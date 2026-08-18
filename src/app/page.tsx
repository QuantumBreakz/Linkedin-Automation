import Link from 'next/link';
import { db } from '@/lib/db';
import { requireSessionUser } from '@/lib/session';
import { runScheduleSweep } from '@/worker/processors/schedule-sweep.processor';
import { logger } from '@/lib/logger';
import {
  PageShell,
  PageHeader,
  Card,
  StatTile,
  Badge,
  EmptyState,
  Avatar,
  statusTone,
  humanise,
  formatDateTime,
  daysUntil,
} from '@/components/ui';

export default async function DashboardPage() {
  const user = await requireSessionUser();
  const userId = user.id;

  // Publish any scheduled posts whose time has passed, in-process, so
  // scheduling works for a user who runs only the web app and not a separate
  // worker. Fire-and-forget and idempotent — it never blocks the dashboard, and
  // the worker's own sweep (when running) can't double-post thanks to the
  // atomic claim inside publishDraft.
  void runScheduleSweep().catch((err) => logger.error('Inline schedule sweep failed', { err }));

  // One round trip, every query scoped to this user.
  const [profile, account, papers, needsReview, scheduled, published, recent, nextUp] =
    await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { name: true, title: true, fieldOfStudy: true, timezone: true, approvalMode: true },
      }),
      db.linkedInAccount.findUnique({
        where: { userId },
        select: { displayName: true, avatarUrl: true, status: true, accessTokenExpires: true },
      }),
      db.researchPaper.count({ where: { userId, dismissed: false } }),
      db.contentDraft.count({ where: { userId, status: 'NEEDS_REVIEW' } }),
      // "Queued to go out" = approved and waiting, whether or not it has a
      // specific time yet. An APPROVED draft (approved, no slot) still belongs
      // in this count — it is in the publish queue — which is exactly what the
      // Schedule page shows. Counting only SCHEDULED made the dashboard read 0
      // while an approved draft sat queued.
      db.contentDraft.count({ where: { userId, status: { in: ['SCHEDULED', 'APPROVED'] } } }),
      db.contentDraft.count({ where: { userId, status: 'PUBLISHED' } }),
      db.contentDraft.findMany({
        where: { userId, status: { in: ['NEEDS_REVIEW', 'GENERATED'] } },
        include: { paper: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      db.contentDraft.findFirst({
        where: { userId, status: { in: ['SCHEDULED', 'APPROVED'] } },
        include: { paper: { select: { title: true } } },
        // Postgres sorts NULLs last on ASC, so a draft with a real time comes
        // before an approved draft that has no slot yet.
        orderBy: { scheduledFor: 'asc' },
      }),
    ]);

  const daysLeft = account ? daysUntil(account.accessTokenExpires) : 0;

  const displayName = profile?.name ?? user.name;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Command centre"
        actions={
          <>
            <Link href="/chat" className="btn btn-ghost btn-sm">
              Open chat
            </Link>
            <Link href="/drafts?status=NEEDS_REVIEW" className="btn btn-primary btn-sm">
              Review drafts{needsReview > 0 ? ` · ${needsReview}` : ''}
            </Link>
          </>
        }
      />

      {/* Hero */}
      <section className="card-ink mb-5 flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
        <div className="flex items-center gap-5">
          <Avatar
            name={profile?.name ?? user.name}
            src={account?.avatarUrl}
            size={72}
            tone="clay"
          />
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-clay-300">
              {profile?.title ?? 'Researcher'}
            </p>
            <h1 className="mt-1 text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
              {displayName}
            </h1>
            <p className="mt-1 text-xs text-cream-100/55">
              {profile?.fieldOfStudy ? `${profile.fieldOfStudy} · ` : ''}
              {profile?.timezone ?? 'UTC'} ·{' '}
              {profile?.approvalMode === 'AUTOMATIC'
                ? 'Auto-approval on'
                : 'Every post needs your approval'}
            </p>
          </div>
        </div>

        <div className="flex gap-8 sm:gap-10">
          <div>
            <p className="text-3xl font-semibold">{published}</p>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-100/50">Published</p>
          </div>
          <div>
            <p className="text-3xl font-semibold">{needsReview}</p>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-100/50">Waiting</p>
          </div>
          <div>
            <p className="text-3xl font-semibold">{papers}</p>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-100/50">Papers</p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Papers found"
          value={papers}
          hint="From your connected sources"
          progress={Math.min(1, papers / 20)}
          tone="ink"
        />
        <StatTile
          label="Needs review"
          value={needsReview}
          hint="Drafted and fact-checked"
          progress={Math.min(1, needsReview / 10)}
          tone="warn"
        />
        <StatTile
          label="Scheduled"
          value={scheduled}
          hint={
            nextUp?.scheduledFor
              ? `Next ${formatDateTime(nextUp.scheduledFor)}`
              : scheduled > 0
                ? 'Approved — awaiting a slot'
                : 'Nothing queued'
          }
          progress={Math.min(1, scheduled / 10)}
          tone="clay"
        />
        <StatTile
          label="Published"
          value={published}
          hint="Live on LinkedIn"
          progress={Math.min(1, published / 20)}
          tone="sage"
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Approval queue */}
        <Card>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-ink-900">
                Waiting for your approval
              </h2>
              <p className="mt-1 text-xs text-ink-500">
                Nothing here has been posted. Open one to see exactly what would go out.
              </p>
            </div>
            <Link href="/drafts" className="btn btn-ghost btn-sm">
              All drafts
            </Link>
          </div>

          {recent.length === 0 ? (
            <EmptyState
              title="No drafts waiting"
              description="Connect a research source and the pipeline will start filling this queue, or write one yourself in chat."
              action={
                <div className="flex gap-2.5">
                  <Link href="/sources" className="btn btn-primary btn-sm">
                    Add a source
                  </Link>
                  <Link href="/chat" className="btn btn-ghost btn-sm">
                    Write in chat
                  </Link>
                </div>
              }
            />
          ) : (
            <ul className="space-y-2.5">
              {recent.map((draft) => (
                <li key={draft.id}>
                  <Link
                    href={`/drafts/${draft.id}`}
                    className="block rounded-2xl bg-cream-50 px-4 py-4 transition-colors hover:bg-white"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone="clay">{humanise(draft.format)}</Badge>
                      <Badge tone={statusTone(draft.verificationStatus)}>
                        {humanise(draft.verificationStatus)}
                      </Badge>
                      {draft.origin === 'CHAT' && <Badge>From chat</Badge>}
                    </div>
                    <p className="truncate text-xs font-medium text-ink-500">
                      {draft.paper?.title ?? 'Written in chat'}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-800">
                      {draft.body}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* LinkedIn connection */}
        <aside className="space-y-5">
          <Card>
            <p className="label">LinkedIn</p>
            {account && account.status === 'ACTIVE' ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={account.displayName ?? user.name} src={account.avatarUrl} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {account.displayName ?? 'Connected'}
                    </p>
                    <p className="text-xs text-ink-500">Token valid for {daysLeft} more days</p>
                  </div>
                </div>
                <div className="mt-4">
                  <Badge tone={daysLeft < 14 ? 'warn' : 'ok'}>
                    {daysLeft < 14 ? 'Reconnect soon' : 'Connected'}
                  </Badge>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-ink-700">
                  No account connected yet. Approving a post will not publish anything until you
                  connect one.
                </p>
                <Link href="/settings" className="btn btn-primary btn-sm mt-4 w-full">
                  Connect LinkedIn
                </Link>
              </>
            )}
          </Card>

          <Card>
            <p className="label">Next in the queue</p>
            {nextUp ? (
              <Link href={`/drafts/${nextUp.id}`} className="block">
                <p className="text-sm font-medium leading-relaxed text-ink-800">
                  {nextUp.paper?.title ?? nextUp.body.slice(0, 80)}
                </p>
                <p className="mt-2 text-xs text-ink-500">{formatDateTime(nextUp.scheduledFor)}</p>
              </Link>
            ) : (
              <p className="text-sm text-ink-500">Nothing scheduled.</p>
            )}
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
