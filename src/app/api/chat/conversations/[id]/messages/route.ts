/**
 * GET  /api/chat/conversations/:id/messages — the thread.
 * POST /api/chat/conversations/:id/messages — send a turn, get the reply.
 *
 * The POST waits for the model rather than streaming. Replies here are short
 * enough that the wait is a second or two, and a plain request keeps the
 * transcript authoritative: what is on screen is what is in the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withUser, notFound, badRequest } from '@/lib/session';
import {
  getConversation,
  listMessages,
  sendMessage,
  MAX_CHAT_MESSAGE_LENGTH,
} from '@/services/chat/chat';

const SendSchema = z.object({
  content: z.string().trim().min(1, 'Type a message first.').max(MAX_CHAT_MESSAGE_LENGTH),
});

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;
    const conversation = await getConversation(userId, id);
    if (!conversation) return notFound('Conversation');
    return NextResponse.json({ messages: await listMessages(userId, id) });
  });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;

    const parsed = SendSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid message.');
    }

    const result = await sendMessage({ userId, conversationId: id, content: parsed.data.content });
    if (!result) return notFound('Conversation');

    return NextResponse.json(result, { status: 201 });
  });
}
