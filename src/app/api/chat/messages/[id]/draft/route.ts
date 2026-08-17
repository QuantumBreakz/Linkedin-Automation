/**
 * POST /api/chat/messages/:id/draft — save an assistant reply as a post draft.
 *
 * The draft lands in NEEDS_REVIEW, which means it still has to pass through
 * the preview-and-approve screen before anything is posted. Chat is a faster
 * way to write a post, never a way around the approval gate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withUser, notFound } from '@/lib/session';
import { draftFromMessage } from '@/services/chat/chat';

export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;
    const result = await draftFromMessage({ userId, messageId: id });
    if (!result) return notFound('Message');
    return NextResponse.json({ draftId: result.draftId }, { status: 201 });
  });
}
