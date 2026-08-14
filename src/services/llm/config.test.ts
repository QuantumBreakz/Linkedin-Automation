import { describe, it, expect } from 'vitest';
import { getChain, getFallbackModel, MODEL_CHAINS } from './config';
import { MODEL_ROLES } from './types';

describe('llm/config', () => {
  it('defines a fallback chain for every defined ModelRole', () => {
    for (const role of MODEL_ROLES) {
      const chain = getChain(role);
      expect(chain).toBeDefined();
      expect(chain.length).toBeGreaterThanOrEqual(2);
      for (const entry of chain) {
        expect(entry.modelId).toBeTruthy();
        expect(typeof entry.modelId).toBe('string');
      }
    }
  });

  it('provides getFallbackModel for fallback transitions', () => {
    const chain = getChain('standard');
    const primary = chain[0]!.modelId;
    const fallback = getFallbackModel('standard', primary);
    expect(fallback).toBe(chain[1]!.modelId);
  });

  it('returns null fallback when the last model in chain fails', () => {
    const chain = getChain('verify');
    const last = chain[chain.length - 1]!.modelId;
    expect(getFallbackModel('verify', last)).toBeNull();
  });
});
