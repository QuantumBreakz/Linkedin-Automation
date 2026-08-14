/**
 * Redis token-bucket rate limiter.
 *
 * Connectors do not sleep by hand — they `await limiter.acquire(host, budget)`
 * and the budgets from docs/01 §D5 are enforced in one place across every
 * worker process:
 *
 *   arXiv    { perSecond: 1,  minDelayMs: 3000 }   // 3s between calls
 *   PubMed   { perSecond: 3 }                      // 10 with an NCBI key
 *   OpenAlex { perSecond: 10 }                     // polite pool
 *
 * Two gates, both enforced in one atomic Lua script:
 *
 *  - **Token bucket** — average rate, with a small burst allowance.
 *  - **`minDelayMs`** — a hard floor between two consecutive acquisitions for
 *    the same key. arXiv's documented budget is a *spacing* requirement, not a
 *    rate; a bucket alone would happily let three calls through back-to-back
 *    after an idle minute, which is exactly what gets an IP blocked.
 *
 * Time comes from `redis.call('TIME')`, not the caller's clock, so several
 * worker hosts with drifting clocks still share one consistent budget.
 */

import type { Redis } from 'ioredis';
import { RateLimitError, ValidationError } from './errors';
import { getRedis } from './redis';

export interface AcquireOptions {
  /** Sustained rate. Must be > 0. */
  perSecond: number;
  /** Minimum gap between two consecutive grants for this key. */
  minDelayMs?: number;
  /**
   * Burst allowance, in tokens. Defaults to `max(1, ceil(perSecond))` — one
   * second's worth. Set to 1 to forbid bursting entirely.
   */
  burst?: number;
  /**
   * Give up after this long and throw `RateLimitError`. Defaults to 60s.
   * A job that waits forever on a saturated key is a stuck queue.
   */
  timeoutMs?: number;
}

export interface RateLimiter {
  /** Resolves once a slot is free. Rejects with `RateLimitError` on timeout. */
  acquire(key: string, options: AcquireOptions): Promise<void>;
  /** Non-blocking probe: grants immediately or reports the wait, without sleeping. */
  tryAcquire(key: string, options: AcquireOptions): Promise<{ granted: boolean; waitMs: number }>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
/** Keys idle for this long are forgotten; a fresh bucket starts full. */
const BUCKET_TTL_MS = 10 * 60_000;
/** Poll granularity floor, so a 1ms wait does not spin. */
const MIN_SLEEP_MS = 5;
/**
 * De-synchronises workers that wake at the same instant. Without it, N workers
 * blocked on the same key all retry together and N-1 lose every round.
 */
const JITTER_MS = 25;

/**
 * KEYS[1] — bucket hash
 * ARGV[1] — refill rate, tokens/second
 * ARGV[2] — capacity, tokens
 * ARGV[3] — minimum spacing, ms
 * ARGV[4] — key TTL, ms
 *
 * Returns 0 when a token was consumed, otherwise the ms to wait before
 * retrying. State is persisted on the deny path too, so a long wait does not
 * repeatedly recompute the same refill from a stale timestamp.
 */
const ACQUIRE_SCRIPT = `
local now_parts = redis.call('TIME')
local now = (tonumber(now_parts[1]) * 1000) + math.floor(tonumber(now_parts[2]) / 1000)

local rate      = tonumber(ARGV[1])
local capacity  = tonumber(ARGV[2])
local min_delay = tonumber(ARGV[3])
local ttl       = tonumber(ARGV[4])

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts', 'last')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])
local last   = tonumber(state[3])

if tokens == nil then tokens = capacity end
if ts == nil then ts = now end
if last == nil then last = -min_delay end

-- Refill for elapsed time. Clock can only move forward for our purposes.
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + (elapsed * rate / 1000.0))
ts = now

-- Gate 1: minimum spacing since the last grant.
local wait = 0
local spacing_wait = (last + min_delay) - now
if spacing_wait > wait then wait = spacing_wait end

-- Gate 2: a whole token must be available.
if tokens < 1 then
  local token_wait = math.ceil(((1 - tokens) * 1000.0) / rate)
  if token_wait > wait then wait = token_wait end
end

if wait > 0 then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', ts, 'last', last)
  redis.call('PEXPIRE', KEYS[1], ttl)
  return math.ceil(wait)
end

tokens = tokens - 1
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', ts, 'last', now)
redis.call('PEXPIRE', KEYS[1], ttl)
return 0
`;

/** Runs the Lua and returns the ms to wait (0 = granted). Injectable for tests. */
export type ScriptRunner = (
  key: string,
  args: readonly string[],
) => Promise<number>;

export interface CreateRateLimiterArgs {
  redis?: Redis;
  /** Overrides the Redis-backed evaluator. Tests use this; production does not. */
  run?: ScriptRunner;
  keyPrefix?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for the timeout budget. */
  now?: () => number;
  /** Injectable jitter, in [0, JITTER_MS). Tests pass `() => 0`. */
  jitter?: () => number;
}

/** Validates and fills in the derived fields of an {@link AcquireOptions}. */
export function normaliseOptions(options: AcquireOptions): Required<AcquireOptions> {
  const { perSecond } = options;
  if (!Number.isFinite(perSecond) || perSecond <= 0) {
    throw new ValidationError(`perSecond must be a positive number, got ${String(perSecond)}.`);
  }

  const minDelayMs = options.minDelayMs ?? 0;
  if (!Number.isFinite(minDelayMs) || minDelayMs < 0) {
    throw new ValidationError(`minDelayMs must be >= 0, got ${String(minDelayMs)}.`);
  }

  const burst = options.burst ?? Math.max(1, Math.ceil(perSecond));
  if (!Number.isFinite(burst) || burst < 1) {
    throw new ValidationError(`burst must be >= 1, got ${String(burst)}.`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ValidationError(`timeoutMs must be > 0, got ${String(timeoutMs)}.`);
  }

  return { perSecond, minDelayMs, burst, timeoutMs };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createRateLimiter(args: CreateRateLimiterArgs = {}): RateLimiter {
  const keyPrefix = args.keyPrefix ?? 'ratelimit';
  const sleep = args.sleep ?? defaultSleep;
  const now = args.now ?? Date.now;
  const jitter = args.jitter ?? (() => Math.random() * JITTER_MS);
  const run: ScriptRunner = args.run ?? redisRunner(args.redis);

  async function attempt(
    key: string,
    settings: Required<AcquireOptions>,
  ): Promise<number> {
    const waitMs = await run(`${keyPrefix}:${key}`, [
      String(settings.perSecond),
      String(settings.burst),
      String(settings.minDelayMs),
      String(BUCKET_TTL_MS + settings.minDelayMs),
    ]);
    if (!Number.isFinite(waitMs)) {
      // A non-numeric reply means the script or the connection is broken.
      // Granting on garbage would silently disable the politeness budget.
      throw new RateLimitError(
        `Rate limiter returned a non-numeric wait for '${key}': ${String(waitMs)}.`,
      );
    }
    return waitMs > 0 ? waitMs : 0;
  }

  return {
    async tryAcquire(key, options) {
      const settings = normaliseOptions(options);
      const waitMs = await attempt(key, settings);
      return { granted: waitMs === 0, waitMs };
    },

    async acquire(key, options) {
      const settings = normaliseOptions(options);
      const deadline = now() + settings.timeoutMs;

      for (;;) {
        const waitMs = await attempt(key, settings);
        if (waitMs === 0) return;

        const remaining = deadline - now();
        if (remaining <= 0 || waitMs > remaining) {
          throw new RateLimitError(
            `Timed out after ${settings.timeoutMs}ms waiting for rate-limit slot '${key}' ` +
              `(${settings.perSecond}/s, minDelay ${settings.minDelayMs}ms); next slot in ${waitMs}ms.`,
            waitMs,
          );
        }

        await sleep(Math.max(MIN_SLEEP_MS, waitMs + jitter()));
      }
    },
  };
}

/**
 * Redis-backed evaluator. Uses `EVALSHA` with a one-time `EVAL` fallback, so
 * the script body is sent once per Redis instance rather than per call.
 */
function redisRunner(injected?: Redis): ScriptRunner {
  let cachedSha: string | undefined;
  const connection = (): Redis => injected ?? getRedis();

  return async (key, args) => {
    const redis = connection();
    if (cachedSha === undefined) {
      cachedSha = await redis.script('LOAD', ACQUIRE_SCRIPT) as string;
    }
    try {
      const result = await redis.evalsha(cachedSha, 1, key, ...args);
      return Number(result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('NOSCRIPT')) {
        // Redis restarted or the script cache was flushed.
        cachedSha = undefined;
        const result = await redis.eval(ACQUIRE_SCRIPT, 1, key, ...args);
        return Number(result);
      }
      throw error;
    }
  };
}

let shared: RateLimiter | undefined;

/** Process-wide limiter over the shared Redis connection. */
export function getRateLimiter(): RateLimiter {
  shared ??= createRateLimiter();
  return shared;
}

/** Test hook: drop the memoised limiter. */
export function resetRateLimiterCache(): void {
  shared = undefined;
}

/**
 * The politeness budgets from docs/01 §D5, in one place so no connector has to
 * remember them. Keyed by external host.
 */
export const HOST_BUDGETS: Readonly<Record<string, AcquireOptions>> = {
  'export.arxiv.org': { perSecond: 1, minDelayMs: 3_000, burst: 1 },
  'eutils.ncbi.nlm.nih.gov': { perSecond: 3, burst: 3 },
  'api.openalex.org': { perSecond: 10, burst: 10 },
  'pub.orcid.org': { perSecond: 5, burst: 5 },
  'api.crossref.org': { perSecond: 5, burst: 5 },
  'api.unpaywall.org': { perSecond: 5, burst: 5 },
  'api.linkedin.com': { perSecond: 5, burst: 5 },
  'openrouter.ai': { perSecond: 5, burst: 5 },
};

/** Budget for `host`, falling back to a conservative 2/s for unknown hosts. */
export function budgetForHost(host: string): AcquireOptions {
  return HOST_BUDGETS[host.toLowerCase()] ?? { perSecond: 2, burst: 2 };
}
