/**
 * Publishing a draft to LinkedIn.
 *
 * The single implementation behind both entry points:
 *
 *  - the `post.publish` BullMQ processor, for scheduled posts;
 *  - `POST /api/drafts/:id/approve` with `publishNow`, which awaits this
 *    directly so the person who just clicked "Approve & publish" is told
 *    whether it worked instead of watching a spinner and hoping.
 *
 * Two invariants the caller cannot opt out of:
 *
 *  1. **Ownership.** The draft is loaded with `userId` in the WHERE clause and
 *     the LinkedIn account is looked up from that same id. A draft can only
 *     ever be posted to its own owner's feed.
 *  2. **Approval.** A draft that the user has not approved is never posted.
 *     `AUTOMATIC` approval mode is applied when the draft is created, not
 *     here — by the time anything reaches this function, a human (or an
 *     explicit account-level setting) has said yes.
 */

import { env } from '@/lib/env';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordStage } from '@/lib/stage';
import { publishIdempotencyKey } from '@/lib/ids';
import { getStorage } from '@/lib/storage';
import { decryptAccessToken, postText, postWithImage } from '@/services/linkedin/client';

export type PublishFailureReason =
  | 'draft_not_found'
  | 'not_approved'
  | 'no_linkedin_account'
  | 'in_progress'
  | 'linkedin_error';

export type PublishOutcome =
  | {
      ok: true;
      alreadyPublished: boolean;
      urn: string | null;
      permalink: string | null;
      /** True when LINKEDIN_DRY_RUN blocked the real API call. */
      dryRun: boolean;
    }
  | { ok: false; reason: PublishFailureReason; message: string };

/**
 * Statuses from which publishing is legitimate.
 *
 * FAILED is included so a transient failure can be re-driven: BullMQ's own
 * retries (attempts: 3) land on a draft whose catch block set it to FAILED, and
 * a user can retry a failed post. This is safe because the atomic claim below,
 * plus the deterministic idempotency key, make a second successful post
 * impossible. PUBLISHING is here so an in-flight draft reads as "legitimately
 * publishing" — the claim then declines it (a live lock is left alone; a
 * crashed one is swept back to FAILED).
 */
const PUBLISHABLE = new Set(['APPROVED', 'SCHEDULED', 'PUBLISHING', 'FAILED']);

export async function publishDraft(args: {
  draftId: string;
  userId: string;
}): Promise<PublishOutcome> {
  const { draftId, userId } = args;

  const draft = await db.contentDraft.findFirst({
    where: { id: draftId, userId },
    include: { visuals: true },
  });

  if (!draft) {
    logger.warn('Publish requested for a draft the user does not own', { draftId, userId });
    return { ok: false, reason: 'draft_not_found', message: 'Draft not found.' };
  }

  if (draft.status === 'PUBLISHED') {
    const existing = await db.publishedPost.findUnique({ where: { draftId } });
    return {
      ok: true,
      alreadyPublished: true,
      urn: existing?.linkedinUrn ?? null,
      permalink: existing?.permalink ?? null,
      dryRun: existing?.apiSurface === 'dry-run',
    };
  }

  if (!PUBLISHABLE.has(draft.status)) {
    return {
      ok: false,
      reason: 'not_approved',
      message: 'This draft has not been approved yet, so it was not posted.',
    };
  }

  const account = await db.linkedInAccount.findUnique({ where: { userId } });

  if (!account || account.status === 'EXPIRED' || account.status === 'REVOKED') {
    // The draft keeps its status. Nothing was attempted, so marking it FAILED
    // would make an unconnected account look like a rejected post — and would
    // force the user to redo an approval they already gave.
    return {
      ok: false,
      reason: 'no_linkedin_account',
      message: 'Connect a LinkedIn account in Settings before publishing.',
    };
  }

  // Atomically claim the draft for publishing. This single conditional write is
  // the duplicate guard: three callers race for the same draft — the Approve
  // button, the per-draft delayed job, and the schedule sweeper — and exactly
  // one can move it out of a claimable state into PUBLISHING. The losers get
  // count === 0 and back off below, so a post is never sent twice.
  //
  // FAILED is claimable so a BullMQ retry (which lands on a draft its own catch
  // block set to FAILED) can re-drive it. PUBLISHING is deliberately *not*
  // claimable here — a live lock is left alone; a crashed one is swept back to
  // FAILED by the schedule sweeper after a grace period.
  const claim = await db.contentDraft.updateMany({
    where: { id: draftId, userId, status: { in: ['APPROVED', 'SCHEDULED', 'FAILED'] } },
    data: { status: 'PUBLISHING' },
  });

  if (claim.count === 0) {
    const fresh = await db.contentDraft.findFirst({
      where: { id: draftId, userId },
      select: { status: true },
    });
    if (fresh?.status === 'PUBLISHED') {
      const existing = await db.publishedPost.findUnique({ where: { draftId } });
      return {
        ok: true,
        alreadyPublished: true,
        urn: existing?.linkedinUrn ?? null,
        permalink: existing?.permalink ?? null,
        dryRun: existing?.apiSurface === 'dry-run',
      };
    }
    // Someone else holds the lock right now. Not an error — just not ours.
    return {
      ok: false,
      reason: 'in_progress',
      message: 'This draft is already being published.',
    };
  }

  const accessToken = decryptAccessToken(account.accessTokenEnc);
  const idempotencyKey = publishIdempotencyKey(draft.id);
  const fullText =
    draft.hashtags.length > 0
      ? `${draft.body}\n\n${draft.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`
      : draft.body;

  try {
    let result;
    const validVisuals = draft.visuals.filter((v) => Boolean(v.storageKey));

    if (validVisuals.length > 0) {
      const imageItems: Array<{
        imageBuffer: Buffer;
        imageMimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
        altText: string;
      }> = [];

      for (const visual of validVisuals.slice(0, 10)) {
        if (!visual.storageKey) continue;
        let imageBuffer: Buffer;
        try {
          imageBuffer = await getStorage().getObject(visual.storageKey);
        } catch {
          const imageSignedUrl = await getStorage().getSignedUrl(visual.storageKey, 300);
          const fetchUrl = imageSignedUrl.startsWith('/') ? `${env.APP_URL}${imageSignedUrl}` : imageSignedUrl;
          const imageResp = await fetch(fetchUrl);
          imageBuffer = Buffer.from(await imageResp.arrayBuffer());
        }

        const mimeType = visual.storageKey.endsWith('.jpg') || visual.storageKey.endsWith('.jpeg')
          ? 'image/jpeg'
          : visual.storageKey.endsWith('.webp')
            ? 'image/webp'
            : visual.storageKey.endsWith('.gif')
              ? 'image/gif'
              : 'image/png';

        imageItems.push({
          imageBuffer,
          imageMimeType: mimeType,
          altText: visual.altText || 'Post image',
        });
      }

      if (imageItems.length > 0) {
        result = await postWithImage({
          authorUrn: account.personUrn,
          accessToken,
          text: fullText,
          linkUrl: draft.linkUrl ?? undefined,
          idempotencyKey,
          imageBuffer: imageItems[0].imageBuffer,
          imageMimeType: imageItems[0].imageMimeType,
          altText: imageItems[0].altText,
          images: imageItems,
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
      db.contentDraft.update({ where: { id: draftId }, data: { status: 'PUBLISHED' } }),
      db.publishedPost.upsert({
        where: { draftId },
        create: {
          draftId,
          accountId: account.id,
          idempotencyKey,
          linkedinUrn: result.urn,
          permalink: result.permalink,
          publishedAt: new Date(),
          apiSurface: result.surface,
          response: result.rawResponse as object,
        },
        update: {
          linkedinUrn: result.urn,
          permalink: result.permalink,
          publishedAt: new Date(),
          apiSurface: result.surface,
          response: result.rawResponse as object,
        },
      }),
    ]);

    logger.info('Draft published to LinkedIn', { draftId, urn: result.urn, surface: result.surface });
    await recordStage('publish', { refType: 'draft', refId: draftId }, {
      ok: true,
      detail: result.surface === 'dry-run' ? 'published (dry-run)' : `published via ${result.surface}`,
    });
    return {
      ok: true,
      alreadyPublished: false,
      urn: result.urn,
      permalink: result.permalink,
      dryRun: result.surface === 'dry-run',
    };
  } catch (err) {
    logger.error('LinkedIn publishing failed', { draftId, err });
    await db.contentDraft.update({ where: { id: draftId }, data: { status: 'FAILED' } });
    await recordStage('publish', { refType: 'draft', refId: draftId }, {
      ok: false,
      detail: err instanceof Error ? err.message : 'LinkedIn rejected the post.',
    });
    return {
      ok: false,
      reason: 'linkedin_error',
      message: err instanceof Error ? err.message : 'LinkedIn rejected the post.',
    };
  }
}
