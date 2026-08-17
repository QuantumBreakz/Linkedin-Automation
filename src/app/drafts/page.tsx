import Link from 'next/link';
import type { DraftStatus } from '@prisma/client';
import { db } from '@/lib/db';
import { requireSessionUser } from '@/lib/session';
import {
  PageShell,
  PageHeader,
  TabBar,
  Card,
  Badge,
  EmptyState,
  statusTone,
  humanise,
  formatDateTime,
} from '@/components/ui';

const FILTERS: Array<{ label: string; value?: DraftStatus }> = [
  { label: 'All' },
  { label: 'Needs review', value: 'NEEDS_REVIEW' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Published', value: 'PUBLISHED' },
];

const VALID = new Set(FILTERS.map((f) => f.value).filter(Boolean) as string[]);

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireSessionUser();
  const { status } = await searchParams;

  // Only a value from our own list reaches the query — a hand-edited query
  // string cannot smuggle anything into the WHERE clause.
  const filter = status && VALID.has(status) ? (status as DraftStatus) : undefined;

  const drafts = await db.contentDraft.findMany({
    where: { userId: user.id, ...(filter ? { status: filter } : {}) },
    include: {
      paper: { select: { title: true, venue: true } },
      published: { select: { permalink: true, publishedAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow="Drafts"
        title="Review & approve"
        description="Every post passes through here first. Open one to see it exactly as LinkedIn will render it."
        actions={
          <Link href="/chat" className="btn btn-ghost btn-sm">
            Write a new one
          </Link>
        }
      />

      <TabBar
        current={filter ? `/drafts?status=${filter}` : '/drafts'}
        tabs={FILTERS.map((f) => ({
          href: f.value ? `/drafts?status=${f.value}` : '/drafts',
          label: f.label,
        }))}
      />

      {drafts.length === 0 ? (
        <EmptyState
          title="Nothing in this view"
          description="Drafts appear here once the pipeline finds a new paper, or when you save a chat reply as a post."
          action={
            <Link href="/chat" className="btn btn-primary btn-sm">
              Write one in chat
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {drafts.map((draft) => (
            <Card key={draft.id} as="article" className="flex flex-col justify-between gap-4">
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(draft.status)}>{humanise(draft.status)}</Badge>
                  <Badge tone="neutral">{humanise(draft.format)}</Badge>
                  {draft.origin === 'CHAT' && <Badge tone="clay">From chat</Badge>}
                </div>

                <p className="truncate text-xs font-medium text-ink-500">
                  {draft.paper?.title ?? 'No source paper'}
                </p>
                <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                  {draft.body}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-ink-900/8 pt-4">
                <span className="text-[0.7rem] text-ink-500">
                  {draft.published?.publishedAt
                    ? `Published ${formatDateTime(draft.published.publishedAt)}`
                    : draft.scheduledFor
                      ? `Scheduled ${formatDateTime(draft.scheduledFor)}`
                      : `Fact-check: ${humanise(draft.verificationStatus)}`}
                </span>
                <Link href={`/drafts/${draft.id}`} className="btn btn-quiet btn-sm">
                  {draft.status === 'PUBLISHED' ? 'View' : 'Review'} →
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
