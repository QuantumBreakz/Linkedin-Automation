/**
 * ORCID author adapter.
 *
 * API: https://pub.orcid.org/v3.0/{orcid}/works
 * Returns summary work records; for papers with DOIs we fetch metadata from
 * OpenAlex to get abstracts and citation counts.
 *
 * Rate limit: 40 req/s per IP (ORCID public API).
 */

import { env } from '@/lib/env';
import { UpstreamError, ValidationError } from '@/lib/errors';
import { normaliseDoi, normaliseOrcid } from '@/lib/ids';
import { getRateLimiter, budgetForHost } from '@/lib/ratelimit';
import type { SourceAdapter, AdapterPaper, AdapterAuthor, FetchResult } from '@/services/sources/adapter';
import { registerAdapter } from '@/services/sources/adapter';

const ORCID_BASE = 'https://pub.orcid.org/v3.0';
const OPENALEX_BASE = 'https://api.openalex.org';
const ORCID_HOST = 'pub.orcid.org';
const OPENALEX_HOST = 'api.openalex.org';

interface OrcidSummary {
  orcid: string;
  name: { 'credit-name'?: { value?: string }; 'given-names'?: { value?: string }; 'family-name'?: { value?: string } };
}

interface OrcidWorkSummary {
  'work-summary': Array<{
    'put-code': number;
    title?: { title?: { value?: string } };
    type?: string;
    'publication-date'?: { year?: { value?: string }; month?: { value?: string }; day?: { value?: string } };
    'external-ids'?: {
      'external-id'?: Array<{ 'external-id-type': string; 'external-id-value': string; 'external-id-url'?: { value?: string } }>;
    };
    'journal-title'?: { value?: string };
    url?: { value?: string };
  }>;
}

interface OrcidWorksResponse {
  group: OrcidWorkSummary[];
}

function extractIds(work: OrcidWorkSummary['work-summary'][0]): {
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
  pmcid: string | null;
  landingUrl: string | null;
} {
  const ids = work['external-ids']?.['external-id'] ?? [];
  let doi: string | null = null;
  let arxivId: string | null = null;
  let pmid: string | null = null;
  let pmcid: string | null = null;
  const landingUrl = work.url?.value ?? null;

  for (const eid of ids) {
    const type = (eid['external-id-type'] ?? '').toLowerCase();
    const value = eid['external-id-value'] ?? '';
    if (type === 'doi') doi = normaliseDoi(value);
    else if (type === 'arxiv') arxivId = value.replace(/^arxiv:/i, '');
    else if (type === 'pmid') pmid = value;
    else if (type === 'pmcid') pmcid = value;
  }

  return { doi, arxivId, pmid, pmcid, landingUrl };
}

function extractDate(pd?: OrcidWorkSummary['work-summary'][0]['publication-date']): string | null {
  if (!pd) return null;
  const year = pd.year?.value ?? '';
  if (!year) return null;
  const month = pd.month?.value ?? '';
  const day = pd.day?.value ?? '';
  if (month && day) return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (month) return `${year}-${month.padStart(2, '0')}`;
  return year;
}

const orcidAdapter: SourceAdapter = {
  kind: 'ORCID',

  async validate(identifier: string) {
    const orcid = normaliseOrcid(identifier);
    if (!orcid) {
      throw new ValidationError(
        `'${identifier}' is not a valid ORCID. Expected format: 0000-0001-2345-6789`,
      );
    }
    await getRateLimiter().acquire(ORCID_HOST, budgetForHost(ORCID_HOST));
    const resp = await fetch(`${ORCID_BASE}/${orcid}/person`, {
      headers: { Accept: 'application/json' },
    });
    if (resp.status === 404) {
      throw new ValidationError(`ORCID '${orcid}' not found.`);
    }
    if (!resp.ok) {
      throw new UpstreamError('ORCID', `Person lookup returned HTTP ${resp.status}`, { status: resp.status });
    }
  },

  async fetch(identifier: string, _config: Record<string, unknown>, _cursor: string | null): Promise<FetchResult> {
    const orcid = normaliseOrcid(identifier);
    if (!orcid) throw new ValidationError(`Invalid ORCID: ${identifier}`);

    await getRateLimiter().acquire(ORCID_HOST, budgetForHost(ORCID_HOST));

    let raw: Response;
    try {
      raw = await fetch(`${ORCID_BASE}/${orcid}/works`, {
        headers: { Accept: 'application/json' },
      });
    } catch (cause) {
      throw new UpstreamError('ORCID', 'Network failure', { cause, retryable: true });
    }

    if (!raw.ok) {
      throw new UpstreamError('ORCID', `Works fetch returned HTTP ${raw.status}`, {
        status: raw.status,
        retryable: raw.status >= 500,
      });
    }

    const data = (await raw.json()) as OrcidWorksResponse;
    const groups = data.group ?? [];

    // Fetch the person name for author attribution
    let authorName = orcid;
    try {
      await getRateLimiter().acquire(ORCID_HOST, budgetForHost(ORCID_HOST));
      const personResp = await fetch(`${ORCID_BASE}/${orcid}/person`, {
        headers: { Accept: 'application/json' },
      });
      if (personResp.ok) {
        const person = (await personResp.json()) as OrcidSummary;
        const credit = person.name?.['credit-name']?.value;
        const given = person.name?.['given-names']?.value ?? '';
        const family = person.name?.['family-name']?.value ?? '';
        authorName = credit ?? (`${given} ${family}`.trim() || orcid);
      }
    } catch {
      // Name fetch is best-effort
    }

    const papers: AdapterPaper[] = [];

    for (const group of groups) {
      // Take the preferred summary (first one)
      const summary = group['work-summary']?.[0];
      if (!summary) continue;

      const title = summary.title?.title?.value ?? '(untitled)';
      const ids = extractIds(summary);
      const publicationDate = extractDate(summary['publication-date']);
      const venue = summary['journal-title']?.value ?? null;

      const author: AdapterAuthor = {
        name: authorName,
        orcid,
        position: 0,
      };

      // For works with DOIs, enrich from OpenAlex (abstract, citation count, full author list)
      if (ids.doi) {
        try {
          await getRateLimiter().acquire(OPENALEX_HOST, budgetForHost(OPENALEX_HOST));
          const oaResp = await fetch(
            `${OPENALEX_BASE}/works/doi:${encodeURIComponent(ids.doi)}?mailto=${encodeURIComponent(env.CONTACT_EMAIL)}&select=id,abstract_inverted_index,cited_by_count,authorships,open_access,is_retracted`,
          );
          if (oaResp.ok) {
            const oaWork = (await oaResp.json()) as {
              id?: string;
              abstract_inverted_index?: Record<string, number[]> | null;
              cited_by_count?: number;
              authorships?: Array<{ author: { display_name: string; orcid?: string | null }; author_position?: string }>;
              open_access?: { oa_url?: string | null };
              is_retracted?: boolean;
            };

            // Rebuild abstract from inverted index
            const abstract = rebuildAbstractOrcid(oaWork.abstract_inverted_index ?? null);

            // Map full author list from OpenAlex, marking the ORCID user
            const enrichedAuthors: AdapterAuthor[] = (oaWork.authorships ?? []).map((a, i) => ({
              name: a.author.display_name,
              orcid: a.author.orcid ?? null,
              position: i,
            }));
            if (enrichedAuthors.length === 0) enrichedAuthors.push(author);

            papers.push({
              ...ids,
              openalexId: oaWork.id ?? null,
              title,
              abstract,
              publicationDate,
              venue,
              landingUrl: ids.landingUrl,
              oaPdfUrl: oaWork.open_access?.oa_url ?? null,
              authors: enrichedAuthors,
              topics: [],
              citedByCount: oaWork.cited_by_count ?? null,
              isRetracted: oaWork.is_retracted ?? false,
              raw: { orcid: summary, openalex: oaWork },
            });
            continue;
          }
        } catch {
          // OpenAlex enrichment is best-effort
        }
      }

      // Fallback — ORCID-only record, no abstract
      papers.push({
        ...ids,
        openalexId: null,
        title,
        abstract: null,
        publicationDate,
        venue,
        landingUrl: ids.landingUrl,
        oaPdfUrl: null,
        authors: [author],
        topics: [],
        citedByCount: null,
        isRetracted: false,
        raw: summary,
      });
    }

    // ORCID returns all works in one page
    return { papers, nextCursor: null };
  },
};

function rebuildAbstractOrcid(index: Record<string, number[]> | null): string | null {
  if (!index || Object.keys(index).length === 0) return null;
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) pairs.push([pos, word]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(([, w]) => w).join(' ');
}

registerAdapter(orcidAdapter);
export { orcidAdapter };
