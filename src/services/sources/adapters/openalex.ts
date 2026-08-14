/**
 * OpenAlex author adapter.
 *
 * API: https://api.openalex.org/works?filter=authorships.author.id:{id}
 * Rate limit: 10 req/s (polite pool with mailto=) — enforced by ratelimit.ts
 * No API key required.
 *
 * Author disambiguation: an OpenAlex author ID is a stable URI like
 * https://openalex.org/A1234567890. We store the bare ID.
 */

import { env } from '@/lib/env';
import { UpstreamError, ValidationError } from '@/lib/errors';
import { normaliseDoi, normaliseArxivId } from '@/lib/ids';
import { getRateLimiter, budgetForHost } from '@/lib/ratelimit';
import type { SourceAdapter, AdapterPaper, AdapterAuthor, FetchResult } from '@/services/sources/adapter';
import { registerAdapter } from '@/services/sources/adapter';

const BASE = 'https://api.openalex.org';
const HOST = 'api.openalex.org';
const PAGE_SIZE = 25;

interface OpenAlexWork {
  id: string;
  doi: string | null;
  title: string;
  abstract_inverted_index: Record<string, number[]> | null;
  publication_date: string | null;
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string;
    pdf_url?: string;
    is_oa?: boolean;
  };
  authorships: Array<{
    author_position: string;
    author: { id: string; display_name: string; orcid?: string | null };
  }>;
  topics: Array<{ display_name: string }>;
  cited_by_count: number;
  ids: {
    openalex?: string;
    doi?: string;
    mag?: string;
    pmid?: string;
    pmcid?: string;
    arxiv?: string;
  };
  is_retracted: boolean;
  open_access?: { oa_url?: string | null };
}

interface OpenAlexResponse {
  results: OpenAlexWork[];
  meta: {
    count: number;
    page: number;
    per_page: number;
  };
}

/** Reconstructs abstract from OpenAlex inverted index. */
function rebuildAbstract(index: Record<string, number[]> | null): string | null {
  if (!index || Object.keys(index).length === 0) return null;
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) pairs.push([pos, word]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(([, w]) => w).join(' ');
}

function mapWork(work: OpenAlexWork): AdapterPaper {
  const authors: AdapterAuthor[] = (work.authorships ?? []).map((a, i) => ({
    name: a.author.display_name,
    orcid: a.author.orcid ?? null,
    position: i,
  }));

  const doi = normaliseDoi(work.doi ?? work.ids?.doi ?? null);
  const rawArxiv = work.ids?.arxiv ?? null;
  const arxivId = rawArxiv ? normaliseArxivId(rawArxiv) : null;
  const pmid = work.ids?.pmid ? String(work.ids.pmid).replace(/^pmid:/i, '') : null;
  const pmcid = work.ids?.pmcid ? String(work.ids.pmcid).replace(/^pmcid:/i, '') : null;

  const oaPdfUrl =
    work.open_access?.oa_url ??
    work.primary_location?.pdf_url ??
    null;

  return {
    doi,
    arxivId,
    pmid,
    pmcid,
    openalexId: work.ids?.openalex ?? work.id ?? null,
    title: work.title ?? '(untitled)',
    abstract: rebuildAbstract(work.abstract_inverted_index),
    publicationDate: work.publication_date,
    venue: work.primary_location?.source?.display_name ?? null,
    landingUrl: work.primary_location?.landing_page_url ?? null,
    oaPdfUrl,
    authors,
    topics: (work.topics ?? []).map((t) => t.display_name),
    citedByCount: work.cited_by_count ?? null,
    isRetracted: work.is_retracted ?? false,
    raw: work,
  };
}

/** Normalises an OpenAlex author ID to its bare numeric form. */
function normaliseOpenAlexAuthorId(input: string): string {
  return input.replace(/^https?:\/\/openalex\.org\//i, '').toUpperCase();
}

const openAlexAdapter: SourceAdapter = {
  kind: 'OPENALEX_AUTHOR',

  async validate(identifier: string) {
    const id = normaliseOpenAlexAuthorId(identifier);
    if (!/^A\d+$/.test(id)) {
      throw new ValidationError(
        `Invalid OpenAlex author ID '${identifier}'. Expected format: A1234567890 or https://openalex.org/A1234567890`,
      );
    }
    // Ping the API to confirm the author exists
    await getRateLimiter().acquire(HOST, budgetForHost(HOST));
    const resp = await fetch(
      `${BASE}/authors/${id}?select=id,display_name&mailto=${encodeURIComponent(env.CONTACT_EMAIL)}`,
    );
    if (resp.status === 404) {
      throw new ValidationError(`OpenAlex author '${id}' not found.`);
    }
    if (!resp.ok) {
      throw new UpstreamError('OpenAlex', `Author lookup returned HTTP ${resp.status}`, {
        status: resp.status,
      });
    }
  },

  async fetch(identifier: string, _config: Record<string, unknown>, cursor: string | null): Promise<FetchResult> {
    const id = normaliseOpenAlexAuthorId(identifier);
    const page = cursor ? Number(cursor) : 1;

    await getRateLimiter().acquire(HOST, budgetForHost(HOST));

    const params = new URLSearchParams({
      filter: `authorships.author.id:${id}`,
      sort: 'publication_date:desc',
      per_page: String(PAGE_SIZE),
      page: String(page),
      mailto: env.CONTACT_EMAIL,
      select: [
        'id', 'doi', 'title', 'abstract_inverted_index', 'publication_date',
        'primary_location', 'authorships', 'topics', 'cited_by_count',
        'ids', 'is_retracted', 'open_access',
      ].join(','),
    });

    let raw: Response;
    try {
      raw = await fetch(`${BASE}/works?${params.toString()}`);
    } catch (cause) {
      throw new UpstreamError('OpenAlex', 'Network failure fetching works', {
        cause,
        retryable: true,
      });
    }

    if (raw.status === 429) {
      return { papers: [], nextCursor: cursor, rateLimited: true };
    }

    if (!raw.ok) {
      throw new UpstreamError('OpenAlex', `Works query returned HTTP ${raw.status}`, {
        status: raw.status,
        retryable: raw.status >= 500,
      });
    }

    const data = (await raw.json()) as OpenAlexResponse;
    const papers = (data.results ?? []).map(mapWork);
    const totalPages = Math.ceil((data.meta?.count ?? 0) / PAGE_SIZE);
    const nextCursor = page < totalPages ? String(page + 1) : null;

    return { papers, nextCursor };
  },
};

registerAdapter(openAlexAdapter);
export { openAlexAdapter };
