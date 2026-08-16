/**
 * LLM model configuration — the ONE file that names model IDs.
 *
 * docs/01 §D8: no model ID appears outside this file. Every other module
 * references a role ('cheap' | 'standard' | 'verify'); this file maps roles
 * to ordered fallback chains. A deprecation or upgrade is a one-line change here.
 *
 * Chain semantics: the provider tries each entry in order. A 429, a transport
 * error, or a deprecated-model response falls through to the next. If the whole
 * chain is exhausted the job fails — we never emit a result from an unintended
 * model tier.
 *
 * Model IDs are OpenRouter slugs (provider/name). The free variants are
 * appropriate for development; pin paid models for the `verify` role in
 * production because accuracy is non-negotiable there.
 */

import type { ModelRole } from './types';

export interface ModelChainEntry {
  /** OpenRouter model ID, e.g. "google/gemini-flash-1.5". */
  modelId: string;
  /** Max tokens to generate. Defaults to the provider's cap when omitted. */
  maxTokens?: number;
  /** Provider-level timeout in ms. */
  timeoutMs?: number;
}

export type ModelChain = readonly [ModelChainEntry, ...ModelChainEntry[]];

/** Backends we can point the provider at. Both speak the OpenAI wire format. */
export type LlmProviderName = 'openrouter' | 'groq';

/**
 * The active backend.
 *
 * Read straight from `process.env` rather than through the validated `env`
 * proxy: importing this module must never trigger a full-schema parse, or unit
 * tests that only care about chain shape would need a complete environment.
 * Mirrors the `isProduction()` escape hatch in src/lib/env.ts.
 */
export function activeProvider(): LlmProviderName {
  return process.env.LLM_PROVIDER?.trim().toLowerCase() === 'groq' ? 'groq' : 'openrouter';
}

/**
 * OpenRouter chains.
 *
 * Slugs are verified against https://openrouter.ai/api/v1/models — the previous
 * set (gemini-1.5, llama-3.1 free tiers, claude-3-5-sonnet) was retired upstream
 * and every one of those entries 404s, which left the `cheap` role with no
 * working model at all.
 */
export const MODEL_CHAINS: Record<ModelRole, ModelChain> = {
  /**
   * cheap — classification, tagging, dedup label assistance.
   * Low latency matters; accuracy requirements are lenient.
   */
  cheap: [
    { modelId: 'google/gemini-3.5-flash-lite', maxTokens: 1024, timeoutMs: 15_000 },
    { modelId: 'google/gemma-4-31b-it:free', maxTokens: 1024, timeoutMs: 20_000 },
  ],

  /**
   * standard — extraction, drafting.
   * Balance of quality and cost; structured output required.
   */
  standard: [
    { modelId: 'openai/gpt-4o-mini', maxTokens: 4096, timeoutMs: 60_000 },
    { modelId: 'google/gemini-3.5-flash', maxTokens: 4096, timeoutMs: 60_000 },
    { modelId: 'google/gemma-4-31b-it:free', maxTokens: 4096, timeoutMs: 90_000 },
  ],

  /**
   * verify — claim checking, number audit.
   * Accuracy-critical: pay for quality, no free-tier fallback.
   * Downgrade only if absolutely necessary; log when you do.
   */
  verify: [
    { modelId: 'openai/gpt-4o', maxTokens: 2048, timeoutMs: 60_000 },
    { modelId: 'anthropic/claude-sonnet-5', maxTokens: 2048, timeoutMs: 60_000 },
    { modelId: 'google/gemini-3.7-flash', maxTokens: 2048, timeoutMs: 60_000 },
  ],
};

/**
 * Groq chains.
 *
 * Groq slugs carry no `provider/` prefix for its own hosted Llama builds. The
 * free tier is rate-limited per minute rather than metered, so the `verify`
 * role does not get a paid tier here — treat its output accordingly.
 */
export const GROQ_MODEL_CHAINS: Record<ModelRole, ModelChain> = {
  cheap: [
    { modelId: 'llama-3.1-8b-instant', maxTokens: 1024, timeoutMs: 15_000 },
    { modelId: 'openai/gpt-oss-20b', maxTokens: 1024, timeoutMs: 20_000 },
  ],

  // gpt-oss leads: it supports strict `json_schema`, which enforces the shape.
  // llama only has loose JSON mode here, and reliably invents its own keys for
  // a schema this size, so it sits behind as a last resort.
  standard: [
    { modelId: 'openai/gpt-oss-120b', maxTokens: 4096, timeoutMs: 60_000 },
    { modelId: 'openai/gpt-oss-20b', maxTokens: 4096, timeoutMs: 60_000 },
    { modelId: 'llama-3.3-70b-versatile', maxTokens: 4096, timeoutMs: 90_000 },
  ],

  verify: [
    { modelId: 'openai/gpt-oss-120b', maxTokens: 2048, timeoutMs: 60_000 },
    { modelId: 'llama-3.3-70b-versatile', maxTokens: 2048, timeoutMs: 60_000 },
  ],
};

/** Chains for the active backend. */
export function chainsForActiveProvider(): Record<ModelRole, ModelChain> {
  return activeProvider() === 'groq' ? GROQ_MODEL_CHAINS : MODEL_CHAINS;
}

/** Returns the fallback chain for a role. Always non-empty. */
export function getChain(role: ModelRole): ModelChain {
  return chainsForActiveProvider()[role];
}

/** Given a role and current modelId, returns the next fallback modelId, or null if exhausted. */
export function getFallbackModel(role: ModelRole, currentModelId: string): string | null {
  const chain = chainsForActiveProvider()[role];
  const idx = chain.findIndex((entry) => entry.modelId === currentModelId);
  if (idx >= 0 && idx < chain.length - 1) {
    return chain[idx + 1]!.modelId;
  }
  return null;
}

/** All model IDs referenced in any chain. Used by the audit grep in CI. */
export function allModelIds(): string[] {
  return [...Object.values(MODEL_CHAINS), ...Object.values(GROQ_MODEL_CHAINS)]
    .flatMap((chain) => chain)
    .map((e) => e.modelId);
}
