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

/** All role → chain assignments. Modify this file only. */
export const MODEL_CHAINS: Record<ModelRole, ModelChain> = {
  /**
   * cheap — classification, tagging, dedup label assistance.
   * Low latency matters; accuracy requirements are lenient.
   */
  cheap: [
    { modelId: 'google/gemini-flash-1.5', maxTokens: 1024, timeoutMs: 15_000 },
    { modelId: 'meta-llama/llama-3.1-8b-instruct:free', maxTokens: 1024, timeoutMs: 20_000 },
  ],

  /**
   * standard — extraction, drafting.
   * Balance of quality and cost; structured output required.
   */
  standard: [
    { modelId: 'google/gemini-pro-1.5', maxTokens: 4096, timeoutMs: 60_000 },
    { modelId: 'openai/gpt-4o-mini', maxTokens: 4096, timeoutMs: 60_000 },
    { modelId: 'meta-llama/llama-3.1-70b-instruct:free', maxTokens: 4096, timeoutMs: 90_000 },
  ],

  /**
   * verify — claim checking, number audit.
   * Accuracy-critical: pay for quality, no free-tier fallback.
   * Downgrade only if absolutely necessary; log when you do.
   */
  verify: [
    { modelId: 'openai/gpt-4o', maxTokens: 2048, timeoutMs: 60_000 },
    { modelId: 'anthropic/claude-3-5-sonnet', maxTokens: 2048, timeoutMs: 60_000 },
    { modelId: 'google/gemini-pro-1.5', maxTokens: 2048, timeoutMs: 60_000 },
  ],
};

/** Returns the fallback chain for a role. Always non-empty. */
export function getChain(role: ModelRole): ModelChain {
  return MODEL_CHAINS[role];
}

/** Given a role and current modelId, returns the next fallback modelId, or null if exhausted. */
export function getFallbackModel(role: ModelRole, currentModelId: string): string | null {
  const chain = MODEL_CHAINS[role];
  const idx = chain.findIndex((entry) => entry.modelId === currentModelId);
  if (idx >= 0 && idx < chain.length - 1) {
    return chain[idx + 1]!.modelId;
  }
  return null;
}

/** All model IDs referenced in any chain. Used by the audit grep in CI. */
export function allModelIds(): string[] {
  return Object.values(MODEL_CHAINS)
    .flatMap((chain) => chain)
    .map((e) => e.modelId);
}
