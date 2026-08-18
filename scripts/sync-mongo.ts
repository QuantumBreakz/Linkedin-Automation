/**
 * On-demand mirror: `npm run sync:mongo`.
 *
 * Copies the whole PostgreSQL database into the MongoDB mirror once and exits.
 * Use it for the initial backfill, or any time you want an immediate sync
 * rather than waiting for the worker's periodic pass.
 */

import 'dotenv/config';
import { syncAllToMongo } from '@/services/sync/mongo-sync';
import { mongoConfigured, closeMongo } from '@/lib/mongo';
import { db } from '@/lib/db';

async function main(): Promise<void> {
  if (!mongoConfigured()) {
    console.error('MONGODB_URI is not set in your environment / .env — nothing to sync.');
    process.exitCode = 1;
    return;
  }

  console.log('Mirroring PostgreSQL → MongoDB…');
  const result = await syncAllToMongo();

  console.log(
    `\nDone ${result.syncedAt} — ${result.total} documents across ` +
      `${Object.keys(result.counts).length} collections:`,
  );
  for (const [collection, n] of Object.entries(result.counts)) {
    console.log(`  ${collection.padEnd(20)} ${n}`);
  }
}

main()
  .catch((err) => {
    console.error('Mongo sync failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => {});
    await db.$disconnect().catch(() => {});
  });
