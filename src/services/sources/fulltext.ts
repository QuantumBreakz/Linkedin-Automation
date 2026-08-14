/**
 * Full-text resolution and retrieval service.
 *
 * Resolves Open Access full-text via Unpaywall, Europe PMC, or direct OA PDF URLs.
 * Stores downloaded full-text assets in Object Storage (S3).
 */

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { getStorage, fullTextObjectKey } from '@/lib/storage';
import { db } from '@/lib/db';
import type { FullTextStatus } from '@prisma/client';

export interface FullTextResolutionResult {
  status: FullTextStatus;
  storageKey: string | null;
  textSnippet: string | null;
}

const UNPAYWALL_BASE = 'https://api.unpaywall.org/v2';

/**
 * Resolves and downloads full-text for a research paper.
 */
export async function resolveFullText(
  userId: string,
  paperId: string,
  doi: string | null,
  oaPdfUrl: string | null,
): Promise<FullTextResolutionResult> {
  let targetPdfUrl: string | null = oaPdfUrl;

  // If no direct PDF URL, query Unpaywall
  if (!targetPdfUrl && doi) {
    try {
      const resp = await fetch(
        `${UNPAYWALL_BASE}/${encodeURIComponent(doi)}?email=${encodeURIComponent(env.CONTACT_EMAIL)}`,
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          is_oa?: boolean;
          best_oa_location?: { url_for_pdf?: string; url?: string };
        };
        if (data.is_oa && data.best_oa_location) {
          targetPdfUrl = data.best_oa_location.url_for_pdf ?? data.best_oa_location.url ?? null;
        }
      }
    } catch (err) {
      logger.warn('Unpaywall resolution failed', { doi, err });
    }
  }

  if (!targetPdfUrl) {
    return { status: 'ABSTRACT_ONLY', storageKey: null, textSnippet: null };
  }

  try {
    const pdfResp = await fetch(targetPdfUrl, {
      headers: {
        'User-Agent': `${env.APP_NAME} (${env.CONTACT_EMAIL})`,
      },
    });

    if (!pdfResp.ok) {
      return { status: 'FETCH_FAILED', storageKey: null, textSnippet: null };
    }

    const arrayBuffer = await pdfResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const storageKey = fullTextObjectKey(userId, paperId, 'pdf');

    await getStorage().putObject(storageKey, buffer, 'application/pdf');

    await db.researchPaper.update({
      where: { id: paperId },
      data: {
        fullTextStatus: 'OA_PDF',
        fullTextKey: storageKey,
      },
    });

    logger.info('Saved full-text PDF to object storage', { paperId, storageKey, bytes: buffer.length });

    return {
      status: 'OA_PDF',
      storageKey,
      textSnippet: null,
    };
  } catch (err) {
    logger.warn('Failed to fetch full-text PDF', { paperId, targetPdfUrl, err });
    return { status: 'FETCH_FAILED', storageKey: null, textSnippet: null };
  }
}
