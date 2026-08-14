/**
 * Paper Analysis processor — runs Stage 1 Extraction on ingested papers.
 */

import type { Job } from 'bullmq';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { extractResearch } from '@/services/analysis/extract';
import { openRouterProvider } from '@/services/llm/provider';
import { draftGenerateQueue } from '../queues';

export interface AnalyzeJobData {
  paperId: string;
  userId: string;
  autoDraft?: boolean;
}

export async function processAnalyzeJob(job: Job<AnalyzeJobData>): Promise<void> {
  const { paperId, userId, autoDraft = true } = job.data;
  logger.info('Starting research extraction for paper', { paperId, userId });

  const paper = await db.researchPaper.findUnique({
    where: { id: paperId },
  });

  if (!paper) {
    logger.warn('Paper not found for analysis job', { paperId });
    return;
  }

  if (paper.isRetracted) {
    logger.info('Skipping extraction for retracted paper', { paperId });
    return;
  }

  // Run Stage 1 extraction
  const result = await extractResearch(
    {
      title: paper.title,
      abstract: paper.abstract,
      fullText: null, // Full-text fetch hook can be attached here when available
      fullTextStatus: paper.fullTextStatus,
    },
    openRouterProvider,
    { userId, paperId },
  );

  // Store in database
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

  // Automatically queue draft generation if eligible and requested
  if (autoDraft && result.confidence >= 0.2) {
    await draftGenerateQueue.add(`draft-${paperId}`, {
      paperId,
      userId,
      analysisId: analysis.id,
    });
  }
}
