/**
 * Environment configuration.
 *
 * Two properties matter here:
 *
 *  1. **Fail fast, but loudly.** A missing variable produces one error listing
 *     *every* problem, not the first one. Discovering config gaps one restart
 *     at a time is a waste of a developer's afternoon.
 *
 *  2. **Lazy.** Parsing happens on first *access*, not on import. Importing
 *     `@/lib/env` from a unit test must never throw — plenty of modules import
 *     it transitively for a single optional flag.
 *
 * Nothing in this file reads a secret from anywhere but `process.env`.
 */

import { z } from 'zod';
import { ConfigError } from './errors';

// ─────────────────────────────  primitives  ─────────────────────────────

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

/** `KEY=true|false|1|0|yes|no|on|off`, with a default when unset. */
function boolFromEnv(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .refine(
      (raw) => {
        if (raw === undefined || raw === '') return true;
        const v = raw.trim().toLowerCase();
        return TRUTHY.has(v) || FALSY.has(v);
      },
      { message: 'must be one of: true, false, 1, 0, yes, no, on, off' },
    )
    .transform((raw) => {
      if (raw === undefined || raw === '') return defaultValue;
      return TRUTHY.has(raw.trim().toLowerCase());
    });
}

/** A non-empty string, trimmed. Empty-string env vars count as unset. */
const requiredString = z
  .string({ error: 'is required' })
  .trim()
  .min(1, { message: 'is required (found an empty value)' });

function optionalString() {
  return z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v));
}

function withDefault(defaultValue: string) {
  return z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : v));
}

/**
 * An enum that tolerates an unset *or* empty variable — `FOO=` in a `.env`
 * file is common and should mean "unset", not "invalid".
 */
function enumWithDefault<const T extends readonly [string, ...string[]]>(
  values: T,
  defaultValue: T[number],
) {
  return z
    .union([z.literal(''), z.enum(values)])
    .optional()
    .transform((v): T[number] => (v === undefined || v === '' ? defaultValue : v));
}

/**
 * An absolute URL *with a host*.
 *
 * The host check is not redundant: `new URL('localhost:3000')` succeeds — it
 * parses as the scheme `localhost:` with the path `3000` and an empty
 * hostname. Without this, a `DATABASE_URL` missing its `//` would sail through
 * validation and fail much later with an unhelpful driver error.
 */
const urlString = requiredString.refine(
  (v) => {
    try {
      return new URL(v).hostname !== '';
    } catch {
      return false;
    }
  },
  {
    message:
      'must be an absolute URL including a scheme and host, e.g. postgresql://user:pass@localhost:5432/db',
  },
);

const emailString = requiredString.refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
  message: 'must be an email address (used for API polite pools — a real, monitored inbox)',
});

/**
 * A 32-byte key, base64-encoded. Rejected loudly rather than silently padded:
 * a short key would still "work" and would quietly weaken every stored token.
 */
const encryptionKeyString = requiredString.refine(
  (v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  },
  { message: 'must be exactly 32 bytes, base64-encoded (openssl rand -base64 32)' },
);

// ──────────────────────────────  schema  ───────────────────────────────

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevelName = (typeof LOG_LEVELS)[number];

const envSchema = z.object({
  NODE_ENV: enumWithDefault(['development', 'test', 'production'] as const, 'development'),

  // ── Datastores ────────────────────────────────────────────────────────
  DATABASE_URL: urlString,
  REDIS_URL: urlString,

  // ── Secrets ───────────────────────────────────────────────────────────
  /** AES-256-GCM key for LinkedIn token columns. See src/lib/crypto.ts. */
  ENCRYPTION_KEY: encryptionKeyString,
  NEXTAUTH_SECRET: requiredString.refine((v) => v.length >= 32, {
    message: 'must be at least 32 characters (openssl rand -base64 32)',
  }),
  NEXTAUTH_URL: urlString,

  // ── LinkedIn ──────────────────────────────────────────────────────────
  LINKEDIN_CLIENT_ID: requiredString,
  LINKEDIN_CLIENT_SECRET: requiredString,
  LINKEDIN_REDIRECT_URI: urlString,
  /**
   * Blocks every real write to LinkedIn. Defaults to `true` so that a
   * forgotten variable can never cause an unintended post to a member's feed.
   */
  LINKEDIN_DRY_RUN: boolFromEnv(true),
  /** `LinkedIn-Version` header for the versioned /rest API surface. */
  LINKEDIN_API_VERSION: withDefault('202601').refine((v) => /^\d{6}$/.test(v), {
    message: 'must be a YYYYMM string, e.g. 202601',
  }),
  /**
   * LinkedIn's self-serve OAuth does not implement PKCE — sending a
   * `code_verifier` makes the token exchange fail `invalid_client` even with
   * valid credentials. Defaults to off; flip if LinkedIn adds support.
   */
  LINKEDIN_USE_PKCE: boolFromEnv(false),

  // ── LLM ───────────────────────────────────────────────────────────────
  /**
   * Which OpenAI-compatible backend the provider talks to. Both speak the same
   * `/chat/completions` wire format, so this only switches the base URL, the
   * credential, and which model chain in ./services/llm/config applies.
   */
  LLM_PROVIDER: enumWithDefault(['openrouter', 'groq'] as const, 'openrouter'),

  OPENROUTER_API_KEY: requiredString,
  OPENROUTER_BASE_URL: withDefault('https://openrouter.ai/api/v1'),

  /** Required only when LLM_PROVIDER=groq. From https://console.groq.com/keys */
  GROQ_API_KEY: optionalString(),
  GROQ_BASE_URL: withDefault('https://api.groq.com/openai/v1'),

  // ── Object storage (S3-compatible: MinIO locally, R2/S3 in prod) ──────
  S3_ENDPOINT: urlString,
  S3_REGION: withDefault('us-east-1'),
  S3_BUCKET: requiredString,
  S3_ACCESS_KEY_ID: requiredString,
  S3_SECRET_ACCESS_KEY: requiredString,
  /** MinIO needs path-style addressing; most managed S3 does not. */
  S3_FORCE_PATH_STYLE: boolFromEnv(true),
  /** Public base URL for rendered assets, when the bucket is fronted by a CDN. */
  S3_PUBLIC_URL: optionalString(),

  // ── Outbound API etiquette (docs/01 §D5) ──────────────────────────────
  /**
   * Sent as `mailto=` to OpenAlex, in the Crossref/Unpaywall `User-Agent`, and
   * as the required `email` parameter to NCBI E-utilities. Must be real.
   */
  CONTACT_EMAIL: emailString,
  /** Required `tool` parameter for NCBI E-utilities; also our User-Agent product token. */
  APP_NAME: withDefault('research-to-linkedin'),
  APP_URL: withDefault('http://localhost:3000'),
  /** Raises the NCBI budget from 3 req/s to 10 req/s when present. */
  NCBI_API_KEY: optionalString(),

  // ── Ops ───────────────────────────────────────────────────────────────
  LOG_LEVEL: enumWithDefault(LOG_LEVELS, 'info'),
  /** Shared secret for POST /api/internal/cron/:name (docs/07). */
  CRON_SECRET: optionalString(),
});

export type Env = z.infer<typeof envSchema>;

/** The variables a developer must set before anything runs. Used by .env.example. */
export const REQUIRED_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'ENCRYPTION_KEY',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
  'LINKEDIN_CLIENT_ID',
  'LINKEDIN_CLIENT_SECRET',
  'LINKEDIN_REDIRECT_URI',
  'OPENROUTER_API_KEY',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'CONTACT_EMAIL',
] as const;

// ──────────────────────────────  parsing  ──────────────────────────────

/**
 * Pure parse. Exported so tests can exercise the schema against a synthetic
 * record without touching `process.env`.
 */
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues
    .map((issue) => {
      const key = issue.path.length > 0 ? String(issue.path[0]) : '(root)';
      // Zod's default "expected string, received undefined" is noise for env vars.
      const message =
        issue.code === 'invalid_type' && !(key in source)
          ? 'is required but was not set'
          : issue.message;
      return `  - ${key} ${message}`;
    })
    // Deduplicate: one line per variable, even if two checks failed.
    .filter((line, index, all) => all.indexOf(line) === index)
    .sort();

  throw new ConfigError(
    `Invalid environment configuration (${lines.length} problem${lines.length === 1 ? '' : 's'}):\n${lines.join(
      '\n',
    )}\n\nSee .env.example for every variable and where to get its value.`,
    { problems: lines.map((l) => l.replace(/^ {2}- /, '')) },
  );
}

let cached: Env | undefined;

/** Parses `process.env` once and memoises. Throws `ConfigError` on the first bad access. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test hook: forget the memoised parse so a new `process.env` is picked up. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * The typed environment.
 *
 * A Proxy, not a plain object, so that `import { env } from '@/lib/env'` is
 * free and only *reading a field* can throw. That is what keeps unit tests
 * importable without a fully populated environment.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, property, _receiver) {
    return Reflect.get(getEnv(), property);
  },
  has(_target, property) {
    return Reflect.has(getEnv(), property);
  },
  ownKeys() {
    return Reflect.ownKeys(getEnv());
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(getEnv(), property);
    return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
  },
  set() {
    throw new ConfigError('env is read-only; set the variable in the process environment instead.');
  },
});

/** True in the local dev / test environments. Cheap and does not validate the full schema. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}
