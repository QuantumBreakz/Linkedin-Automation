/**
 * Inline discovery pipeline.
 *
 * Runs the same poll → ingest → analyse → draft chain the BullMQ worker runs,
 * but directly in the calling process, so adding a source starts producing
 * papers (and, for AUTOMATIC users, scheduled drafts) even when no separate
 * worker is running. Every stage is idempotent — ingest dedupes on
 * canonicalKey, analysis upserts, draft generation is one-per-paper — so this
 * and the worker can both run without duplicating anything.
 */

import { logger } from '@/lib/logger';
import { pollSources } from '@/worker/processors/poll.processor';
import { analyzePaper, MIN_DRAFT_CONFIDENCE } from '@/worker/processors/analyze.processor';
import { generatePaperDraft } from '@/worker/processors/draft.processor';

/**
 * Cap on how many freshly discovered papers get analysed + drafted in one run,
 * so connecting a prolific ORCID does not fire dozens of LLM calls (and, for
 * AUTOMATIC users, dozens of scheduled posts) at once. The rest are still
 * ingested — visible in the inbox and available to the chat assistant — and can
 * be drafted on demand.
 */
const MAX_AUTO_DRAFT = 5;

export interface SourcePipelineResult {
  ingested: number;
  drafted: number;
}

/** Poll + ingest a source, then analyse and draft its most recent new papers. */
export async function runPipelineForSource(
  sourceId: string,
  opts: { maxAutoDraft?: number } = {},
): Promise<SourcePipelineResult> {
  const maxAutoDraft = opts.maxAutoDraft ?? MAX_AUTO_DRAFT;

  const { created } = await pollSources(sourceId);
  logger.info('Inline pipeline ingested papers', { sourceId, ingested: created.length });

  let drafted = 0;
  for (const { paperId, userId } of created.slice(0, maxAutoDraft)) {
    try {
      const { analysisId, confidence } = await analyzePaper(paperId, userId);
      if (analysisId && confidence >= MIN_DRAFT_CONFIDENCE) {
        const { draftId } = await generatePaperDraft(paperId, userId);
        if (draftId) drafted += 1;
      }
    } catch (err) {
      // One paper failing (e.g. an LLM hiccup) must not abort the rest.
      logger.error('Inline pipeline failed for a paper', { paperId, err });
    }
  }

  logger.info('Inline pipeline finished', { sourceId, ingested: created.length, drafted });
  return { ingested: created.length, drafted };
}
