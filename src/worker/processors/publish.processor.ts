/**
 * Publish processor — publishes scheduled or approved drafts to LinkedIn.
 */

import type { Job } from 'bullmq';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { decryptAccessToken, postText, postWithImage } from '@/services/linkedin/client';
import { publishIdempotencyKey } from '@/lib/ids';
import { getStorage } from '@/lib/storage';

export interface PublishJobData {
  draftId: string;
  userId: string;
}

export async function processPublishJob(job: Job<PublishJobData>): Promise<void> {
  const { draftId, userId } = job.data;
  logger.info('Starting post publish to LinkedIn', { draftId, userId });

  const [draft, account] = await Promise.all([
    db.contentDraft.findUnique({
      where: { id: draftId },
      include: { visuals: true },
    }),
    db.linkedInAccount.findUnique({
      where: { userId },
    }),
  ]);

  if (!draft) {
    logger.warn('Draft not found for publishing', { draftId });
    return;
  }

  if (draft.status === 'PUBLISHED') {
    logger.info('Draft is already published — skipping duplicate publish', { draftId });
    return;
  }

  if (!account || account.status === 'EXPIRED') {
    await db.contentDraft.update({
      where: { id: draftId },
      data: { status: 'FAILED' },
    });
    logger.error('No active LinkedIn account found for user', { userId, draftId });
    throw new Error(`User ${userId} does not have an active LinkedIn connection`);
  }

  const accessToken = decryptAccessToken(account.accessTokenEnc);
  const idempotencyKey = publishIdempotencyKey(draft.id);
  const fullText = draft.hashtags.length > 0
    ? `${draft.body}\n\n${draft.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`
    : draft.body;

  try {
    let result;
    const primaryVisual = draft.visuals?.find((v) => v.isPrimary) ?? draft.visuals?.[0];

    if (primaryVisual && primaryVisual.storageKey) {
      // Fetch image bytes from S3
      const imageSignedUrl = await getStorage().getSignedUrl(primaryVisual.storageKey, 300);
      const imageResp = await fetch(imageSignedUrl);
      const arrayBuffer = await imageResp.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      result = await postWithImage({
        authorUrn: account.personUrn,
        accessToken,
        text: fullText,
        linkUrl: draft.linkUrl ?? undefined,
        idempotencyKey,
        imageBuffer,
        imageMimeType: 'image/png',
        altText: primaryVisual.altText || 'Research summary visual card',
      });
    } else {
      result = await postText({
        authorUrn: account.personUrn,
        accessToken,
        text: fullText,
        linkUrl: draft.linkUrl ?? undefined,
        idempotencyKey,
      });
    }

    await db.$transaction([
      db.contentDraft.update({
        where: { id: draftId },
        data: { status: 'PUBLISHED' },
      }),
      db.publishedPost.create({
        data: {
          draftId,
          accountId: account.id,
          idempotencyKey,
          linkedinUrn: result.urn,
          permalink: result.permalink,
          publishedAt: new Date(),
          apiSurface: result.surface,
          response: result.rawResponse as object,
        },
      }),
    ]);

    logger.info('Draft published successfully to LinkedIn', {
      draftId,
      urn: result.urn,
      surface: result.surface,
    });
  } catch (err) {
    logger.error('LinkedIn publishing failed', { draftId, err });
    await db.contentDraft.update({
      where: { id: draftId },
      data: { status: 'FAILED' },
    });
    throw err;
  }
}
