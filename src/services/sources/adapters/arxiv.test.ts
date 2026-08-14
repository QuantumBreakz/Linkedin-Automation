import { describe, it, expect } from 'vitest';
import { arxivAdapter } from './arxiv';

describe('arxiv adapter', () => {
  it('has kind ARXIV_AUTHOR', () => {
    expect(arxivAdapter.kind).toBe('ARXIV_AUTHOR');
  });

  it('rejects empty query in validate', async () => {
    await expect(arxivAdapter.validate('')).rejects.toThrow();
  });
});
