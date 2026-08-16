/**
 * Paper deduplication.
 *
 * docs/04-research-sources.md §Normalisation & deduplication — three passes:
 *
 *  1. Canonical key match   (exact, in `ResearchPaper.canonicalKey`)
 *  2. DOI upgrade           (fuzzy key → doi key when a DOI arrives)
 *  3. pg_trgm fuzzy pass    (title similarity ≥ 0.9 with compatible year)
 *
 * Pass 3 runs in Postgres to leverage the GIN trigram index. The function
 * returns a canonical key for an existing paper when a duplicate is found,
 * so the ingest worker can add a PaperSourceLink instead of creating a
 * duplicate row.
 */

import { db } from '@/lib/db';
import {
  canonicalKeyFor,
  normaliseDoi,
  TITLE_SIMILARITY_THRESHOLD,
  PUBLICATION_YEAR_TOLERANCE,
  normaliseTitleForMatch,
  publicationYear,
} from '@/lib/ids';
import type { AdapterPaper } from './adapter';

// ──────────────────────────────  public  ────────────────────────────────

export interface DedupResult {
  existingId: string | null;
  existingCanonicalKey: string | null;
  /** True when the key changed (fuzzy → doi upgrade). */
  upgraded: boolean;
}

/**
 * Checks whether a paper already exists for this user.
 *
 * Returns the existing `ResearchPaper.id` when found; `null` when the paper
 * is new. Also returns the upgraded canonical key if the incoming DOI is
 * better than the stored fuzzy hash.
 */
export async function checkDuplicate(
  userId: string,
  paper: AdapterPaper,
): Promise<DedupResult> {
  const canonicalKey = canonicalKeyFor({
    ids: {
      doi: paper.doi,
      openalexId: paper.openalexId,
      arxivId: paper.arxivId,
      pmid: paper.pmid,
      pmcid: paper.pmcid,
    },
    title: paper.title,
    authors: paper.authors,
    publicationDate: paper.publicationDate ?? undefined,
  });

  // Pass 1 — exact canonical key match
  const exact = await db.researchPaper.findUnique({
    where: { userId_canonicalKey: { userId, canonicalKey } },
    select: { id: true, canonicalKey: true },
  });
  if (exact) {
    return { existingId: exact.id, existingCanonicalKey: exact.canonicalKey, upgraded: false };
  }

  // Pass 2 — DOI upgrade: the incoming record has a DOI; the stored record
  // has a fuzzy key for the same title. Replace the fuzzy key with the DOI key.
  if (paper.doi) {
    const doi = normaliseDoi(paper.doi);
    if (doi) {
      const fuzzyMatch = await findFuzzyMatchWithDoi(userId, paper, doi);
      if (fuzzyMatch) {
        await db.researchPaper.update({
          where: { id: fuzzyMatch.id },
          data: { canonicalKey, doi },
        });
        return { existingId: fuzzyMatch.id, existingCanonicalKey: canonicalKey, upgraded: true };
      }
    }
  }

  // Pass 3 — pg_trgm title similarity
  const fuzzy = await findByTitleSimilarity(userId, paper);
  if (fuzzy) {
    return { existingId: fuzzy.id, existingCanonicalKey: fuzzy.canonicalKey, upgraded: false };
  }

  return { existingId: null, existingCanonicalKey: null, upgraded: false };
}

// ─────────────────────────────  internals  ──────────────────────────────

/** Looks for a fuzzy-keyed paper that could be the same work (pass 2). */
async function findFuzzyMatchWithDoi(
  userId: string,
  paper: AdapterPaper,
  doi: string,
): Promise<{ id: string; canonicalKey: string } | null> {
  const normalised = normaliseTitleForMatch(paper.title);
  const year = publicationYear(paper.publicationDate ?? null);

  // Find any paper for this user with a fuzzy key and a similar title
  // Prisma maps these columns without @map, so they are camelCase and must be
  // quoted — unquoted identifiers are folded to lower case by Postgres.
  const candidates = await db.$queryRaw<Array<{ id: string; canonicalKey: string; publicationDate: Date | null }>>`
    SELECT id, "canonicalKey", "publicationDate"
    FROM "ResearchPaper"
    WHERE "userId" = ${userId}
      AND "canonicalKey" LIKE 'fuzzy:%'
      AND doi IS NULL
      AND similarity(normalise_title_for_match(title), ${normalised}) >= ${TITLE_SIMILARITY_THRESHOLD}
    LIMIT 5
  `;

  for (const c of candidates) {
    // Year-compatible guard (avoids merging two papers by the same authors in different years)
    const candidateYear = publicationYear(c.publicationDate);
    if (year && candidateYear && Math.abs(Number(year) - Number(candidateYear)) > PUBLICATION_YEAR_TOLERANCE) {
      continue;
    }
    return { id: c.id, canonicalKey: c.canonicalKey };
  }
  return null;
}

/** Pass 3 — pg_trgm similarity on title+year. */
async function findByTitleSimilarity(
  userId: string,
  paper: AdapterPaper,
): Promise<{ id: string; canonicalKey: string } | null> {
  const normalised = normaliseTitleForMatch(paper.title);
  const year = publicationYear(paper.publicationDate ?? null);

  const candidates = await db.$queryRaw<Array<{ id: string; canonicalKey: string; publicationDate: Date | null }>>`
    SELECT id, "canonicalKey", "publicationDate"
    FROM "ResearchPaper"
    WHERE "userId" = ${userId}
      AND similarity(normalise_title_for_match(title), ${normalised}) >= ${TITLE_SIMILARITY_THRESHOLD}
    ORDER BY similarity(normalise_title_for_match(title), ${normalised}) DESC
    LIMIT 3
  `;

  for (const c of candidates) {
    const candidateYear = publicationYear(c.publicationDate);
    if (year && candidateYear && Math.abs(Number(year) - Number(candidateYear)) > PUBLICATION_YEAR_TOLERANCE) {
      continue;
    }
    return { id: c.id, canonicalKey: c.canonicalKey };
  }
  return null;
}
