/**
 * PubMed query & author adapter.
 *
 * API: NCBI E-utilities (esearch.fcgi + esummary.fcgi)
 * Rate limit: 3 req/s without API key — enforced via ratelimit.ts
 */

import { env } from '@/lib/env';
import { UpstreamError, ValidationError } from '@/lib/errors';
import { normaliseDoi, normalisePmid } from '@/lib/ids';
import { getRateLimiter, budgetForHost } from '@/lib/ratelimit';
import type { SourceAdapter, AdapterPaper, AdapterAuthor, FetchResult } from '../adapter';
import { registerAdapter } from '../adapter';

const PUBMED_HOST = 'eutils.ncbi.nlm.nih.gov';
const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PAGE_SIZE = 25;

interface ESearchResult {
  esearchresult?: {
    count?: string;
    retmax?: string;
    retstart?: string;
    idlist?: string[];
  };
}

interface ESummaryResult {
  result?: {
    uids?: string[];
    [pmid: string]: any;
  };
}

const pubmedAdapter: SourceAdapter = {
  kind: 'PUBMED_QUERY',

  async validate(identifier: string, _config: Record<string, unknown> = {}) {
    if (!identifier || identifier.trim().length === 0) {
      throw new ValidationError('PubMed search query cannot be empty');
    }

    await getRateLimiter().acquire(PUBMED_HOST, budgetForHost(PUBMED_HOST));
    const params = new URLSearchParams({
      db: 'pubmed',
      term: identifier.trim(),
      retmode: 'json',
      retmax: '1',
      email: env.CONTACT_EMAIL,
      tool: env.APP_NAME,
    });

    const resp = await fetch(`${BASE_URL}/esearch.fcgi?${params.toString()}`);
    if (!resp.ok) {
      throw new UpstreamError('PubMed', `Validation query returned HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
  },

  async fetch(
    identifier: string,
    _config: Record<string, unknown> = {},
    cursor: string | null = null,
  ): Promise<FetchResult> {
    const retstart = cursor ? Number(cursor) : 0;
    await getRateLimiter().acquire(PUBMED_HOST, budgetForHost(PUBMED_HOST));

    // Step 1: ESearch to get matching PMIDs
    const searchParams = new URLSearchParams({
      db: 'pubmed',
      term: identifier.trim(),
      retmode: 'json',
      sort: 'pub_date',
      retstart: String(retstart),
      retmax: String(PAGE_SIZE),
      email: env.CONTACT_EMAIL,
      tool: env.APP_NAME,
    });

    let searchResp: Response;
    try {
      searchResp = await fetch(`${BASE_URL}/esearch.fcgi?${searchParams.toString()}`);
    } catch (cause) {
      throw new UpstreamError('PubMed', 'Network failure during PubMed search', { cause, retryable: true });
    }

    if (!searchResp.ok) {
      throw new UpstreamError('PubMed', `Search returned HTTP ${searchResp.status}`, { status: searchResp.status });
    }

    const searchData = (await searchResp.json()) as ESearchResult;
    const ids = searchData.esearchresult?.idlist ?? [];

    if (ids.length === 0) {
      return { papers: [], nextCursor: null };
    }

    // Step 2: ESummary to get document summaries
    await getRateLimiter().acquire(PUBMED_HOST, budgetForHost(PUBMED_HOST));
    const summaryParams = new URLSearchParams({
      db: 'pubmed',
      id: ids.join(','),
      retmode: 'json',
      email: env.CONTACT_EMAIL,
      tool: env.APP_NAME,
    });

    const summaryResp = await fetch(`${BASE_URL}/esummary.fcgi?${summaryParams.toString()}`);
    if (!summaryResp.ok) {
      throw new UpstreamError('PubMed', `Summary returned HTTP ${summaryResp.status}`, { status: summaryResp.status });
    }

    const summaryData = (await summaryResp.json()) as ESummaryResult;
    const resultObj = summaryData.result ?? {};
    const papers: AdapterPaper[] = [];

    for (const id of ids) {
      const doc = resultObj[id];
      if (!doc || typeof doc !== 'object') continue;

      const pmid = normalisePmid(id);
      let doi: string | null = null;

      // Extract DOI from articleids
      if (Array.isArray(doc.articleids)) {
        for (const aid of doc.articleids) {
          if (aid.idtype === 'doi' && aid.value) {
            doi = normaliseDoi(aid.value);
            break;
          }
        }
      }

      const title = (typeof doc.title === 'string' ? doc.title : '').replace(/<[^>]*>/g, '').trim();
      const authors: AdapterAuthor[] = Array.isArray(doc.authors)
        ? doc.authors.map((a: { name?: string }, i: number) => ({
            name: a.name ?? 'Unknown',
            orcid: null,
            position: i,
          }))
        : [];

      const publicationDate = typeof doc.pubdate === 'string' ? doc.pubdate.slice(0, 10) : null;
      const venue = typeof doc.source === 'string' ? doc.source : null;
      const landingUrl = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : null;

      papers.push({
        doi,
        arxivId: null,
        pmid,
        pmcid: null,
        openalexId: null,
        title: title || '(untitled PubMed paper)',
        abstract: null, // ESummary doesn't include full abstracts; enriched downstream
        publicationDate,
        venue,
        landingUrl,
        oaPdfUrl: null,
        authors,
        topics: [],
        citedByCount: null,
        isRetracted: false,
        raw: doc,
      });
    }

    const total = Number(searchData.esearchresult?.count ?? 0);
    const nextCursor = retstart + ids.length < total ? String(retstart + PAGE_SIZE) : null;

    return { papers, nextCursor };
  },
};

registerAdapter(pubmedAdapter);
export { pubmedAdapter };
