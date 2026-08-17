/**
 * Source polling processor — fetches works from registered research sources
 * and dispatches them to ingestion and analysis.
 */

import type { Job } from 'bullmq';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getAdapter } from '@/services/sources/adapter';
import { processIngestJob } from '@/services/ingest/paper-ingest';
import { paperAnalyzeQueue } from '../queues';

// Ensure adapters are registered
import '@/services/sources/adapters';

export interface PollJobData {
  sourceId?: string;
}

export async function processPollJob(job: Job<PollJobData>): Promise<void> {
  const { sourceId } = job.data;
  logger.info('Running source poll job', { sourceId });

  const sources = await db.researchSource.findMany({
    where: sourceId
      ? { id: sourceId, syncStatus: { not: 'DISABLED' } }
      : { syncStatus: { not: 'DISABLED' } },
  });

  for (const source of sources) {
    try {
      const adapter = getAdapter(source.kind);
      if (!adapter) {
        logger.warn('No adapter registered for source kind', { kind: source.kind, sourceId: source.id });
        continue;
      }

      const fetchResult = await adapter.fetch(
        source.identifier,
        (source.config as Record<string, unknown>) ?? {},
        source.cursor,
      );

      if (fetchResult.rateLimited) {
        logger.warn('Source fetch rate limited — will retry next tick', { sourceId: source.id });
        continue;
      }

      logger.info('Fetched papers from source', {
        sourceId: source.id,
        count: fetchResult.papers.length,
      });

      for (const paper of fetchResult.papers) {
        const ingestResult = await processIngestJob({
          userId: source.userId,
          sourceId: source.id,
          paper,
        });

        if (ingestResult.action === 'created' && ingestResult.paperId) {
          // Queue automatic analysis for new papers
          await paperAnalyzeQueue.add(`analyze-${ingestResult.paperId}`, {
            paperId: ingestResult.paperId,
            userId: source.userId,
            autoDraft: true,
          });
        }
      }

      // Update source cursor and last checked time.
      //
      // Store nextCursor verbatim — including null. Per the adapter contract a
      // null nextCursor means "all pages fetched for this sync cycle", and every
      // paginated adapter sorts newest-first, so resetting to null is what makes
      // the *next* cycle start again at page 0 and pick up newly published work
      // (already-seen papers dedupe on canonicalKey, so re-scanning is cheap and
      // never re-drafts). The old `?? source.cursor` fallback pinned the cursor
      // at the final offset forever, so after the initial backfill the poller
      // re-fetched the same trailing page and never saw a new paper again.
      await db.researchSource.update({
        where: { id: source.id },
        data: {
          cursor: fetchResult.nextCursor,
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
          syncStatus: 'OK',
          consecutiveFailures: 0,
          lastError: null,
        },
      });
    } catch (err) {
      logger.error('Error polling source', { sourceId: source.id, err });
      await db.researchSource.update({
        where: { id: source.id },
        data: {
          lastCheckedAt: new Date(),
          syncStatus: 'FAILING',
          consecutiveFailures: { increment: 1 },
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}
