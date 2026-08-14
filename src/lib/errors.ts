/**
 * Typed error hierarchy.
 *
 * Every error that crosses a service boundary should be an `AppError` so that
 * route handlers can serialise it without a `switch` on `instanceof` in every
 * file. The wire shape is fixed by docs/07-api-contract.md:
 *
 *   { error: { code: string, message: string, details?: unknown } }
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'CONFIG_ERROR'
  | 'CRYPTO_ERROR'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AppErrorOptions {
  /** Machine-readable code returned to clients. */
  code?: ErrorCode;
  /** HTTP status a route handler should respond with. */
  httpStatus?: number;
  /** Structured extra context. Must never contain secrets — it is serialised to clients. */
  details?: unknown;
  /** Underlying error, preserved for logs. Never serialised to clients. */
  cause?: unknown;
  /**
   * Whether `message` is safe to show a client. `false` replaces it with a
   * generic string in `toResponseBody()`. Defaults to `true` for 4xx and
   * `false` for 5xx.
   */
  expose?: boolean;
}

const GENERIC_MESSAGE = 'An unexpected error occurred.';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details: unknown;
  readonly expose: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.httpStatus = options.httpStatus ?? 500;
    this.details = options.details;
    this.expose = options.expose ?? this.httpStatus < 500;
    // Restores prototype chain when compiled to ES5-ish targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toResponseBody(): ErrorResponseBody {
    const body: ErrorResponseBody = {
      error: {
        code: this.code,
        message: this.expose ? this.message : GENERIC_MESSAGE,
      },
    };
    if (this.expose && this.details !== undefined) {
      body.error.details = this.details;
    }
    return body;
  }
}

/** 400 — request or LLM output failed schema validation. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, { code: 'VALIDATION_ERROR', httpStatus: 400, details, cause });
  }
}

/** 401 — no valid session. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.', cause?: unknown) {
    super(message, { code: 'UNAUTHORIZED', httpStatus: 401, cause });
  }
}

/** 403 — authenticated, but the actor does not own this resource. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource.', cause?: unknown) {
    super(message, { code: 'FORBIDDEN', httpStatus: 403, cause });
  }
}

/**
 * 404 — resource missing, or owned by another user.
 *
 * Services deliberately return this rather than `ForbiddenError` for
 * cross-tenant reads, so an attacker cannot probe for existence.
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string, cause?: unknown) {
    super(id === undefined ? `${resource} not found.` : `${resource} '${id}' not found.`, {
      code: 'NOT_FOUND',
      httpStatus: 404,
      cause,
    });
  }
}

/** 409 — the request conflicts with current state (duplicate key, bad transition). */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, { code: 'CONFLICT', httpStatus: 409, details, cause });
  }
}

/** 429 — a local or upstream rate limit was hit. */
export class RateLimitError extends AppError {
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryAfterMs?: number, cause?: unknown) {
    super(message, {
      code: 'RATE_LIMITED',
      httpStatus: 429,
      details: retryAfterMs === undefined ? undefined : { retryAfterMs },
      cause,
    });
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 502 — an external dependency (OpenAlex, arXiv, LinkedIn, OpenRouter, S3)
 * failed or answered unusably. Carries enough context to decide whether the
 * job should retry.
 */
export class UpstreamError extends AppError {
  readonly service: string;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    service: string,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown; retryable?: boolean } = {},
  ) {
    super(`${service}: ${message}`, {
      code: 'UPSTREAM_ERROR',
      httpStatus: 502,
      details: options.details,
      cause: options.cause,
    });
    this.service = service;
    this.status = options.status;
    this.retryable = options.retryable ?? isRetryableStatus(options.status);
  }
}

function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return true; // network-level failure
  if (status === 408 || status === 429) return true;
  return status >= 500;
}

/**
 * 500 — the process is misconfigured. Thrown by `@/lib/env` at first access
 * when required variables are missing. Never exposed to clients.
 */
export class ConfigError extends AppError {
  constructor(message: string, details?: unknown, cause?: unknown) {
    super(message, { code: 'CONFIG_ERROR', httpStatus: 500, details, cause, expose: false });
  }
}

/**
 * 500 — token encryption/decryption failed: bad key, tampered ciphertext,
 * unknown envelope version. Never exposed; the message can hint at key state.
 */
export class CryptoError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'CRYPTO_ERROR', httpStatus: 500, cause, expose: false });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Last-resort mapping for a route handler's catch block. Unknown errors become
 * an opaque 500 — we never leak an internal message or stack to a client.
 */
export function toErrorResponse(error: unknown): { status: number; body: ErrorResponseBody } {
  if (isAppError(error)) {
    return { status: error.httpStatus, body: error.toResponseBody() };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: GENERIC_MESSAGE } },
  };
}
