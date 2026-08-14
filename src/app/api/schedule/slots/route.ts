import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slots = await db.scheduleSlot.findMany({
    where: { userId: session.user.id },
    orderBy: [{ dayOfWeek: 'asc' }, { timeOfDay: 'asc' }],
  });

  return NextResponse.json({ slots });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { dayOfWeek, timeOfDay } = body as { dayOfWeek: number; timeOfDay: string };

  if (typeof dayOfWeek !== 'number' || !timeOfDay) {
    return NextResponse.json({ error: 'dayOfWeek and timeOfDay are required' }, { status: 400 });
  }

  const slot = await db.scheduleSlot.upsert({
    where: {
      userId_dayOfWeek_timeOfDay: {
        userId: session.user.id,
        dayOfWeek,
        timeOfDay,
      },
    },
    create: {
      userId: session.user.id,
      dayOfWeek,
      timeOfDay,
      active: true,
    },
    update: {
      active: true,
    },
  });

  return NextResponse.json({ slot }, { status: 201 });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id parameter is required' }, { status: 400 });
  }

  await db.scheduleSlot.deleteMany({
    where: { id, userId: session.user.id },
  });

  return NextResponse.json({ success: true });
}
