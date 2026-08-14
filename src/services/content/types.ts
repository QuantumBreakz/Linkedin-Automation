/**
 * Shared contract types for the content module (docs/05 §Stage 2–4).
 *
 * ─── Why these live here ────────────────────────────────────────────────
 * The authoritative `ResearchExtraction` schema belongs to `src/services/
 * analysis` (docs/05 §Stage 1). This file declares the *structural* shape the
 * content module consumes so that:
 *
 *   1. Nothing here depends on a module owned by another agent at compile
 *      time, and
 *   2. TypeScript's structural typing means the analysis module's own
 *      `ResearchExtraction` is accepted verbatim — the fields, names and enum
 *      members are copied from docs/05 exactly, and every field is declared
 *      `readonly` + optional so a *stricter* upstream type is assignable to it.
 *
 * The optionality is not laziness: docs/05 §Stage 1 rule 4 states that for an
 * `ABSTRACT_ONLY` paper, `methodology`, `dataset` and `limitations` are
 * "removed from the requested schema entirely". A stored extraction therefore
 * legitimately lacks those keys, and every reader must treat "missing" as
 * `ABSENT`. {@link claimProvenance} is the single place that rule is applied.
 */

import { z } from 'zod';

import type {
  ApprovalMode,
  ContentFormat,
  DraftStatus,
  EmojiUsage,
  FullTextStatus,
  PostLength,
  Technicality,
  Tone,
  VerificationStatus,
} from '@prisma/client';

export type {
  ApprovalMode,
  ContentFormat,
  DraftStatus,
  EmojiUsage,
  FullTextStatus,
  PostLength,
  Technicality,
  Tone,
  VerificationStatus,
};

// ────────────────────────────  enum literals  ────────────────────────────
//
// Prisma generates enums as `const` objects plus a string-literal union. We
// only ever need the *type* from `@prisma/client` (a type-only import, so no
// runtime cost and no client construction), and a locally declared literal
// array when we need to iterate. The `satisfies` clauses below make TypeScript
// fail the build if either list drifts from prisma/schema.prisma.

export const CONTENT_FORMATS = [
  'RESEARCH_BREAKDOWN',
  'ONE_INSIGHT',
  'RESEARCH_STORY',
  'MYTH_VS_REALITY',
  'VISUAL_EXPLAINER',
  'TECHNICAL_DEEP_DIVE',
] as const satisfies readonly ContentFormat[];

export const FULL_TEXT_STATUSES = [
  'UNKNOWN',
  'ABSTRACT_ONLY',
  'OA_PDF',
  'OA_XML',
  'FETCH_FAILED',
] as const satisfies readonly FullTextStatus[];

export const DRAFT_STATUSES = [
  'GENERATED',
  'NEEDS_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly DraftStatus[];

export const VERIFICATION_STATUSES = [
  'PENDING',
  'PASSED',
  'FLAGGED',
  'FAILED',
] as const satisfies readonly VerificationStatus[];

export const APPROVAL_MODES = [
  'AUTOMATIC',
  'APPROVAL_REQUIRED',
  'DRAFT_ONLY',
] as const satisfies readonly ApprovalMode[];

// ──────────────────────────  extraction contract  ────────────────────────

/** docs/05 §Stage 1. */
export const PROVENANCE_VALUES = ['STATED', 'INFERRED', 'ABSENT'] as const;
export const ProvenanceSchema = z.enum(PROVENANCE_VALUES);
export type Provenance = (typeof PROVENANCE_VALUES)[number];

export const AUDIENCE_VALUES = [
  'RESEARCHERS',
  'CLINICIANS',
  'INDUSTRY',
  'GENERAL_PUBLIC',
] as const;
export const AudienceSchema = z.enum(AUDIENCE_VALUES);
export type Audience = (typeof AUDIENCE_VALUES)[number];

export const SUGGESTED_VISUAL_VALUES = [
  'STAT_CARD',
  'KEY_FINDINGS',
  'BEFORE_AFTER',
  'PROBLEM_SOLUTION',
  'PROCESS_FLOW',
  'COMPARISON',
  'CONCEPT_EXPLAINER',
] as const;
export type SuggestedVisual = (typeof SUGGESTED_VISUAL_VALUES)[number];

/** docs/05 §Stage 1 `Claim`. */
export interface Claim {
  readonly value: string;
  readonly provenance: Provenance;
  /** Verbatim span copied from the source. Non-null only when `STATED`. */
  readonly evidence: string | null;
}

/**
 * docs/05 §Stage 1 `importantNumbers` entry. `value` is a string on purpose —
 * it preserves "37%", "p<0.001" and "1.4×" without a lossy numeric round-trip.
 */
export interface ImportantNumber {
  readonly metric: string;
  readonly value: string;
  readonly context: string;
  /** Mandatory: an entry whose evidence failed containment was discarded upstream. */
  readonly evidence: string;
}

export interface TechnicalTerm {
  readonly term: string;
  readonly plainLanguage: string;
}

/**
 * The structural shape of `PaperAnalysis.extraction`.
 *
 * Every field is optional because (a) it arrives from a `Json` column and
 * (b) docs/05 §Stage 1 rule 4 removes three of them entirely for abstract-only
 * papers. Read claims through {@link claimProvenance} / {@link statedClaims}
 * rather than touching fields directly.
 */
export interface ResearchExtraction {
  readonly problem?: Claim;
  readonly researchQuestion?: Claim;
  readonly methodology?: Claim;
  readonly dataset?: Claim;
  readonly keyFindings?: readonly Claim[];
  readonly importantNumbers?: readonly ImportantNumber[];
  readonly limitations?: readonly Claim[];
  readonly realWorldImplications?: readonly Claim[];
  readonly novelty?: Claim;
  readonly technicalTerms?: readonly TechnicalTerm[];
  readonly audienceFit?: Audience;
  readonly suggestedVisuals?: readonly SuggestedVisual[];
  readonly overallConfidence?: number;
}

/**
 * Boundary re-validation for `PaperAnalysis.extraction` read back out of the
 * `Json` column. `src/services/analysis` owns the *authoritative* schema used
 * for structured output; this one is deliberately lenient (unknown keys pass,
 * doc-removed fields are optional) so that a schema improvement upstream never
 * makes an already-stored analysis unreadable.
 */
export const ClaimSchema = z.object({
  value: z.string(),
  provenance: ProvenanceSchema,
  evidence: z.string().nullable(),
});

export const ImportantNumberSchema = z.object({
  metric: z.string(),
  value: z.string(),
  context: z.string(),
  evidence: z.string(),
});

export const ResearchExtractionSchema = z.object({
  problem: ClaimSchema.optional(),
  researchQuestion: ClaimSchema.optional(),
  methodology: ClaimSchema.optional(),
  dataset: ClaimSchema.optional(),
  keyFindings: z.array(ClaimSchema).max(5).optional(),
  importantNumbers: z.array(ImportantNumberSchema).optional(),
  limitations: z.array(ClaimSchema).max(4).optional(),
  realWorldImplications: z.array(ClaimSchema).max(3).optional(),
  novelty: ClaimSchema.optional(),
  technicalTerms: z.array(z.object({ term: z.string(), plainLanguage: z.string() })).optional(),
  audienceFit: AudienceSchema.optional(),
  suggestedVisuals: z.array(z.enum(SUGGESTED_VISUAL_VALUES)).optional(),
  overallConfidence: z.number().min(0).max(1).optional(),
});

// ────────────────────────────  paper contract  ───────────────────────────

export interface PaperAuthorRecord {
  readonly name: string;
  readonly orcid?: string | null;
  readonly position: number;
  /** docs/04 §Author disambiguation — true only for a verified attribution. */
  readonly isUser: boolean;
}

/**
 * The subset of `ResearchPaper` (+ its authors) the content module needs.
 * Structurally satisfied by a Prisma `ResearchPaper & { authors: PaperAuthor[] }`.
 */
export interface PaperRecord {
  readonly id: string;
  readonly title: string;
  readonly abstract?: string | null;
  readonly venue?: string | null;
  readonly landingUrl?: string | null;
  readonly oaPdfUrl?: string | null;
  readonly doi?: string | null;
  readonly arxivId?: string | null;
  readonly pmid?: string | null;
  readonly publicationDate?: Date | string | null;
  readonly isRetracted?: boolean;
  readonly authors?: readonly PaperAuthorRecord[];
}

/**
 * The subset of `PaperAnalysis` the content module needs. `fullTextStatus`
 * maps to `PaperAnalysis.basedOn` — what the extraction actually read, not what
 * the paper record hopes is available.
 */
export interface AnalysisRecord {
  readonly id?: string;
  readonly extraction: ResearchExtraction;
  readonly fullTextStatus: FullTextStatus;
  readonly confidence?: number;
}

// ────────────────────────────  brand contract  ───────────────────────────

/** Structurally satisfied by a Prisma `BrandProfile` row. */
export interface BrandProfileRecord {
  readonly tone: Tone;
  readonly technicality: Technicality;
  readonly postLength: PostLength;
  readonly emojiUsage: EmojiUsage;
  readonly ctaEnabled: boolean;
  readonly hashtagsEnabled: boolean;
  readonly firstPerson: boolean;
  readonly customInstructions?: string | null;
  /** `Json` column: an array of the user's own approved posts. */
  readonly styleSamples?: unknown;
}

/** Structurally satisfied by a Prisma `User` row. */
export interface UserRecord {
  readonly id: string;
  readonly name: string;
  readonly title?: string | null;
  readonly fieldOfStudy?: string | null;
  readonly targetAudience?: readonly string[];
  readonly approvalMode?: ApprovalMode;
}

// ─────────────────────────────  LLM port  ────────────────────────────────
//
// docs/05 §Provider abstraction. Declared as a *port* the content module
// depends on rather than importing `src/services/llm` directly: the concrete
// provider is injected, which is what lets every function here be unit-tested
// with a fake and no network. Written with method shorthand (not a property of
// function type) so parameter checking is bivariant and the real provider —
// whose `LlmResult` carries more fields than we read — remains assignable.

export type ModelRole = 'cheap' | 'standard' | 'verify';

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompleteArgs {
  readonly role: ModelRole;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  /** Structured output; the provider enforces it where the model supports it. */
  readonly schema?: unknown;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Written to `LlmRequest.purpose`. */
  readonly purpose?: string;
  readonly userId?: string;
  readonly refType?: string;
  readonly refId?: string;
}

export interface LlmCompletion {
  readonly text: string;
  /** Populated when the provider validated against `schema`. */
  readonly parsed?: unknown;
  readonly modelId?: string;
}

export interface LlmProvider {
  readonly name?: string;
  complete(args: LlmCompleteArgs): Promise<LlmCompletion>;
}

// ──────────────────────────  claim accessors  ────────────────────────────

const ABSENT_CLAIM: Claim = { value: '', provenance: 'ABSENT', evidence: null };

/**
 * Provenance of a possibly-missing claim.
 *
 * A field that was removed from the requested schema (docs/05 §Stage 1 rule 4)
 * is indistinguishable from a field the model marked `ABSENT`, and both mean
 * "the source does not state this". Collapsing them here is what stops the
 * format gate from ever treating `undefined` as truthy.
 */
export function claimProvenance(claim: Claim | undefined | null): Provenance {
  if (claim === undefined || claim === null) return 'ABSENT';
  return claim.provenance;
}

export function isStated(claim: Claim | undefined | null): boolean {
  return claimProvenance(claim) === 'STATED';
}

export function isInferred(claim: Claim | undefined | null): boolean {
  return claimProvenance(claim) === 'INFERRED';
}

/** Never returns `undefined`, so callers can read `.value` without a guard. */
export function claimOrAbsent(claim: Claim | undefined | null): Claim {
  return claim ?? ABSENT_CLAIM;
}

export function claimList(claims: readonly Claim[] | undefined | null): readonly Claim[] {
  return Array.isArray(claims) ? claims : [];
}

/** The `STATED` subset of a claim list, in original order. */
export function statedClaims(claims: readonly Claim[] | undefined | null): readonly Claim[] {
  return claimList(claims).filter((claim) => claim.provenance === 'STATED');
}

export function inferredClaims(claims: readonly Claim[] | undefined | null): readonly Claim[] {
  return claimList(claims).filter((claim) => claim.provenance === 'INFERRED');
}

export function importantNumbers(
  extraction: ResearchExtraction | undefined | null,
): readonly ImportantNumber[] {
  const numbers = extraction?.importantNumbers;
  return Array.isArray(numbers) ? numbers : [];
}

/** Count of `STATED` entries in `keyFindings`. The unit the format table counts. */
export function statedFindingCount(extraction: ResearchExtraction): number {
  return statedClaims(extraction.keyFindings).length;
}
