import { describe, it, expect } from 'vitest';
import { pubmedAdapter } from './pubmed';

describe('pubmed adapter', () => {
  it('has kind PUBMED_QUERY', () => {
    expect(pubmedAdapter.kind).toBe('PUBMED_QUERY');
  });

  it('rejects empty query in validate', async () => {
    await expect(pubmedAdapter.validate('')).rejects.toThrow();
  });
});
