/**
 * SourceAdapter — the contract every research-source connector implements.
 *
 * docs/04-research-sources.md §Adapters
 *
 * Design principles:
 *  - Each adapter is stateless; sync state lives in `ResearchSource` rows.
 *  - `fetch` is paginated via a `cursor`; the first call passes `null`.
 *  - The adapter never writes to the DB. It returns raw `AdapterPaper`
 *    records; the ingest worker normalises and deduplicates them.
 *  - `validate` runs before the first sync so the user sees an error
 *    immediately rather than at the next cron tick.
 */

import type { SourceKind } from '@prisma/client';

// ──────────────────────────  paper shape  ──────────────────────────

/** The raw paper record an adapter returns — no DB ids, no dedup state. */
export interface AdapterPaper {
  /** Best available identifier — DOI > arXiv ID > PMID > PMCID. Used for dedup. */
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
  pmcid: string | null;
  openalexId: string | null;

  title: string;
  abstract: string | null;

  /** ISO 8601 string or partial date like '2024-03'. */
  publicationDate: string | null;
  venue: string | null;
  landingUrl: string | null;
  /** Open-access PDF URL when freely available. */
  oaPdfUrl: string | null;

  authors: AdapterAuthor[];
  topics: string[];
  citedByCount: number | null;

  isRetracted: boolean;

  /** The raw API response, stored verbatim in `ResearchPaper.raw`. */
  raw: unknown;
}

export interface AdapterAuthor {
  name: string;
  orcid: string | null;
  position: number;
}

// ──────────────────────────  fetch result  ─────────────────────────

export interface FetchResult {
  papers: AdapterPaper[];
  /**
   * Cursor to pass on the next call. `null` signals that all pages have
   * been fetched for this sync cycle.
   */
  nextCursor: string | null;
  /** True when the API reported rate-limiting — the worker backs off. */
  rateLimited?: boolean;
}

// ──────────────────────────  adapter interface  ─────────────────────

export interface SourceAdapter {
  readonly kind: SourceKind;

  /**
   * Validates the adapter's configuration and the identifier/query.
   * Called when the user adds or edits a source.
   * Should throw a `ValidationError` with a user-readable message on failure.
   */
  validate(identifier: string, config: Record<string, unknown>): Promise<void>;

  /**
   * Fetches one page of papers.
   *
   * @param identifier  The user-supplied id (ORCID, author id, query, …)
   * @param config      Stored per-source configuration
   * @param cursor      `null` for the first page; the value from the previous call otherwise
   */
  fetch(
    identifier: string,
    config: Record<string, unknown>,
    cursor: string | null,
  ): Promise<FetchResult>;
}

// ──────────────────────────  registry  ─────────────────────────────

const registry = new Map<SourceKind, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  registry.set(adapter.kind, adapter);
}

export function getAdapter(kind: SourceKind): SourceAdapter {
  const adapter = registry.get(kind);
  if (!adapter) {
    throw new Error(
      `No adapter registered for source kind '${kind}'. ` +
        'Import the adapter module before calling getAdapter().',
    );
  }
  return adapter;
}

export function listRegisteredKinds(): SourceKind[] {
  return [...registry.keys()];
}
