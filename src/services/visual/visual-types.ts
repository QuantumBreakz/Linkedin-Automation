/**
 * VisualSpec — the schema that the LLM emits (Stage 5).
 *
 * docs/06-visual-engine.md §VisualSpec schema
 *
 * The model chooses the template and populates content fields.
 * Numbers come from importantNumbers, which have survived evidence checking.
 * The renderer consumes this spec deterministically — no AI in the render path.
 */

import { z } from 'zod';

// ─────────────────────────────  colours  ─────────────────────────────

const ColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const ThemeSchema = z.object({
  background: ColourSchema.default('#0A0F1E'),
  primary: ColourSchema.default('#6366F1'),
  text: ColourSchema.default('#F1F5F9'),
  accent: ColourSchema.default('#22D3EE'),
});

export type Theme = z.infer<typeof ThemeSchema>;

// ─────────────────────────────  templates  ───────────────────────────

const StatCardSpecSchema = z.object({
  template: z.literal('STAT_CARD'),
  headline: z.string().max(120),
  stat: z.string().max(40),     // e.g. "37%", "p<0.001", "1.4×"
  statLabel: z.string().max(80),
  context: z.string().max(200),
  source: z.string().max(100),
  theme: ThemeSchema.optional(),
});

const KeyFindingsSpecSchema = z.object({
  template: z.literal('KEY_FINDINGS'),
  headline: z.string().max(120),
  findings: z.array(z.string().max(200)).min(1).max(5),
  source: z.string().max(100),
  theme: ThemeSchema.optional(),
});

const QuoteCardSpecSchema = z.object({
  template: z.literal('QUOTE_CARD'),
  quote: z.string().max(300),
  attribution: z.string().max(100),  // author name + paper
  context: z.string().max(150),
  source: z.string().max(100),
  theme: ThemeSchema.optional(),
});

const ComparisonSpecSchema = z.object({
  template: z.literal('COMPARISON'),
  headline: z.string().max(120),
  leftLabel: z.string().max(60),
  leftValue: z.string().max(40),
  rightLabel: z.string().max(60),
  rightValue: z.string().max(40),
  context: z.string().max(200),
  source: z.string().max(100),
  theme: ThemeSchema.optional(),
});

/**
 * PROBLEM_SOLUTION — the gap the paper identifies, and what it does about it.
 * Backs the `PROBLEM_SOLUTION` suggestion, which previously had no renderer.
 */
const ProblemSolutionSpecSchema = z.object({
  template: z.literal('PROBLEM_SOLUTION'),
  headline: z.string().max(120),
  problem: z.string().max(240),
  solution: z.string().max(240),
  source: z.string().max(100),
  theme: ThemeSchema.optional(),
});

/**
 * CONCEPT_EXPLAINER — jargon in plain language, built from the extraction's
 * `technicalTerms`. Backs the `CONCEPT_EXPLAINER` suggestion.
 */
const ConceptExplainerSpecSchema = z.object({
  template: z.literal('CONCEPT_EXPLAINER'),
  headline: z.string().max(120),
  terms: z
    .array(z.object({ term: z.string().max(60), plain: z.string().max(180) }))
    .min(1)
    .max(4),
  source: z.string().max(100),
  theme: ThemeSchema.optional(),
});

export const VisualSpecSchema = z.discriminatedUnion('template', [
  StatCardSpecSchema,
  KeyFindingsSpecSchema,
  QuoteCardSpecSchema,
  ComparisonSpecSchema,
  ProblemSolutionSpecSchema,
  ConceptExplainerSpecSchema,
]);

export type VisualSpec = z.infer<typeof VisualSpecSchema>;
export type VisualTemplate = VisualSpec['template'];

export const VISUAL_TEMPLATES: readonly VisualTemplate[] = [
  'STAT_CARD',
  'KEY_FINDINGS',
  'QUOTE_CARD',
  'COMPARISON',
  'PROBLEM_SOLUTION',
  'CONCEPT_EXPLAINER',
] as const;
