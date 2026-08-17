import Link from 'next/link';
import { db } from '@/lib/db';
import { requireSessionUser } from '@/lib/session';
import { PageShell, PageHeader, TabBar, Card, Badge, EmptyState, statusTone, humanise, formatDateTime } from '@/components/ui';
import { AddSourceForm } from '@/components/AddSourceForm';

export const metadata = { title: 'Sources — Researchly' };

export default async function SourcesPage() {
  const user = await requireSessionUser();

  const [sources, paperCount] = await Promise.all([
    db.researchSource.findMany({
      where: { userId: user.id },
      include: { _count: { select: { links: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.researchPaper.count({ where: { userId: user.id, dismissed: false } }),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Research"
        title="Sources"
        description="Connect the identifiers that publish under your name. Each source is polled on its own cadence and only ever writes into your workspace."
      />

      <TabBar
        current="/sources"
        tabs={[
          { href: '/inbox', label: 'Papers', count: paperCount },
          { href: '/sources', label: 'Sources', count: sources.length },
        ]}
      />

      <div className="mb-5">
        <AddSourceForm />
      </div>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources connected"
          description="An ORCID iD is the quickest start — it pulls your full works list, then enriches each entry by DOI."
        />
      ) : (
        <div className="space-y-3">
          {sources.map((source) => (
            <Card key={source.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{humanise(source.kind)}</Badge>
                  <Badge tone={statusTone(source.syncStatus)}>{humanise(source.syncStatus)}</Badge>
                  {source.consecutiveFailures > 0 && (
                    <Badge tone="danger">{source.consecutiveFailures} failed polls</Badge>
                  )}
                </div>
                <p className="truncate font-mono text-sm font-medium text-ink-900">
                  {source.identifier}
                </p>
                {source.label && <p className="text-xs text-ink-500">{source.label}</p>}
                {source.lastError && (
                  <p className="mt-1 line-clamp-1 text-xs text-rust-500">{source.lastError}</p>
                )}
              </div>

              <div className="shrink-0 text-left text-xs text-ink-500 sm:text-right">
                <p className="font-semibold text-ink-800">{source._count.links} papers linked</p>
                <p>{source.lastCheckedAt ? `Last checked ${formatDateTime(source.lastCheckedAt)}` : 'Pending first check'}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-ink-500">
        Papers land in your{' '}
        <Link href="/inbox" className="font-semibold text-clay-600">
          inbox
        </Link>{' '}
        as they are found.
      </p>
    </PageShell>
  );
}
