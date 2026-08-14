# 05 — AI Pipeline

The product's core claim is *scientific accuracy*. This document is where that claim is either
engineered or lost. The pipeline never does `paper → post`; it does:

```
paper → structured extraction (+provenance) → format selection → draft → verification → visual spec
```

## Stage 1 — Extraction

Input: title, abstract, and full text when `fullTextStatus` allows it.
Output: a `ResearchExtraction`, validated with Zod, produced via the model's structured-output
mode (not free-text-then-parse).

```ts
const Provenance = z.enum(['STATED', 'INFERRED', 'ABSENT']);

const Claim = z.object({
  value: z.string(),
  provenance: Provenance,
  /** Verbatim span copied from the source. REQUIRED when provenance is STATED. */
  evidence: z.string().nullable(),
});

const ResearchExtraction = z.object({
  problem:          Claim,
  researchQuestion: Claim,
  methodology:      Claim,
  dataset:          Claim,
  keyFindings:      z.array(Claim).max(5),
  importantNumbers: z.array(z.object({
    metric:   z.string(),
    value:    z.string(),   // string, not number — preserves "37%", "p<0.001", "1.4×"
    context:  z.string(),
    evidence: z.string(),   // mandatory: a number with no evidence span is dropped
  })),
  limitations:          z.array(Claim).max(4),
  realWorldImplications: z.array(Claim).max(3),
  novelty:          Claim,
  technicalTerms:   z.array(z.object({ term: z.string(), plainLanguage: z.string() })),
  audienceFit:      z.enum(['RESEARCHERS', 'CLINICIANS', 'INDUSTRY', 'GENERAL_PUBLIC']),
  suggestedVisuals: z.array(z.enum([
    'STAT_CARD', 'KEY_FINDINGS', 'BEFORE_AFTER',
    'PROBLEM_SOLUTION', 'PROCESS_FLOW', 'COMPARISON', 'CONCEPT_EXPLAINER',
  ])),
  overallConfidence: z.number().min(0).max(1),
});
```

### The rules that make this trustworthy

1. **`ABSENT` is a first-class answer.** The prompt states plainly: *"If the source does not
   state something, return `ABSENT` with `evidence: null`. Returning `ABSENT` is correct
   behaviour and is preferred over any guess."* Most abstract-only papers should legitimately come
   back with `methodology: ABSENT` and `limitations: []`.
2. **Evidence spans are verified in code, not trusted.** After the model returns, we assert that
   every `STATED` claim's `evidence` string actually appears in the source text (normalised
   whitespace, case-insensitive). Any `STATED` claim whose evidence is not literally present is
   **downgraded to `INFERRED` and its `evidence` set to null**. This is a deterministic check that
   catches the most common and most dangerous failure — a fabricated quotation.
3. **Numbers require evidence, unconditionally.** Any entry in `importantNumbers` whose
   `evidence` fails the containment check is **discarded**, not downgraded. Invented statistics
   are the highest-severity failure this product can produce.
4. **Extraction is scoped to what we actually read.** When `fullTextStatus = ABSTRACT_ONLY`,
   `methodology`, `dataset`, and `limitations` are removed from the requested schema entirely.
   We do not ask the model a question it cannot possibly answer from the input — asking is what
   produces confabulation.
5. **Confidence is computed, not self-reported.** `overallConfidence` from the model is advisory.
   The stored value is derived: share of `STATED` vs `INFERRED` claims, evidence-check pass rate,
   full-text availability, and abstract length.

## Stage 2 — Format selection

Deterministic gating first, then model choice within what remains eligible.

| Format | Requires |
| --- | --- |
| `ONE_INSIGHT` | ≥1 `STATED` key finding |
| `RESEARCH_BREAKDOWN` | ≥3 `STATED` key findings |
| `VISUAL_EXPLAINER` | ≥1 `importantNumbers` entry **or** ≥2 `STATED` key findings |
| `RESEARCH_STORY` | `problem` **and** `methodology` both `STATED` |
| `MYTH_VS_REALITY` | `novelty` `STATED` and framed as contrast |
| `TECHNICAL_DEEP_DIVE` | `fullTextStatus ≠ ABSTRACT_ONLY` **and** `methodology` `STATED` |

An abstract-only paper is therefore structurally incapable of producing a `TECHNICAL_DEEP_DIVE`.
That is the point — the guard is in code, so no prompt regression can bypass it.

Among eligible formats, selection considers: user's target audience, the last ~8 posts (avoid
repeating a format), topic diversity, and — post-partner-approval — historical engagement.

## Stage 3 — Drafting

The prompt receives **only the extraction**, never the raw paper. This is the single most
effective anti-hallucination measure in the pipeline: the model physically cannot cite a number
that did not survive Stage 1's evidence check.

Prompt composition:
- **System:** role, hard constraints, the "no new facts" rule.
- **Extraction:** `STATED` claims only. `INFERRED` claims are passed with an explicit label and
  may only be used hedged ("suggests", "may indicate"). `ABSENT` fields are omitted.
- **Brand:** tone, technicality, length, emoji, CTA, hashtags, first-person.
- **Few-shot:** 2–3 of the user's own approved posts from `BrandProfile.styleSamples` — the one
  genuinely good idea inherited from the `LinkedIn_Post_Generator` baseline, now scoped to the
  user's *own* voice rather than a scraped celebrity's.
- **Hard requirement:** the paper link is always included; authorship is stated accurately
  ("our study" only when the user is a listed author).

## Stage 4 — Verification

An independent pass with a *different* prompt and the `verify` model role. The draft and the
extraction go in; a claim-by-claim report comes out.

```ts
const VerificationReport = z.object({
  claims: z.array(z.object({
    text: z.string(),                                  // sentence from the draft
    status: z.enum(['SUPPORTED', 'HEDGED_OK', 'UNSUPPORTED', 'CONTRADICTED']),
    supportingField: z.string().nullable(),            // which extraction field backs it
    note: z.string().nullable(),
  })),
  overstatement: z.boolean(),      // causal language over a correlational finding
  medicalAdviceRisk: z.boolean(),  // reads as clinical guidance
  numbersMatch: z.boolean(),       // every numeral in the draft traces to importantNumbers
  verdict: z.enum(['PASS', 'FLAG', 'FAIL']),
});
```

Deterministic post-checks run alongside the model, because these are decidable in code:

- Every numeral in the draft body must appear in `importantNumbers` or in the source text.
  Unmatched numeral → automatic `FAIL`.
- Causal verbs ("causes", "proves", "cures", "eliminates") against a finding whose evidence uses
  correlational language → `overstatement = true`.
- Author-count and venue claims cross-checked against `PaperAuthor` / `venue`.

**Routing:** `FAIL` → regenerate once, then `NEEDS_REVIEW`. `FLAG` → `NEEDS_REVIEW` always,
irrespective of approval mode. `PASS` → follows the user's approval mode.

Medical/clinical users get a stricter default: `medicalAdviceRisk = true` forces review, and the
system never phrases a finding as a recommendation to patients.

## Stage 5 — Visual specification

The model emits a `VisualSpec` (JSON) — never an image, never SVG markup. It chooses the
template and the content; the deterministic renderer draws it. Numbers in the spec are copied
from `importantNumbers`, which have already survived evidence checking. See
[`06-visual-engine.md`](06-visual-engine.md).

## Provider abstraction

```ts
type ModelRole = 'cheap' | 'standard' | 'verify';

interface LlmProvider {
  readonly name: string;
  complete(args: {
    role: ModelRole;
    system: string;
    messages: Message[];
    schema?: ZodSchema;      // structured output; provider enforces where supported
    temperature?: number;
    maxTokens?: number;
  }): Promise<LlmResult>;
}
```

- Roles map to **ordered fallback chains** of model IDs in config. A 429, a timeout, or a
  deprecated-model error falls through to the next entry.
- Structured output is requested natively where the provider supports it; where it does not, we
  fall back to JSON-mode plus Zod validation plus one repair retry.
- Every call writes an `LlmRequest` row.
- **No model ID appears outside config.** OpenRouter's free tier is the development default and
  is expected to change without notice (D8).

Retry policy: 2 attempts per model in a chain, exponential backoff with jitter, then fall
through. If an entire chain is exhausted the job fails and the paper stays in the inbox — we never
silently emit a lower-quality result from an unintended model.
