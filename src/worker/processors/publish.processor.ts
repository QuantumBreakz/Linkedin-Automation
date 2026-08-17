/**
 * Publish processor — posts approved/scheduled drafts to LinkedIn.
 *
 * The work itself lives in `@/services/linkedin/publish` so that the API route
 * behind the Approve button and this background job cannot drift apart. This
 * file is only the BullMQ adapter: unwrap the job, call the service, and turn
 * a failed outcome into a thrown error so BullMQ retries it.
 */

import type { Job } from 'bullmq';
import { logger } from '@/lib/logger';
import { publishDraft } from '@/services/linkedin/publish';

export interface PublishJobData {
  draftId: string;
  userId: string;
}

/** Outcomes where retrying cannot help — a retry would just burn attempts. */
const TERMINAL = new Set(['draft_not_found', 'not_approved', 'no_linkedin_account', 'in_progress']);

export async function processPublishJob(job: Job<PublishJobData>): Promise<void> {
  const { draftId, userId } = job.data;
  logger.info('Starting post publish to LinkedIn', { draftId, userId });

  const outcome = await publishDraft({ draftId, userId });

  if (outcome.ok) return;

  if (TERMINAL.has(outcome.reason)) {
    logger.warn('Publish job stopped without posting', {
      draftId,
      userId,
      reason: outcome.reason,
      message: outcome.message,
    });
    return;
  }

  throw new Error(`Publish failed for draft ${draftId}: ${outcome.message}`);
}
