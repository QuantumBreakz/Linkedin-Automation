/**
 * BullMQ Queues and job definitions.
 *
 * All background queue instances are defined and exported here.
 * Reusable across both API route producers and background worker consumers.
 */

import { Queue, type DefaultJobOptions } from 'bullmq';
import { createRedisConnection } from '@/lib/redis';

// ─────────────────────  Queue Names  ─────────────────────────────────

export const QUEUE_NAMES = {
  PAPER_INGEST: 'paper.ingest',
  PAPER_ANALYZE: 'paper.analyze',
  DRAFT_GENERATE: 'draft.generate',
  DRAFT_VERIFY: 'draft.verify',
  POST_PUBLISH: 'post.publish',
  TOKEN_WATCH: 'token.watch',
  SOURCES_POLL: 'sources.poll',
  /**
   * Reconciliation sweep for scheduled posts. The safety net behind every
   * `scheduledFor`: it publishes drafts whose time has passed even if the
   * per-draft delayed job was never enqueued (Redis was down when the user
   * scheduled) or was lost (evicted, crashed). Without it a SCHEDULED draft
   * that misses its one delayed job would never publish.
   */
  SCHEDULE_SWEEP: 'schedule.sweep',
  /** Periodic one-way mirror of PostgreSQL into the MongoDB mirror database. */
  MONGO_SYNC: 'mongo.sync',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─────────────────────  Default Job Options  ─────────────────────────

const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 3_000,
  },
  removeOnComplete: {
    age: 24 * 3600, // keep completed jobs for 24h for audit/diagnostics
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // keep failed jobs for 7 days
    count: 5000,
  },
};

// ─────────────────────  Queue Instances  ─────────────────────────────

function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: createRedisConnection({ label: `queue-${name}` }),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

export const paperIngestQueue = createQueue(QUEUE_NAMES.PAPER_INGEST);
export const paperAnalyzeQueue = createQueue(QUEUE_NAMES.PAPER_ANALYZE);
export const draftGenerateQueue = createQueue(QUEUE_NAMES.DRAFT_GENERATE);
export const draftVerifyQueue = createQueue(QUEUE_NAMES.DRAFT_VERIFY);
export const postPublishQueue = createQueue(QUEUE_NAMES.POST_PUBLISH);
export const tokenWatchQueue = createQueue(QUEUE_NAMES.TOKEN_WATCH);
export const sourcesPollQueue = createQueue(QUEUE_NAMES.SOURCES_POLL);
export const scheduleSweepQueue = createQueue(QUEUE_NAMES.SCHEDULE_SWEEP);
export const mongoSyncQueue = createQueue(QUEUE_NAMES.MONGO_SYNC);

