/**
 * Format eligibility gate — Stage 2 of the AI pipeline.
 *
 * docs/05-ai-pipeline.md §Stage 2
 *
 * The table is deterministic: it checks extraction provenance in code, so
 * no prompt regression can bypass the guard. An abstract-only paper is
 * structurally incapable of producing a TECHNICAL_DEEP_DIVE.
 */

import type { ContentFormat, FullTextStatus } from '@prisma/client';
import type { ResearchExtraction } from './types';
import { statedClaims, statedFindingCount, importantNumbers, isStated } from './types';

// ────────────────────────────  gate table  ──────────────────────────

/**
 * Returns which formats this extraction is eligible for.
 * An empty array means no format can be generated — the paper goes back to inbox.
 */
export function eligibleFormats(
  extraction: ResearchExtraction,
  fullTextStatus: FullTextStatus,
): ContentFormat[] {
  const eligible: ContentFormat[] = [];

  // ONE_INSIGHT — ≥1 STATED key finding
  if (statedFindingCount(extraction) >= 1) {
    eligible.push('ONE_INSIGHT');
  }

  // RESEARCH_BREAKDOWN — ≥3 STATED key findings
  if (statedFindingCount(extraction) >= 3) {
    eligible.push('RESEARCH_BREAKDOWN');
  }

  // VISUAL_EXPLAINER — ≥1 importantNumbers OR ≥2 STATED key findings
  if (
    importantNumbers(extraction).length >= 1 ||
    statedFindingCount(extraction) >= 2
  ) {
    eligible.push('VISUAL_EXPLAINER');
  }

  // RESEARCH_STORY — problem AND methodology both STATED
  if (isStated(extraction.problem) && isStated(extraction.methodology)) {
    eligible.push('RESEARCH_STORY');
  }

  // MYTH_VS_REALITY — novelty STATED and framed as contrast
  if (
    isStated(extraction.novelty) &&
    _isContrast(extraction.novelty?.value ?? '')
  ) {
    eligible.push('MYTH_VS_REALITY');
  }

  // TECHNICAL_DEEP_DIVE — full text required AND methodology STATED
  if (
    fullTextStatus !== 'ABSTRACT_ONLY' &&
    fullTextStatus !== 'UNKNOWN' &&
    fullTextStatus !== 'FETCH_FAILED' &&
    isStated(extraction.methodology)
  ) {
    eligible.push('TECHNICAL_DEEP_DIVE');
  }

  return eligible;
}

/**
 * Picks the best single format for a first draft, given eligible options,
 * the user's target audience, and the last N formats used (to avoid repetition).
 */
export function selectFormat(
  eligible: ContentFormat[],
  opts: {
    audienceFit?: string | null;
    recentFormats?: ContentFormat[];
    preferVisuals?: boolean;
  } = {},
): ContentFormat | null {
  if (eligible.length === 0) return null;

  // Score each format
  const scores = eligible.map((format) => ({
    format,
    score: _scoreFormat(format, opts),
  }));

  scores.sort((a, b) => b.score - a.score);
  return scores[0]!.format;
}

function _scoreFormat(
  format: ContentFormat,
  opts: { audienceFit?: string | null; recentFormats?: ContentFormat[]; preferVisuals?: boolean },
): number {
  let score = 0;

  // Recency penalty — avoid the same format in the last 8 posts
  const recent = opts.recentFormats ?? [];
  const lastUsed = recent.lastIndexOf(format);
  if (lastUsed >= 0) {
    score -= Math.max(0, 8 - lastUsed) * 10;
  }

  // Audience fit
  const audience = opts.audienceFit;
  if (audience === 'RESEARCHERS') {
    if (format === 'TECHNICAL_DEEP_DIVE') score += 20;
    if (format === 'RESEARCH_BREAKDOWN') score += 15;
  } else if (audience === 'INDUSTRY') {
    if (format === 'VISUAL_EXPLAINER') score += 20;
    if (format === 'ONE_INSIGHT') score += 15;
  } else if (audience === 'GENERAL_PUBLIC') {
    if (format === 'MYTH_VS_REALITY') score += 20;
    if (format === 'RESEARCH_STORY') score += 15;
    if (format === 'ONE_INSIGHT') score += 10;
  } else if (audience === 'CLINICIANS') {
    if (format === 'RESEARCH_BREAKDOWN') score += 20;
    if (format === 'MYTH_VS_REALITY') score += 15;
  }

  // Visual preference
  if (opts.preferVisuals && format === 'VISUAL_EXPLAINER') score += 10;

  // Base score: prefer richer formats (more content surface = less likely to be bland)
  const richness: Record<ContentFormat, number> = {
    TECHNICAL_DEEP_DIVE: 5,
    RESEARCH_BREAKDOWN: 4,
    RESEARCH_STORY: 3,
    VISUAL_EXPLAINER: 3,
    MYTH_VS_REALITY: 2,
    ONE_INSIGHT: 1,
  };
  score += richness[format] ?? 0;

  return score;
}

// Heuristic: does the novelty claim read as a contrast?
const CONTRAST_MARKERS = /\b(contrary|contradict|challenge|overturn|myth|debunk|counter|wrong|incorrect|instead|unlike|not|no)\b/i;
function _isContrast(text: string): boolean {
  return CONTRAST_MARKERS.test(text);
}

/** Human-readable description of why a format was rejected. */
export function formatRejectReason(
  format: ContentFormat,
  extraction: ResearchExtraction,
  fullTextStatus: FullTextStatus,
): string {
  switch (format) {
    case 'ONE_INSIGHT':
      return 'No STATED key findings';
    case 'RESEARCH_BREAKDOWN':
      return `Only ${statedFindingCount(extraction)} STATED key finding(s); need ≥3`;
    case 'VISUAL_EXPLAINER':
      return 'No importantNumbers and fewer than 2 STATED key findings';
    case 'RESEARCH_STORY':
      return `problem is ${extraction.problem?.provenance ?? 'ABSENT'}, methodology is ${extraction.methodology?.provenance ?? 'ABSENT'}`;
    case 'MYTH_VS_REALITY':
      return 'novelty is not STATED or not framed as contrast';
    case 'TECHNICAL_DEEP_DIVE':
      return fullTextStatus === 'ABSTRACT_ONLY' || fullTextStatus === 'UNKNOWN'
        ? 'Abstract-only paper — full text required'
        : `methodology is ${extraction.methodology?.provenance ?? 'ABSENT'}`;
  }
}
