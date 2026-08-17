import Link from 'next/link';
import { db } from '@/lib/db';
import { requireSessionUser } from '@/lib/session';
import {
  PageShell,
  PageHeader,
  TabBar,
  Card,
  Badge,
  EmptyState,
  humanise,
  formatDateTime,
} from '@/components/ui';
import { SlotEditor } from '@/components/SlotEditor';

export const metadata = { title: 'Schedule — Researchly' };

export default async function SchedulePage() {
  const user = await requireSessionUser();

  const [profile, slots, queued, published] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { timezone: true } }),
    db.scheduleSlot.findMany({
      where: { userId: user.id, active: true },
      orderBy: [{ dayOfWeek: 'asc' }, { timeOfDay: 'asc' }],
      select: { id: true, dayOfWeek: true, timeOfDay: true },
    }),
    db.contentDraft.findMany({
      where: { userId: user.id, status: { in: ['SCHEDULED', 'APPROVED'] } },
      include: { paper: { select: { title: true } } },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: 25,
    }),
    // Scoped through the draft's owner — a published post is only ever reachable
    // via a draft the requesting user owns.
    db.publishedPost.findMany({
      where: { draft: { userId: user.id } },
      include: { draft: { select: { body: true, paper: { select: { title: true } } } } },
      orderBy: { publishedAt: 'desc' },
      take: 10,
    }),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Publishing"
        title="Schedule"
        description="When approved posts go out, and what has already gone."
      />

      <TabBar
        current="/schedule"
        tabs={[
          { href: '/settings', label: 'Profile' },
          { href: '/schedule', label: 'Schedule', count: queued.length },
          { href: '/sources', label: 'Sources' },
        ]}
      />

      <div className="space-y-5">
        <SlotEditor slots={slots} timezone={profile.timezone} />

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-ink-900">
            Queue · {queued.length}
          </h2>

          {queued.length === 0 ? (
            <EmptyState
              title="Nothing queued"
              description="Approve a draft and it will appear here with its publish time."
              action={
                <Link href="/drafts?status=NEEDS_REVIEW" className="btn btn-primary btn-sm">
                  Review drafts
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {queued.map((draft) => (
                <li
                  key={draft.id}
                  className="flex flex-col gap-3 rounded-2xl bg-cream-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone={draft.status === 'SCHEDULED' ? 'clay' : 'ok'}>
                        {humanise(draft.status)}
                      </Badge>
                      <span className="text-xs text-ink-500">
                        {draft.scheduledFor ? formatDateTime(draft.scheduledFor) : 'Next free slot'}
                      </span>
                    </div>
                    <p className="truncate text-sm font-medium text-ink-800">
                      {draft.paper?.title ?? draft.body.slice(0, 90)}
                    </p>
                  </div>
                  <Link href={`/drafts/${draft.id}`} className="btn btn-quiet btn-sm shrink-0">
                    Open →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-ink-900">
            Recently published
          </h2>

          {published.length === 0 ? (
            <EmptyState title="Nothing published yet" />
          ) : (
            <ul className="space-y-2.5">
              {published.map((post) => (
                <li
                  key={post.id}
                  className="flex flex-col gap-3 rounded-2xl bg-cream-50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink-500">
                      {post.draft.paper?.title ?? 'Written in chat'}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-800">{post.draft.body}</p>
                    <p className="mt-1 text-[0.7rem] text-ink-500">
                      {formatDateTime(post.publishedAt)}
                    </p>
                  </div>
                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-quiet btn-sm shrink-0"
                    >
                      View ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
