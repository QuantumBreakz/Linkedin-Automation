import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { postPublishQueue } from '@/worker/queues';

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await props.params;

  const draft = await db.contentDraft.findFirst({
    where: { id, userId: session.user.id },
    include: {
      paper: {
        include: {
          authors: { orderBy: { position: 'asc' } },
        },
      },
      analysis: true,
      visuals: true,
      published: true,
    },
  });

  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  return NextResponse.json({ draft });
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await props.params;
  const body = await req.json();

  const draft = await db.contentDraft.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  const updated = await db.contentDraft.update({
    where: { id },
    data: {
      ...(body.body ? { body: body.body, editedByUser: true } : {}),
      ...(body.hashtags ? { hashtags: body.hashtags } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.scheduledFor ? { scheduledFor: new Date(body.scheduledFor) } : {}),
      ...(body.status === 'APPROVED' ? { approvedAt: new Date() } : {}),
    },
  });

  return NextResponse.json({ draft: updated });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await props.params;
  const { action } = await req.json().catch(() => ({ action: 'publish' }));

  const draft = await db.contentDraft.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  }

  if (action === 'publish') {
    await postPublishQueue.add(`publish-${draft.id}`, {
      draftId: draft.id,
      userId: session.user.id,
    });

    return NextResponse.json({ success: true, message: 'Publish job queued' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
