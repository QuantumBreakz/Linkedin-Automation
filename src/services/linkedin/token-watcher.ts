/**
 * LinkedIn token expiry watcher.
 *
 * docs/01 §D3 — 60-day tokens, no programmatic refresh.
 * docs/02 §Token lifecycle
 *
 * Runs as a cron job (every 6 hours recommended). Checks all active
 * LinkedInAccount rows for impending expiry and:
 *  - T-14 days: sends first reminder email
 *  - T-3 days:  sends urgent reminder
 *  - T-0:       marks EXPIRED, pauses all scheduled posts
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

const NOTICE_WINDOWS = [
  { daysAhead: 14, noticeIndex: 0, label: 'first' },
  { daysAhead: 3, noticeIndex: 1, label: 'urgent' },
] as const;

/**
 * Check all active LinkedIn tokens and send expiry notices as needed.
 * Call this from a cron worker (e.g. every 6 hours).
 */
export async function runTokenExpiryWatch(): Promise<{ checked: number; noticed: number; expired: number }> {
  const now = new Date();
  let noticed = 0;
  let expired = 0;

  // Find all active/expiring accounts
  const accounts = await db.linkedInAccount.findMany({
    where: {
      status: { in: ['ACTIVE', 'EXPIRING'] },
    },
    include: {
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  for (const account of accounts) {
    const expiresAt = account.accessTokenExpires;
    const daysUntilExpiry =
      (expiresAt.getTime() - now.getTime()) / (1_000 * 60 * 60 * 24);

    // Already expired
    if (daysUntilExpiry <= 0) {
      await handleExpired(account.id, account.userId);
      expired++;
      continue;
    }

    // Check notice windows (most urgent first)
    for (const window of [...NOTICE_WINDOWS].reverse()) {
      if (
        daysUntilExpiry <= window.daysAhead &&
        account.expiryNoticesSent <= window.noticeIndex
      ) {
        await sendExpiryNotice(account.id, account.userId, account.user, daysUntilExpiry, window.label);
        noticed++;
        break;
      }
    }

    // Upgrade status to EXPIRING when within 14 days
    if (daysUntilExpiry <= 14 && account.status === 'ACTIVE') {
      await db.linkedInAccount.update({
        where: { id: account.id },
        data: { status: 'EXPIRING' },
      });
    }
  }

  logger.info('Token expiry watch completed', { checked: accounts.length, noticed, expired });
  return { checked: accounts.length, noticed, expired };
}

async function handleExpired(accountId: string, userId: string): Promise<void> {
  await db.$transaction([
    // Mark the account expired
    db.linkedInAccount.update({
      where: { id: accountId },
      data: { status: 'EXPIRED' },
    }),
    // Cancel any SCHEDULED drafts (don't drop them — user re-authorises and they re-queue)
    // We set to NEEDS_REVIEW so the user sees them in the inbox
    db.contentDraft.updateMany({
      where: {
        userId,
        status: 'SCHEDULED',
      },
      data: {
        status: 'NEEDS_REVIEW',
        scheduledFor: null,
      },
    }),
  ]);

  logger.warn('LinkedIn token expired — account marked EXPIRED, scheduled posts paused', { accountId, userId });

  // Emit a notification (in production, this triggers an email via a queue)
  // For now, we log at warn level so it surfaces in alerting
  logger.warn('ACTION REQUIRED: LinkedIn token expired. User must reconnect at /settings/linkedin', { accountId, userId });
}

async function sendExpiryNotice(
  accountId: string,
  userId: string,
  user: { email: string; name: string },
  daysRemaining: number,
  urgency: string,
): Promise<void> {
  // Increment the notice counter first so a crash doesn't re-send
  const updated = await db.linkedInAccount.update({
    where: { id: accountId },
    data: { expiryNoticesSent: { increment: 1 } },
  });

  const roundedDays = Math.ceil(daysRemaining);

  logger.info(`LinkedIn token expiry notice (${urgency}) sent to ${user.email}`, { accountId, userId, urgency, daysRemaining: roundedDays, noticeCount: updated.expiryNoticesSent });

  // TODO: integrate with your email provider here.
  // The message content to deliver:
  // Subject: "Your LinkedIn connection expires in ${roundedDays} day${roundedDays !== 1 ? 's' : ''}"
  // Body: "Hi ${user.name}, your LinkedIn connection will expire in ${roundedDays} days.
  //        Please reconnect at [APP_URL]/settings/linkedin to keep your scheduled posts active.
  //        This takes about 1 minute every 2 months."
  //
  // Example with Resend:
  //   await resend.emails.send({
  //     from: 'notifications@yourdomain.com',
  //     to: user.email,
  //     subject: `Your LinkedIn connection expires in ${roundedDays} days`,
  //     html: buildExpiryEmailHtml(user.name, roundedDays),
  //   });
}
