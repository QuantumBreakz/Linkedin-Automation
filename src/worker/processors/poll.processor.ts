/**
 * Source polling processor — fetches works from registered research sources
 * and ingests them.
 *
 * The polling itself lives in `pollSources`, a plain function so it can run in
 * this BullMQ worker *or* inline in the web process (see
 * services/pipeline/run.ts) — the app must not depend on a separate worker
 * being up for a freshly added source to start discovering papers.
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

/** A paper newly created during a poll, with the owner it belongs to. */
export interface CreatedPaper {
  paperId: string;
  userId: string;
}

/**
 * Polls one source (or every active source when `sourceId` is omitted), ingests
 * each fetched paper, and returns the papers that were newly created this run —
 * leaving the caller to decide how analysis is dispatched (enqueued by the
 * worker, or run inline). Never throws for a single bad source: it records the
 * failure on that source row and moves on.
 */
export async function pollSources(sourceId?: string): Promise<{ created: CreatedPaper[] }> {
  const created: CreatedPaper[] = [];

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
          created.push({ paperId: ingestResult.paperId, userId: source.userId });
        }
      }

      // Store nextCursor verbatim — including null. Per the adapter contract a
      // null nextCursor means "all pages fetched for this sync cycle", and every
      // paginated adapter sorts newest-first, so resetting to null is what makes
      // the *next* cycle start again at page 0 and pick up newly published work
      // (already-seen papers dedupe on canonicalKey, so re-scanning is cheap and
      // never re-drafts).
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

  return { created };
}

export async function processPollJob(job: Job<PollJobData>): Promise<void> {
  const { sourceId } = job.data;
  logger.info('Running source poll job', { sourceId });

  const { created } = await pollSources(sourceId);
  for (const { paperId, userId } of created) {
    await paperAnalyzeQueue.add(`analyze-${paperId}`, { paperId, userId, autoDraft: true });
  }
}
