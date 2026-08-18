/**
 * One-way mirror: PostgreSQL (system of record) → MongoDB.
 *
 * Every app table is copied into a same-named collection in the mirror
 * database. Each row's cuid becomes the Mongo `_id`, so a re-run upserts rather
 * than duplicates, and rows deleted in Postgres are removed from Mongo too —
 * the mirror always matches the source, it never just grows.
 *
 * This is deliberately a periodic full mirror, not a per-write hook: it cannot
 * wedge a Postgres transaction, a failed sync never blocks the app, and it is
 * safe to run as often or as rarely as you like.
 *
 * Nothing decrypts anything on the way out — encrypted token columns (Bytes)
 * are mirrored as-is, so the ciphertext in Mongo is exactly the ciphertext in
 * Postgres.
 */

import { Prisma } from '@prisma/client';
import type { Db } from 'mongodb';
import { db } from '@/lib/db';
import { getMongoDb } from '@/lib/mongo';
import { logger } from '@/lib/logger';

interface MirrorDoc {
  _id: string;
  id: string;
  [field: string]: unknown;
}

/**
 * Prisma model delegate → Mongo collection. `_prisma_migrations` is internal
 * and intentionally excluded.
 */
const MODELS: ReadonlyArray<{ key: string; collection: string }> = [
  { key: 'user', collection: 'users' },
  { key: 'brandProfile', collection: 'brandProfiles' },
  { key: 'linkedInAccount', collection: 'linkedInAccounts' },
  { key: 'researchSource', collection: 'researchSources' },
  { key: 'researchPaper', collection: 'researchPapers' },
  { key: 'paperAuthor', collection: 'paperAuthors' },
  { key: 'paperSourceLink', collection: 'paperSourceLinks' },
  { key: 'paperAnalysis', collection: 'paperAnalyses' },
  { key: 'contentDraft', collection: 'contentDrafts' },
  { key: 'visualAsset', collection: 'visualAssets' },
  { key: 'scheduleSlot', collection: 'scheduleSlots' },
  { key: 'publishedPost', collection: 'publishedPosts' },
  { key: 'postMetric', collection: 'postMetrics' },
  { key: 'chatConversation', collection: 'chatConversations' },
  { key: 'chatMessage', collection: 'chatMessages' },
  { key: 'llmRequest', collection: 'llmRequests' },
  { key: 'pipelineRun', collection: 'pipelineRuns' },
];

/** Postgres row → Mongo document. `_id` is set from the filter on upsert, so it
 *  is left off the body here; Decimal is stringified to keep full precision. */
function toMongoDoc(row: Record<string, unknown>): Omit<MirrorDoc, '_id'> {
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    doc[key] = value instanceof Prisma.Decimal ? value.toString() : value;
  }
  return doc as Omit<MirrorDoc, '_id'>;
}

async function mirrorModel(mongo: Db, modelKey: string, collection: string): Promise<number> {
  // The delegate is looked up by name; every model exposes findMany().
  const delegate = (db as unknown as Record<string, { findMany: () => Promise<Record<string, unknown>[]> }>)[modelKey];
  const rows = await delegate.findMany();
  const coll = mongo.collection<MirrorDoc>(collection);

  if (rows.length > 0) {
    await coll.bulkWrite(
      rows.map((row) => ({
        replaceOne: {
          filter: { _id: row.id as string },
          replacement: toMongoDoc(row),
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  // Keep the mirror faithful: remove docs whose source row no longer exists.
  const ids = rows.map((row) => row.id as string);
  await coll.deleteMany(ids.length > 0 ? { _id: { $nin: ids } } : {});

  return rows.length;
}

export interface MongoSyncResult {
  syncedAt: string;
  counts: Record<string, number>;
  total: number;
}

/** Mirrors every table into MongoDB and records the run in a `_sync` doc. */
export async function syncAllToMongo(now: Date = new Date()): Promise<MongoSyncResult> {
  const mongo = await getMongoDb();

  const counts: Record<string, number> = {};
  let total = 0;
  for (const { key, collection } of MODELS) {
    const n = await mirrorModel(mongo, key, collection);
    counts[collection] = n;
    total += n;
  }

  const result: MongoSyncResult = { syncedAt: now.toISOString(), counts, total };

  await mongo
    .collection<{ _id: string } & MongoSyncResult>('_sync')
    .replaceOne({ _id: 'last' }, { ...result }, { upsert: true });

  logger.info('Mongo mirror sync complete', { total, collections: MODELS.length });
  return result;
}
