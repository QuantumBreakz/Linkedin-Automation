/**
 * POST /api/drafts/[id]/image - Upload custom picture(s) for a draft (up to 10).
 * DELETE /api/drafts/[id]/image - Remove a specific picture or all pictures from a draft.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withUser, notFound, badRequest } from '@/lib/session';
import { getStorage } from '@/lib/storage';
import { nanoid } from 'nanoid';

const ALLOWED_MIME_TYPES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit per image
const MAX_IMAGES_PER_DRAFT = 10;

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id: draftId } = await props.params;

    const visuals = await db.visualAsset.findMany({
      where: { draftId, draft: { userId } },
      orderBy: { createdAt: 'asc' },
    });

    const images = await Promise.all(
      visuals.map(async (v) => {
        let url: string | null = null;
        if (v.storageKey) {
          url = await getStorage().getSignedUrl(v.storageKey, 600).catch(() => null);
        }
        return {
          id: v.id,
          url,
          altText: v.altText,
          isPrimary: v.isPrimary,
        };
      }),
    );

    return NextResponse.json({ images: images.filter((img) => img.url !== null) });
  });
}

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id: draftId } = await props.params;

    const draft = await db.contentDraft.findFirst({
      where: { id: draftId, userId },
      select: { id: true, status: true, _count: { select: { visuals: true } } },
    });
    if (!draft) return notFound('Draft');

    if (draft.status === 'PUBLISHED') {
      return badRequest('Cannot modify images on a published draft.');
    }

    const currentCount = draft._count.visuals;
    if (currentCount >= MAX_IMAGES_PER_DRAFT) {
      return badRequest(`You can attach a maximum of ${MAX_IMAGES_PER_DRAFT} images per post.`);
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return badRequest('Invalid form data.');
    }

    const files = formData.getAll('file') as File[];
    if (!files || files.length === 0) {
      return badRequest('No image file provided.');
    }

    if (currentCount + files.length > MAX_IMAGES_PER_DRAFT) {
      return badRequest(
        `Adding ${files.length} images would exceed the limit of ${MAX_IMAGES_PER_DRAFT} images (currently ${currentCount}).`,
      );
    }

    const uploadedResults: Array<{ id: string; url: string; altText: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = ALLOWED_MIME_TYPES.get(file.type);
      if (!extension) {
        return badRequest(`Unsupported format for "${file.name}". Please use PNG, JPEG, WEBP, or GIF.`);
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return badRequest(`"${file.name}" exceeds the 10MB limit.`);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const storageKey = `visuals/${userId}/upload-${nanoid()}.${extension}`;

      await getStorage().putObject(storageKey, buffer, file.type);
      const signedUrl = await getStorage().getSignedUrl(storageKey, 600);

      const altText = file.name.replace(/\.[^/.]+$/, '');
      const isFirst = currentCount === 0 && i === 0;

      const visual = await db.visualAsset.create({
        data: {
          draftId: draft.id,
          template: 'CUSTOM_UPLOAD',
          spec: { uploaded: true, filename: file.name, mimeType: file.type },
          specHash: `upload-${nanoid()}`,
          storageKey,
          width: 1200,
          height: 1200,
          altText,
          isPrimary: isFirst,
        },
      });

      uploadedResults.push({
        id: visual.id,
        url: signedUrl,
        altText,
      });
    }

    await db.contentDraft.update({
      where: { id: draft.id },
      data: { editedByUser: true },
    });

    const allVisuals = await db.visualAsset.findMany({
      where: { draftId: draft.id },
      orderBy: { createdAt: 'asc' },
    });

    const allImages = await Promise.all(
      allVisuals.map(async (v) => {
        let url: string | null = null;
        if (v.storageKey) {
          url = await getStorage().getSignedUrl(v.storageKey, 600).catch(() => null);
        }
        return {
          id: v.id,
          url,
          altText: v.altText,
          isPrimary: v.isPrimary,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      images: allImages.filter((img) => img.url !== null),
      uploaded: uploadedResults,
    });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id: draftId } = await props.params;

    const draft = await db.contentDraft.findFirst({
      where: { id: draftId, userId },
      select: { id: true, status: true },
    });
    if (!draft) return notFound('Draft');

    if (draft.status === 'PUBLISHED') {
      return badRequest('Cannot modify images on a published draft.');
    }

    const { visualId } = (await req.json().catch(() => ({}))) as { visualId?: string };

    if (visualId) {
      await db.visualAsset.deleteMany({
        where: { id: visualId, draftId: draft.id },
      });
    } else {
      await db.visualAsset.deleteMany({
        where: { draftId: draft.id },
      });
    }

    await db.contentDraft.update({
      where: { id: draft.id },
      data: { editedByUser: true },
    });

    const remainingVisuals = await db.visualAsset.findMany({
      where: { draftId: draft.id },
      orderBy: { createdAt: 'asc' },
    });

    const remainingImages = await Promise.all(
      remainingVisuals.map(async (v) => {
        let url: string | null = null;
        if (v.storageKey) {
          url = await getStorage().getSignedUrl(v.storageKey, 600).catch(() => null);
        }
        return {
          id: v.id,
          url,
          altText: v.altText,
          isPrimary: v.isPrimary,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      images: remainingImages.filter((img) => img.url !== null),
    });
  });
}

