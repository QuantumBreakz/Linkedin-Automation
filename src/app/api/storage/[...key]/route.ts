/**
 * GET /api/storage/[...key] - Serve files stored in local filesystem storage fallback.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserId, UnauthorizedError } from '@/lib/session';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ key: string[] }> },
): Promise<NextResponse> {
  try {
    await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) return err.response;
    throw err;
  }

  const { key } = await props.params;
  const storageKey = key.join('/');

  if (storageKey.includes('..') || storageKey.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid storage key' }, { status: 400 });
  }

  const localFilePath = join(process.cwd(), '.storage', storageKey);

  try {
    const fileStat = await stat(localFilePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const buffer = await readFile(localFilePath);

    const ext = storageKey.split('.').pop()?.toLowerCase();
    const contentType =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'pdf'
                ? 'application/pdf'
                : 'application/octet-stream';

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers,
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
