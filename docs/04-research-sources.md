# 04 — Research Source Adapters

## The interface

Every connector implements one interface. Adding a source means adding one file and one registry
entry — nothing else in the system changes.

```ts
export type SourceKind =
  | 'ORCID' | 'OPENALEX_AUTHOR' | 'ARXIV_AUTHOR' | 'PUBMED_QUERY'
  | 'CROSSREF_QUERY' | 'RSS' | 'MANUAL_DOI' | 'MANUAL_URL';

export interface DiscoveredWork {
  /** Identifiers, any subset. Drives dedup. */
  ids: {
    doi?: string;          // normalised: lowercase, no scheme/host prefix
    openalexId?: string;
    arxivId?: string;
    pmid?: string;
    pmcid?: string;
  };
  title: string;
  abstract?: string;
  authors: { name: string; orcid?: string; position: number }[];
  publicationDate?: string;   // ISO-8601, may be year-only precision
  datePrecision: 'DAY' | 'MONTH' | 'YEAR';
  venue?: string;
  landingUrl?: string;
  oaPdfUrl?: string;
  isRetracted: boolean;       // never optional — connectors must state a position
  topics: string[];
  citedByCount?: number;
  /** Verbatim upstream payload, kept for re-processing without re-fetching. */
  raw: unknown;
}

export interface SyncResult {
  works: DiscoveredWork[];
  cursor?: string;            // opaque, persisted; enables incremental sync
  checkedAt: Date;
}

export interface SourceAdapter {
  readonly kind: SourceKind;
  readonly displayName: string;
  /** Politeness budget, enforced centrally by the rate limiter. */
  readonly rateLimit: { host: string; perSecond: number; minDelayMs?: number };

  /** Turn user input (a URL, an ORCID, a query) into a stored source config. */
  parseInput(input: string): Promise<{ identifier: string; config: Json } | null>;

  /** Cheap reachability + "is this really you?" check at add-time. */
  validate(identifier: string, config: Json): Promise<ValidationResult>;

  /** Incremental fetch. `since` and `cursor` are both honoured where supported. */
  sync(args: { identifier: string; config: Json; since?: Date; cursor?: string }): Promise<SyncResult>;
}
```

Notes on two deliberate choices:

- **`isRetracted` is required, not optional.** A connector that cannot determine retraction
  status must return `false` *and* the ingest layer will independently check OpenAlex/Crossref by
  DOI. Making it non-optional forces each connector author to think about it.
- **`raw` is always persisted.** When we improve the extraction prompt in three months, we
  re-run against stored payloads instead of re-hitting every upstream API.

## Connector matrix (Tier A — MVP)

| Kind | Endpoint | Auth | Budget | Incremental via |
| --- | --- | --- | --- | --- |
| `OPENALEX_AUTHOR` | `api.openalex.org/works?filter=author.orcid:…` or `author.id:…` | none | polite pool: `mailto=` | `from_created_date` |
| `ORCID` | `pub.orcid.org/v3.0/{id}/works` | none (public API) | be polite | `last-modified-date` |
| `ARXIV_AUTHOR` | `export.arxiv.org/api/query?search_query=au:…` | none | **3s between calls** | `sortBy=submittedDate` + high-water mark |
| `PUBMED_QUERY` | `eutils.ncbi.nlm.nih.gov` esearch → efetch | free key recommended | 3/s (10/s keyed); `tool`+`email` **required** | `mindate`/`maxdate` |
| `CROSSREF_QUERY` | `api.crossref.org/works?query.author=…` | none | UA with mailto | `from-index-date` |
| `MANUAL_DOI` | `api.crossref.org/works/{doi}` + OpenAlex | none | — | n/a (one-shot) |
| `RSS` | any Atom/RSS feed | none | per-host | `lastBuildDate` / GUID set |

**Recommended default onboarding: ORCID.** One field, unambiguous, and it keys directly into
OpenAlex (`filter=author.orcid:…`) — verified live to return 95 works for a real researcher with
no API key. ORCID is the identifier academics already have and already curate.

## Normalisation & deduplication

The same paper legitimately arrives from four sources. Dedup runs in `paper.ingest`:

1. **Canonical key** — first available of:
   `doi:{normalised}` → `arxiv:{id}` → `pmid:{id}` → `openalex:{id}`
   → `fuzzy:{sha256(slug(title) + firstAuthorSurname + year)}`
2. **Exact match** on `canonicalKey` → merge into the existing `ResearchPaper`.
3. **Fuzzy pass** for records with no shared identifier: normalised-title trigram similarity
   ≥ 0.90 **and** matching first-author surname **and** publication year within ±1.
   Postgres `pg_trgm` handles this; no LLM needed.
4. **Merge policy** — richest wins per field. An OpenAlex record with a full abstract beats an
   RSS record with a truncated one. Never overwrite a non-null field with null.
5. Record the association in `PaperSourceLink` so the UI can show "found via ORCID + arXiv".

Preprint→published is treated as **one paper with two versions**, not two papers: the arXiv
record and the journal record share a `canonicalKey` once the DOI appears. Otherwise every
researcher gets posted about twice.

## Author disambiguation

"J. Smith" is not a person. We only ever attribute a paper to a user when one of these holds:

- The paper's `authorships[].author.orcid` matches the user's verified ORCID, **or**
- The source itself is author-scoped (an ORCID profile, an OpenAlex author ID), **or**
- The user manually added that specific paper.

Name-only matching is never sufficient to enter the auto-publish path. A name-matched paper lands
in the Research Inbox marked `needsAttribution` for one-click confirmation.

## Full-text acquisition

Ordered attempts, stopping at the first success; `fullTextStatus` records the outcome.

1. `best_oa_location.pdf_url` from OpenAlex
2. arXiv PDF (`arxiv.org/pdf/{id}`) when an arXiv ID exists
3. PMC OA subset when a PMCID exists
4. Unpaywall by DOI
5. Give up → `fullTextStatus = 'ABSTRACT_ONLY'`

We never bypass a paywall. `ABSTRACT_ONLY` is a normal, well-handled state — it constrains which
content formats are eligible (see [`05-ai-pipeline.md`](05-ai-pipeline.md)), it does not block the
paper.
