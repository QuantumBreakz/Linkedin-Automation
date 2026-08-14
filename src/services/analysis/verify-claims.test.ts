import { describe, it, expect } from 'vitest';
import { verifyDraft } from './verify-claims';
import type { LlmProvider } from '../llm/types';
import type { ResearchExtraction } from '../content/types';

describe('verify-claims', () => {
  const mockExtraction: ResearchExtraction = {
    problem: { value: 'Early diagnosis is challenging', provenance: 'STATED', evidence: 'Early diagnosis is challenging' },
    keyFindings: [
      {
        value: 'Higher levels of protein X were associated with increased risk',
        provenance: 'STATED',
        evidence: 'protein X was associated with increased risk',
      },
    ],
    importantNumbers: [
      { metric: 'Risk Increase', value: '42%', context: 'hazard ratio 1.42', evidence: '42% increased risk' },
    ],
  };

  const mockSource = 'A study found that protein X was associated with a 42% increased risk of disease.';

  it('fails verification deterministically if draft invents numbers not in source or extraction', async () => {
    const mockLlm: LlmProvider = {
      name: 'mock',
      complete: async <T>() => ({
        provider: 'mock',
        role: 'verify' as const,
        modelId: 'mock-model',
        text: '{}',
        parsed: {
          claims: [{ text: 'It reduced 99% of symptoms', status: 'SUPPORTED' as const, supportingField: null, note: null }],
          overstatement: false,
          medicalAdviceRisk: false,
          numbersMatch: true,
          verdict: 'PASS' as const,
        } as unknown as T,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, costUsd: 0 },
        latencyMs: 10,
        attempts: [],
      }),
    };

    const report = await verifyDraft(
      {
        draftBody: 'Our new therapy cured 99% of all patients.',
        extraction: mockExtraction,
        sourceText: mockSource,
      },
      mockLlm,
    );

    // Deterministic check detected '99%' is not in number pool or source → numbersMatch: false → verdict: FAIL
    expect(report.numbersMatch).toBe(false);
    expect(report.verdict).toBe('FAIL');
  });

  it('flags overstatement if causal verb (causes/cures) is used for correlational findings', async () => {
    const mockLlm: LlmProvider = {
      name: 'mock',
      complete: async <T>() => ({
        provider: 'mock',
        role: 'verify' as const,
        modelId: 'mock-model',
        text: '{}',
        parsed: {
          claims: [{ text: 'Protein X causes the disease', status: 'SUPPORTED' as const, supportingField: null, note: null }],
          overstatement: false,
          medicalAdviceRisk: false,
          numbersMatch: true,
          verdict: 'PASS' as const,
        } as unknown as T,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, costUsd: 0 },
        latencyMs: 10,
        attempts: [],
      }),
    };

    const report = await verifyDraft(
      {
        draftBody: 'This study shows that protein X causes the disease with a 42% rate.',
        extraction: mockExtraction,
        sourceText: mockSource,
      },
      mockLlm,
    );

    expect(report.overstatement).toBe(true);
    expect(report.verdict).toBe('FAIL');
  });

  it('passes when numerals match and claims are backed', async () => {
    const mockLlm: LlmProvider = {
      name: 'mock',
      complete: async <T>() => ({
        provider: 'mock',
        role: 'verify' as const,
        modelId: 'mock-model',
        text: '{}',
        parsed: {
          claims: [{ text: 'Protein X is associated with a 42% risk increase', status: 'SUPPORTED' as const, supportingField: 'keyFindings', note: null }],
          overstatement: false,
          medicalAdviceRisk: false,
          numbersMatch: true,
          verdict: 'PASS' as const,
        } as unknown as T,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20, costUsd: 0 },
        latencyMs: 10,
        attempts: [],
      }),
    };

    const report = await verifyDraft(
      {
        draftBody: 'Researchers observed that protein X was associated with a 42% increased risk.',
        extraction: mockExtraction,
        sourceText: mockSource,
      },
      mockLlm,
    );

    expect(report.numbersMatch).toBe(true);
    expect(report.overstatement).toBe(false);
    expect(report.verdict).toBe('PASS');
  });
});
