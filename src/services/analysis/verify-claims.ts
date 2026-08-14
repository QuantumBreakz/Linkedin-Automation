/**
 * Stage 4 — Draft verification.
 *
 * docs/05-ai-pipeline.md §Stage 4
 *
 * Two independent passes run in parallel:
 *  A. LLM verification: claim-by-claim report from a 'verify' role model.
 *  B. Deterministic checks: numeral tracing, causal language, author count.
 *
 * Both must pass for verdict PASS. Either B check triggering → automatic FAIL
 * regardless of the LLM verdict (docs/05: "these are decidable in code").
 */

import { z } from 'zod';
import type { LlmProvider } from '../llm/types';
import type { ResearchExtraction, ImportantNumber } from '../content/types';
import { importantNumbers as getImportantNumbers } from '../content/types';

// ─────────────────────────────  schema  ─────────────────────────────

const ClaimCheckSchema = z.object({
  text: z.string(),
  status: z.enum(['SUPPORTED', 'HEDGED_OK', 'UNSUPPORTED', 'CONTRADICTED']),
  supportingField: z.string().nullable(),
  note: z.string().nullable(),
});

export const VerificationReportSchema = z.object({
  claims: z.array(ClaimCheckSchema),
  overstatement: z.boolean(),
  medicalAdviceRisk: z.boolean(),
  numbersMatch: z.boolean(),
  verdict: z.enum(['PASS', 'FLAG', 'FAIL']),
});

export type VerificationReport = z.infer<typeof VerificationReportSchema>;
export type VerificationVerdict = VerificationReport['verdict'];

// ─────────────────────────────  causal verbs  ───────────────────────

const CAUSAL_VERBS = /\b(causes?|proves?|cures?|eliminates?|guarantees?|prevents?)\b/gi;
const CORRELATIONAL_TERMS = /\b(associated|correlat|linked|related|suggests?|indicates?|may|might|could)\b/i;

// ─────────────────────────────  numeral extraction  ─────────────────

function extractNumerals(text: string): string[] {
  const matches = text.match(/\d+(?:[.,]\d+)*(?:\s*%|\s*×|\s*x)?/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/\s+/g, '').toLowerCase()))];
}

function buildNumberPool(extraction: ResearchExtraction, source: string): Set<string> {
  const pool = new Set<string>();
  for (const num of getImportantNumbers(extraction)) {
    for (const n of extractNumerals(num.value)) pool.add(n);
    for (const n of extractNumerals(num.context)) pool.add(n);
  }
  // Also allow any numeral literally present in the source text
  for (const n of extractNumerals(source)) pool.add(n);
  return pool;
}

// ─────────────────────────────  deterministic checks  ───────────────

interface DetChecks {
  /** Every numeral in the draft traces to the number pool or source text. */
  numeralsOk: boolean;
  /** No causal verb applied to a correlational finding. */
  noOverstatement: boolean;
  /** Unmatched numerals (for the report). */
  unmatchedNumerals: string[];
}

function runDeterministicChecks(
  draftBody: string,
  extraction: ResearchExtraction,
  sourceText: string,
): DetChecks {
  const pool = buildNumberPool(extraction, sourceText);
  const draftNumerals = extractNumerals(draftBody);
  const unmatchedNumerals = draftNumerals.filter((n) => !pool.has(n));

  // Causal-language check: does the draft apply causal verbs where the
  // extraction uses correlational language?
  let noOverstatement = true;
  const sentences = draftBody.split(/[.!?]+/).filter(Boolean);
  for (const sentence of sentences) {
    if (CAUSAL_VERBS.test(sentence)) {
      // Check if any backing finding is phrased correlational
      const backingFindings = extraction.keyFindings?.filter(
        (c) => c.provenance !== 'ABSENT' && CORRELATIONAL_TERMS.test(c.evidence ?? c.value),
      );
      if (backingFindings && backingFindings.length > 0) {
        noOverstatement = false;
        break;
      }
    }
    CAUSAL_VERBS.lastIndex = 0; // reset regex
  }

  return {
    numeralsOk: unmatchedNumerals.length === 0,
    noOverstatement,
    unmatchedNumerals,
  };
}

// ─────────────────────────────  LLM pass  ────────────────────────────

function buildVerifyPrompt(
  draftBody: string,
  extraction: ResearchExtraction,
): { system: string; user: string } {
  const system = `You are a scientific fact-checker. You will receive a LinkedIn post draft and the structured extraction of the paper it is based on.

For each verifiable claim in the draft:
- SUPPORTED: claim is directly backed by the extraction
- HEDGED_OK: claim is hedged appropriately (uses "may", "suggests", "could")
- UNSUPPORTED: claim cannot be found in the extraction
- CONTRADICTED: claim contradicts the extraction

Also check:
- overstatement: does the draft use causal language ("causes", "proves") for correlational findings?
- medicalAdviceRisk: does any sentence read as advice to patients?
- numbersMatch: does every numeral in the draft appear in the extraction's importantNumbers?
- verdict: PASS if all claims SUPPORTED or HEDGED_OK, numbersMatch true, no overstatement, no medical risk. FLAG if minor issues. FAIL if any CONTRADICTED, numbersMatch false, or serious overstatement.

Return ONLY a valid JSON object.`;

  const extractionText = JSON.stringify({
    keyFindings: extraction.keyFindings?.filter((c) => c.provenance !== 'ABSENT'),
    importantNumbers: extraction.importantNumbers,
    limitations: extraction.limitations?.filter((c) => c.provenance !== 'ABSENT'),
    novelty: extraction.novelty?.provenance !== 'ABSENT' ? extraction.novelty : undefined,
  }, null, 2);

  const user = `DRAFT:\n${draftBody}\n\nEXTRACTION:\n${extractionText}`;
  return { system, user };
}

// ─────────────────────────────  main  ────────────────────────────────

export interface VerifyDraftInput {
  draftBody: string;
  extraction: ResearchExtraction;
  /** The full source text used for numeral tracing. */
  sourceText: string;
}

export async function verifyDraft(
  input: VerifyDraftInput,
  llm: LlmProvider,
  opts: { userId?: string; draftId?: string } = {},
): Promise<VerificationReport> {
  const { system, user } = buildVerifyPrompt(input.draftBody, input.extraction);

  // Run deterministic checks and LLM in parallel
  const [detChecks, llmResult] = await Promise.all([
    Promise.resolve(runDeterministicChecks(input.draftBody, input.extraction, input.sourceText)),
    llm.complete<VerificationReport>({
      role: 'verify',
      system,
      messages: [{ role: 'user', content: user }],
      schema: VerificationReportSchema,
      schemaName: 'VerificationReport',
      temperature: 0,
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.draftId ? { refType: 'draft', refId: opts.draftId } : {}),
    } as Parameters<LlmProvider['complete']>[0]),
  ]);

  // If LLM failed, produce a deterministic-only report
  const llmReport = llmResult.parsed;
  if (!llmReport) {
    return {
      claims: [],
      overstatement: !detChecks.noOverstatement,
      medicalAdviceRisk: false,
      numbersMatch: detChecks.numeralsOk,
      verdict: detChecks.numeralsOk && detChecks.noOverstatement ? 'FLAG' : 'FAIL',
    };
  }

  // Merge: deterministic checks can only make the verdict worse, never better
  const numeralsOk = detChecks.numeralsOk;
  const noOverstatement = detChecks.noOverstatement;

  let verdict = llmReport.verdict;
  if (!numeralsOk || !noOverstatement) {
    verdict = 'FAIL';
  } else if (verdict === 'PASS' && (llmReport.overstatement || llmReport.medicalAdviceRisk)) {
    verdict = 'FLAG';
  }

  return {
    claims: llmReport.claims,
    overstatement: llmReport.overstatement || !noOverstatement,
    medicalAdviceRisk: llmReport.medicalAdviceRisk,
    numbersMatch: numeralsOk && llmReport.numbersMatch,
    verdict,
  };
}
