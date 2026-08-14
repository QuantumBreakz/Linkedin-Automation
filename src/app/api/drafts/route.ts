import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import type { DraftStatus } from '@prisma/client';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as DraftStatus | null;

  const drafts = await db.contentDraft.findMany({
    where: {
      userId: session.user.id,
      ...(status ? { status } : {}),
    },
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          venue: true,
          landingUrl: true,
          doi: true,
          authors: { take: 3 },
        },
      },
      visuals: {
        where: { isPrimary: true },
        take: 1,
      },
      published: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json({ drafts });
}
