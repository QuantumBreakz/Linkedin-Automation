import { describe, expect, it } from 'vitest';
import { RateLimitError, ValidationError } from './errors';
import {
  budgetForHost,
  createRateLimiter,
  normaliseOptions,
  HOST_BUDGETS,
  type ScriptRunner,
} from './ratelimit';

/**
 * These tests cover the client-side control flow — option validation, the
 * wait/retry loop, the timeout budget, and key construction. The Lua script
 * itself is exercised by integration tests against a real Redis; unit tests
 * here never open a socket.
 */

interface Recorded {
  key: string;
  args: readonly string[];
}

/** A scripted evaluator: returns each queued wait in turn, then 0 forever. */
function scriptedRunner(waits: number[]): { run: ScriptRunner; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const queue = [...waits];
  const run: ScriptRunner = async (key, args) => {
    calls.push({ key, args });
    return queue.length > 0 ? (queue.shift() as number) : 0;
  };
  return { run, calls };
}

function fakeSleeper() {
  const slept: number[] = [];
  let clock = 0;
  return {
    slept,
    now: (): number => clock,
    sleep: async (ms: number): Promise<void> => {
      slept.push(ms);
      clock += ms;
    },
  };
}

describe('normaliseOptions', () => {
  it('derives a one-second burst by default', () => {
    expect(normaliseOptions({ perSecond: 3 })).toEqual({
      perSecond: 3,
      minDelayMs: 0,
      burst: 3,
      timeoutMs: 60_000,
    });
  });

  it('rounds a fractional rate up to at least one token of burst', () => {
    expect(normaliseOptions({ perSecond: 0.33 }).burst).toBe(1);
  });

  it('keeps an explicit burst', () => {
    expect(normaliseOptions({ perSecond: 10, burst: 1 }).burst).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects perSecond=%s',
    (perSecond) => {
      expect(() => normaliseOptions({ perSecond })).toThrow(ValidationError);
    },
  );

  it('rejects a negative minDelayMs', () => {
    expect(() => normaliseOptions({ perSecond: 1, minDelayMs: -1 })).toThrow(ValidationError);
  });

  it('rejects a burst below one', () => {
    expect(() => normaliseOptions({ perSecond: 1, burst: 0 })).toThrow(ValidationError);
  });

  it('rejects a non-positive timeout', () => {
    expect(() => normaliseOptions({ perSecond: 1, timeoutMs: 0 })).toThrow(ValidationError);
  });
});

describe('acquire', () => {
  it('returns immediately when a slot is free', async () => {
    const { run, calls } = scriptedRunner([]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep, now: clock.now, jitter: () => 0 });

    await limiter.acquire('api.openalex.org', { perSecond: 10 });

    expect(calls).toHaveLength(1);
    expect(clock.slept).toEqual([]);
  });

  it('waits the reported time and retries until granted', async () => {
    const { run, calls } = scriptedRunner([3_000, 1_500]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep, now: clock.now, jitter: () => 0 });

    await limiter.acquire('export.arxiv.org', { perSecond: 1, minDelayMs: 3_000 });

    expect(clock.slept).toEqual([3_000, 1_500]);
    expect(calls).toHaveLength(3);
  });

  it('never sleeps for less than the polling floor', async () => {
    const { run } = scriptedRunner([1]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep, now: clock.now, jitter: () => 0 });

    await limiter.acquire('k', { perSecond: 100 });

    expect(clock.slept[0]).toBeGreaterThanOrEqual(5);
  });

  it('adds jitter so competing workers do not retry in lockstep', async () => {
    const { run } = scriptedRunner([1_000]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({
      run,
      sleep: clock.sleep,
      now: clock.now,
      jitter: () => 17,
    });

    await limiter.acquire('k', { perSecond: 1 });

    expect(clock.slept).toEqual([1_017]);
  });

  it('throws RateLimitError rather than waiting past the timeout', async () => {
    const { run } = scriptedRunner([5_000, 5_000, 5_000]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep, now: clock.now, jitter: () => 0 });

    await expect(
      limiter.acquire('export.arxiv.org', { perSecond: 1, timeoutMs: 6_000 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('does not start a sleep it knows will exceed the deadline', async () => {
    const { run } = scriptedRunner([30_000]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep, now: clock.now, jitter: () => 0 });

    await expect(limiter.acquire('k', { perSecond: 1, timeoutMs: 1_000 })).rejects.toThrow(
      RateLimitError,
    );
    expect(clock.slept).toEqual([]);
  });

  it('reports the next available slot on timeout, for the caller to log', async () => {
    const { run } = scriptedRunner([9_000]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep, now: clock.now, jitter: () => 0 });

    await expect(
      limiter.acquire('k', { perSecond: 1, timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ retryAfterMs: 9_000 });
  });

  it('refuses to grant on a non-numeric reply instead of failing open', async () => {
    // A broken script must not silently disable the politeness budget.
    const run: ScriptRunner = async () => Number.NaN;
    const limiter = createRateLimiter({ run });
    await expect(limiter.acquire('k', { perSecond: 1 })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('validates options before touching Redis', async () => {
    let called = false;
    const run: ScriptRunner = async () => {
      called = true;
      return 0;
    };
    const limiter = createRateLimiter({ run });

    await expect(limiter.acquire('k', { perSecond: 0 })).rejects.toBeInstanceOf(ValidationError);
    expect(called).toBe(false);
  });
});

describe('script arguments', () => {
  it('namespaces the key and passes rate, burst, minDelay and TTL', async () => {
    const { run, calls } = scriptedRunner([]);
    const limiter = createRateLimiter({ run, keyPrefix: 'rl' });

    await limiter.acquire('export.arxiv.org', { perSecond: 1, minDelayMs: 3_000, burst: 1 });

    expect(calls[0]?.key).toBe('rl:export.arxiv.org');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['1', '1', '3000']);
    // TTL must outlive the spacing requirement, or the bucket forgets `last`
    // and lets two calls through back to back.
    expect(Number(calls[0]?.args[3])).toBeGreaterThan(3_000);
  });

  it('keeps different keys independent', async () => {
    const { run, calls } = scriptedRunner([]);
    const limiter = createRateLimiter({ run });

    await limiter.acquire('a', { perSecond: 1 });
    await limiter.acquire('b', { perSecond: 1 });

    expect(calls.map((c) => c.key)).toEqual(['ratelimit:a', 'ratelimit:b']);
  });
});

describe('tryAcquire', () => {
  it('reports a grant without sleeping', async () => {
    const { run } = scriptedRunner([]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep });

    expect(await limiter.tryAcquire('k', { perSecond: 5 })).toEqual({ granted: true, waitMs: 0 });
    expect(clock.slept).toEqual([]);
  });

  it('reports the wait without sleeping', async () => {
    const { run } = scriptedRunner([2_500]);
    const clock = fakeSleeper();
    const limiter = createRateLimiter({ run, sleep: clock.sleep });

    expect(await limiter.tryAcquire('k', { perSecond: 1 })).toEqual({
      granted: false,
      waitMs: 2_500,
    });
    expect(clock.slept).toEqual([]);
  });
});

describe('HOST_BUDGETS — docs/01 §D5', () => {
  it('enforces arXiv 3s spacing with no bursting', () => {
    expect(HOST_BUDGETS['export.arxiv.org']).toEqual({
      perSecond: 1,
      minDelayMs: 3_000,
      burst: 1,
    });
  });

  it('holds PubMed at the keyless 3 req/s budget', () => {
    expect(HOST_BUDGETS['eutils.ncbi.nlm.nih.gov']?.perSecond).toBe(3);
  });

  it('resolves a known host', () => {
    expect(budgetForHost('export.arxiv.org').minDelayMs).toBe(3_000);
  });

  it('is case-insensitive', () => {
    expect(budgetForHost('EXPORT.ARXIV.ORG').minDelayMs).toBe(3_000);
  });

  it('falls back conservatively for an unknown host', () => {
    // An unknown feed host gets a slow default rather than no limit at all.
    expect(budgetForHost('feeds.example.com')).toEqual({ perSecond: 2, burst: 2 });
  });
});
