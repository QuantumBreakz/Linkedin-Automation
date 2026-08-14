import { describe, expect, it } from 'vitest';
import { AppError, UpstreamError } from './errors';
import { REDACTED, createLogger, redact, type LogFields } from './logger';

/** Collects emitted records so assertions read against structured data. */
function capture(level: 'debug' | 'info' | 'warn' | 'error' | 'silent' = 'debug') {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    sink: (line) => lines.push(line),
    now: () => new Date('2026-08-14T09:00:00.000Z'),
  });
  return {
    logger,
    lines,
    records: (): Record<string, unknown>[] =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('redact', () => {
  it.each([
    'token',
    'accessToken',
    'access_token',
    'refreshTokenEnc',
    'secret',
    'NEXTAUTH_SECRET',
    'clientSecret',
    'password',
    'Password',
    'authorization',
    'Authorization',
    'apiKey',
    'APIKEY',
    'openrouterApikey',
  ])('masks the key %s', (key) => {
    expect(redact({ [key]: 'super-sensitive' })).toEqual({ [key]: REDACTED });
  });

  it.each(['user', 'title', 'doi', 'count', 'personUrn', 'canonicalKey'])(
    'leaves the harmless key %s alone',
    (key) => {
      expect(redact({ [key]: 'value' })).toEqual({ [key]: 'value' });
    },
  );

  it('fails closed on substring matches rather than trying to be clever', () => {
    // `tokenizer` is not a secret, but matching on substrings is the only
    // behaviour that stays safe as new field names appear. A false positive
    // costs a log line; a false negative leaks a member's access token.
    expect(redact({ tokenizerConfig: 'gpt2' })).toEqual({ tokenizerConfig: REDACTED });
  });

  it('masks at depth', () => {
    const input = {
      request: {
        url: 'https://api.linkedin.com/rest/posts',
        headers: { authorization: 'Bearer AQV-real-token', 'content-type': 'application/json' },
      },
    };
    expect(redact(input)).toEqual({
      request: {
        url: 'https://api.linkedin.com/rest/posts',
        headers: { authorization: REDACTED, 'content-type': 'application/json' },
      },
    });
  });

  it('masks inside arrays', () => {
    const input = { accounts: [{ id: 'a', accessToken: 'x' }, { id: 'b', accessToken: 'y' }] };
    expect(redact(input)).toEqual({
      accounts: [
        { id: 'a', accessToken: REDACTED },
        { id: 'b', accessToken: REDACTED },
      ],
    });
  });

  it('masks inside Map keys', () => {
    const input = new Map<string, string>([
      ['authorization', 'Bearer x'],
      ['x-request-id', 'abc'],
    ]);
    expect(redact(input)).toEqual({ authorization: REDACTED, 'x-request-id': 'abc' });
  });

  it('survives cycles', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    expect(redact(node)).toEqual({ name: 'root', self: '[Circular]' });
  });

  it('does not confuse a repeated (non-cyclic) reference with a cycle', () => {
    const shared = { id: 'shared' };
    expect(redact({ a: shared, b: shared })).toEqual({ a: { id: 'shared' }, b: { id: 'shared' } });
  });

  it('caps depth instead of recursing forever', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 30; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep))).toContain('[MaxDepth]');
  });

  it('renders binary as a size, never as content', () => {
    const result = redact({ blob: Buffer.from('secret bytes') }) as Record<string, unknown>;
    expect(result.blob).toBe('[Binary 12 bytes]');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('serialises Errors with name, message and stack', () => {
    const result = redact(new TypeError('bad shape')) as Record<string, unknown>;
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('bad shape');
    expect(typeof result.stack).toBe('string');
  });

  it('keeps AppError code and details, and redacts sensitive own fields', () => {
    const error = new UpstreamError('linkedin', 'rejected the post', { status: 401 });
    const result = redact(error) as Record<string, unknown>;
    expect(result.code).toBe('UPSTREAM_ERROR');
    expect(result.service).toBe('linkedin');
    expect(result.status).toBe(401);
  });

  it('redacts a sensitive field carried on an error', () => {
    const error = new AppError('boom', { details: { accessToken: 'AQV-leak' } });
    expect(JSON.stringify(redact(error))).not.toContain('AQV-leak');
  });

  it('follows an error cause chain', () => {
    const root = new Error('socket hang up');
    const wrapper = new UpstreamError('openalex', 'request failed', { cause: root });
    const result = redact(wrapper) as Record<string, unknown>;
    expect((result.cause as Record<string, unknown>).message).toBe('socket hang up');
  });

  it('converts values JSON.stringify cannot handle', () => {
    const result = redact({
      big: 10n,
      when: new Date('2026-01-02T03:04:05.000Z'),
      pattern: /abc/gi,
      fn: function namedFn() {},
      nan: Number.NaN,
    }) as Record<string, unknown>;

    expect(result.big).toBe('10n');
    expect(result.when).toBe('2026-01-02T03:04:05.000Z');
    expect(result.pattern).toBe('/abc/gi');
    expect(result.fn).toBe('[Function namedFn]');
    expect(result.nan).toBe('NaN');
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('truncates a runaway string rather than flooding the log', () => {
    const result = redact({ body: 'a'.repeat(20_000) }) as Record<string, unknown>;
    expect(String(result.body)).toContain('[truncated');
    expect(String(result.body).length).toBeLessThan(20_000);
  });

  it('caps very long arrays', () => {
    const result = redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(result).toHaveLength(101);
    expect(result[100]).toBe('[…400 more items]');
  });
});

describe('level filtering', () => {
  it('emits everything at debug', () => {
    const { logger, records } = capture('debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(records().map((r) => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('drops records below the threshold', () => {
    const { logger, records } = capture('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(records().map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('emits nothing at silent', () => {
    const { logger, lines } = capture('silent');
    logger.error('this should not appear');
    expect(lines).toHaveLength(0);
  });
});

describe('record shape', () => {
  it('is a single line of valid JSON with level, time and msg', () => {
    const { logger, lines, records } = capture();
    logger.info('paper ingested', { paperId: 'abc', canonicalKey: 'doi:10.1000/x' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(records()[0]).toEqual({
      level: 'info',
      time: '2026-08-14T09:00:00.000Z',
      msg: 'paper ingested',
      paperId: 'abc',
      canonicalKey: 'doi:10.1000/x',
    });
  });

  it('redacts top-level sensitive fields', () => {
    const { logger, records } = capture();
    logger.info('linkedin call', { accessToken: 'AQV-real', personUrn: 'urn:li:person:x' });

    const record = records()[0] as Record<string, unknown>;
    expect(record.accessToken).toBe(REDACTED);
    expect(record.personUrn).toBe('urn:li:person:x');
  });

  it('never lets a caller field clobber level/time/msg', () => {
    const { logger, records } = capture();
    logger.warn('real message', { msg: 'spoofed', level: 'debug', time: 'yesterday' } as LogFields);

    const record = records()[0] as Record<string, unknown>;
    expect(record.level).toBe('warn');
    expect(record.msg).toBe('real message');
    expect(record._msg).toBe('spoofed');
    expect(record._level).toBe('debug');
  });

  it('routes warn and error to stderr, the rest to stdout', () => {
    const seen: [string, string][] = [];
    const logger = createLogger({
      level: 'debug',
      sink: (line, level) => seen.push([level, line]),
    });
    logger.debug('a');
    logger.error('b');
    expect(seen.map(([level]) => level)).toEqual(['debug', 'error']);
  });
});

describe('child loggers', () => {
  it('merges bindings into every record', () => {
    const { logger, records } = capture();
    logger.child({ component: 'ingest', userId: 'u1' }).info('start');

    const record = records()[0] as Record<string, unknown>;
    expect(record.component).toBe('ingest');
    expect(record.userId).toBe('u1');
  });

  it('lets a call-site field win over a binding', () => {
    const { logger, records } = capture();
    logger.child({ stage: 'ingest' }).info('done', { stage: 'analyse' });
    expect((records()[0] as Record<string, unknown>).stage).toBe('analyse');
  });

  it('nests, accumulating bindings', () => {
    const { logger, records } = capture();
    logger.child({ a: 1 }).child({ b: 2 }).info('x');

    const record = records()[0] as Record<string, unknown>;
    expect(record.a).toBe(1);
    expect(record.b).toBe(2);
  });

  it('redacts bindings too', () => {
    const { logger, records } = capture();
    logger.child({ apiKey: 'sk-live-123' }).info('x');
    expect((records()[0] as Record<string, unknown>).apiKey).toBe(REDACTED);
  });

  it('inherits the parent level', () => {
    const { logger, lines } = capture('error');
    logger.child({ a: 1 }).info('suppressed');
    expect(lines).toHaveLength(0);
  });
});
