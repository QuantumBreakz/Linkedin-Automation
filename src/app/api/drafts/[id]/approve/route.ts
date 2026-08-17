/**
 * POST /api/drafts/:id/approve — the approval gate in front of every post.
 *
 * Nothing reaches a member's LinkedIn feed without passing through here. The
 * UI shows the exact text and image that will be posted (see
 * `PostPreview`), and this route is what that Approve button calls.
 *
 * Three modes, all explicit — the client says which one it wants:
 *
 *   { "mode": "publish" }                     → approve and post right now
 *   { "mode": "schedule", "scheduledFor": … } → approve and queue for a time
 *   { "mode": "approve" }                     → approve only; post later
 *
 * "publish" is awaited rather than queued so the response can carry the real
 * result. A LinkedIn rejection shows up as an error on the button that caused
 * it, not as a job that quietly fails minutes later.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withUser, notFound, badRequest } from '@/lib/session';
import { publishDraft } from '@/services/linkedin/publish';
import { postPublishQueue } from '@/worker/queues';
import { logger } from '@/lib/logger';

const ApproveSchema = z.object({
  mode: z.enum(['approve', 'publish', 'schedule']).default('approve'),
  scheduledFor: z.string().datetime().optional(),
  /** Last-second edits made in the preview pane, applied before posting. */
  body: z.string().trim().min(1).max(3000).optional(),
  hashtags: z.array(z.string().trim().max(60)).max(15).optional(),
});

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;

    const parsed = ApproveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid approval request.');
    }
    const { mode, scheduledFor, body, hashtags } = parsed.data;

    const draft = await db.contentDraft.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!draft) return notFound('Draft');

    if (draft.status === 'PUBLISHED') {
      return badRequest('That draft has already been published.');
    }

    if (mode === 'schedule' && !scheduledFor) {
      return badRequest('A publish time is required to schedule a post.');
    }

    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
    if (scheduledDate && scheduledDate.getTime() <= Date.now()) {
      return badRequest('Pick a publish time in the future.');
    }

    await db.contentDraft.update({
      where: { id: draft.id },
      data: {
        ...(body ? { body, editedByUser: true } : {}),
        ...(hashtags ? { hashtags } : {}),
        status: mode === 'schedule' ? 'SCHEDULED' : 'APPROVED',
        approvedAt: new Date(),
        ...(scheduledDate ? { scheduledFor: scheduledDate } : {}),
      },
    });

    if (mode === 'approve') {
      return NextResponse.json({ status: 'APPROVED', message: 'Approved. Ready to publish.' });
    }

    if (mode === 'schedule' && scheduledDate) {
      try {
        // Rescheduling reuses the same jobId, and BullMQ silently ignores an
        // add() whose jobId already exists — so without removing the previous
        // job first, a re-scheduled post would keep firing at its *old* time
        // while the UI showed the new one. Remove, then add the fresh delay.
        await postPublishQueue.remove(`publish-${draft.id}`).catch(() => {});
        await postPublishQueue.add(
          `publish-${draft.id}`,
          { draftId: draft.id, userId },
          { delay: Math.max(0, scheduledDate.getTime() - Date.now()), jobId: `publish-${draft.id}` },
        );
      } catch (err) {
        // Redis down should not silently swallow a scheduled post. The draft
        // stays SCHEDULED and the schedule sweeper (schedule.sweep, every
        // minute) publishes it once its time passes.
        logger.error('Could not enqueue scheduled publish', { draftId: draft.id, err });
        return NextResponse.json(
          {
            status: 'SCHEDULED',
            queued: false,
            message: 'Approved and scheduled, but the job queue is unreachable right now.',
          },
          { status: 202 },
        );
      }

      return NextResponse.json({
        status: 'SCHEDULED',
        queued: true,
        scheduledFor: scheduledDate.toISOString(),
        message: `Approved. Publishing ${scheduledDate.toUTCString()}.`,
      });
    }

    const outcome = await publishDraft({ draftId: draft.id, userId });

    if (!outcome.ok) {
      const status = outcome.reason === 'draft_not_found' ? 404 : 400;
      return NextResponse.json({ error: outcome.message, reason: outcome.reason }, { status });
    }

    return NextResponse.json({
      status: 'PUBLISHED',
      alreadyPublished: outcome.alreadyPublished,
      permalink: outcome.permalink,
      urn: outcome.urn,
      dryRun: outcome.dryRun,
      // Dry run says so plainly. Reporting "Published to LinkedIn" when
      // LINKEDIN_DRY_RUN blocked the call would be a lie the user acts on.
      message: outcome.dryRun
        ? 'Recorded as published — but LINKEDIN_DRY_RUN is on, so nothing was sent to LinkedIn.'
        : outcome.alreadyPublished
          ? 'That draft was already live on LinkedIn.'
          : 'Published to LinkedIn.',
    });
  });
}
