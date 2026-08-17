import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError } from '@/lib/session';
import { renderVisual } from '@/services/visual/render';
import { VisualSpecSchema } from '@/services/visual/visual-types';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Renders from the posted spec only — nothing is read from the database, so
  // the session check here is about not offering free rendering to the world.
  try {
    await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) return err.response;
    throw err;
  }

  const body = await req.json();
  const parseResult = VisualSpecSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid visual spec', details: parseResult.error }, { status: 400 });
  }

  try {
    const result = await renderVisual(parseResult.data);
    const headers = new Headers();
    headers.set('Content-Type', 'image/png');
    headers.set('X-Spec-Hash', result.specHash);

    return new NextResponse(new Uint8Array(result.png), {
      status: 200,
      headers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to render visual', details: String(err) },
      { status: 500 },
    );
  }
}
