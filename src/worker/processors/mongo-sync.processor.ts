/**
 * Mongo mirror processor — periodically copies PostgreSQL into the MongoDB
 * mirror. Registered as a repeatable job only when MONGODB_URI is configured;
 * the guard here is a second belt so a stray job is a no-op rather than a throw.
 */

import type { Job } from 'bullmq';
import { logger } from '@/lib/logger';
import { mongoConfigured } from '@/lib/mongo';
import { syncAllToMongo } from '@/services/sync/mongo-sync';

export async function processMongoSyncJob(_job: Job): Promise<void> {
  if (!mongoConfigured()) return;
  const result = await syncAllToMongo();
  logger.info('Scheduled Mongo mirror sync finished', {
    total: result.total,
    collections: Object.keys(result.counts).length,
  });
}
