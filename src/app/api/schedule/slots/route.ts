import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withUser, badRequest } from '@/lib/session';

const SlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:MM time.'),
});

export async function GET(): Promise<NextResponse> {
  return withUser(async (userId) => {
    const slots = await db.scheduleSlot.findMany({
      where: { userId },
      orderBy: [{ dayOfWeek: 'asc' }, { timeOfDay: 'asc' }],
    });
    return NextResponse.json({ slots });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const parsed = SlotSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid slot.');
    }
    const { dayOfWeek, timeOfDay } = parsed.data;

    const slot = await db.scheduleSlot.upsert({
      where: { userId_dayOfWeek_timeOfDay: { userId, dayOfWeek, timeOfDay } },
      create: { userId, dayOfWeek, timeOfDay, active: true },
      update: { active: true },
    });

    return NextResponse.json({ slot }, { status: 201 });
  });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return badRequest('id parameter is required');

    // deleteMany with the owner in the filter: another user's slot id deletes
    // nothing rather than deleting their slot.
    const result = await db.scheduleSlot.deleteMany({ where: { id, userId } });
    return NextResponse.json({ success: true, deleted: result.count });
  });
}
