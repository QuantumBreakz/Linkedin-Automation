/**
 * GET  /api/chat/conversations — the signed-in user's threads.
 * POST /api/chat/conversations — start a new one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withUser } from '@/lib/session';
import { listConversations, createConversation } from '@/services/chat/chat';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const includeArchived = new URL(req.url).searchParams.get('archived') === 'true';
    const conversations = await listConversations(userId, includeArchived);
    return NextResponse.json({
      conversations: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        archived: c.archived,
        lastMessageAt: c.lastMessageAt,
        messageCount: c._count.messages,
        preview: c.messages[0]?.content.slice(0, 120) ?? '',
      })),
    });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const conversation = await createConversation(userId, body.title);
    return NextResponse.json({ conversation }, { status: 201 });
  });
}
