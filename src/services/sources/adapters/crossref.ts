/**
 * Crossref query and manual DOI adapter.
 *
 * API: https://api.crossref.org/works
 * Rate limit: Polite pool with mailto header — 50 req/s.
 */

import { env } from '@/lib/env';
import { UpstreamError, ValidationError } from '@/lib/errors';
import { normaliseDoi } from '@/lib/ids';
import { getRateLimiter, budgetForHost } from '@/lib/ratelimit';
import type { SourceAdapter, AdapterPaper, AdapterAuthor, FetchResult } from '../adapter';
import { registerAdapter } from '../adapter';

const CROSSREF_HOST = 'api.crossref.org';
const BASE_URL = 'https://api.crossref.org/works';
const PAGE_SIZE = 25;

interface CrossrefWork {
  DOI: string;
  title?: string[];
  abstract?: string;
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    ORCID?: string;
    sequence?: string;
  }>;
  'container-title'?: string[];
  published?: { 'date-parts'?: number[][] };
  URL?: string;
  'is-referenced-by-count'?: number;
  subject?: string[];
  link?: Array<{ URL?: string; 'content-type'?: string }>;
}

interface CrossrefResponse {
  message?: {
    items?: CrossrefWork[];
    'total-results'?: number;
  } & CrossrefWork;
}

function mapCrossrefWork(work: CrossrefWork): AdapterPaper {
  const doi = normaliseDoi(work.DOI);
  const title = work.title?.[0]?.replace(/\s+/g, ' ').trim() || '(untitled)';
  const abstract = work.abstract ? work.abstract.replace(/<[^>]*>/g, '').trim() : null;

  const authors: AdapterAuthor[] = (work.author ?? []).map((a, i) => {
    const name = a.name ?? ((`${a.given ?? ''} ${a.family ?? ''}`).trim() || 'Unknown');
    const rawOrcid = a.ORCID ? a.ORCID.replace(/^https?:\/\/orcid\.org\//i, '') : null;
    return {
      name,
      orcid: rawOrcid,
      position: i,
    };
  });

  const dateParts = work.published?.['date-parts']?.[0];
  let publicationDate: string | null = null;
  if (dateParts && dateParts.length > 0) {
    const y = String(dateParts[0]);
    const m = dateParts[1] ? String(dateParts[1]).padStart(2, '0') : '01';
    const d = dateParts[2] ? String(dateParts[2]).padStart(2, '0') : '01';
    publicationDate = `${y}-${m}-${d}`;
  }

  const venue = work['container-title']?.[0] ?? null;
  const landingUrl = work.URL ?? (doi ? `https://doi.org/${doi}` : null);

  let oaPdfUrl: string | null = null;
  if (Array.isArray(work.link)) {
    const pdfLink = work.link.find((l) => l['content-type']?.includes('pdf'));
    if (pdfLink?.URL) oaPdfUrl = pdfLink.URL;
  }

  return {
    doi,
    arxivId: null,
    pmid: null,
    pmcid: null,
    openalexId: null,
    title,
    abstract,
    publicationDate,
    venue,
    landingUrl,
    oaPdfUrl,
    authors,
    topics: work.subject ?? [],
    citedByCount: work['is-referenced-by-count'] ?? null,
    isRetracted: false,
    raw: work,
  };
}

const crossrefQueryAdapter: SourceAdapter = {
  kind: 'CROSSREF_QUERY',

  async validate(identifier: string, _config: Record<string, unknown> = {}) {
    if (!identifier || identifier.trim().length === 0) {
      throw new ValidationError('Crossref query cannot be empty');
    }
    await getRateLimiter().acquire(CROSSREF_HOST, budgetForHost(CROSSREF_HOST));
    const resp = await fetch(
      `${BASE_URL}?query=${encodeURIComponent(identifier)}&rows=1&mailto=${encodeURIComponent(env.CONTACT_EMAIL)}`,
    );
    if (!resp.ok) {
      throw new UpstreamError('Crossref', `Validation query returned HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
  },

  async fetch(
    identifier: string,
    _config: Record<string, unknown> = {},
    cursor: string | null = null,
  ): Promise<FetchResult> {
    const offset = cursor ? Number(cursor) : 0;
    await getRateLimiter().acquire(CROSSREF_HOST, budgetForHost(CROSSREF_HOST));

    const params = new URLSearchParams({
      query: identifier.trim(),
      rows: String(PAGE_SIZE),
      offset: String(offset),
      sort: 'published',
      order: 'desc',
      mailto: env.CONTACT_EMAIL,
    });

    let resp: Response;
    try {
      resp = await fetch(`${BASE_URL}?${params.toString()}`);
    } catch (cause) {
      throw new UpstreamError('Crossref', 'Network failure querying Crossref', { cause, retryable: true });
    }

    if (!resp.ok) {
      throw new UpstreamError('Crossref', `Query returned HTTP ${resp.status}`, { status: resp.status });
    }

    const data = (await resp.json()) as CrossrefResponse;
    const items = data.message?.items ?? [];
    const papers = items.map(mapCrossrefWork);
    const total = data.message?.['total-results'] ?? 0;
    const nextCursor = offset + items.length < total ? String(offset + PAGE_SIZE) : null;

    return { papers, nextCursor };
  },
};

const manualDoiAdapter: SourceAdapter = {
  kind: 'MANUAL_DOI',

  async validate(identifier: string, _config: Record<string, unknown> = {}) {
    const doi = normaliseDoi(identifier);
    if (!doi) {
      throw new ValidationError(`Invalid DOI format: '${identifier}'`);
    }

    await getRateLimiter().acquire(CROSSREF_HOST, budgetForHost(CROSSREF_HOST));
    const resp = await fetch(
      `${BASE_URL}/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(env.CONTACT_EMAIL)}`,
    );
    if (resp.status === 404) {
      throw new ValidationError(`DOI '${doi}' not found on Crossref.`);
    }
    if (!resp.ok) {
      throw new UpstreamError('Crossref', `DOI lookup returned HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
  },

  async fetch(
    identifier: string,
    _config: Record<string, unknown> = {},
    _cursor: string | null = null,
  ): Promise<FetchResult> {
    const doi = normaliseDoi(identifier);
    if (!doi) throw new ValidationError(`Invalid DOI: ${identifier}`);

    await getRateLimiter().acquire(CROSSREF_HOST, budgetForHost(CROSSREF_HOST));
    const resp = await fetch(
      `${BASE_URL}/${encodeURIComponent(doi)}?mailto=${encodeURIComponent(env.CONTACT_EMAIL)}`,
    );

    if (!resp.ok) {
      throw new UpstreamError('Crossref', `DOI fetch returned HTTP ${resp.status}`, {
        status: resp.status,
      });
    }

    const data = (await resp.json()) as CrossrefResponse;
    const work = data.message;
    if (!work) return { papers: [], nextCursor: null };

    return {
      papers: [mapCrossrefWork(work)],
      nextCursor: null,
    };
  },
};

registerAdapter(crossrefQueryAdapter);
registerAdapter(manualDoiAdapter);
export { crossrefQueryAdapter, manualDoiAdapter };
