/**
 * GET /api/chat/tabs — the signed-in user's open chat tabs + active tab.
 * PUT /api/chat/tabs — save them.
 *
 * This replaces the browser-localStorage tab state, so the workspace a user
 * left open follows them to any device. The ids are opaque UI state; the
 * workspace filters them against the user's own conversations on load, so a
 * stale or foreign id can never surface another account's thread.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser, badRequest } from '@/lib/session';
import { getChatTabs, setChatTabs } from '@/services/chat/chat';

const TabsSchema = z.object({
  openIds: z.array(z.string().max(64)).max(20),
  activeId: z.string().max(64).nullable(),
});

export async function GET(): Promise<NextResponse> {
  return withUser(async (userId) => {
    return NextResponse.json(await getChatTabs(userId));
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const parsed = TabsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid tab state.');
    }
    await setChatTabs(userId, parsed.data);
    return NextResponse.json({ ok: true });
  });
}
