/**
 * Paper ingest worker — BullMQ `paper.ingest` queue consumer.
 *
 * Receives a paper from a source adapter and:
 *  1. Deduplicates against existing ResearchPaper rows
 *  2. Creates or updates the paper record
 *  3. Adds a PaperSourceLink
 *  4. Retraction gate (blocks paper from appearing in inbox)
 *  5. Queues analysis if the paper is new and has enough content
 *
 * docs/08-mvp-plan.md §M2 exit criteria
 */

import type { AdapterPaper } from '../sources/adapter';
import { checkDuplicate } from '../sources/dedup';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  canonicalKeyFor,
  normaliseDoi,
  normaliseArxivId,
  normalisePmid,
  normalisePmcid,
} from '@/lib/ids';

// ──────────────────────────  job payload  ───────────────────────────

export interface IngestJobData {
  userId: string;
  sourceId: string;
  paper: AdapterPaper;
}

// ──────────────────────────  result  ────────────────────────────────

export interface IngestResult {
  action: 'created' | 'updated' | 'skipped';
  paperId: string | null;
  reason?: string;
}

// ──────────────────────────  worker  ────────────────────────────────

export async function processIngestJob(data: IngestJobData): Promise<IngestResult> {
  const { userId, sourceId, paper } = data;

  // ── Retraction gate ────────────────────────────────────────────────
  if (paper.isRetracted) {
    logger.info('Skipping retracted paper', { userId, title: paper.title, doi: paper.doi });

    // If the paper already exists, update its retraction flag
    const canonicalKey = canonicalKeyFor({
      ids: { doi: paper.doi, openalexId: paper.openalexId, arxivId: paper.arxivId, pmid: paper.pmid, pmcid: paper.pmcid },
      title: paper.title,
      authors: paper.authors,
      publicationDate: paper.publicationDate ?? undefined,
    });

    const existing = await db.researchPaper.findUnique({
      where: { userId_canonicalKey: { userId, canonicalKey } },
    });

    if (existing && !existing.isRetracted) {
      await db.researchPaper.update({
        where: { id: existing.id },
        data: { isRetracted: true, retractionCheckedAt: new Date() },
      });
      logger.warn('Marked existing paper as retracted', { paperId: existing.id });
    }

    return { action: 'skipped', paperId: existing?.id ?? null, reason: 'retracted' };
  }

  // ── Deduplication ─────────────────────────────────────────────────
  const dedup = await checkDuplicate(userId, paper);

  if (dedup.existingId) {
    // Add source link if missing
    await db.paperSourceLink.upsert({
      where: {
        paperId_sourceId: { paperId: dedup.existingId, sourceId },
      },
      create: {
        paperId: dedup.existingId,
        sourceId,
        externalId: paper.openalexId ?? paper.arxivId ?? paper.pmid ?? null,
      },
      update: {},
    });

    logger.debug('Paper already exists — added source link', { paperId: dedup.existingId, upgraded: dedup.upgraded });

    return { action: dedup.upgraded ? 'updated' : 'skipped', paperId: dedup.existingId };
  }

  // ── Create new paper ──────────────────────────────────────────────
  const canonicalKey = canonicalKeyFor({
    ids: { doi: paper.doi, openalexId: paper.openalexId, arxivId: paper.arxivId, pmid: paper.pmid, pmcid: paper.pmcid },
    title: paper.title,
    authors: paper.authors,
    publicationDate: paper.publicationDate ?? undefined,
  });

  const doi = normaliseDoi(paper.doi);
  const arxivId = normaliseArxivId(paper.arxivId);
  const pmid = normalisePmid(paper.pmid);
  const pmcid = normalisePmcid(paper.pmcid);

  // Determine full-text status
  const fullTextStatus = paper.oaPdfUrl ? 'OA_PDF' : paper.abstract ? 'ABSTRACT_ONLY' : 'UNKNOWN';

  // Parse publication date
  let publicationDate: Date | undefined;
  if (paper.publicationDate) {
    const parsed = new Date(paper.publicationDate);
    if (!isNaN(parsed.getTime())) publicationDate = parsed;
  }

  const newPaper = await db.$transaction(async (tx) => {
    const created = await tx.researchPaper.create({
      data: {
        userId,
        canonicalKey,
        doi,
        openalexId: paper.openalexId,
        arxivId,
        pmid,
        pmcid,
        title: paper.title,
        abstract: paper.abstract,
        publicationDate,
        venue: paper.venue,
        landingUrl: paper.landingUrl,
        oaPdfUrl: paper.oaPdfUrl,
        topics: paper.topics,
        citedByCount: paper.citedByCount,
        isRetracted: paper.isRetracted,
        retractionCheckedAt: new Date(),
        fullTextStatus,
        raw: paper.raw as object,
        authors: {
          create: paper.authors.map((a) => ({
            name: a.name,
            orcid: a.orcid,
            position: a.position,
            // isUser: set downstream by author-attribution job
          })),
        },
      },
    });

    await tx.paperSourceLink.create({
      data: {
        paperId: created.id,
        sourceId,
        externalId: paper.openalexId ?? paper.arxivId ?? paper.pmid ?? null,
      },
    });

    return created;
  });

  logger.info('New paper ingested', { paperId: newPaper.id, canonicalKey, userId });

  return { action: 'created', paperId: newPaper.id };
}
