/**
 * arXiv author & query adapter.
 *
 * API: http://export.arxiv.org/api/query
 * Rate limit: 1 req per 3 seconds (polite pool) — enforced via ratelimit.ts
 * Format: Atom XML (parsed via fast-xml-parser)
 */

import { XMLParser } from 'fast-xml-parser';
import { UpstreamError, ValidationError } from '@/lib/errors';
import { normaliseArxivId, normaliseDoi } from '@/lib/ids';
import { getRateLimiter, budgetForHost } from '@/lib/ratelimit';
import type { SourceAdapter, AdapterPaper, AdapterAuthor, FetchResult } from '../adapter';
import { registerAdapter } from '../adapter';

const ARXIV_HOST = 'export.arxiv.org';
const BASE_URL = 'https://export.arxiv.org/api/query';
const PAGE_SIZE = 25;

interface ArxivEntry {
  id: string;
  title: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: Array<{ name: string }> | { name: string };
  'arxiv:doi'?: { '#text'?: string } | string;
  'arxiv:primary_category'?: { '@_term'?: string };
  category?: Array<{ '@_term'?: string }> | { '@_term'?: string };
  link?: Array<{ '@_href'?: string; '@_title'?: string; '@_rel'?: string }>;
}

interface ArxivFeed {
  feed?: {
    entry?: ArxivEntry[] | ArxivEntry;
    'opensearch:totalResults'?: { '#text'?: number } | number;
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});

function mapEntry(entry: ArxivEntry): AdapterPaper {
  const rawId = typeof entry.id === 'string' ? entry.id : '';
  const arxivId = normaliseArxivId(rawId);
  const title = (typeof entry.title === 'string' ? entry.title : '').replace(/\s+/g, ' ').trim();
  const abstract = (typeof entry.summary === 'string' ? entry.summary : '').replace(/\s+/g, ' ').trim() || null;
  const publicationDate = entry.published ? entry.published.slice(0, 10) : null;

  const rawDoi = entry['arxiv:doi'];
  const doiStr = typeof rawDoi === 'string' ? rawDoi : rawDoi?.['#text'];
  const doi = doiStr ? normaliseDoi(doiStr) : null;

  // Authors
  const authorsRaw = Array.isArray(entry.author) ? entry.author : entry.author ? [entry.author] : [];
  const authors: AdapterAuthor[] = authorsRaw.map((a, i) => ({
    name: typeof a.name === 'string' ? a.name.trim() : 'Unknown',
    orcid: null,
    position: i,
  }));

  // Topics / categories
  const categoriesRaw = Array.isArray(entry.category) ? entry.category : entry.category ? [entry.category] : [];
  const topics = categoriesRaw
    .map((c) => c['@_term'])
    .filter((t): t is string => typeof t === 'string' && t.length > 0);

  // PDF URL
  let oaPdfUrl: string | null = null;
  let landingUrl: string | null = null;

  if (Array.isArray(entry.link)) {
    for (const link of entry.link) {
      if (link['@_title'] === 'pdf') {
        oaPdfUrl = link['@_href'] ?? null;
      } else if (link['@_rel'] === 'alternate') {
        landingUrl = link['@_href'] ?? null;
      }
    }
  }

  if (!oaPdfUrl && arxivId) {
    oaPdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
  }
  if (!landingUrl && arxivId) {
    landingUrl = `https://arxiv.org/abs/${arxivId}`;
  }

  return {
    doi,
    arxivId,
    pmid: null,
    pmcid: null,
    openalexId: null,
    title: title || '(untitled arXiv paper)',
    abstract,
    publicationDate,
    venue: 'arXiv',
    landingUrl,
    oaPdfUrl,
    authors,
    topics,
    citedByCount: null,
    isRetracted: false,
    raw: entry,
  };
}

const arxivAdapter: SourceAdapter = {
  kind: 'ARXIV_AUTHOR',

  async validate(identifier: string, _config: Record<string, unknown> = {}) {
    if (!identifier || identifier.trim().length === 0) {
      throw new ValidationError('arXiv author query cannot be empty');
    }
    // Ping arXiv API with max_results=1
    await getRateLimiter().acquire(ARXIV_HOST, budgetForHost(ARXIV_HOST));
    const params = new URLSearchParams({
      search_query: `au:${identifier.trim()}`,
      max_results: '1',
    });

    const resp = await fetch(`${BASE_URL}?${params.toString()}`);
    if (!resp.ok) {
      throw new UpstreamError('arXiv', `Validation ping returned HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
  },

  async fetch(
    identifier: string,
    _config: Record<string, unknown> = {},
    cursor: string | null = null,
  ): Promise<FetchResult> {
    const start = cursor ? Number(cursor) : 0;
    await getRateLimiter().acquire(ARXIV_HOST, budgetForHost(ARXIV_HOST));

    const params = new URLSearchParams({
      search_query: `au:${identifier.trim()}`,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      start: String(start),
      max_results: String(PAGE_SIZE),
    });

    let resp: Response;
    try {
      resp = await fetch(`${BASE_URL}?${params.toString()}`);
    } catch (cause) {
      throw new UpstreamError('arXiv', 'Network error querying arXiv API', { cause, retryable: true });
    }

    if (resp.status === 429) {
      return { papers: [], nextCursor: cursor, rateLimited: true };
    }

    if (!resp.ok) {
      throw new UpstreamError('arXiv', `Query returned HTTP ${resp.status}`, { status: resp.status });
    }

    const xmlText = await resp.text();
    const parsed = parser.parse(xmlText) as ArxivFeed;

    const entriesRaw = parsed.feed?.entry;
    const entries: ArxivEntry[] = Array.isArray(entriesRaw)
      ? entriesRaw
      : entriesRaw
        ? [entriesRaw]
        : [];

    const papers = entries.map(mapEntry);
    const nextCursor = entries.length === PAGE_SIZE ? String(start + PAGE_SIZE) : null;

    return { papers, nextCursor };
  },
};

registerAdapter(arxivAdapter);
export { arxivAdapter };
