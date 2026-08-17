import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireSessionUser } from '@/lib/session';
import { getStorage } from '@/lib/storage';
import { env } from '@/lib/env';
import { PageShell, PageHeader, Card, Badge, statusTone, humanise } from '@/components/ui';
import { DraftApproval, type DraftView } from '@/components/DraftApproval';

export const metadata = { title: 'Review draft — Researchly' };

interface VerificationReport {
  claims?: Array<{
    text: string;
    status: 'SUPPORTED' | 'HEDGED_OK' | 'UNSUPPORTED' | 'CONTRADICTED';
    supportingField?: string | null;
    note?: string | null;
  }>;
  overstatement?: boolean;
  medicalAdviceRisk?: boolean;
  numbersMatch?: boolean;
  verdict?: string;
}

export default async function DraftDetailPage(props: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  const { id } = await props.params;

  // `findFirst` with the owner in the WHERE clause, not `findUnique` by id:
  // another user's draft id must read as "does not exist".
  const draft = await db.contentDraft.findFirst({
    where: { id, userId: user.id },
    include: {
      paper: { include: { authors: { orderBy: { position: 'asc' } } } },
      visuals: true,
      published: true,
    },
  });

  if (!draft) notFound();

  const [account, profile] = await Promise.all([
    db.linkedInAccount.findUnique({
      where: { userId: user.id },
      select: { displayName: true, avatarUrl: true, status: true },
    }),
    db.user.findUnique({ where: { id: user.id }, select: { name: true, title: true } }),
  ]);

  const primaryVisual = draft.visuals.find((v) => v.isPrimary) ?? draft.visuals[0];
  let imageUrl: string | null = null;
  if (primaryVisual?.storageKey) {
    // A signed URL, so the preview shows the real rendered card without making
    // the bucket public. Failure here is cosmetic — never block the review.
    imageUrl = await getStorage()
      .getSignedUrl(primaryVisual.storageKey, 600)
      .catch(() => null);
  }

  const view: DraftView = {
    id: draft.id,
    status: draft.status,
    format: draft.format,
    origin: draft.origin,
    body: draft.body,
    hashtags: draft.hashtags,
    linkUrl: draft.linkUrl,
    verificationStatus: draft.verificationStatus,
    scheduledFor: draft.scheduledFor?.toISOString() ?? null,
    paperTitle: draft.paper?.title ?? null,
    imageUrl,
    imageAlt: primaryVisual?.altText ?? null,
    permalink: draft.published?.permalink ?? null,
  };

  const report = (draft.verification ?? null) as VerificationReport | null;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Review & approve"
        title={draft.paper?.title ?? 'Post draft'}
        description={
          draft.origin === 'CHAT'
            ? 'Written in chat. There is no source paper behind it, so you are the fact-check.'
            : 'Generated from your paper and checked claim by claim against it.'
        }
        actions={
          <Link href="/drafts" className="btn btn-ghost btn-sm">
            ← All drafts
          </Link>
        }
      />

      <DraftApproval
        draft={view}
        authorName={account?.displayName ?? profile?.name ?? user.name}
        authorHeadline={profile?.title ?? null}
        authorAvatar={account?.avatarUrl ?? null}
        linkedinConnected={account?.status === 'ACTIVE'}
        dryRun={env.LINKEDIN_DRY_RUN}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight text-ink-900">Fact-check</h2>
            <Badge tone={statusTone(draft.verificationStatus)}>
              {humanise(draft.verificationStatus)}
            </Badge>
          </div>

          {report ? (
            <>
              <ul className="space-y-2 text-xs">
                <CheckRow
                  label="Numbers trace to the source"
                  ok={report.numbersMatch !== false}
                  failText="Unverified figures"
                />
                <CheckRow
                  label="No causal overstatement"
                  ok={!report.overstatement}
                  failText="Causal language flagged"
                />
                <CheckRow
                  label="No medical advice"
                  ok={!report.medicalAdviceRisk}
                  failText="Medical risk detected"
                />
              </ul>

              {report.claims && report.claims.length > 0 && (
                <div className="mt-5 space-y-2">
                  <p className="label mb-0">Claim by claim</p>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {report.claims.map((claim, index) => (
                      <div key={index} className="rounded-2xl bg-cream-50 px-3.5 py-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <Badge
                            tone={
                              claim.status === 'SUPPORTED'
                                ? 'ok'
                                : claim.status === 'HEDGED_OK'
                                  ? 'clay'
                                  : 'danger'
                            }
                          >
                            {humanise(claim.status)}
                          </Badge>
                          {claim.supportingField && (
                            <span className="text-[0.65rem] text-ink-500">
                              {claim.supportingField}
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-ink-700">{claim.text}</p>
                        {claim.note && (
                          <p className="mt-1 text-[0.7rem] text-ink-500">{claim.note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-xs leading-relaxed text-ink-500">
              This draft was not produced from an extracted paper, so there is nothing to check it
              against automatically. Read it carefully before approving.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-ink-900">Source</h2>
          {draft.paper ? (
            <div className="space-y-2.5 text-xs">
              <p className="text-sm font-medium leading-relaxed text-ink-800">
                {draft.paper.title}
              </p>
              {draft.paper.venue && (
                <p className="text-ink-500">
                  <span className="text-ink-500">Venue · </span>
                  {draft.paper.venue}
                </p>
              )}
              <p className="text-ink-500">
                <span>Authors · </span>
                {draft.paper.authors.map((a) => a.name).join(', ') || '—'}
              </p>
              {draft.paper.doi && <p className="text-ink-500">DOI · {draft.paper.doi}</p>}
              {draft.paper.landingUrl && (
                <a
                  href={draft.paper.landingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm mt-2"
                >
                  Open the paper ↗
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-ink-500">
              No source paper — this draft came from a chat thread.
              {draft.conversationId && (
                <>
                  {' '}
                  <Link href="/chat" className="font-semibold text-clay-600">
                    Back to chat
                  </Link>
                </>
              )}
            </p>
          )}
        </Card>
      </div>
    </PageShell>
  );
}

function CheckRow({ label, ok, failText }: { label: string; ok: boolean; failText: string }) {
  return (
    <li className="flex items-center justify-between rounded-2xl bg-cream-50 px-3.5 py-2.5">
      <span className="text-ink-700">{label}</span>
      <span className={`font-semibold ${ok ? 'text-sage-500' : 'text-rust-500'}`}>
        {ok ? '✓ Clear' : `✗ ${failText}`}
      </span>
    </li>
  );
}
