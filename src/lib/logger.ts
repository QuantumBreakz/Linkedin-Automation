/**
 * Structured JSON logger.
 *
 * Deliberately does NOT import `@/lib/env`: the first thing this logger has to
 * be able to report is a broken environment, so it reads `LOG_LEVEL` straight
 * from `process.env` and never participates in config validation.
 *
 * The redaction pass is the load-bearing part. LinkedIn access tokens, the
 * OpenRouter key and NextAuth secrets all flow through objects that some
 * well-meaning caller will eventually pass to `logger.error(msg, { response })`.
 * Redaction happens here, once, at any depth — not at each call site.
 */

export const LOG_LEVEL_NAMES = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVEL_NAMES)[number];

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `bindings` into every subsequent record. */
  child(bindings: LogFields): Logger;
  readonly level: LogLevel;
}

// ─────────────────────────────  redaction  ─────────────────────────────

/**
 * Any object key matching this becomes `[REDACTED]`, at any depth.
 * Matching is on the key, not the value — we do not try to detect "this string
 * looks like a JWT", because that fails open.
 */
export const SENSITIVE_KEY_PATTERN = /token|secret|password|authorization|apikey/i;

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_STRING_LENGTH = 8_000;

/**
 * Produces a JSON-safe copy of `value` with sensitive keys masked.
 *
 * Also defends the log pipeline against the things that make `JSON.stringify`
 * throw or explode: cycles, BigInt, Buffers, deep nesting, huge arrays.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet<object>());
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value ?? null;

  switch (typeof value) {
    case 'string':
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
        : value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return `${value.toString()}n`;
    case 'function':
      return `[Function ${value.name || 'anonymous'}]`;
    case 'symbol':
      return value.toString();
    default:
      break;
  }

  const obj = value as object;

  if (depth >= MAX_DEPTH) return '[MaxDepth]';
  if (seen.has(obj)) return '[Circular]';

  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof RegExp) return obj.toString();
  if (obj instanceof Error) {
    seen.add(obj);
    const out: Record<string, unknown> = {
      name: obj.name,
      message: obj.message,
    };
    if (obj.stack !== undefined) out.stack = obj.stack;
    // AppError and friends carry `code` / `details` worth keeping.
    const own = obj as unknown as Record<string, unknown>;
    for (const key of Object.keys(own)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactValue(own[key], depth + 1, seen);
    }
    if (obj.cause !== undefined) out.cause = redactValue(obj.cause, depth + 1, seen);
    seen.delete(obj);
    return out;
  }
  if (obj instanceof ArrayBuffer) return `[Binary ${obj.byteLength} bytes]`;
  if (ArrayBuffer.isView(obj)) return `[Binary ${obj.byteLength} bytes]`;

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const items = obj
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redactValue(item, depth + 1, seen));
      if (obj.length > MAX_ARRAY_ITEMS) {
        items.push(`[…${obj.length - MAX_ARRAY_ITEMS} more items]`);
      }
      return items;
    }

    if (obj instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of obj.entries()) {
        const key = String(k);
        out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(v, depth + 1, seen);
      }
      return out;
    }
    if (obj instanceof Set) {
      return [...obj].slice(0, MAX_ARRAY_ITEMS).map((v) => redactValue(v, depth + 1, seen));
    }

    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(v, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

// ──────────────────────────────  logger  ───────────────────────────────

export interface LogRecord {
  level: Exclude<LogLevel, 'silent'>;
  time: string;
  msg: string;
  [field: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Merged into every record produced by this logger. */
  bindings?: LogFields;
  /** Where a formatted line goes. Injectable so tests never touch stdout. */
  sink?: (line: string, level: Exclude<LogLevel, 'silent'>) => void;
  /** Injectable clock, for deterministic tests. */
  now?: () => Date;
}

function defaultSink(line: string, level: Exclude<LogLevel, 'silent'>): void {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

function resolveDefaultLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (raw !== undefined && (LOG_LEVEL_NAMES as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? resolveDefaultLevel();
  const bindings = options.bindings ?? {};
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const threshold = LEVEL_RANK[level];

  function emit(recordLevel: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[recordLevel] < threshold) return;

    const merged: LogFields = { ...bindings, ...(fields ?? {}) };
    const record: Record<string, unknown> = {
      level: recordLevel,
      time: now().toISOString(),
      msg: message,
    };
    for (const [key, value] of Object.entries(merged)) {
      // Reserved keys must not be clobbered by a caller's field.
      const safeKey = key === 'level' || key === 'time' || key === 'msg' ? `_${key}` : key;
      record[safeKey] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(value);
    }

    let line: string;
    try {
      line = JSON.stringify(record);
    } catch (serialisationError) {
      line = JSON.stringify({
        level: recordLevel,
        time: record.time,
        msg: message,
        logError: `record could not be serialised: ${String(serialisationError)}`,
      });
    }
    sink(line, recordLevel);
  }

  const logger: Logger = {
    level,
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (childBindings) =>
      createLogger({
        level,
        bindings: { ...bindings, ...childBindings },
        sink,
        now,
      }),
  };

  return logger;
}

/** Process-wide default logger. Prefer `logger.child({ ... })` in services. */
export const logger: Logger = createLogger();
