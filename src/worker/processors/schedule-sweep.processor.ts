/**
 * Schedule sweep processor — the reconciliation net for scheduled publishing.
 *
 * Two jobs, both idempotent and safe to run every minute:
 *
 *  1. **Publish what is due.** Any draft still `SCHEDULED` whose `scheduledFor`
 *     has passed is published. This is the backstop the approve route promises
 *     when it cannot enqueue a per-draft delayed job (Redis down), and the
 *     mechanism that publishes drafts auto-scheduled by AUTOMATIC approval.
 *     A short grace period lets the primary delayed job go first; the atomic
 *     claim inside `publishDraft` guarantees only one of them actually posts.
 *
 *  2. **Recover crashed locks.** A draft is moved to `PUBLISHING` before the
 *     LinkedIn call. If the worker is hard-killed mid-post, that draft is left
 *     locked forever. Any `PUBLISHING` draft that was approved long ago and has
 *     no published post is reset to `FAILED` so it surfaces to the user in the
 *     Failed tab instead of vanishing — never auto-reposted, to avoid ever
 *     sending a post twice.
 */

import type { Job } from 'bullmq';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { publishDraft } from '@/services/linkedin/publish';

/** Let the per-draft delayed job fire first; the sweeper is only the backstop. */
const DUE_GRACE_MS = 60_000;
/** A PUBLISHING draft older than this with no published post is a crashed lock. */
const STALE_LOCK_MS = 15 * 60_000;
/**
 * A draft still SCHEDULED this long after its time has passed is abandoned —
 * an account left disconnected, say. Give up and mark it FAILED so it surfaces
 * to the user instead of being retried (and logged) every minute forever.
 */
const ABANDON_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Bound the work per tick so one sweep cannot run unbounded. */
const MAX_PER_TICK = 50;

/**
 * The sweep itself, as a plain function so it can run in the BullMQ worker or
 * inline (e.g. on a page load) — scheduled posts must still go out for a user
 * who runs only the web app, not a separate worker.
 */
export async function runScheduleSweep(): Promise<void> {
  const now = Date.now();

  // 1) Recover crashed publish locks.
  const staleCutoff = new Date(now - STALE_LOCK_MS);
  const stale = await db.contentDraft.findMany({
    where: { status: 'PUBLISHING', approvedAt: { lt: staleCutoff }, published: { is: null } },
    select: { id: true },
    take: MAX_PER_TICK,
  });
  for (const draft of stale) {
    // Guarded so we never clobber a draft another worker has legitimately
    // moved on from between the read and the write.
    const reset = await db.contentDraft.updateMany({
      where: { id: draft.id, status: 'PUBLISHING' },
      data: { status: 'FAILED' },
    });
    if (reset.count > 0) {
      logger.warn('Reset a stale PUBLISHING lock to FAILED', { draftId: draft.id });
    }
  }

  // 2) Abandon posts that have been due for far too long (e.g. the account was
  //    disconnected and never reconnected). Marking them FAILED stops an
  //    endless minute-by-minute retry and puts them in the user's Failed tab.
  const abandonCutoff = new Date(now - ABANDON_AFTER_MS);
  const abandoned = await db.contentDraft.updateMany({
    where: { status: 'SCHEDULED', scheduledFor: { lt: abandonCutoff } },
    data: { status: 'FAILED' },
  });
  if (abandoned.count > 0) {
    logger.warn('Abandoned long-overdue scheduled drafts', { count: abandoned.count });
  }

  // 3) Publish everything whose scheduled time has passed (within the window).
  const dueCutoff = new Date(now - DUE_GRACE_MS);
  const due = await db.contentDraft.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledFor: { lte: dueCutoff, gte: abandonCutoff },
    },
    select: { id: true, userId: true },
    orderBy: { scheduledFor: 'asc' },
    take: MAX_PER_TICK,
  });

  if (due.length === 0) return;
  logger.info('Schedule sweep found due drafts', { count: due.length });

  for (const draft of due) {
    try {
      const outcome = await publishDraft({ draftId: draft.id, userId: draft.userId });
      // `in_progress` means the primary delayed job already claimed it — expected,
      // not an error. Anything else that failed is worth a line in the log.
      if (!outcome.ok && outcome.reason !== 'in_progress') {
        logger.warn('Schedule sweep could not publish a due draft', {
          draftId: draft.id,
          reason: outcome.reason,
          message: outcome.message,
        });
      }
    } catch (err) {
      // One bad draft must not stop the sweep for the rest.
      logger.error('Schedule sweep threw while publishing a draft', { draftId: draft.id, err });
    }
  }
}

export async function processScheduleSweepJob(_job: Job): Promise<void> {
  await runScheduleSweep();
}
