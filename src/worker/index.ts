/**
 * Background worker runtime entrypoint.
 *
 * Runs BullMQ workers and schedules recurring tasks.
 * Start via: `npm run worker`
 */

import { Worker } from 'bullmq';
import { createRedisConnection, closeRedis } from '@/lib/redis';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { QUEUE_NAMES, sourcesPollQueue, tokenWatchQueue, scheduleSweepQueue } from './queues';
import { processAnalyzeJob } from './processors/analyze.processor';
import { processDraftJob } from './processors/draft.processor';
import { processPublishJob } from './processors/publish.processor';
import { processPollJob } from './processors/poll.processor';
import { processTokenWatchJob } from './processors/token-watch.processor';
import { processScheduleSweepJob } from './processors/schedule-sweep.processor';

// ─────────────────────  Worker Setup  ────────────────────────────────

const workers: Worker[] = [
  new Worker(QUEUE_NAMES.PAPER_ANALYZE, processAnalyzeJob, {
    connection: createRedisConnection({ label: 'worker-analyze' }),
    concurrency: 3,
  }),
  new Worker(QUEUE_NAMES.DRAFT_GENERATE, processDraftJob, {
    connection: createRedisConnection({ label: 'worker-draft' }),
    concurrency: 3,
  }),
  new Worker(QUEUE_NAMES.POST_PUBLISH, processPublishJob, {
    connection: createRedisConnection({ label: 'worker-publish' }),
    concurrency: 2,
  }),
  new Worker(QUEUE_NAMES.SOURCES_POLL, processPollJob, {
    connection: createRedisConnection({ label: 'worker-poll' }),
    concurrency: 1,
  }),
  new Worker(QUEUE_NAMES.TOKEN_WATCH, processTokenWatchJob, {
    connection: createRedisConnection({ label: 'worker-token-watch' }),
    concurrency: 1,
  }),
  // Single instance, no concurrency: the sweep is a serial reconciliation pass
  // and its own claims already guard against a second one overlapping.
  new Worker(QUEUE_NAMES.SCHEDULE_SWEEP, processScheduleSweepJob, {
    connection: createRedisConnection({ label: 'worker-schedule-sweep' }),
    concurrency: 1,
  }),
];

// Error listeners
for (const worker of workers) {
  worker.on('error', (err) => {
    logger.error('Worker error', { worker: worker.name, err });
  });
  worker.on('failed', (job, err) => {
    logger.error('Job failed', { worker: worker.name, jobId: job?.id, err });
  });
}

// ─────────────────────  Cron Schedules  ──────────────────────────────

async function scheduleCronJobs(): Promise<void> {
  // Source polling: every 1 hour (3600000 ms)
  await sourcesPollQueue.upsertJobScheduler('hourly-source-poll', {
    every: 60 * 60 * 1000,
  });

  // Token watch: every 6 hours (21600000 ms)
  await tokenWatchQueue.upsertJobScheduler('token-expiry-watch', {
    every: 6 * 60 * 60 * 1000,
  });

  // Schedule sweep: every minute. Publishes due drafts and recovers crashed
  // publish locks. This is what makes a `scheduledFor` a promise rather than a
  // hope pinned on one delayed job surviving.
  await scheduleSweepQueue.upsertJobScheduler('schedule-sweep', {
    every: 60 * 1000,
  });

  logger.info('Registered repeatable cron jobs (sources poll, token watch & schedule sweep)');
}

// ─────────────────────  Lifecycle  ───────────────────────────────────

async function start(): Promise<void> {
  logger.info('Research-to-LinkedIn worker engine started');
  await scheduleCronJobs();
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down worker gracefully...');
  await Promise.all(workers.map((w) => w.close()));
  await closeRedis();
  await db.$disconnect();
  logger.info('Worker shutdown complete');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  logger.error('Fatal error starting worker', { err });
  process.exit(1);
});
