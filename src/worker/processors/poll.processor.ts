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
import '@/services/sources/adapters/openalex';
import '@/services/sources/adapters/orcid';

export interface PollJobData {
  sourceId?: string;
}

export async function processPollJob(job: Job<PollJobData>): Promise<void> {
  const { sourceId } = job.data;
  logger.info('Running source poll job', { sourceId });

  const whereClause = sourceId ? { id: sourceId, status: 'ACTIVE' as const } : { status: 'ACTIVE' as const };
  const sources = await db.researchSource.findMany({
    where: whereClause,
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

      // Update source cursor and last checked time
      await db.researchSource.update({
        where: { id: source.id },
        data: {
          cursor: fetchResult.nextCursor ?? source.cursor,
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
