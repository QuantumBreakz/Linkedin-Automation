/**
 * LLM provider abstraction — the shapes in docs/05-ai-pipeline.md §Provider abstraction.
 *
 * The pipeline addresses **roles**, never models (docs/01 §D8). A role maps to an
 * ordered fallback chain of model IDs in `./config`, and no model ID appears
 * anywhere else in the codebase.
 */

import type { z } from 'zod';

// ──────────────────────────────  roles  ───────────────────────────────

/**
 * `cheap`    — classification, tagging, dedup assistance.
 * `standard` — extraction, drafting.
 * `verify`   — claim checking, number audit. The accuracy-critical role.
 */
export type ModelRole = 'cheap' | 'standard' | 'verify';

export const MODEL_ROLES = ['cheap', 'standard', 'verify'] as const satisfies readonly ModelRole[];

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === 'string' && (MODEL_ROLES as readonly string[]).includes(value);
}

// ─────────────────────────────  messages  ─────────────────────────────

/**
 * Deliberately excludes `'system'`.
 *
 * The system prompt is a *separate argument* to `complete()` so that untrusted
 * paper text physically cannot be concatenated into it. See docs/07 §Prompt
 * injection and `./prompts/injection.ts`.
 */
export type MessageRole = 'user' | 'assistant';

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
}

// ─────────────────────────────  results  ──────────────────────────────

export interface LlmUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  /** Provider-reported cost in USD, when the provider returns one. */
  readonly costUsd: number | null;
}

export const EMPTY_USAGE: LlmUsage = {
  promptTokens: null,
  completionTokens: null,
  totalTokens: null,
  costUsd: null,
};

/** Why a single HTTP call to one model ended. Recorded per attempt. */
export type AttemptOutcome =
  | 'ok'
  /** Network-level failure, abort, or timeout — no HTTP response. */
  | 'transport'
  /** An HTTP or provider-level error response. */
  | 'http'
  /** HTTP 200 but the body was not usable (no choices, empty content). */
  | 'empty'
  /** Body parsed as JSON but failed the caller's Zod schema. */
  | 'schema';

export interface LlmAttempt {
  readonly modelId: string;
  readonly outcome: AttemptOutcome;
  /** True when this call was the single schema-repair retry. */
  readonly repair: boolean;
  readonly structuredOutput: 'json_schema' | 'json_object' | 'none';
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  readonly usage: LlmUsage;
  readonly error: string | null;
}

export interface LlmResult<T = unknown> {
  readonly provider: string;
  readonly role: ModelRole;
  /** The model that actually produced `text`. Never assume it is chain[0]. */
  readonly modelId: string;
  readonly text: string;
  /**
   * Schema-validated output. `null` when no `schema` was supplied.
   * Use `requireParsed()` rather than a non-null assertion.
   */
  readonly parsed: T | null;
  readonly finishReason: string | null;
  readonly usage: LlmUsage;
  /** Wall-clock across the whole chain, including backoff sleeps. */
  readonly latencyMs: number;
  /** Every HTTP call made, in order — including the ones that failed. */
  readonly attempts: readonly LlmAttempt[];
}

// ─────────────────────────────  provider  ─────────────────────────────

export interface CompleteArgs<T = unknown> {
  readonly role: ModelRole;
  /** Trusted instructions only. Never interpolate source text into this. */
  readonly system: string;
  readonly messages: readonly Message[];
  /**
   * Requests structured output. Enforced natively via `json_schema` where the
   * model supports it, otherwise JSON mode + this schema + one repair retry.
   */
  readonly schema?: z.ZodType<T> | z.ZodTypeAny;
  /** Identifier for the schema in the provider payload. Defaults to `output`. */
  readonly schemaName?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  // ── logging metadata (written to LlmRequest row, never sent to the model) ──
  readonly userId?: string;
  readonly purpose?: string;
  /** e.g. 'paper', 'draft' */
  readonly refType?: string;
  readonly refId?: string;
}

export interface LlmProvider {
  readonly name: string;
  complete<T = unknown>(args: CompleteArgs<T>): Promise<LlmResult<T>>;
}
