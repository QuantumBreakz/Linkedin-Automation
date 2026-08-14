import { describe, it, expect } from 'vitest';
import { crossrefQueryAdapter, manualDoiAdapter } from './crossref';

describe('crossref adapters', () => {
  it('has kind CROSSREF_QUERY and MANUAL_DOI', () => {
    expect(crossrefQueryAdapter.kind).toBe('CROSSREF_QUERY');
    expect(manualDoiAdapter.kind).toBe('MANUAL_DOI');
  });

  it('rejects empty query in validate', async () => {
    await expect(crossrefQueryAdapter.validate('')).rejects.toThrow();
  });

  it('rejects invalid DOI format in manual DOI validate', async () => {
    await expect(manualDoiAdapter.validate('not-a-doi')).rejects.toThrow();
  });
});
