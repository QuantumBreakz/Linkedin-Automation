/**
 * Research extraction — Stage 1 of the AI pipeline.
 *
 * docs/05-ai-pipeline.md §Stage 1
 *
 * The safety properties implemented here:
 *  1. Schema-driven — Zod + structured output mode; no free-text parsing.
 *  2. Evidence containment — every STATED claim's evidence must literally
 *     appear in the source. Failed spans are downgraded to INFERRED.
 *  3. Number guard — importantNumbers entries whose evidence fails containment
 *     are discarded entirely. Invented statistics are the highest-severity failure.
 *  4. Scope gating — ABSTRACT_ONLY papers get a reduced schema; we never ask
 *     for methodology/dataset/limitations from an abstract.
 *  5. Confidence is computed deterministically, not self-reported.
 */

import { z } from 'zod';
import type { FullTextStatus } from '@prisma/client';
import type { LlmProvider } from '../llm/types';
import { ResearchExtractionSchema } from '../content/types';
import type { ResearchExtraction, Claim, ImportantNumber } from '../content/types';

// ─────────────────────────────  input  ─────────────────────────────

export interface ExtractionInput {
  title: string;
  abstract: string | null;
  fullText: string | null;
  fullTextStatus: FullTextStatus;
}

// ─────────────────────────────  output  ─────────────────────────────

export interface ExtractionResult {
  extraction: ResearchExtraction;
  /** Per-field evidence containment pass/fail (post-correction state). */
  provenance: Record<string, 'STATED' | 'INFERRED' | 'ABSENT'>;
  /** Share of claims that passed containment after correction. */
  confidence: number;
  basedOn: FullTextStatus;
  modelId: string;
  promptHash: string;
}

// ─────────────────────────────  schema gating  ──────────────────────

/**
 * For ABSTRACT_ONLY papers, we remove fields that require full-text
 * understanding (docs/05 §Stage 1 rule 4). This prevents confabulation by
 * making it structurally impossible to request those fields.
 */
function buildExtractionSchema(fullTextStatus: FullTextStatus): z.ZodType<ResearchExtraction> {
  if (fullTextStatus === 'ABSTRACT_ONLY' || fullTextStatus === 'UNKNOWN') {
    return ResearchExtractionSchema.omit({
      methodology: true,
      dataset: true,
      limitations: true,
    }) as unknown as z.ZodType<ResearchExtraction>;
  }
  return ResearchExtractionSchema as z.ZodType<ResearchExtraction>;
}

// ─────────────────────────────  prompt  ─────────────────────────────

function buildExtractionPrompt(input: ExtractionInput): { system: string; user: string } {
  const isAbstractOnly =
    input.fullTextStatus === 'ABSTRACT_ONLY' || input.fullTextStatus === 'UNKNOWN';

  const system = `You are a scientific research analyst. Your task is to extract structured information from an academic paper.

CRITICAL RULES:
1. If the source does not explicitly state something, return provenance: "ABSENT" with evidence: null. ABSENT is correct behaviour and is PREFERRED over guessing.
2. For every STATED claim, the "evidence" field MUST be a verbatim quote from the source text.
3. Every entry in importantNumbers MUST have an "evidence" field with a verbatim quote containing that number.
4. Do not invent numbers, statistics, or findings not present in the source.
5. "INFERRED" means you reasonably concluded it from the text but it is not directly stated.
${isAbstractOnly ? '6. You only have access to the abstract. Do NOT attempt to describe methodology, dataset, or limitations — those fields are not requested.' : ''}

Return ONLY a valid JSON object matching the schema. No prose, no markdown.`;

  const source = input.fullText
    ? `TITLE: ${input.title}\n\nFULL TEXT:\n${input.fullText.slice(0, 12_000)}`
    : `TITLE: ${input.title}\n\nABSTRACT:\n${input.abstract ?? '(no abstract available)'}`;

  return { system, user: source };
}

// ─────────────────────────────  containment check  ──────────────────

/** Normalises text for containment matching: lowercase, collapse whitespace. */
function normaliseForContainment(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsEvidence(source: string, evidence: string): boolean {
  const normSource = normaliseForContainment(source);
  const normEvidence = normaliseForContainment(evidence);
  return normEvidence.length > 0 && normSource.includes(normEvidence);
}

/** The full source text used for containment checking. */
function sourceText(input: ExtractionInput): string {
  return [input.title, input.abstract, input.fullText].filter(Boolean).join(' ');
}

/**
 * Runs evidence containment on a single claim.
 * Downgrades STATED → INFERRED and clears evidence when it fails.
 */
function verifyClaim(claim: Claim, source: string): Claim {
  if (claim.provenance !== 'STATED') return claim;
  if (!claim.evidence) {
    // STATED with no evidence → downgrade
    return { ...claim, provenance: 'INFERRED' };
  }
  if (!containsEvidence(source, claim.evidence)) {
    return { ...claim, provenance: 'INFERRED', evidence: null };
  }
  return claim;
}

/**
 * Runs evidence containment on an importantNumbers entry.
 * Returns null (discard) when evidence fails — discarding is mandatory for numbers.
 */
function verifyNumber(num: ImportantNumber, source: string): ImportantNumber | null {
  if (!containsEvidence(source, num.evidence)) return null;
  return num;
}

// ─────────────────────────────  confidence  ─────────────────────────

function computeConfidence(
  extraction: ResearchExtraction,
  input: ExtractionInput,
): number {
  const allClaims: Array<{ provenance: string }> = [
    extraction.problem,
    extraction.researchQuestion,
    extraction.methodology,
    extraction.dataset,
    extraction.novelty,
    ...(extraction.keyFindings ?? []),
    ...(extraction.limitations ?? []),
    ...(extraction.realWorldImplications ?? []),
  ].filter((c): c is Claim => !!c);

  if (allClaims.length === 0) return 0;

  const stated = allClaims.filter((c) => c.provenance === 'STATED').length;
  const claimScore = stated / allClaims.length;

  // Full-text bonus
  const ftBonus = input.fullTextStatus === 'OA_PDF' || input.fullTextStatus === 'OA_XML' ? 0.1 : 0;

  // Abstract length bonus (more context = more reliable)
  const abstractLen = input.abstract?.length ?? 0;
  const abstractBonus = Math.min(abstractLen / 2000, 0.1);

  return Math.min(claimScore * 0.8 + ftBonus + abstractBonus, 1.0);
}

// ─────────────────────────────  main  ────────────────────────────────

import { createHash } from 'node:crypto';

export async function extractResearch(
  input: ExtractionInput,
  llm: LlmProvider,
  opts: { userId?: string; paperId?: string } = {},
): Promise<ExtractionResult> {
  const schema = buildExtractionSchema(input.fullTextStatus);
  const { system, user } = buildExtractionPrompt(input);
  const promptHash = createHash('sha256').update(system).update(user).digest('hex').slice(0, 16);

  const result = await (llm.complete as (args: {
    role: 'standard';
    system: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    schema: typeof schema;
    schemaName: string;
    temperature: number;
    maxTokens: number;
    userId?: string;
    refType?: string;
    refId?: string;
    purpose?: string;
  }) => Promise<{ parsed: ResearchExtraction | null; modelId: string }>)({
    role: 'standard',
    system,
    messages: [{ role: 'user', content: user }],
    schema,
    schemaName: 'ResearchExtraction',
    temperature: 0.1,
    maxTokens: 4096,
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.paperId ? { refType: 'paper', refId: opts.paperId } : {}),
    purpose: 'extraction',
  });

  if (!result.parsed) {
    throw new Error('LLM returned no parsed extraction — all models in chain failed schema validation');
  }

  const raw = result.parsed;
  const src = sourceText(input);

  // ── evidence containment ───────────────────────────────────────────

  const extraction: ResearchExtraction = {
    problem: raw.problem ? verifyClaim(raw.problem, src) : undefined,
    researchQuestion: raw.researchQuestion ? verifyClaim(raw.researchQuestion, src) : undefined,
    methodology: raw.methodology ? verifyClaim(raw.methodology, src) : undefined,
    dataset: raw.dataset ? verifyClaim(raw.dataset, src) : undefined,
    novelty: raw.novelty ? verifyClaim(raw.novelty, src) : undefined,
    keyFindings: raw.keyFindings?.map((c) => verifyClaim(c, src)),
    limitations: raw.limitations?.map((c) => verifyClaim(c, src)),
    realWorldImplications: raw.realWorldImplications?.map((c) => verifyClaim(c, src)),
    // Numbers: discard (not downgrade) on containment failure
    importantNumbers: raw.importantNumbers
      ?.map((n) => verifyNumber(n, src))
      .filter((n): n is ImportantNumber => n !== null),
    technicalTerms: raw.technicalTerms,
    audienceFit: raw.audienceFit,
    suggestedVisuals: raw.suggestedVisuals,
    overallConfidence: raw.overallConfidence,
  };

  // ── provenance summary ────────────────────────────────────────────

  const provenance: Record<string, 'STATED' | 'INFERRED' | 'ABSENT'> = {};
  for (const field of [
    'problem', 'researchQuestion', 'methodology', 'dataset', 'novelty',
  ] as const) {
    const claim = extraction[field];
    provenance[field] = claim?.provenance ?? 'ABSENT';
  }
  provenance['keyFindings'] =
    (extraction.keyFindings?.some((c) => c.provenance === 'STATED') ? 'STATED'
      : extraction.keyFindings?.length ? 'INFERRED'
      : 'ABSENT');

  const confidence = computeConfidence(extraction, input);

  return {
    extraction,
    provenance,
    confidence,
    basedOn: input.fullTextStatus,
    modelId: result.modelId,
    promptHash,
  };
}
