import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withUser } from '@/lib/session';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { searchParams } = new URL(req.url);
    const topic = searchParams.get('topic');
    const search = searchParams.get('search');

    const papers = await db.researchPaper.findMany({
      where: {
        userId,
        dismissed: false,
        ...(topic ? { topics: { has: topic } } : {}),
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: 'insensitive' } },
                { abstract: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        authors: { orderBy: { position: 'asc' } },
        analyses: { take: 1, orderBy: { createdAt: 'desc' } },
        drafts: {
          select: { id: true, status: true, format: true, verificationStatus: true },
        },
      },
      orderBy: { discoveredAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ papers });
  });
}
