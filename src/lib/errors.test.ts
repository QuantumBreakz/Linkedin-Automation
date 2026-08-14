import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConfigError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UpstreamError,
  ValidationError,
  isAppError,
  toErrorResponse,
} from './errors';

describe('AppError', () => {
  it('defaults to an opaque 500', () => {
    const error = new AppError('something broke');
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.httpStatus).toBe(500);
    expect(error.expose).toBe(false);
  });

  it('exposes 4xx messages but not 5xx ones', () => {
    expect(new AppError('bad input', { httpStatus: 400 }).expose).toBe(true);
    expect(new AppError('db down', { httpStatus: 503 }).expose).toBe(false);
  });

  it('sets name from the concrete subclass', () => {
    expect(new ValidationError('x').name).toBe('ValidationError');
    expect(new NotFoundError('Draft').name).toBe('NotFoundError');
  });

  it('survives instanceof through the hierarchy', () => {
    const error = new ValidationError('x');
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });

  it('preserves the cause for logs', () => {
    const root = new Error('ECONNRESET');
    expect(new UpstreamError('openalex', 'failed', { cause: root }).cause).toBe(root);
  });
});

describe('toResponseBody — docs/07 wire shape', () => {
  it('matches { error: { code, message } }', () => {
    expect(new NotFoundError('Draft', 'abc').toResponseBody()).toEqual({
      error: { code: 'NOT_FOUND', message: "Draft 'abc' not found." },
    });
  });

  it('includes details when present and exposable', () => {
    expect(new ValidationError('Invalid body', { field: 'hashtags' }).toResponseBody()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid body',
        details: { field: 'hashtags' },
      },
    });
  });

  it('omits details entirely when there are none', () => {
    const body = new ForbiddenError().toResponseBody();
    expect('details' in body.error).toBe(false);
  });

  it('never leaks a non-exposed message or its details', () => {
    const error = new ConfigError('DATABASE_URL is missing', { problems: ['DATABASE_URL'] });
    const body = error.toResponseBody();
    expect(body.error.message).not.toContain('DATABASE_URL');
    expect('details' in body.error).toBe(false);
  });
});

describe('concrete errors', () => {
  it.each([
    ['ValidationError', new ValidationError('x'), 400, 'VALIDATION_ERROR'],
    ['UnauthorizedError', new UnauthorizedError(), 401, 'UNAUTHORIZED'],
    ['ForbiddenError', new ForbiddenError(), 403, 'FORBIDDEN'],
    ['NotFoundError', new NotFoundError('Paper'), 404, 'NOT_FOUND'],
    ['ConflictError', new ConflictError('x'), 409, 'CONFLICT'],
    ['RateLimitError', new RateLimitError('x'), 429, 'RATE_LIMITED'],
    ['UpstreamError', new UpstreamError('s', 'x'), 502, 'UPSTREAM_ERROR'],
    ['ConfigError', new ConfigError('x'), 500, 'CONFIG_ERROR'],
  ])('%s maps to %i / %s', (_name, error, status, code) => {
    expect(error.httpStatus).toBe(status);
    expect(error.code).toBe(code);
  });

  it('NotFoundError omits the id when it is not supplied', () => {
    expect(new NotFoundError('Paper').message).toBe('Paper not found.');
  });

  it('RateLimitError carries retryAfterMs in details', () => {
    const error = new RateLimitError('slow down', 3_000);
    expect(error.retryAfterMs).toBe(3_000);
    expect(error.toResponseBody().error.details).toEqual({ retryAfterMs: 3_000 });
  });
});

describe('UpstreamError retryability', () => {
  it.each([
    [undefined, true], // network-level failure
    [408, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [404, false],
  ])('status %s -> retryable %s', (status, expected) => {
    expect(new UpstreamError('linkedin', 'x', { status }).retryable).toBe(expected);
  });

  it('lets the caller override the inference', () => {
    expect(new UpstreamError('linkedin', 'x', { status: 400, retryable: true }).retryable).toBe(
      true,
    );
  });

  it('prefixes the message with the service so logs are greppable', () => {
    expect(new UpstreamError('arxiv', 'timed out').message).toBe('arxiv: timed out');
  });
});

describe('isAppError / toErrorResponse', () => {
  it('recognises AppErrors', () => {
    expect(isAppError(new ValidationError('x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError('a string')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('serialises an AppError with its own status', () => {
    expect(toErrorResponse(new NotFoundError('Draft', 'd1'))).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: "Draft 'd1' not found." } },
    });
  });

  it('turns an unknown throw into an opaque 500', () => {
    const result = toErrorResponse(new Error('connection string postgres://user:pw@host'));
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result.body)).not.toContain('postgres://');
  });

  it('handles a non-Error throw', () => {
    expect(toErrorResponse('boom').status).toBe(500);
    expect(toErrorResponse(undefined).status).toBe(500);
  });
});
