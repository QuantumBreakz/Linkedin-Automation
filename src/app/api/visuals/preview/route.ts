import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError } from '@/lib/session';
import { renderVisual } from '@/services/visual/render';
import { VisualSpecSchema } from '@/services/visual/visual-types';
import { getStorage } from '@/lib/storage';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Renders from the posted spec only — nothing is read from the database, so
  // the session check here is about not offering free rendering to the world.
  try {
    await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) return err.response;
    throw err;
  }

  // A malformed or empty body must be a 400, not an unhandled throw → 500.
  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: 'Invalid or empty request body' }, { status: 400 });
  }

  const parseResult = VisualSpecSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid visual spec', details: parseResult.error }, { status: 400 });
  }

  try {
    const result = await renderVisual(parseResult.data);

    // On a cache hit renderVisual returns an empty buffer (the bytes already
    // live in storage). This endpoint streams the PNG, so fetch them back —
    // otherwise every repeat render of the same spec returns a 0-byte image.
    let pngBytes = result.png;
    if (pngBytes.length === 0 && result.storageKey) {
      const url = await getStorage().getSignedUrl(result.storageKey, 300);
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Could not fetch cached visual (HTTP ${resp.status})`);
      }
      pngBytes = Buffer.from(await resp.arrayBuffer());
    }
    if (pngBytes.length === 0) {
      throw new Error('Render produced no image bytes');
    }

    const headers = new Headers();
    headers.set('Content-Type', 'image/png');
    headers.set('X-Spec-Hash', result.specHash);

    return new NextResponse(new Uint8Array(pngBytes), {
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
