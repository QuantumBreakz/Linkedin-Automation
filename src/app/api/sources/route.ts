import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withUser, badRequest } from '@/lib/session';
import { getAdapter } from '@/services/sources/adapter';
import { runPipelineForSource } from '@/services/pipeline/run';
import { logger } from '@/lib/logger';
import type { SourceKind } from '@prisma/client';

// Ensure adapters are registered
import '@/services/sources/adapters';

export async function GET(): Promise<NextResponse> {
  return withUser(async (userId) => {
    const sources = await db.researchSource.findMany({
      where: { userId },
      include: { _count: { select: { links: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ sources });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withUser(async (userId) => {
    const body = (await req.json().catch(() => ({}))) as {
      kind?: SourceKind;
      identifier?: string;
      label?: string;
    };
    const { kind, identifier, label } = body;

    if (!kind || !identifier) return badRequest('kind and identifier are required');

    // getAdapter throws for an unregistered kind, so an unsupported value has
    // to be caught here to stay a 400 rather than surfacing as a 500.
    let adapter;
    try {
      adapter = getAdapter(kind);
    } catch {
      return badRequest(`Unsupported source kind: ${kind}`);
    }

    try {
      await adapter.validate(identifier, {});
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Source validation failed');
    }

    const source = await db.researchSource.create({
      data: { userId, kind, identifier, label: label || null, syncStatus: 'PENDING' },
    });

    // Start discovery immediately, in-process, so the source begins ingesting
    // without depending on a separate worker being up. Fire-and-forget: polling
    // and drafting can take a while (network + LLM), so we don't make the user
    // wait on it — papers appear in the inbox as they land, and the worker's
    // hourly re-poll (when running) keeps it current after that.
    void runPipelineForSource(source.id).catch((err) =>
      logger.error('Inline source pipeline failed', { sourceId: source.id, err }),
    );

    return NextResponse.json({ source }, { status: 201 });
  });
}
