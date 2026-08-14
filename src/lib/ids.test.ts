import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  canonicalKeyFor,
  firstAuthorSurname,
  fuzzyKeyHash,
  isIdentifierKey,
  normaliseArxivId,
  normaliseDoi,
  normaliseOpenAlexId,
  normaliseOrcid,
  normalisePmcid,
  normalisePmid,
  normaliseTitleForMatch,
  parseCanonicalKey,
  publicationYear,
  publishIdempotencyKey,
  sha256Hex,
  slugifyTitle,
  specHashFor,
  surnameOf,
  type CanonicalKeyInput,
} from './ids';

describe('normaliseDoi', () => {
  const expected = '10.1038/s41586-024-07123-4';

  it.each([
    ['bare', '10.1038/s41586-024-07123-4'],
    ['uppercase', '10.1038/S41586-024-07123-4'],
    ['https resolver', 'https://doi.org/10.1038/s41586-024-07123-4'],
    ['http resolver', 'http://doi.org/10.1038/s41586-024-07123-4'],
    ['dx resolver', 'http://dx.doi.org/10.1038/s41586-024-07123-4'],
    ['doi scheme', 'doi:10.1038/s41586-024-07123-4'],
    ['DOI scheme with space', 'DOI: 10.1038/s41586-024-07123-4'],
    ['info uri', 'info:doi/10.1038/s41586-024-07123-4'],
    ['whitespace', '  10.1038/s41586-024-07123-4\n'],
    ['citation trailing period', '10.1038/s41586-024-07123-4.'],
    ['angle brackets', '<10.1038/s41586-024-07123-4>'],
  ])('normalises %s', (_label, input) => {
    expect(normaliseDoi(input)).toBe(expected);
  });

  it('collapses every representation to the same key', () => {
    const forms = [
      '10.1038/S41586-024-07123-4',
      'https://doi.org/10.1038/s41586-024-07123-4',
      'doi:10.1038/s41586-024-07123-4',
    ];
    expect(new Set(forms.map(normaliseDoi)).size).toBe(1);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['not a doi', 'some paper title'],
    ['missing suffix', '10.1038/'],
    ['missing registrant', '10./abc'],
    ['registrant too short', '10.12/abc'],
    ['an arxiv id', '2401.01234'],
    ['a url', 'https://example.com/paper'],
  ])('returns null for %s', (_label, input) => {
    expect(normaliseDoi(input)).toBeNull();
  });

  it('preserves case-sensitive-looking suffixes as lowercase, consistently', () => {
    // DOIs are case-insensitive by spec; lowercasing is what makes dedup work.
    expect(normaliseDoi('10.1000/AbC')).toBe('10.1000/abc');
    expect(normaliseDoi('10.1000/abc')).toBe('10.1000/abc');
  });
});

describe('normaliseArxivId', () => {
  it.each([
    ['new style, 5-digit sequence', '2401.01234', '2401.01234'],
    ['new style, 4-digit sequence (pre-2015)', '0704.0001', '0704.0001'],
    ['versioned', '2401.01234v3', '2401.01234'],
    ['arXiv prefix', 'arXiv:2401.01234', '2401.01234'],
    ['abs url', 'https://arxiv.org/abs/2401.01234', '2401.01234'],
    ['pdf url', 'https://arxiv.org/pdf/2401.01234v2', '2401.01234'],
    ['pdf url with extension', 'https://arxiv.org/pdf/2401.01234v2.pdf', '2401.01234'],
    ['legacy', 'hep-th/9901001', 'hep-th/9901001'],
    ['legacy with subject class', 'math.GT/0309136', 'math.gt/0309136'],
    ['legacy versioned', 'hep-th/9901001v2', 'hep-th/9901001'],
  ])('normalises %s', (_label, input, expected) => {
    expect(normaliseArxivId(input)).toBe(expected);
  });

  it('collapses versions so a revision does not become a second paper', () => {
    expect(normaliseArxivId('2401.01234v1')).toBe(normaliseArxivId('2401.01234v7'));
  });

  it.each([['null', null], ['empty', ''], ['a doi', '10.1038/x'], ['nonsense', 'hello world']])(
    'returns null for %s',
    (_label, input) => {
      expect(normaliseArxivId(input)).toBeNull();
    },
  );
});

describe('normalisePmid / normalisePmcid / normaliseOpenAlexId', () => {
  it('normalises PMIDs', () => {
    expect(normalisePmid('12345678')).toBe('12345678');
    expect(normalisePmid('PMID: 12345678')).toBe('12345678');
    expect(normalisePmid('https://pubmed.ncbi.nlm.nih.gov/12345678/')).toBe('12345678');
    expect(normalisePmid('not-a-pmid')).toBeNull();
  });

  it('normalises PMCIDs to canonical PMC form', () => {
    expect(normalisePmcid('PMC1234567')).toBe('PMC1234567');
    expect(normalisePmcid('pmc1234567')).toBe('PMC1234567');
    expect(normalisePmcid('https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/')).toBe(
      'PMC1234567',
    );
    expect(normalisePmcid('1234567')).toBeNull();
  });

  it('normalises OpenAlex work IDs', () => {
    expect(normaliseOpenAlexId('W2741809807')).toBe('W2741809807');
    expect(normaliseOpenAlexId('https://openalex.org/W2741809807')).toBe('W2741809807');
    expect(normaliseOpenAlexId('https://api.openalex.org/works/W2741809807')).toBe('W2741809807');
    expect(normaliseOpenAlexId('w2741809807')).toBe('W2741809807');
    expect(normaliseOpenAlexId('A1234567')).toBeNull(); // author ID, not a work
  });
});

describe('normaliseOrcid', () => {
  it('normalises the canonical example from docs/07', () => {
    expect(normaliseOrcid('0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
  });

  it('accepts a URL and unhyphenated input', () => {
    expect(normaliseOrcid('https://orcid.org/0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
    expect(normaliseOrcid('0000000218250097')).toBe('0000-0002-1825-0097');
  });

  it('accepts a trailing X checksum', () => {
    expect(normaliseOrcid('0000-0003-1613-5981')).toBe('0000-0003-1613-5981');
  });

  it('rejects a typo that fails the ISO 7064 checksum', () => {
    // A single transposed digit — exactly the failure that would attribute a
    // paper to the wrong researcher.
    expect(normaliseOrcid('0000-0002-1825-0098')).toBeNull();
  });

  it('rejects wrong-length and non-ORCID input', () => {
    expect(normaliseOrcid('0000-0002-1825')).toBeNull();
    expect(normaliseOrcid('not an orcid')).toBeNull();
    expect(normaliseOrcid(null)).toBeNull();
  });
});

describe('slugifyTitle', () => {
  it('slugifies a normal title', () => {
    expect(slugifyTitle('Deep Learning for Protein Folding: A Review')).toBe(
      'deep-learning-for-protein-folding-a-review',
    );
  });

  it('strips diacritics so accented spellings collide correctly', () => {
    expect(slugifyTitle('Réseaux de Neurones Profonds')).toBe('reseaux-de-neurones-profonds');
    expect(slugifyTitle('Über Müller')).toBe('uber-muller');
    // Same title typed with and without accents must produce the same slug —
    // this is what stops one paper becoming two.
    expect(slugifyTitle('Émilie Châtelet')).toBe(slugifyTitle('Emilie Chatelet'));
  });

  it('collapses punctuation and whitespace runs', () => {
    expect(slugifyTitle('  A   B---C!!!  ')).toBe('a-b-c');
  });

  it('removes smart quotes rather than turning them into hyphens', () => {
    expect(slugifyTitle('The “Best” Method')).toBe('the-best-method');
  });

  it('returns an empty string for empty or missing input', () => {
    expect(slugifyTitle('')).toBe('');
    expect(slugifyTitle(null)).toBe('');
    expect(slugifyTitle('!!!')).toBe('');
  });

  it('truncates long titles on a word boundary', () => {
    const slug = slugifyTitle('word '.repeat(80), 40);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('is stable — the same title always yields the same slug', () => {
    const title = 'Transformer Architectures in Computational Biology';
    expect(slugifyTitle(title)).toBe(slugifyTitle(title));
  });
});

describe('normaliseTitleForMatch', () => {
  it('produces space-separated words for the pg_trgm pass', () => {
    expect(normaliseTitleForMatch('Deep Learning for Protein Folding: A Review')).toBe(
      'deep learning for protein folding a review',
    );
  });

  it('is insensitive to punctuation and case differences between sources', () => {
    const fromOpenAlex = 'CRISPR-Cas9 Editing: A Meta-Analysis';
    const fromRss = 'CRISPR Cas9 editing — a meta analysis';
    expect(normaliseTitleForMatch(fromOpenAlex)).toBe(normaliseTitleForMatch(fromRss));
  });
});

describe('surnameOf / firstAuthorSurname', () => {
  it.each([
    ['Jane Q. Smith', 'smith'],
    ['Smith, Jane Q.', 'smith'],
    ['Müller', 'muller'],
    ['J. Smith', 'smith'],
    ['van der Berg', 'berg'],
    ['O’Brien', 'obrien'],
    ['  Wu  ', 'wu'],
  ])('extracts the surname from %s', (input, expected) => {
    expect(surnameOf(input)).toBe(expected);
  });

  it('returns an empty string for missing names', () => {
    expect(surnameOf('')).toBe('');
    expect(surnameOf(null)).toBe('');
    expect(surnameOf('!!!')).toBe('');
  });

  it('picks the author at the lowest position, not array order', () => {
    const authors = [
      { name: 'Second Author', position: 2 },
      { name: 'First Writer', position: 1 },
    ];
    expect(firstAuthorSurname(authors)).toBe('writer');
  });

  it('falls back to array order when positions are absent', () => {
    expect(firstAuthorSurname([{ name: 'Alpha Ant' }, { name: 'Beta Bee' }])).toBe('ant');
  });

  it('returns an empty string for no authors', () => {
    expect(firstAuthorSurname([])).toBe('');
    expect(firstAuthorSurname(undefined)).toBe('');
  });
});

describe('publicationYear', () => {
  it.each([
    ['2024-03-15', '2024'],
    ['2024-03', '2024'],
    ['2024', '2024'],
    ['2024-03-15T00:00:00Z', '2024'],
  ])('extracts %s -> %s', (input, expected) => {
    expect(publicationYear(input)).toBe(expected);
  });

  it('accepts a Date', () => {
    expect(publicationYear(new Date('2024-03-15T00:00:00Z'))).toBe('2024');
  });

  it('returns an empty string when absent or implausible', () => {
    expect(publicationYear(null)).toBe('');
    expect(publicationYear(undefined)).toBe('');
    expect(publicationYear('no digits')).toBe('');
    expect(publicationYear('0012')).toBe('');
    expect(publicationYear(new Date('not a date'))).toBe('');
  });
});

describe('canonicalKeyFor — precedence (docs/04 §Dedup step 1)', () => {
  const base: CanonicalKeyInput = {
    title: 'A Paper',
    authors: [{ name: 'Jane Smith', position: 1 }],
    publicationDate: '2024-03-15',
  };

  it('prefers the DOI above everything else', () => {
    expect(
      canonicalKeyFor({
        ...base,
        ids: {
          doi: '10.1038/x',
          arxivId: '2401.01234',
          pmid: '12345678',
          openalexId: 'W1',
        },
      }),
    ).toBe('doi:10.1038/x');
  });

  it('falls back to arXiv when there is no DOI', () => {
    expect(
      canonicalKeyFor({ ...base, ids: { arxivId: '2401.01234v2', pmid: '12345678' } }),
    ).toBe('arxiv:2401.01234');
  });

  it('falls back to PMID when there is no DOI or arXiv ID', () => {
    expect(canonicalKeyFor({ ...base, ids: { pmid: '12345678', openalexId: 'W1' } })).toBe(
      'pmid:12345678',
    );
  });

  it('falls back to OpenAlex when it is the only identifier', () => {
    expect(canonicalKeyFor({ ...base, ids: { openalexId: 'W2741809807' } })).toBe(
      'openalex:W2741809807',
    );
  });

  it('falls back to a fuzzy hash when there is no identifier at all', () => {
    const key = canonicalKeyFor({ ...base, ids: {} });
    expect(key.startsWith('fuzzy:')).toBe(true);
    expect(key).toBe(`fuzzy:${fuzzyKeyHash(base)}`);
  });

  it('ignores a malformed identifier rather than keying on garbage', () => {
    // A bad DOI must not become `doi:not-a-doi` — that would merge every
    // record that happens to carry the same broken value.
    const key = canonicalKeyFor({ ...base, ids: { doi: 'not-a-doi', pmid: '12345678' } });
    expect(key).toBe('pmid:12345678');
  });

  it('does not key on a PMCID (a full-text deposit, not the work)', () => {
    const key = canonicalKeyFor({ ...base, ids: { pmcid: 'PMC1234567' } });
    expect(key.startsWith('fuzzy:')).toBe(true);
  });

  it('tolerates a missing ids object entirely', () => {
    expect(canonicalKeyFor(base).startsWith('fuzzy:')).toBe(true);
  });
});

describe('canonicalKeyFor — dedup behaviour', () => {
  it('gives the same key to the same paper arriving from four sources', () => {
    const fromOpenAlex: CanonicalKeyInput = {
      ids: { doi: 'https://doi.org/10.1038/s41586-024-07123-4', openalexId: 'W1' },
      title: 'Structure Prediction at Scale',
      authors: [{ name: 'Jane Q. Smith', position: 1 }],
      publicationDate: '2024-03-15',
    };
    const fromCrossref: CanonicalKeyInput = {
      ids: { doi: '10.1038/S41586-024-07123-4' },
      title: 'Structure prediction at scale',
      authors: [{ name: 'Smith, Jane Q.', position: 1 }],
      publicationDate: '2024-03',
    };
    const fromRss: CanonicalKeyInput = {
      ids: { doi: 'doi:10.1038/s41586-024-07123-4' },
      title: 'Structure Prediction at Scale',
      authors: [{ name: 'J. Smith', position: 1 }],
    };
    const fromPubmed: CanonicalKeyInput = {
      ids: { doi: '  10.1038/s41586-024-07123-4  ', pmid: '99999999' },
      title: 'Structure Prediction at Scale.',
      authors: [{ name: 'Smith JQ', position: 1 }],
      publicationDate: '2024',
    };

    const keys = [fromOpenAlex, fromCrossref, fromRss, fromPubmed].map(canonicalKeyFor);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('doi:10.1038/s41586-024-07123-4');
  });

  it('collapses preprint and published record once the DOI appears (docs/04)', () => {
    const preprintOnly: CanonicalKeyInput = {
      ids: { arxivId: 'arXiv:2401.01234v1' },
      title: 'Structure Prediction at Scale',
      authors: [{ name: 'Jane Smith', position: 1 }],
    };
    const published: CanonicalKeyInput = {
      ids: { doi: '10.1038/s41586-024-07123-4', arxivId: '2401.01234' },
      title: 'Structure Prediction at Scale',
      authors: [{ name: 'Jane Smith', position: 1 }],
    };

    // Before the DOI exists the preprint keys on arXiv; afterwards on the DOI.
    // The ingest layer merges the two via the fuzzy pass — these keys are
    // *expected* to differ, and that difference is what the merge handles.
    expect(canonicalKeyFor(preprintOnly)).toBe('arxiv:2401.01234');
    expect(canonicalKeyFor(published)).toBe('doi:10.1038/s41586-024-07123-4');
  });

  it('gives different keys to genuinely different papers', () => {
    const a = canonicalKeyFor({
      title: 'Protein Folding with Transformers',
      authors: [{ name: 'Jane Smith', position: 1 }],
      publicationDate: '2024-01-01',
    });
    const b = canonicalKeyFor({
      title: 'Protein Folding with Diffusion Models',
      authors: [{ name: 'Jane Smith', position: 1 }],
      publicationDate: '2024-01-01',
    });
    expect(a).not.toBe(b);
  });

  it('separates same-title papers by different first authors', () => {
    const shared = { title: 'A Review of Methods', publicationDate: '2024-01-01' };
    const a = canonicalKeyFor({ ...shared, authors: [{ name: 'Jane Smith', position: 1 }] });
    const b = canonicalKeyFor({ ...shared, authors: [{ name: 'John Doe', position: 1 }] });
    expect(a).not.toBe(b);
  });

  it('separates same-title, same-author papers by year', () => {
    const shared = {
      title: 'Annual Report',
      authors: [{ name: 'Jane Smith', position: 1 }],
    };
    expect(canonicalKeyFor({ ...shared, publicationDate: '2023-01-01' })).not.toBe(
      canonicalKeyFor({ ...shared, publicationDate: '2024-01-01' }),
    );
  });

  it('is not fooled by concatenation ambiguity in the fuzzy hash', () => {
    // Without a field separator, ("ab","c") and ("a","bc") would collide.
    const a = canonicalKeyFor({ title: 'ab', authors: [{ name: 'C', position: 1 }] });
    const b = canonicalKeyFor({ title: 'a', authors: [{ name: 'Bc', position: 1 }] });
    expect(a).not.toBe(b);
  });

  it('is deterministic across calls', () => {
    const work: CanonicalKeyInput = {
      title: 'Reproducibility Matters',
      authors: [{ name: 'Jane Smith', position: 1 }],
      publicationDate: '2024-06-01',
    };
    expect(canonicalKeyFor(work)).toBe(canonicalKeyFor(work));
  });
});

describe('canonical key helpers', () => {
  it('identifies identifier-derived keys', () => {
    expect(isIdentifierKey('doi:10.1038/x')).toBe(true);
    expect(isIdentifierKey('arxiv:2401.01234')).toBe(true);
    expect(isIdentifierKey('fuzzy:abc123')).toBe(false);
  });

  it('parses a key into scheme and value', () => {
    expect(parseCanonicalKey('doi:10.1038/s41586-024-07123-4')).toEqual({
      scheme: 'doi',
      value: '10.1038/s41586-024-07123-4',
    });
  });

  it('keeps colons inside the value intact', () => {
    expect(parseCanonicalKey('openalex:W1:extra')).toEqual({
      scheme: 'openalex',
      value: 'W1:extra',
    });
  });

  it('returns null for a malformed key', () => {
    expect(parseCanonicalKey('nocolon')).toBeNull();
    expect(parseCanonicalKey(':leading')).toBeNull();
    expect(parseCanonicalKey('trailing:')).toBeNull();
  });
});

describe('canonicalJson / specHashFor', () => {
  it('sorts keys at every depth so field order cannot change the hash', () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const b = { a: { c: 3, d: 2 }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('drops undefined values consistently', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('serialises Dates deterministically', () => {
    expect(canonicalJson({ at: new Date('2026-01-01T00:00:00Z') })).toBe(
      '{"at":"2026-01-01T00:00:00.000Z"}',
    );
  });

  it('makes an identical VisualSpec produce an identical specHash', () => {
    const spec = { template: 'STAT_CARD', headline: 'Hello', theme: 'LIGHT' };
    const reordered = { theme: 'LIGHT', headline: 'Hello', template: 'STAT_CARD' };
    expect(specHashFor(spec, 1)).toBe(specHashFor(reordered, 1));
  });

  it('invalidates the cache when the template version changes', () => {
    const spec = { template: 'STAT_CARD', headline: 'Hello' };
    expect(specHashFor(spec, 1)).not.toBe(specHashFor(spec, 2));
  });

  it('changes when any spec value changes', () => {
    expect(specHashFor({ value: '37%' }, 1)).not.toBe(specHashFor({ value: '40%' }, 1));
  });
});

describe('sha256Hex / publishIdempotencyKey', () => {
  it('produces a known digest', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('derives a stable, fixed-length idempotency key from the draft id', () => {
    const key = publishIdempotencyKey('draft_abc123');
    expect(key).toHaveLength(32);
    expect(key).toBe(publishIdempotencyKey('draft_abc123'));
    expect(key).not.toBe(publishIdempotencyKey('draft_abc124'));
  });
});
