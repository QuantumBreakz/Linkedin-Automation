import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let brand = await db.brandProfile.findUnique({
    where: { userId: session.user.id },
  });

  if (!brand) {
    brand = await db.brandProfile.create({
      data: {
        userId: session.user.id,
        tone: 'PROFESSIONAL',
        technicality: 'INTERMEDIATE',
        postLength: 'MEDIUM',
        emojiUsage: 'LOW',
      },
    });
  }

  const linkedin = await db.linkedInAccount.findUnique({
    where: { userId: session.user.id },
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
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  const brand = await db.brandProfile.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      tone: body.tone ?? 'PROFESSIONAL',
      technicality: body.technicality ?? 'INTERMEDIATE',
      postLength: body.postLength ?? 'MEDIUM',
      emojiUsage: body.emojiUsage ?? 'LOW',
      ctaEnabled: body.ctaEnabled ?? true,
      hashtagsEnabled: body.hashtagsEnabled ?? true,
      firstPerson: body.firstPerson ?? true,
      customInstructions: body.customInstructions ?? null,
      styleSamples: body.styleSamples ?? [],
    },
    update: {
      tone: body.tone,
      technicality: body.technicality,
      postLength: body.postLength,
      emojiUsage: body.emojiUsage,
      ctaEnabled: body.ctaEnabled,
      hashtagsEnabled: body.hashtagsEnabled,
      firstPerson: body.firstPerson,
      customInstructions: body.customInstructions,
      styleSamples: body.styleSamples,
    },
  });

  return NextResponse.json({ brand });
}
