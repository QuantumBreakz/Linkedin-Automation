/**
 * Redis connection factory.
 *
 * BullMQ has one non-negotiable requirement: `maxRetriesPerRequest: null`.
 * Blocking commands (`BRPOPLPUSH`, `BZPOPMIN`) sit open for as long as a worker
 * is idle; with a retry cap ioredis aborts them and BullMQ starts throwing
 * `MaxRetriesPerRequestError` on a perfectly healthy queue.
 *
 * Nothing here connects at import time — `lazyConnect` defers the socket to the
 * first command, so importing this module in a unit test is free.
 */

import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

export type { Redis, RedisOptions };

/**
 * Options every connection shares. Exported so a caller constructing its own
 * connection (a BullMQ `Worker`, say) cannot accidentally drop the settings
 * that make blocking commands work.
 */
export const BASE_REDIS_OPTIONS: RedisOptions = {
  /** Required by BullMQ. Do not set a number here. */
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  /** Commands issued before the socket is up are queued, not rejected. */
  enableOfflineQueue: true,
  lazyConnect: true,
  connectTimeout: 10_000,
  keepAlive: 30_000,
  retryStrategy(times: number): number {
    // 100ms, 200ms, 400ms … capped at 10s. Never gives up: a worker that
    // stops reconnecting is a queue that silently stops draining.
    return Math.min(2 ** Math.min(times, 7) * 100, 10_000);
  },
};

let attachedListenerCount = 0;

function attachDiagnostics(connection: Redis, label: string): Redis {
  const log = logger.child({ component: 'redis', connection: label });
  connection.on('error', (error: Error) => {
    log.error('Redis connection error', { err: error });
  });
  connection.on('end', () => {
    log.warn('Redis connection closed');
  });
  connection.on('reconnecting', (delayMs: number) => {
    log.warn('Redis reconnecting', { delayMs });
  });
  attachedListenerCount += 1;
  return connection;
}

export interface CreateConnectionArgs {
  /** Defaults to `REDIS_URL`. */
  url?: string;
  /** Merged over {@link BASE_REDIS_OPTIONS}. */
  options?: RedisOptions;
  /** Shows up in logs; helps tell the queue connection from the limiter's. */
  label?: string;
}

/**
 * Creates a new, independent connection.
 *
 * BullMQ needs a *dedicated* connection per `Worker` and per `QueueScheduler`
 * because blocking commands monopolise a socket — sharing one with the rate
 * limiter would stall the limiter behind an idle worker's `BRPOPLPUSH`.
 */
export function createRedisConnection(args: CreateConnectionArgs = {}): Redis {
  const url = args.url ?? env.REDIS_URL;
  const connection = new Redis(url, { ...BASE_REDIS_OPTIONS, ...args.options });
  return attachDiagnostics(connection, args.label ?? 'anonymous');
}

/**
 * Connection options object for BullMQ's `connection` field, for callers that
 * would rather let BullMQ own the socket lifecycle.
 */
export function bullConnectionOptions(): RedisOptions & { url: string } {
  return { ...BASE_REDIS_OPTIONS, url: env.REDIS_URL };
}

let shared: Redis | undefined;

/**
 * A shared connection for non-blocking work: the rate limiter, idempotency
 * keys, caches. Never hand this to a BullMQ `Worker`.
 */
export function getRedis(): Redis {
  shared ??= createRedisConnection({ label: 'shared' });
  return shared;
}

/** Graceful shutdown for the worker process. */
export async function closeRedis(): Promise<void> {
  const connection = shared;
  if (connection === undefined) return;
  shared = undefined;
  await connection.quit().catch(() => connection.disconnect());
}

/** Diagnostic only — how many connections this module has instrumented. */
export function instrumentedConnectionCount(): number {
  return attachedListenerCount;
}
