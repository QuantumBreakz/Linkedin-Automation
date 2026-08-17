import { NextRequest, NextResponse } from 'next/server';
import { DraftStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { withUser } from '@/lib/session';

const STATUSES = new Set(Object.values(DraftStatus) as string[]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const raw = new URL(req.url).searchParams.get('status');
    // Only a known enum value reaches the query.
    const status = raw && STATUSES.has(raw) ? (raw as DraftStatus) : undefined;

    const drafts = await db.contentDraft.findMany({
      where: { userId, ...(status ? { status } : {}) },
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
        visuals: { where: { isPrimary: true }, take: 1 },
        published: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ drafts });
  });
}
