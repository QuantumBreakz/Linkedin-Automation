/**
 * Stage 3 — Draft generation.
 *
 * docs/05-ai-pipeline.md §Stage 3
 *
 * Critical: the prompt receives ONLY the extraction, never the raw paper.
 * This is the single most effective anti-hallucination measure — the model
 * physically cannot cite a number that didn't survive Stage 1's evidence check.
 */

import type { ContentFormat } from '@prisma/client';
import type { LlmProvider } from '../llm/types';
import type {
  ResearchExtraction,
  BrandProfileRecord,
  UserRecord,
  PaperRecord,
  AnalysisRecord,
} from './types';
import { statedClaims, claimList, importantNumbers, isStated } from './types';

// ─────────────────────────────  format configs  ──────────────────────

const FORMAT_DESCRIPTIONS: Record<ContentFormat, string> = {
  ONE_INSIGHT: 'A single striking insight from the research, explained clearly with one key finding.',
  RESEARCH_BREAKDOWN: 'A structured breakdown of the research: problem, key findings, and implications.',
  RESEARCH_STORY: 'A narrative arc: the problem the researchers faced, their approach, and what they found.',
  MYTH_VS_REALITY: 'Challenge a common misconception or assumption that this research overturns.',
  VISUAL_EXPLAINER: 'Lead with the key statistic or number, then explain what it means.',
  TECHNICAL_DEEP_DIVE: 'A technically detailed post for expert readers: methodology, findings, and limitations.',
};

const APPROXIMATE_CHAR_LIMITS: Record<string, number> = {
  SHORT: 800,
  MEDIUM: 1500,
  LONG: 2500,
};

// ─────────────────────────────  prompt builder  ──────────────────────

function buildDraftPrompt(
  format: ContentFormat,
  extraction: ResearchExtraction,
  paper: PaperRecord,
  analysis: AnalysisRecord,
  brand: BrandProfileRecord,
  user: UserRecord,
): { system: string; user: string } {
  const charLimit = APPROXIMATE_CHAR_LIMITS[brand.postLength] ?? 1500;
  const isAuthor = paper.authors?.some((a) => a.isUser) ?? false;

  // Style samples (few-shot exemplars from the user's own approved posts)
  const styleSamples = Array.isArray(brand.styleSamples) ? brand.styleSamples : [];
  const fewShotSection =
    styleSamples.length > 0
      ? `\nEXAMPLES OF MY PAST POSTS (match this style):\n${
          styleSamples
            .slice(0, 3)
            .map((s, i) => `Example ${i + 1}:\n${String(s)}`)
            .join('\n\n')
        }\n`
      : '';

  const system = `You are a LinkedIn ghostwriter helping a researcher communicate their work.

FORMAT: ${format} — ${FORMAT_DESCRIPTIONS[format]}

AUTHOR PROFILE:
- Name: ${user.name}
- Title: ${user.title ?? 'Researcher'}
- Field: ${user.fieldOfStudy ?? 'Research'}

STYLE REQUIREMENTS:
- Tone: ${brand.tone}
- Technicality: ${brand.technicality}
- Target length: ~${charLimit} characters
- Emoji: ${brand.emojiUsage === 'NONE' ? 'none' : brand.emojiUsage === 'LOW' ? '1-2 only' : '3-5 where appropriate'}
- First person: ${brand.firstPerson ? 'yes — write as "I" or "we"' : 'no — write in third person'}
- CTA at end: ${brand.ctaEnabled ? 'yes' : 'no'}
- Hashtags: ${brand.hashtagsEnabled ? 'yes, 3-5 relevant hashtags' : 'no hashtags'}
${brand.customInstructions ? `- Custom instructions: ${brand.customInstructions}` : ''}

CRITICAL RULES:
1. Only use facts from the EXTRACTION below. Do NOT add new facts, numbers, or claims.
2. ${isAuthor ? 'This is the researcher\'s own work — use "our study", "we found", "in our research".' : 'This is NOT the researcher\'s own work — use "researchers found", "the study shows" — never "our".'}
3. INFERRED claims must be hedged: use "suggests", "may indicate", "could imply".
4. ABSENT fields do not exist in this paper — do not mention them.
5. Always include the paper link at the end.
6. Return a JSON object with: {"body": "...", "hashtags": ["..."]}
${fewShotSection}`;

  // Build extraction digest — stated claims only, absent fields omitted
  const digest: Record<string, unknown> = {};

  if (isStated(extraction.problem)) {
    digest['problem'] = extraction.problem!.value;
  }
  if (isStated(extraction.researchQuestion)) {
    digest['researchQuestion'] = extraction.researchQuestion!.value;
  }
  if (isStated(extraction.methodology) && format === 'TECHNICAL_DEEP_DIVE') {
    digest['methodology'] = extraction.methodology!.value;
  }
  const statedFindings = statedClaims(extraction.keyFindings);
  if (statedFindings.length > 0) {
    digest['keyFindings'] = statedFindings.map((c) => c.value);
  }
  // Inferred findings — pass with label
  const inferredFindings = claimList(extraction.keyFindings).filter((c) => c.provenance === 'INFERRED');
  if (inferredFindings.length > 0) {
    digest['keyFindings_inferred'] = inferredFindings.map((c) => c.value);
  }
  const nums = importantNumbers(extraction);
  if (nums.length > 0) {
    digest['importantNumbers'] = nums.map((n) => `${n.metric}: ${n.value} (${n.context})`);
  }
  if (isStated(extraction.novelty)) {
    digest['novelty'] = extraction.novelty!.value;
  }
  const statedImplications = statedClaims(extraction.realWorldImplications);
  if (statedImplications.length > 0) {
    digest['implications'] = statedImplications.map((c) => c.value);
  }
  if (extraction.technicalTerms?.length) {
    digest['technicalTerms'] = extraction.technicalTerms.map(
      (t) => `${t.term}: ${t.plainLanguage}`,
    );
  }

  const authorList = paper.authors
    ? paper.authors.map((a) => a.name).join(', ')
    : 'Unknown authors';

  // publicationDate arrives as a Date (Prisma) or a partial ISO string. Format
  // to YYYY-MM: `String(new Date(...))` would yield "Mon Aug 18 2026 …", whose
  // first seven chars are "Mon Aug" — a mangled date the model then parrots into
  // the post. Guard against an unparseable value rather than emitting garbage.
  const publicationMonth = (() => {
    if (!paper.publicationDate) return null;
    const d = new Date(paper.publicationDate as string | Date);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 7);
  })();

  const paperInfo = [
    `Title: ${paper.title}`,
    paper.venue ? `Published in: ${paper.venue}` : null,
    publicationMonth ? `Date: ${publicationMonth}` : null,
    `Authors: ${authorList}`,
    paper.landingUrl ? `Link: ${paper.landingUrl}` : paper.doi ? `DOI: ${paper.doi}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = `PAPER:\n${paperInfo}\n\nEXTRACTION:\n${JSON.stringify(digest, null, 2)}`;

  return { system, user: userContent };
}

// ─────────────────────────────  output schema  ───────────────────────

import { z } from 'zod';

const DraftOutputSchema = z.object({
  body: z.string().min(50),
  hashtags: z.array(z.string()).max(10).default([]),
});

// ─────────────────────────────  main  ────────────────────────────────

export interface GenerateDraftResult {
  body: string;
  hashtags: string[];
  linkUrl: string | null;
  modelId: string;
}

export async function generateDraft(
  format: ContentFormat,
  paper: PaperRecord,
  analysis: AnalysisRecord,
  brand: BrandProfileRecord,
  user: UserRecord,
  llm: LlmProvider,
  opts: { userId?: string; paperId?: string } = {},
): Promise<GenerateDraftResult> {
  const extraction = analysis.extraction;
  const { system, user: userContent } = buildDraftPrompt(
    format, extraction, paper, analysis, brand, user,
  );

  const result = await llm.complete<z.infer<typeof DraftOutputSchema>>({
    role: 'standard',
    system,
    messages: [{ role: 'user', content: userContent }],
    schema: DraftOutputSchema,
    schemaName: 'DraftOutput',
    temperature: 0.7,
    maxTokens: 2000,
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.paperId ? { refType: 'paper', refId: opts.paperId } : {}),
  } as Parameters<LlmProvider['complete']>[0]);

  if (!result.parsed) {
    throw new Error('Draft generation failed — all models exhausted');
  }

  const linkUrl = paper.landingUrl ?? (paper.doi ? `https://doi.org/${paper.doi}` : null);

  return {
    body: result.parsed.body,
    hashtags: brand.hashtagsEnabled ? result.parsed.hashtags : [],
    linkUrl,
    modelId: result.modelId,
  };
}
