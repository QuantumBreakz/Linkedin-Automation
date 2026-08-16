import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getAdapter } from '@/services/sources/adapter';
import { sourcesPollQueue } from '@/worker/queues';
import type { SourceKind } from '@prisma/client';

// Ensure adapters are registered
import '@/services/sources/adapters';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sources = await db.researchSource.findMany({
    where: { userId: session.user.id },
    include: {
      _count: {
        select: { links: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { kind, identifier, label } = body as { kind: SourceKind; identifier: string; label?: string };

  if (!kind || !identifier) {
    return NextResponse.json({ error: 'kind and identifier are required' }, { status: 400 });
  }

  // getAdapter throws for an unregistered kind, so an unsupported value has to
  // be caught here to stay a 400 rather than surfacing as a 500.
  let adapter;
  try {
    adapter = getAdapter(kind);
  } catch {
    return NextResponse.json({ error: `Unsupported source kind: ${kind}` }, { status: 400 });
  }

  // Validate with adapter
  try {
    await adapter.validate(identifier, {});
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Source validation failed' },
      { status: 400 },
    );
  }

  const source = await db.researchSource.create({
    data: {
      userId: session.user.id,
      kind,
      identifier,
      label: label || null,
      syncStatus: 'PENDING',
    },
  });

  // Trigger initial poll immediately
  await sourcesPollQueue.add(`initial-poll-${source.id}`, {
    sourceId: source.id,
  });

  return NextResponse.json({ source }, { status: 201 });
}
