/**
 * One draft: read, edit, or hand to the publisher.
 *
 * `PATCH` deliberately cannot set every status. Publishing is a side effect,
 * not a field — letting a client PATCH `status: "PUBLISHED"` would let it mark
 * a post as live without anything ever being sent, and letting it PATCH
 * `APPROVED` would route around the approval endpoint that records *when* and
 * *what* was approved. Both go through /approve instead.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { withUser, notFound, badRequest } from '@/lib/session';
import { publishDraft } from '@/services/linkedin/publish';

/** Statuses a client may set directly. Everything else is server-driven. */
const EditableStatus = z.enum(['NEEDS_REVIEW', 'CANCELLED']);

const PatchSchema = z.object({
  body: z.string().trim().min(1).max(6000).optional(),
  hashtags: z.array(z.string().trim().max(60)).max(15).optional(),
  status: EditableStatus.optional(),
});

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;

    const draft = await db.contentDraft.findFirst({
      where: { id, userId },
      include: {
        paper: { include: { authors: { orderBy: { position: 'asc' } } } },
        analysis: true,
        visuals: true,
        published: true,
      },
    });

    if (!draft) return notFound('Draft');
    return NextResponse.json({ draft });
  });
}

export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;

    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid draft update.');
    }
    const { body, hashtags, status } = parsed.data;

    const draft = await db.contentDraft.findFirst({
      where: { id, userId },
      select: { id: true, status: true },
    });
    if (!draft) return notFound('Draft');

    if (draft.status === 'PUBLISHED') {
      return badRequest('A published post cannot be edited here.');
    }

    const updated = await db.contentDraft.update({
      where: { id: draft.id },
      data: {
        ...(body !== undefined ? { body, editedByUser: true } : {}),
        ...(hashtags !== undefined ? { hashtags } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    });

    return NextResponse.json({ draft: updated });
  });
}

/**
 * Publishes an already-approved draft.
 *
 * Kept for the "approve now, publish later" path. It will not publish
 * something the user has not approved — that check lives in `publishDraft`.
 */
export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;
    const { action } = (await req.json().catch(() => ({ action: 'publish' }))) as {
      action?: string;
    };

    if (action !== 'publish') return badRequest(`Unknown action: ${action}`);

    const outcome = await publishDraft({ draftId: id, userId });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.message, reason: outcome.reason },
        { status: outcome.reason === 'draft_not_found' ? 404 : 400 },
      );
    }

    return NextResponse.json({
      success: true,
      permalink: outcome.permalink,
      message: outcome.alreadyPublished ? 'Already published.' : 'Published to LinkedIn.',
    });
  });
}

export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  return withUser(async (userId) => {
    const { id } = await props.params;

    const draft = await db.contentDraft.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        published: {
          select: {
            linkedinUrn: true,
            account: { select: { accessTokenEnc: true } },
          },
        },
      },
    });
    if (!draft) return notFound('Draft');

    if (draft.status === 'PUBLISHING') {
      return badRequest('Cannot delete a draft that is currently being published.');
    }

    const { deleteOnLinkedin } = (await req.json().catch(() => ({}))) as {
      deleteOnLinkedin?: boolean;
    };

    let deletedFromLinkedin = false;
    if (deleteOnLinkedin && draft.published?.linkedinUrn && draft.published.account?.accessTokenEnc) {
      try {
        const { deletePost, decryptAccessToken } = await import('@/services/linkedin/client');
        const token = decryptAccessToken(draft.published.account.accessTokenEnc);
        deletedFromLinkedin = await deletePost({
          urn: draft.published.linkedinUrn,
          accessToken: token,
        });
      } catch (err) {
        // Log but don't block DB deletion
        console.error('Failed to delete post from LinkedIn:', err);
      }
    }

    await db.contentDraft.delete({
      where: { id: draft.id },
    });

    return NextResponse.json({ success: true, deletedFromLinkedin });
  });
}

