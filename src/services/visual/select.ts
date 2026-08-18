/**
 * Visual template selection — deciding *which* card a paper should get.
 *
 * The renderer has always supported four templates, but the pipeline only ever
 * built STAT_CARD, and only for papers with an extracted number — so three
 * templates were dead and qualitative papers got no image at all. This picks
 * the template the paper can actually support, which is what makes the image
 * relevant to the post rather than merely present.
 *
 * Two signals, in order:
 *
 *  1. **The model's own suggestion.** Stage 1 already emits `suggestedVisuals`
 *     (it was stored but never read). A suggestion is honoured only when the
 *     extraction carries the data to build it — a suggestion is a hint, not a
 *     licence to invent content.
 *  2. **What the extraction actually contains**, as a fallback.
 *
 * Everything here is deterministic and draws only on already-verified
 * extraction fields, preserving the invariant in render.ts: no generative model
 * touches the image, so a card can never state a number the paper does not.
 */

import type { Claim, ResearchExtraction } from '@/services/content/types';
import type { VisualSpec } from './visual-types';

/** The paper fields a card needs for its headline, attribution and source line. */
export interface VisualPaperContext {
  title: string;
  venue: string | null;
  authors: readonly { name: string; isUser: boolean; position: number }[];
}

/** Collapses whitespace and truncates to `max` characters (ellipsis included). */
function clip(text: string, max: number): string {
  const normalised = text.replace(/\s+/g, ' ').trim();
  return normalised.length <= max ? normalised : `${normalised.slice(0, max - 1).trimEnd()}…`;
}

function sourceLine(paper: VisualPaperContext): string {
  return clip(paper.venue ?? paper.title, 100);
}

// ────────────────────────────  builders  ─────────────────────────────
// Each returns null when the extraction cannot support that template. None of
// them invent content: every string traces back to an extraction field.

function buildStatCard(
  extraction: ResearchExtraction,
  paper: VisualPaperContext,
): VisualSpec | null {
  const top = extraction.importantNumbers?.[0];
  if (!top) return null;
  return {
    template: 'STAT_CARD',
    headline: clip(paper.title, 120),
    stat: clip(top.value, 40),
    statLabel: clip(top.metric, 80),
    context: clip(top.context, 200),
    source: sourceLine(paper),
  };
}

function buildKeyFindings(
  extraction: ResearchExtraction,
  paper: VisualPaperContext,
): VisualSpec | null {
  const findings = (extraction.keyFindings ?? [])
    .map((finding) => clip(finding.value, 200))
    .filter((value) => value.length > 0)
    .slice(0, 5);
  // A lone finding reads better as a quote card than as a one-item list.
  if (findings.length < 2) return null;
  return {
    template: 'KEY_FINDINGS',
    headline: clip(paper.title, 120),
    findings,
    source: sourceLine(paper),
  };
}

function buildQuoteCard(
  extraction: ResearchExtraction,
  paper: VisualPaperContext,
): VisualSpec | null {
  // The template renders a large quotation mark, so only a STATED claim — one
  // with a verbatim span behind it — may go on this card. Attributing an
  // INFERRED sentence to the authors would be putting words in their mouths.
  const candidates: readonly (Claim | undefined)[] = [
    extraction.novelty,
    ...(extraction.keyFindings ?? []),
    ...(extraction.realWorldImplications ?? []),
  ];
  const stated = candidates.find(
    (claim): claim is Claim =>
      claim !== undefined && claim.provenance === 'STATED' && claim.value.trim().length > 0,
  );
  if (!stated) return null;

  const lead =
    paper.authors.find((author) => author.isUser) ??
    [...paper.authors].sort((a, b) => a.position - b.position)[0];

  return {
    template: 'QUOTE_CARD',
    quote: clip(stated.value, 300),
    attribution: clip(lead?.name ?? 'From the paper', 100),
    context: clip(paper.title, 150),
    source: sourceLine(paper),
  };
}

function buildComparison(
  extraction: ResearchExtraction,
  paper: VisualPaperContext,
): VisualSpec | null {
  const numbers = extraction.importantNumbers ?? [];
  // Never synthesise a second side: a comparison card with one real value and
  // one invented one is worse than no card.
  if (numbers.length < 2) return null;
  const [left, right] = numbers as [
    (typeof numbers)[number],
    (typeof numbers)[number],
  ];
  return {
    template: 'COMPARISON',
    headline: clip(paper.title, 120),
    leftLabel: clip(left.metric, 60),
    leftValue: clip(left.value, 40),
    rightLabel: clip(right.metric, 60),
    rightValue: clip(right.value, 40),
    context: clip(left.context, 200),
    source: sourceLine(paper),
  };
}

// ────────────────────────────  selection  ────────────────────────────

/** Suggestions that map onto the COMPARISON renderer. */
const COMPARATIVE_SUGGESTIONS = new Set(['COMPARISON', 'BEFORE_AFTER']);

/**
 * Chooses the best-supported visual for a paper, or null when the extraction
 * has nothing worth putting on a card.
 *
 * COMPARISON is reachable only through an explicit model suggestion — two
 * unrelated numbers ("37% improvement", "1,200 participants") must never be
 * staged as a before/after just because both exist.
 */
export function selectVisualSpec(
  extraction: ResearchExtraction,
  paper: VisualPaperContext,
): VisualSpec | null {
  for (const suggestion of extraction.suggestedVisuals ?? []) {
    if (suggestion === 'STAT_CARD') {
      const spec = buildStatCard(extraction, paper);
      if (spec) return spec;
    } else if (suggestion === 'KEY_FINDINGS') {
      const spec = buildKeyFindings(extraction, paper);
      if (spec) return spec;
    } else if (COMPARATIVE_SUGGESTIONS.has(suggestion)) {
      const spec = buildComparison(extraction, paper);
      if (spec) return spec;
    }
    // PROBLEM_SOLUTION / PROCESS_FLOW / CONCEPT_EXPLAINER have no renderer yet;
    // fall through to whatever the extraction can support.
  }

  return (
    buildStatCard(extraction, paper) ??
    buildKeyFindings(extraction, paper) ??
    buildQuoteCard(extraction, paper)
  );
}

/**
 * Alt text for a rendered card. This is what screen readers announce and what
 * gets sent to LinkedIn as the image description, so it states the card's
 * actual content rather than naming the template.
 */
export function visualAltText(spec: VisualSpec): string {
  switch (spec.template) {
    case 'STAT_CARD':
      return clip(`${spec.statLabel}: ${spec.stat}. ${spec.context}`, 300);
    case 'KEY_FINDINGS':
      return clip(`Key findings from ${spec.headline}: ${spec.findings.join('; ')}`, 300);
    case 'QUOTE_CARD':
      return clip(`“${spec.quote}” — ${spec.attribution}`, 300);
    case 'COMPARISON':
      return clip(
        `${spec.leftLabel}: ${spec.leftValue}, compared with ${spec.rightLabel}: ${spec.rightValue}.`,
        300,
      );
  }
}
