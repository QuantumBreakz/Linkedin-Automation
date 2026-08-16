/**
 * OpenRouter LLM provider.
 *
 * Implements the LlmProvider interface from ./types using OpenRouter's
 * OpenAI-compatible API. Key behaviours:
 *
 *  - Role-based fallback chains from ./config — never falls back silently.
 *  - `json_schema` structured output when the model supports it; JSON mode
 *    + Zod validation + one repair retry otherwise.
 *  - Every call writes an `LlmRequest` row (fire-and-forget — never delays
 *    the caller).
 *  - Prompt injection: the system prompt is a separate field, never
 *    concatenated with user content (docs/07 §Prompt injection).
 */

import { z } from 'zod';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { UpstreamError } from '@/lib/errors';
import { db } from '@/lib/db';
import { ConfigError } from '@/lib/errors';
import { getChain, activeProvider } from './config';
import type { CompleteArgs, LlmResult, LlmAttempt, LlmUsage, ModelRole } from './types';
import { EMPTY_USAGE } from './types';

// ─────────────────────────────  constants  ─────────────────────────

/** Models confirmed to support json_schema structured output. */
const JSON_SCHEMA_MODELS = new Set([
  // OpenRouter slugs
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/gpt-4-turbo',
  // Groq slugs
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
]);

const MAX_REPAIR_ATTEMPTS = 1;

/**
 * Endpoint, credential and outbound headers for the active backend.
 *
 * Both backends expose the same OpenAI-compatible `/chat/completions`, so the
 * only differences are the base URL, which key to send, and the OpenRouter-only
 * attribution headers (harmless elsewhere, but not sent to keep requests clean).
 */
function resolveBackend(): { baseUrl: string; apiKey: string; headers: Record<string, string> } {
  if (activeProvider() === 'groq') {
    const apiKey = env.GROQ_API_KEY;
    if (!apiKey) {
      throw new ConfigError('LLM_PROVIDER=groq requires GROQ_API_KEY (https://console.groq.com/keys).');
    }
    return { baseUrl: env.GROQ_BASE_URL, apiKey, headers: {} };
  }

  return {
    baseUrl: env.OPENROUTER_BASE_URL,
    apiKey: env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': env.APP_URL, 'X-Title': env.APP_NAME },
  };
}

// ─────────────────────────────  helpers  ───────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(base: number): number {
  return base * (0.75 + Math.random() * 0.5);
}

function extractUsage(data: Record<string, unknown>): LlmUsage {
  const usage = data['usage'] as Record<string, unknown> | undefined;
  if (!usage) return EMPTY_USAGE;
  return {
    promptTokens: typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : null,
    completionTokens:
      typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : null,
    totalTokens: typeof usage['total_tokens'] === 'number' ? usage['total_tokens'] : null,
    costUsd: typeof usage['cost'] === 'number' ? usage['cost'] : null,
  };
}

// ─────────────────────────────  provider  ──────────────────────────

export class OpenRouterProvider {
  readonly name = activeProvider();

  async complete<T = unknown>(args: CompleteArgs<T>): Promise<LlmResult<T>> {
    const chain = getChain(args.role);
    const attempts: LlmAttempt[] = [];
    const wallStart = Date.now();

    for (let ci = 0; ci < chain.length; ci++) {
      const entry = chain[ci]!;
      const modelId = entry.modelId;

      // Exponential backoff between models (not between repair retries)
      if (ci > 0) {
        await sleep(jitter(1_000 * Math.pow(2, ci - 1)));
      }

      const attempt = await this._trySingleModel<T>(args, modelId, entry.timeoutMs);
      attempts.push(...attempt.attempts);

      if (attempt.ok) {
        const latencyMs = Date.now() - wallStart;
        const result: LlmResult<T> = {
          provider: activeProvider(),
          role: args.role,
          modelId,
          text: attempt.text,
          parsed: attempt.parsed as T | null,
          finishReason: attempt.finishReason,
          usage: attempt.usage,
          latencyMs,
          attempts,
        };
        this._logRequest(args, result).catch(() => {});
        return result;
      }
    }

    // Chain exhausted
    throw new UpstreamError(
      'OpenRouter',
      `All models in the '${args.role}' chain failed after ${attempts.length} attempt(s)`,
      { details: { role: args.role, attempts: attempts.map((a) => a.modelId) }, retryable: false },
    );
  }

  // ──────────────────  single-model attempt  ────────────────────

  private async _trySingleModel<T>(
    args: CompleteArgs<T>,
    modelId: string,
    timeoutMs?: number,
  ): Promise<{
    ok: boolean;
    text: string;
    parsed: T | null;
    finishReason: string | null;
    usage: LlmUsage;
    attempts: LlmAttempt[];
  }> {
    const useJsonSchema = !!args.schema && JSON_SCHEMA_MODELS.has(modelId);
    const useJsonMode = !!args.schema && !useJsonSchema;

    const payload = this._buildPayload(args, modelId, useJsonSchema, useJsonMode);
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs ?? 60_000,
    );

    let raw: Response;
    let httpStatus: number | null = null;
    try {
      const backend = resolveBackend();
      raw = await fetch(`${backend.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${backend.apiKey}`,
          'Content-Type': 'application/json',
          ...backend.headers,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      httpStatus = raw.status;
    } catch (err) {
      clearTimeout(timeout);
      const latencyMs = Date.now() - start;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const attempt: LlmAttempt = {
        modelId,
        outcome: 'transport',
        repair: false,
        structuredOutput: useJsonSchema ? 'json_schema' : useJsonMode ? 'json_object' : 'none',
        httpStatus: null,
        latencyMs,
        usage: EMPTY_USAGE,
        error: isAbort ? 'timeout' : String(err),
      };
      return { ok: false, text: '', parsed: null, finishReason: null, usage: EMPTY_USAGE, attempts: [attempt] };
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - start;

    if (!raw.ok) {
      const text = await raw.text().catch(() => '');
      const attempt: LlmAttempt = {
        modelId,
        outcome: 'http',
        repair: false,
        structuredOutput: useJsonSchema ? 'json_schema' : useJsonMode ? 'json_object' : 'none',
        httpStatus,
        latencyMs,
        usage: EMPTY_USAGE,
        error: text.slice(0, 500),
      };
      return { ok: false, text: '', parsed: null, finishReason: null, usage: EMPTY_USAGE, attempts: [attempt] };
    }

    let data: Record<string, unknown>;
    try {
      data = (await raw.json()) as Record<string, unknown>;
    } catch {
      const attempt: LlmAttempt = {
        modelId,
        outcome: 'empty',
        repair: false,
        structuredOutput: useJsonSchema ? 'json_schema' : useJsonMode ? 'json_object' : 'none',
        httpStatus,
        latencyMs,
        usage: EMPTY_USAGE,
        error: 'non-JSON body',
      };
      return { ok: false, text: '', parsed: null, finishReason: null, usage: EMPTY_USAGE, attempts: [attempt] };
    }

    const usage = extractUsage(data);
    const choices = data['choices'] as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const messageContent = (choice?.['message'] as Record<string, unknown> | undefined)?.['content'];
    const text = typeof messageContent === 'string' ? messageContent : '';
    const finishReason = typeof choice?.['finish_reason'] === 'string' ? choice['finish_reason'] : null;

    if (!text) {
      const attempt: LlmAttempt = {
        modelId,
        outcome: 'empty',
        repair: false,
        structuredOutput: useJsonSchema ? 'json_schema' : useJsonMode ? 'json_object' : 'none',
        httpStatus,
        latencyMs,
        usage,
        error: 'empty content',
      };
      return { ok: false, text: '', parsed: null, finishReason, usage, attempts: [attempt] };
    }

    const firstAttempt: LlmAttempt = {
      modelId,
      outcome: 'ok',
      repair: false,
      structuredOutput: useJsonSchema ? 'json_schema' : useJsonMode ? 'json_object' : 'none',
      httpStatus,
      latencyMs,
      usage,
      error: null,
    };

    // No schema → done
    if (!args.schema) {
      return { ok: true, text, parsed: null, finishReason, usage, attempts: [firstAttempt] };
    }

    // Try to parse the schema
    const parsed = tryParse<T>(text, args.schema);
    if (parsed !== null) {
      return { ok: true, text, parsed, finishReason, usage, attempts: [firstAttempt] };
    }

    // Schema failed — one repair attempt
    const allAttempts: LlmAttempt[] = [firstAttempt];
    for (let r = 0; r < MAX_REPAIR_ATTEMPTS; r++) {
      const repairStart = Date.now();
      const repairPayload = this._buildRepairPayload(payload, text);
      let repairRaw: Response;
      try {
        const repairBackend = resolveBackend();
        repairRaw = await fetch(`${repairBackend.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${repairBackend.apiKey}`,
            'Content-Type': 'application/json',
            ...repairBackend.headers,
          },
          body: JSON.stringify(repairPayload),
        });
      } catch {
        allAttempts.push({
          modelId,
          outcome: 'transport',
          repair: true,
          structuredOutput: 'json_object',
          httpStatus: null,
          latencyMs: Date.now() - repairStart,
          usage: EMPTY_USAGE,
          error: 'repair transport failure',
        });
        break;
      }

      if (!repairRaw.ok) {
        allAttempts.push({
          modelId,
          outcome: 'http',
          repair: true,
          structuredOutput: 'json_object',
          httpStatus: repairRaw.status,
          latencyMs: Date.now() - repairStart,
          usage: EMPTY_USAGE,
          error: `repair HTTP ${repairRaw.status}`,
        });
        break;
      }

      let repairData: Record<string, unknown>;
      try {
        repairData = (await repairRaw.json()) as Record<string, unknown>;
      } catch {
        break;
      }

      const repairUsage = extractUsage(repairData);
      const repairChoices = repairData['choices'] as Array<Record<string, unknown>> | undefined;
      const repairText =
        (
          (repairChoices?.[0]?.['message'] as Record<string, unknown> | undefined)?.['content'] as
            | string
            | undefined
        ) ?? '';

      const repairParsed = repairText ? tryParse<T>(repairText, args.schema) : null;
      allAttempts.push({
        modelId,
        outcome: repairParsed !== null ? 'ok' : 'schema',
        repair: true,
        structuredOutput: 'json_object',
        httpStatus: repairRaw.status,
        latencyMs: Date.now() - repairStart,
        usage: repairUsage,
        error: repairParsed !== null ? null : 'schema validation failed after repair',
      });

      if (repairParsed !== null) {
        return { ok: true, text: repairText, parsed: repairParsed, finishReason, usage: repairUsage, attempts: allAttempts };
      }
    }

    // Schema validation failed after repair — treat as 'schema' failure; fall through to next model
    allAttempts[0] = { ...firstAttempt, outcome: 'schema', error: 'schema validation failed' };
    return { ok: false, text, parsed: null, finishReason, usage, attempts: allAttempts };
  }

  // ──────────────────  payload builders  ───────────────────────

  private _buildPayload<T>(
    args: CompleteArgs<T>,
    modelId: string,
    useJsonSchema: boolean,
    useJsonMode: boolean,
  ): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: args.system },
      ...args.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const payload: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: args.temperature ?? 0.3,
      max_tokens: args.maxTokens,
    };

    if (useJsonSchema && args.schema) {
      payload['response_format'] = {
        type: 'json_schema',
        json_schema: {
          name: args.schemaName ?? 'output',
          strict: true,
          schema: zodToJsonSchema(args.schema),
        },
      };
    } else if (useJsonMode) {
      payload['response_format'] = { type: 'json_object' };
    }

    return payload;
  }

  private _buildRepairPayload(
    original: Record<string, unknown>,
    badOutput: string,
  ): Record<string, unknown> {
    const messages = [
      ...(original['messages'] as Array<{ role: string; content: string }>),
      { role: 'assistant', content: badOutput },
      {
        role: 'user',
        content:
          'Your previous response did not match the required JSON schema. ' +
          'Return only a valid JSON object that satisfies the schema — no prose, no markdown.',
      },
    ];
    return {
      ...original,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0,
    };
  }

  // ──────────────────  logging  ─────────────────────────────────

  private async _logRequest<T>(
    args: CompleteArgs<T>,
    result: LlmResult<T>,
  ): Promise<void> {
    try {
      await db.llmRequest.create({
        data: {
          userId: (args as CompleteArgs<T> & { userId?: string }).userId ?? null,
          role: result.role,
          provider: activeProvider(),
          modelId: result.modelId,
          purpose: (args as CompleteArgs<T> & { purpose?: string }).purpose ?? 'unknown',
          refType: (args as CompleteArgs<T> & { refType?: string }).refType ?? null,
          refId: (args as CompleteArgs<T> & { refId?: string }).refId ?? null,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
          costUsd: result.usage.costUsd,
          latencyMs: result.latencyMs,
          status: 'ok',
        },
      });
    } catch (err) {
      logger.warn('Failed to write LlmRequest row', { err });
    }
  }
}

// ──────────────────  schema helpers  ──────────────────────────────

function tryParse<T>(text: string, schema: z.ZodType<T> | z.ZodTypeAny): T | null {
  try {
    const json = JSON.parse(text);
    const result = schema.safeParse(json);
    return result.success ? (result.data as T) : null;
  } catch {
    return null;
  }
}

/**
 * Minimal Zod → JSON Schema converter for the fields we actually use.
 * We don't need a full library — OpenRouter's json_schema mode only needs
 * type, properties, required, and enum. This is deterministic and has no deps.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = (schema as z.ZodObject<any>).shape as Record<string, any>;
    for (const [key, value] of Object.entries(shape)) {
      const inner = zodToJsonSchema(value as z.ZodTypeAny);
      // Strict mode forbids omitting a key from `required`, so an optional
      // field is expressed as "present but nullable" instead of absent.
      properties[key] = value instanceof z.ZodOptional ? asNullable(inner) : inner;
      required.push(key);
    }
    // Under strict json_schema both OpenAI and Groq reject the request (HTTP
    // 400) unless every object sets `additionalProperties: false` and lists
    // every property in `required` — nested objects included, not just the root.
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (schema instanceof z.ZodOptional) return zodToJsonSchema((schema as any).unwrap());
  if (schema instanceof z.ZodArray) return { type: 'array', items: zodToJsonSchema((schema as any).element) };
  if (schema instanceof z.ZodEnum) {
    const options = (schema as any).options ?? Object.keys((schema as any).enum ?? {});
    return { type: 'string', enum: options };
  }
  if (schema instanceof z.ZodString) return { type: 'string' };
  if (schema instanceof z.ZodNumber) return { type: 'number' };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodNullable) return asNullable(zodToJsonSchema((schema as any).unwrap()));
  // fallback
  return {};
}

/**
 * Marks a converted schema as nullable using a `type` union.
 *
 * The draft-4 style `{ nullable: true }` is not recognised under strict
 * json_schema mode; `type: ["string", "null"]` is the accepted spelling.
 */
function asNullable(js: Record<string, unknown>): Record<string, unknown> {
  const type = js['type'];
  if (typeof type === 'string') return { ...js, type: [type, 'null'] };
  if (Array.isArray(type) && !type.includes('null')) return { ...js, type: [...type, 'null'] };
  return js;
}

/** Singleton. Import this, not the class directly. */
export const openRouterProvider = new OpenRouterProvider();

