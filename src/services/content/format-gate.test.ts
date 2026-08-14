import { describe, it, expect } from 'vitest';
import { eligibleFormats, selectFormat, formatRejectReason } from './format-gate';
import type { ResearchExtraction } from './types';

const baseExtraction: ResearchExtraction = {
  problem: { value: 'Cancer detection is slow', provenance: 'STATED', evidence: 'quoted text' },
  researchQuestion: { value: 'Can AI speed up diagnosis?', provenance: 'STATED', evidence: 'quoted text' },
  methodology: { value: 'Trained a ResNet50 model', provenance: 'STATED', evidence: 'quoted text' },
  novelty: { value: 'Contrary to previous beliefs, CNNs outperform ViTs here', provenance: 'STATED', evidence: 'quoted text' },
  keyFindings: [
    { value: 'Achieved 98% accuracy', provenance: 'STATED', evidence: '98% accuracy' },
    { value: 'Reduced latency by 40%', provenance: 'STATED', evidence: 'latency by 40%' },
    { value: 'Generalized across 4 hospitals', provenance: 'STATED', evidence: '4 hospitals' },
  ],
  importantNumbers: [
    { metric: 'Accuracy', value: '98%', context: 'on validation set', evidence: '98% accuracy' },
  ],
};

describe('format-gate', () => {
  describe('eligibleFormats', () => {
    it('allows all formats when full text and all stated findings are present', () => {
      const formats = eligibleFormats(baseExtraction, 'OA_PDF');
      expect(formats).toContain('ONE_INSIGHT');
      expect(formats).toContain('RESEARCH_BREAKDOWN');
      expect(formats).toContain('VISUAL_EXPLAINER');
      expect(formats).toContain('RESEARCH_STORY');
      expect(formats).toContain('MYTH_VS_REALITY');
      expect(formats).toContain('TECHNICAL_DEEP_DIVE');
    });

    it('blocks TECHNICAL_DEEP_DIVE on ABSTRACT_ONLY papers', () => {
      const formats = eligibleFormats(baseExtraction, 'ABSTRACT_ONLY');
      expect(formats).not.toContain('TECHNICAL_DEEP_DIVE');
      expect(formats).toContain('ONE_INSIGHT');
      expect(formats).toContain('RESEARCH_BREAKDOWN');
    });

    it('blocks RESEARCH_BREAKDOWN when fewer than 3 findings are STATED', () => {
      const extraction: ResearchExtraction = {
        ...baseExtraction,
        keyFindings: [
          { value: 'Finding 1', provenance: 'STATED', evidence: 'quote' },
          { value: 'Finding 2', provenance: 'INFERRED', evidence: null },
        ],
      };
      const formats = eligibleFormats(extraction, 'OA_PDF');
      expect(formats).not.toContain('RESEARCH_BREAKDOWN');
      expect(formats).toContain('ONE_INSIGHT');
    });

    it('returns empty array when no findings are stated or present', () => {
      const extraction: ResearchExtraction = {
        keyFindings: [],
        importantNumbers: [],
      };
      const formats = eligibleFormats(extraction, 'ABSTRACT_ONLY');
      expect(formats).toHaveLength(0);
    });
  });

  describe('selectFormat', () => {
    it('returns null if eligible list is empty', () => {
      expect(selectFormat([])).toBeNull();
    });

    it('prefers TECHNICAL_DEEP_DIVE for RESEARCHERS audience if eligible', () => {
      const eligible = eligibleFormats(baseExtraction, 'OA_PDF');
      const selected = selectFormat(eligible, { audienceFit: 'RESEARCHERS' });
      expect(selected).toBe('TECHNICAL_DEEP_DIVE');
    });

    it('prefers VISUAL_EXPLAINER for INDUSTRY audience if eligible', () => {
      const eligible = eligibleFormats(baseExtraction, 'OA_PDF');
      const selected = selectFormat(eligible, { audienceFit: 'INDUSTRY' });
      expect(selected).toBe('VISUAL_EXPLAINER');
    });
  });

  describe('formatRejectReason', () => {
    it('gives accurate reason for TECHNICAL_DEEP_DIVE on abstract', () => {
      const reason = formatRejectReason('TECHNICAL_DEEP_DIVE', baseExtraction, 'ABSTRACT_ONLY');
      expect(reason).toContain('Abstract-only');
    });
  });
});
