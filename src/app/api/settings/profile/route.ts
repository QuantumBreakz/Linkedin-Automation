/**
 * The signed-in user's own profile. There is no route that reads or writes
 * another user's record — the id always comes from the session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withUser, badRequest } from '@/lib/session';

const ProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(160).nullable().optional(),
  fieldOfStudy: z.string().trim().max(160).nullable().optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  timezone: z.string().trim().max(64).optional(),
  researchAreas: z.array(z.string().trim().max(80)).max(20).optional(),
  approvalMode: z.enum(['AUTOMATIC', 'APPROVAL_REQUIRED', 'DRAFT_ONLY']).optional(),
});

export async function GET(): Promise<NextResponse> {
  return withUser(async (userId) => {
    const profile = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        title: true,
        fieldOfStudy: true,
        bio: true,
        timezone: true,
        researchAreas: true,
        approvalMode: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ profile });
  });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const parsed = ProfileSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid profile update.');
    }

    // Email and password are deliberately not updatable here: changing either
    // is an account-security action and belongs behind a re-authentication
    // step, not a profile form.
    const profile = await db.user.update({
      where: { id: userId },
      data: parsed.data,
      select: {
        name: true,
        title: true,
        fieldOfStudy: true,
        bio: true,
        timezone: true,
        researchAreas: true,
        approvalMode: true,
      },
    });

    return NextResponse.json({ profile });
  });
}
