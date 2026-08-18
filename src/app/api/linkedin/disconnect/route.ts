/**
 * POST /api/linkedin/disconnect — sever the LinkedIn connection.
 *
 * Non-destructive on purpose: the account row (and the published-post history
 * that cascades from it) is kept, but its status is set to REVOKED so nothing
 * can publish through it — every publish path refuses a non-ACTIVE account.
 * Reconnecting through the OAuth flow re-activates the same row with fresh
 * tokens. `updateMany` makes a missing account a no-op rather than a 404.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withUser } from '@/lib/session';
import { logger } from '@/lib/logger';

export async function POST(): Promise<NextResponse> {
  return withUser(async (userId) => {
    const result = await db.linkedInAccount.updateMany({
      where: { userId },
      data: { status: 'REVOKED', refreshTokenEnc: null },
    });
    logger.info('LinkedIn account disconnected', { userId, updated: result.count });
    return NextResponse.json({ ok: true, disconnected: result.count > 0 });
  });
}
