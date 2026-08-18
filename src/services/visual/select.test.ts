import { describe, it, expect } from 'vitest';
import { selectVisualSpec, visualAltText, type VisualPaperContext } from './select';
import { VisualSpecSchema } from './visual-types';
import type { Claim, ResearchExtraction } from '@/services/content/types';

const paper: VisualPaperContext = {
  title: 'Sparse attention improves long-context recall in clinical notes',
  venue: 'NeurIPS 2025',
  authors: [
    { name: 'A. Collaborator', isUser: false, position: 1 },
    { name: 'Dr. Elena Rostova', isUser: true, position: 2 },
  ],
};

function stated(value: string): Claim {
  return { value, provenance: 'STATED', evidence: value };
}
function inferred(value: string): Claim {
  return { value, provenance: 'INFERRED', evidence: null };
}

const number = (metric: string, value: string) => ({
  metric,
  value,
  context: `${metric} was ${value} in the reported evaluation`,
  evidence: `${metric} ${value}`,
});

describe('visual/select', () => {
  it('builds a STAT_CARD when the paper has an extracted number', () => {
    const spec = selectVisualSpec({ importantNumbers: [number('Recall improvement', '37%')] }, paper);
    expect(spec?.template).toBe('STAT_CARD');
    expect(spec).toMatchObject({ stat: '37%', statLabel: 'Recall improvement' });
  });

  it('falls back to KEY_FINDINGS for a qualitative paper with no numbers', () => {
    // The old pipeline produced no image at all for this shape.
    const spec = selectVisualSpec(
      { keyFindings: [stated('Clinicians preferred the sparse model'), stated('Latency was unchanged')] },
      paper,
    );
    expect(spec?.template).toBe('KEY_FINDINGS');
  });

  it('falls back to QUOTE_CARD when there is a single stated claim', () => {
    const spec = selectVisualSpec({ novelty: stated('First method to keep full recall past 100k tokens') }, paper);
    expect(spec?.template).toBe('QUOTE_CARD');
    // Attributed to the signed-in author, not the first-listed one.
    expect(spec).toMatchObject({ attribution: 'Dr. Elena Rostova' });
  });

  it('never quotes an INFERRED claim', () => {
    // The template renders a quotation mark; attributing an inference to the
    // authors would be putting words in their mouths.
    expect(selectVisualSpec({ novelty: inferred('Probably generalises to other domains') }, paper)).toBeNull();
  });

  it('returns null when the extraction has nothing to show', () => {
    expect(selectVisualSpec({}, paper)).toBeNull();
  });

  it('honours a KEY_FINDINGS suggestion over the number-first default', () => {
    const extraction: ResearchExtraction = {
      suggestedVisuals: ['KEY_FINDINGS'],
      importantNumbers: [number('Recall improvement', '37%')],
      keyFindings: [stated('Recall held past 100k tokens'), stated('Latency was unchanged')],
    };
    expect(selectVisualSpec(extraction, paper)?.template).toBe('KEY_FINDINGS');
  });

  it('ignores a suggestion the extraction cannot support', () => {
    // Suggested COMPARISON, but only one number exists — inventing the other
    // side is exactly what must not happen.
    const spec = selectVisualSpec(
      { suggestedVisuals: ['COMPARISON'], importantNumbers: [number('Recall improvement', '37%')] },
      paper,
    );
    expect(spec?.template).toBe('STAT_CARD');
  });

  it('only builds COMPARISON when explicitly suggested, never from two loose numbers', () => {
    const numbers = [number('Recall improvement', '37%'), number('Participants', '1200')];
    // Unrelated numbers must not be staged as a before/after…
    expect(selectVisualSpec({ importantNumbers: numbers }, paper)?.template).toBe('STAT_CARD');
    // …but a BEFORE_AFTER suggestion maps onto the COMPARISON renderer.
    expect(
      selectVisualSpec({ suggestedVisuals: ['BEFORE_AFTER'], importantNumbers: numbers }, paper)?.template,
    ).toBe('COMPARISON');
  });

  it('falls through suggestions that have no renderer', () => {
    const spec = selectVisualSpec(
      { suggestedVisuals: ['PROCESS_FLOW', 'CONCEPT_EXPLAINER'], importantNumbers: [number('Speedup', '1.4×')] },
      paper,
    );
    expect(spec?.template).toBe('STAT_CARD');
  });

  it('produces specs that satisfy the renderer schema, including field limits', () => {
    const long = 'x'.repeat(500);
    const wide: VisualPaperContext = { ...paper, title: long, venue: long };
    const extractions: ResearchExtraction[] = [
      { importantNumbers: [{ metric: long, value: long, context: long, evidence: long }] },
      { keyFindings: [stated(long), stated(long)] },
      { novelty: stated(long) },
      {
        suggestedVisuals: ['COMPARISON'],
        importantNumbers: [number('A', '1%'), { metric: long, value: long, context: long, evidence: long }],
      },
    ];

    for (const extraction of extractions) {
      const spec = selectVisualSpec(extraction, wide);
      expect(spec).not.toBeNull();
      // Would throw on any field exceeding its max — the renderer's contract.
      expect(() => VisualSpecSchema.parse(spec)).not.toThrow();
      expect(visualAltText(spec!).length).toBeLessThanOrEqual(300);
    }
  });

  it('describes card content in alt text rather than naming the template', () => {
    const spec = selectVisualSpec({ importantNumbers: [number('Recall improvement', '37%')] }, paper);
    const alt = visualAltText(spec!);
    expect(alt).toContain('37%');
    expect(alt).not.toMatch(/STAT_CARD/);
  });
});
