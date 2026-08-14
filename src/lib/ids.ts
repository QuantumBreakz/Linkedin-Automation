/**
 * Canonical identifier and dedup-key helpers.
 *
 * Implements docs/04-research-sources.md §Normalisation & deduplication. The
 * same paper legitimately arrives from ORCID, OpenAlex, arXiv and Crossref
 * within the same hour; if these functions disagree with each other by a
 * character, a researcher gets posted about twice.
 *
 * There is exactly one implementation of each rule and every connector imports
 * it from here. Do not re-derive a canonical key anywhere else.
 */

import { createHash } from 'node:crypto';

// ────────────────────────────  identifiers  ────────────────────────────

/**
 * Normalises a DOI to bare, lowercase form: `10.1038/s41586-024-07123-4`.
 *
 * Accepts every shape users and APIs actually produce — `https://doi.org/…`,
 * `http://dx.doi.org/…`, `doi:…`, `DOI: …`, with or without surrounding
 * whitespace or a trailing period from a citation.
 *
 * Returns `null` when the input is not a DOI. Callers must handle `null`
 * rather than falling back to the raw string: a malformed DOI used as a
 * canonical key merges two unrelated papers.
 */
export function normaliseDoi(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim();
  if (value.length === 0) return null;

  // Strip resolver prefixes, then any `doi:` scheme, in either order.
  value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  value = value.replace(/^https?:\/\/doi\.org\//i, '');
  value = value.replace(/^doi:\s*/i, '');
  value = value.replace(/^info:doi\//i, '');
  value = value.trim();

  // Citation punctuation and stray wrappers.
  value = value.replace(/^[<[("']+/, '').replace(/[>\])"'.,;]+$/, '');
  value = value.trim();

  if (value.length === 0) return null;

  const lowered = value.toLowerCase();

  // A DOI is `10.<registrant>/<suffix>`; the suffix must be non-empty.
  if (!/^10\.\d{4,9}\/\S+$/.test(lowered)) return null;

  return lowered;
}

/**
 * Normalises an arXiv identifier and **drops the version suffix**.
 *
 * Version-stripping is deliberate: `2401.01234v1` and `2401.01234v3` are the
 * same paper, and a researcher should not get two posts because they uploaded
 * a revision. Handles both the new scheme (`2401.01234`) and the legacy one
 * (`hep-th/9901001`, `math.GT/0309136`).
 */
export function normaliseArxivId(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim();
  if (value.length === 0) return null;

  value = value.replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '');
  value = value.replace(/^arxiv:\s*/i, '');
  value = value.replace(/\.pdf$/i, '');
  value = value.trim().toLowerCase();

  // Strip the version suffix: 2401.01234v2 -> 2401.01234
  value = value.replace(/v\d+$/, '');

  if (/^\d{4}\.\d{4,5}$/.test(value)) return value;
  if (/^[a-z-]+(?:\.[a-z]{2})?\/\d{7}$/.test(value)) return value;

  return null;
}

/** Normalises a PubMed ID to bare digits. */
export function normalisePmid(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim().toLowerCase();
  value = value.replace(/^https?:\/\/(?:www\.)?(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\//i, '');
  value = value.replace(/^pmid:\s*/i, '');
  value = value.replace(/\/+$/, '').trim();

  return /^\d{1,9}$/.test(value) ? value : null;
}

/** Normalises a PubMed Central ID to `PMC` + digits. */
export function normalisePmcid(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim();
  value = value.replace(/^https?:\/\/(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, '');
  value = value.replace(/\/+$/, '').replace(/^pmc:\s*/i, '').trim();

  const match = /^pmc(\d{1,9})$/i.exec(value);
  return match === null ? null : `PMC${match[1]}`;
}

/** Normalises an OpenAlex work ID to bare `W…` form. */
export function normaliseOpenAlexId(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim();
  value = value.replace(/^https?:\/\/(?:api\.)?openalex\.org\/(?:works\/)?/i, '');
  value = value.replace(/\/+$/, '').trim().toUpperCase();

  return /^W\d{1,12}$/.test(value) ? value : null;
}

/**
 * Normalises an ORCID iD to `0000-0000-0000-000X`.
 *
 * Validates the ISO 7064 MOD 11-2 checksum, because an ORCID with a typo is
 * how a paper gets attributed to the wrong person — the one failure mode in
 * docs/04 §Author disambiguation that we must never allow.
 */
export function normaliseOrcid(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;

  let value = input.trim();
  value = value.replace(/^https?:\/\/(?:sandbox\.)?orcid\.org\//i, '');
  value = value.replace(/[\s-]/g, '').toUpperCase();

  if (!/^\d{15}[\dX]$/.test(value)) return null;
  if (!hasValidOrcidChecksum(value)) return null;

  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}`;
}

function hasValidOrcidChecksum(digits16: string): boolean {
  let total = 0;
  for (let i = 0; i < 15; i += 1) {
    total = (total + Number(digits16[i])) * 2;
  }
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const expected = result === 10 ? 'X' : String(result);
  return digits16[15] === expected;
}

// ──────────────────────────────  text  ─────────────────────────────────

/** Strips diacritics so "Müller" and "Muller" hash the same. */
function stripDiacritics(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * URL/hash-safe slug of a title: lowercase, unaccented, alphanumeric words
 * joined by single hyphens.
 *
 * `slugifyTitle('Deep Learning for Protein Folding: A Review')`
 *   → `'deep-learning-for-protein-folding-a-review'`
 */
export function slugifyTitle(title: string | null | undefined, maxLength = 120): string {
  if (typeof title !== 'string') return '';

  const slug = stripDiacritics(title)
    .toLowerCase()
    // Common typographic noise in scraped titles.
    .replace(/[‘’“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length <= maxLength) return slug;
  // Cut on a word boundary so the slug stays readable.
  const cut = slug.slice(0, maxLength);
  const lastHyphen = cut.lastIndexOf('-');
  return lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
}

/**
 * Title form used for the `pg_trgm` fuzzy pass (docs/04 §Dedup step 3).
 *
 * Differs from {@link slugifyTitle}: words are separated by single spaces, not
 * hyphens, because trigram similarity over hyphenated text scores differently.
 * Store this in the column the similarity index is built on.
 */
export function normaliseTitleForMatch(title: string | null | undefined): string {
  if (typeof title !== 'string') return '';
  return stripDiacritics(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Trigram similarity at or above this counts as the same title. docs/04 §Dedup step 3. */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;
/** Publication years within ±this are compatible. docs/04 §Dedup step 3. */
export const PUBLICATION_YEAR_TOLERANCE = 1;

/**
 * Extracts a comparable surname from an author string.
 *
 * Handles the two forms real APIs return — `"Jane Q. Smith"` and
 * `"Smith, Jane Q."` — plus particles (`"van der Berg"` → `vandenberg`-style
 * joining is deliberately avoided; we take the final token, which is what both
 * Crossref and OpenAlex index on).
 */
export function firstAuthorSurname(
  authors: ReadonlyArray<{ name: string; position?: number }> | null | undefined,
): string {
  if (!Array.isArray(authors) || authors.length === 0) return '';

  const first = [...authors].sort(
    (a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
  )[0];

  return surnameOf(first?.name);
}

export function surnameOf(name: string | null | undefined): string {
  if (typeof name !== 'string') return '';

  const cleaned = stripDiacritics(name).trim();
  if (cleaned.length === 0) return '';

  // "Smith, Jane Q." — everything before the first comma is the surname.
  const commaIndex = cleaned.indexOf(',');
  const candidate =
    commaIndex > 0 ? cleaned.slice(0, commaIndex) : cleaned.split(/\s+/).slice(-1)[0] ?? '';

  return candidate.toLowerCase().replace(/[^a-z]/g, '');
}

/** Four-digit year from an ISO string, a `Date`, or a bare year. `''` when absent. */
export function publicationYear(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : String(value.getUTCFullYear());
  }
  if (typeof value !== 'string') return '';

  const match = /(\d{4})/.exec(value.trim());
  if (match === null) return '';

  const year = Number(match[1]);
  // Guard against a page number or an identifier fragment being read as a year.
  return year >= 1500 && year <= 2200 ? String(year) : '';
}

// ─────────────────────────────  dedup key  ─────────────────────────────

/**
 * Structural shape of a work, compatible with `DiscoveredWork` from
 * docs/04-research-sources.md — a connector can pass its result straight in.
 */
export interface CanonicalKeyInput {
  ids?: {
    doi?: string | null;
    openalexId?: string | null;
    arxivId?: string | null;
    pmid?: string | null;
    pmcid?: string | null;
  };
  title: string;
  authors?: ReadonlyArray<{ name: string; position?: number }>;
  publicationDate?: string | Date | null;
}

/**
 * Field separator inside the fuzzy hash input.
 *
 * docs/04 writes this as `sha256(slug(title) + firstAuthorSurname + year)`. A
 * separator is used because bare concatenation is ambiguous — `("ab", "c")`
 * and `("a", "bc")` would collide — and `\u001f` (unit separator) cannot occur in any of the
 * three normalised inputs. This function is the single implementation of the
 * rule, so the separator choice can never drift between connectors.
 */
const FUZZY_FIELD_SEPARATOR = '\u001f';

/**
 * The `ResearchPaper.canonicalKey` value. docs/04 §Dedup step 1:
 *
 *   `doi:{normalised}` → `arxiv:{id}` → `pmid:{id}` → `openalex:{id}`
 *   → `fuzzy:{sha256(slug(title) + firstAuthorSurname + year)}`
 *
 * The DOI wins over the arXiv ID on purpose. That is what collapses the
 * preprint and the published article into one paper once the DOI appears
 * (docs/04 §Normalisation) instead of posting about the same work twice.
 *
 * Note that `pmcid` is intentionally not a key source: it identifies a
 * full-text deposit, not the work, and a work can have one without being
 * distinct from its DOI-keyed self.
 */
export function canonicalKeyFor(work: CanonicalKeyInput): string {
  const ids = work.ids ?? {};

  const doi = normaliseDoi(ids.doi);
  if (doi !== null) return `doi:${doi}`;

  const arxivId = normaliseArxivId(ids.arxivId);
  if (arxivId !== null) return `arxiv:${arxivId}`;

  const pmid = normalisePmid(ids.pmid);
  if (pmid !== null) return `pmid:${pmid}`;

  const openalexId = normaliseOpenAlexId(ids.openalexId);
  if (openalexId !== null) return `openalex:${openalexId}`;

  return `fuzzy:${fuzzyKeyHash(work)}`;
}

/** The hex digest used by the `fuzzy:` branch of {@link canonicalKeyFor}. */
export function fuzzyKeyHash(work: CanonicalKeyInput): string {
  const parts = [
    slugifyTitle(work.title),
    firstAuthorSurname(work.authors),
    publicationYear(work.publicationDate),
  ];
  return sha256Hex(parts.join(FUZZY_FIELD_SEPARATOR));
}

/** True when the key was derived from a real identifier rather than a title hash. */
export function isIdentifierKey(canonicalKey: string): boolean {
  return !canonicalKey.startsWith('fuzzy:');
}

/** Splits a canonical key into its scheme and value. */
export function parseCanonicalKey(
  canonicalKey: string,
): { scheme: string; value: string } | null {
  const index = canonicalKey.indexOf(':');
  if (index <= 0 || index === canonicalKey.length - 1) return null;
  return {
    scheme: canonicalKey.slice(0, index),
    value: canonicalKey.slice(index + 1),
  };
}

// ────────────────────────────  misc hashes  ────────────────────────────

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Deterministic JSON: object keys sorted at every depth, so
 * `sha256(canonicalJson(spec))` is a stable render-cache key regardless of the
 * order the LLM emitted the fields in (docs/06 §Rendering).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue; // JSON.stringify would drop it anyway
    sorted[key] = sortKeysDeep(source[key]);
  }
  return sorted;
}

/** `specHash` for the visual render cache: docs/06 — sha256(canonicalJson(spec) + templateVersion). */
export function specHashFor(spec: unknown, templateVersion: string | number): string {
  return sha256Hex(`${canonicalJson(spec)}|${String(templateVersion)}`);
}

/**
 * Idempotency key for `post.publish`. docs/02 §Idempotency keys publish on
 * `draftId`; the digest keeps the value opaque and fixed-length for LinkedIn's
 * header while remaining a pure function of the draft.
 */
export function publishIdempotencyKey(draftId: string): string {
  return sha256Hex(`publish:${draftId}`).slice(0, 32);
}
