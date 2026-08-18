/**
 * MongoDB client for the one-way Postgres → Mongo mirror.
 *
 * PostgreSQL stays this app's system of record — the request path, the dedup
 * engine (pg_trgm) and the job queues all depend on it. MongoDB is only a
 * mirror the sync layer writes into (see services/sync/mongo-sync.ts); nothing
 * reads from it. The mirror lives in its own database (`MONGODB_DB`, default
 * `research_linkedin`) so it never collides with other projects that share the
 * same cluster.
 *
 * Read straight from `process.env` — like services/llm/config — so a script or
 * the worker can use it without pulling in the full validated env schema, and
 * so the mirror stays entirely optional: with no `MONGODB_URI` set, nothing
 * connects and the sync is a no-op.
 */

import { MongoClient, type Db } from 'mongodb';

let client: MongoClient | undefined;

/** True when a MongoDB mirror target is configured. */
export function mongoConfigured(): boolean {
  return typeof process.env.MONGODB_URI === 'string' && process.env.MONGODB_URI.trim() !== '';
}

/** The mirror database, connecting on first use. Throws if unconfigured. */
export async function getMongoDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.trim() === '') {
    throw new Error('MONGODB_URI is not set — cannot mirror to MongoDB.');
  }
  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB?.trim() || 'research_linkedin');
}

/** Closes the shared connection (scripts call this so the process can exit). */
export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}
