/**
 * One conversation: read, rename/pin/archive, delete.
 *
 * Every query is filtered by `userId` as well as `id`, and a thread belonging
 * to somebody else answers 404 — not 403 — so ids cannot be probed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withUser, notFound, badRequest } from '@/lib/session';
import { getConversation, listMessages } from '@/services/chat/chat';

const PatchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;
    const conversation = await getConversation(userId, id);
    if (!conversation) return notFound('Conversation');

    const messages = await listMessages(userId, id);
    return NextResponse.json({ conversation, messages });
  });
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;
    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest('Invalid conversation update.');

    // updateMany, not update: it takes a WHERE that includes userId, so a
    // mismatched owner updates zero rows instead of somebody else's thread.
    const result = await db.chatConversation.updateMany({
      where: { id, userId },
      data: parsed.data,
    });
    if (result.count === 0) return notFound('Conversation');

    const conversation = await getConversation(userId, id);
    return NextResponse.json({ conversation });
  });
}

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;
    const result = await db.chatConversation.deleteMany({ where: { id, userId } });
    if (result.count === 0) return notFound('Conversation');
    return NextResponse.json({ success: true });
  });
}
