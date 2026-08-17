import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withUser, badRequest } from '@/lib/session';

const BrandSchema = z.object({
  tone: z.enum(['PROFESSIONAL', 'CONVERSATIONAL', 'ACADEMIC', 'ENTHUSIASTIC']).optional(),
  technicality: z.enum(['BEGINNER', 'INTERMEDIATE', 'EXPERT']).optional(),
  postLength: z.enum(['SHORT', 'MEDIUM', 'LONG']).optional(),
  emojiUsage: z.enum(['NONE', 'LOW', 'MODERATE']).optional(),
  ctaEnabled: z.boolean().optional(),
  hashtagsEnabled: z.boolean().optional(),
  firstPerson: z.boolean().optional(),
  customInstructions: z.string().max(2000).nullable().optional(),
});

export async function GET(): Promise<NextResponse> {
  return withUser(async (userId) => {
    const brand = await db.brandProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });

    const linkedin = await db.linkedInAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        personUrn: true,
        displayName: true,
        avatarUrl: true,
        status: true,
        accessTokenExpires: true,
      },
    });

    return NextResponse.json({ brand, linkedin });
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const parsed = BrandSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid voice profile.');
    }

    const brand = await db.brandProfile.upsert({
      where: { userId },
      create: { userId, ...parsed.data },
      update: parsed.data,
    });

    return NextResponse.json({ brand });
  });
}
