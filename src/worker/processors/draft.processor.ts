/**
 * Draft Generation processor — runs Stage 2 (Format Gate), Stage 3 (Drafting),
 * Stage 4 (Verification), and optionally Stage 5 (Visual Rendering).
 *
 * The work lives in `generatePaperDraft`, a plain function so it runs in this
 * BullMQ worker or inline (services/pipeline/run.ts). It is idempotent per
 * paper: if a draft already exists it returns that one rather than making a
 * second, so the inline path and the worker can never double-draft.
 */

import type { Job } from 'bullmq';
import type { ContentFormat } from '@prisma/client';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { eligibleFormats, selectFormat } from '@/services/content/format-gate';
import { generateDraft } from '@/services/content/draft';
import { scheduleDraftToNextSlot } from '@/services/scheduling/slots';
import { verifyDraft } from '@/services/analysis/verify-claims';
import { openRouterProvider } from '@/services/llm/provider';
import type { ResearchExtraction } from '@/services/content/types';
import { renderVisual } from '@/services/visual/render';
import type { VisualSpec } from '@/services/visual/visual-types';

export interface DraftJobData {
  paperId: string;
  userId: string;
  analysisId?: string;
  requestedFormat?: ContentFormat;
}

export async function generatePaperDraft(
  paperId: string,
  userId: string,
  requestedFormat?: ContentFormat,
): Promise<{ draftId: string | null }> {
  logger.info('Processing draft generation', { paperId, userId, requestedFormat });

  // Idempotency guard: one draft per paper. Without this the inline pipeline
  // and the worker's hourly re-poll would each create a draft for the same
  // paper.
  const existing = await db.contentDraft.findFirst({
    where: { userId, paperId },
    select: { id: true },
  });
  if (existing) {
    logger.info('Draft already exists for paper; skipping generation', { paperId, draftId: existing.id });
    return { draftId: existing.id };
  }

  const [paper, user, brand] = await Promise.all([
    db.researchPaper.findUnique({
      where: { id: paperId },
      include: { analyses: true, authors: true },
    }),
    db.user.findUnique({
      where: { id: userId },
    }),
    db.brandProfile.findUnique({
      where: { userId },
    }),
  ]);

  const analysis = paper?.analyses?.[0];

  if (!paper || !user || !analysis) {
    logger.warn('Missing required records for draft generation', { paperId, userId });
    return { draftId: null };
  }

  const extraction = analysis.extraction as unknown as ResearchExtraction;
  const eligible = eligibleFormats(extraction, paper.fullTextStatus);

  if (eligible.length === 0) {
    logger.info('No eligible content formats for this paper extraction', { paperId });
    return { draftId: null };
  }

  const format: ContentFormat =
    requestedFormat && eligible.includes(requestedFormat)
      ? requestedFormat
      : selectFormat(eligible, {
          audienceFit: 'RESEARCHERS',
          preferVisuals: true,
        }) ?? eligible[0]!;

  // Default brand profile fallback if user hasn't configured one yet
  const effectiveBrand = brand ?? {
    id: 'default',
    userId,
    tone: 'PROFESSIONAL' as const,
    technicality: 'INTERMEDIATE' as const,
    postLength: 'MEDIUM' as const,
    emojiUsage: 'LOW' as const,
    firstPerson: true,
    ctaEnabled: true,
    hashtagsEnabled: true,
    customInstructions: null,
    styleSamples: [],
    updatedAt: new Date(),
  };

  // Stage 3: Generate Draft
  const draftResult = await generateDraft(
    format,
    {
      id: paper.id,
      title: paper.title,
      abstract: paper.abstract,
      publicationDate: paper.publicationDate,
      venue: paper.venue,
      landingUrl: paper.landingUrl,
      doi: paper.doi,
      authors: paper.authors.map((a) => ({ name: a.name, isUser: a.isUser, position: a.position })),
    },
    {
      id: analysis.id,
      extraction,
      confidence: analysis.confidence,
      fullTextStatus: paper.fullTextStatus,
    },
    effectiveBrand,
    {
      id: user.id,
      name: user.name ?? 'Researcher',
      title: user.title,
      fieldOfStudy: user.fieldOfStudy,
    },
    openRouterProvider,
    { userId, paperId },
  );

  // Stage 4: Verification
  const sourceText = [paper.title, paper.abstract].filter(Boolean).join(' ');
  const verification = await verifyDraft(
    {
      draftBody: draftResult.body,
      extraction,
      sourceText,
    },
    openRouterProvider,
    { userId },
  );

  const verificationStatus =
    verification.verdict === 'PASS'
      ? 'PASSED'
      : verification.verdict === 'FLAG'
        ? 'FLAGGED'
        : 'FAILED';

  // The exact text that would be posted, so we never auto-approve something
  // LinkedIn will reject. Mirrors the composition in services/linkedin/publish.
  const composedLength = (
    draftResult.hashtags.length > 0
      ? `${draftResult.body}\n\n${draftResult.hashtags
          .map((h) => (h.startsWith('#') ? h : `#${h}`))
          .join(' ')}`
      : draftResult.body
  ).length;

  // Honour the user's approval mode. Only AUTOMATIC may pre-approve a draft,
  // and even then only one whose fact-check PASSED and that fits LinkedIn's
  // 3,000-character limit — a FLAGGED/FAILED or over-length post always goes to
  // the review queue, whatever the mode. APPROVAL_REQUIRED (the default) and
  // DRAFT_ONLY never machine-approve: the whole app promises "nothing posts
  // until you approve it," so a pipeline draft must land in NEEDS_REVIEW and
  // wait for a human, not arrive pre-stamped APPROVED and auto-published.
  const autoApprove =
    user.approvalMode === 'AUTOMATIC' &&
    verificationStatus === 'PASSED' &&
    composedLength <= 3000;
  const initialStatus = autoApprove ? 'APPROVED' : 'NEEDS_REVIEW';

  // Persist ContentDraft
  const createdDraft = await db.contentDraft.create({
    data: {
      userId,
      paperId,
      analysisId: analysis.id,
      format,
      body: draftResult.body,
      hashtags: draftResult.hashtags,
      linkUrl: draftResult.linkUrl,
      status: initialStatus,
      ...(autoApprove ? { approvedAt: new Date() } : {}),
      verification: verification as object,
      verificationStatus,
    },
  });

  logger.info('Draft created', {
    draftId: createdDraft.id,
    format,
    verdict: verification.verdict,
    status: initialStatus,
  });

  // AUTOMATIC means "go out on my schedule without a second look" (the exact
  // promise the settings screen makes). Assign the approved draft to the next
  // open slot; the schedule sweeper publishes it when that time arrives. If
  // slot assignment fails, the draft simply stays APPROVED for manual handling
  // rather than being lost.
  if (autoApprove) {
    try {
      const scheduledFor = await scheduleDraftToNextSlot(createdDraft.id, userId);
      logger.info('Auto-approved draft scheduled', { draftId: createdDraft.id, scheduledFor });
    } catch (err) {
      logger.error('Could not auto-schedule an approved draft; left APPROVED', {
        draftId: createdDraft.id,
        err,
      });
    }
  }

  // Stage 5: Visual Card generation if appropriate (e.g. VISUAL_EXPLAINER or numbers present)
  if (extraction.importantNumbers && extraction.importantNumbers.length > 0) {
    try {
      const topNum = extraction.importantNumbers[0]!;
      const spec: VisualSpec = {
        template: 'STAT_CARD',
        headline: paper.title.slice(0, 100),
        stat: topNum.value,
        statLabel: topNum.metric,
        context: topNum.context,
        source: paper.venue ?? paper.title.slice(0, 50),
      };

      const render = await renderVisual(spec);

      await db.visualAsset.create({
        data: {
          draftId: createdDraft.id,
          template: spec.template,
          spec: spec as object,
          specHash: render.specHash,
          storageKey: render.storageKey,
          width: render.width,
          height: render.height,
          altText: `Stat card showing ${topNum.metric}: ${topNum.value}`,
          isPrimary: true,
        },
      });

      logger.info('Attached visual asset to draft', {
        draftId: createdDraft.id,
        specHash: render.specHash,
      });
    } catch (err) {
      logger.warn('Visual asset generation failed; proceeding without visual', { err });
    }
  }

  return { draftId: createdDraft.id };
}

export async function processDraftJob(job: Job<DraftJobData>): Promise<void> {
  const { paperId, userId, requestedFormat } = job.data;
  await generatePaperDraft(paperId, userId, requestedFormat);
}
