/**
 * Paper Analysis processor — runs Stage 1 Extraction on ingested papers.
 *
 * The extraction lives in `analyzePaper`, a plain function usable from this
 * BullMQ worker or inline (services/pipeline/run.ts).
 */

import type { Job } from 'bullmq';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { runStage } from '@/lib/stage';
import { extractResearch } from '@/services/analysis/extract';
import { openRouterProvider } from '@/services/llm/provider';
import { draftGenerateQueue } from '../queues';

export interface AnalyzeJobData {
  paperId: string;
  userId: string;
  autoDraft?: boolean;
}

/** Confidence below this is treated as too weak to auto-draft from. */
export const MIN_DRAFT_CONFIDENCE = 0.2;

export interface AnalyzeResult {
  analysisId: string | null;
  confidence: number;
}

/**
 * Runs extraction for one paper and stores it as analysis v1 (idempotent
 * upsert). Returns the analysis id and confidence so the caller can decide
 * whether to draft. Returns a null id for a paper that cannot be analysed
 * (missing or retracted).
 */
export async function analyzePaper(paperId: string, userId: string): Promise<AnalyzeResult> {
  return runStage('analyze', { refType: 'paper', refId: paperId }, async () => {
    const paper = await db.researchPaper.findUnique({ where: { id: paperId } });
    if (!paper) {
      logger.warn('Paper not found for analysis job', { paperId });
      return { analysisId: null, confidence: 0 };
    }
    if (paper.isRetracted) {
      logger.info('Skipping extraction for retracted paper', { paperId });
      return { analysisId: null, confidence: 0 };
    }

    const result = await extractResearch(
      {
        title: paper.title,
        abstract: paper.abstract,
        fullText: null,
        fullTextStatus: paper.fullTextStatus,
      },
      openRouterProvider,
      { userId, paperId },
    );

    const analysis = await db.paperAnalysis.upsert({
      where: { paperId_version: { paperId, version: 1 } },
      create: {
        paperId,
        version: 1,
        extraction: result.extraction as object,
        provenance: result.provenance,
        confidence: result.confidence,
        basedOn: result.basedOn,
        modelId: result.modelId,
        promptHash: result.promptHash,
      },
      update: {
        extraction: result.extraction as object,
        provenance: result.provenance,
        confidence: result.confidence,
        basedOn: result.basedOn,
        modelId: result.modelId,
        promptHash: result.promptHash,
      },
    });

    logger.info('Research extraction completed', {
      paperId,
      confidence: result.confidence,
      modelId: result.modelId,
    });

    return { analysisId: analysis.id, confidence: result.confidence };
  });
}

export async function processAnalyzeJob(job: Job<AnalyzeJobData>): Promise<void> {
  const { paperId, userId, autoDraft = true } = job.data;
  const { analysisId, confidence } = await analyzePaper(paperId, userId);

  if (autoDraft && analysisId && confidence >= MIN_DRAFT_CONFIDENCE) {
    await draftGenerateQueue.add(`draft-${paperId}`, { paperId, userId, analysisId });
  }
}
