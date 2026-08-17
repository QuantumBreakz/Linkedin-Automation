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
  statusTone,
  humanise,
  formatDate,
} from '@/components/ui';

export const metadata = { title: 'Research inbox — Researchly' };

export default async function InboxPage() {
  const user = await requireSessionUser();

  const [papers, sourceCount] = await Promise.all([
    db.researchPaper.findMany({
      where: { userId: user.id, dismissed: false },
      include: {
        authors: { orderBy: { position: 'asc' } },
        analyses: { take: 1, orderBy: { createdAt: 'desc' }, select: { confidence: true } },
        drafts: { select: { id: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { discoveredAt: 'desc' },
      take: 60,
    }),
    db.researchSource.count({ where: { userId: user.id } }),
  ]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Research"
        title="Your inbox"
        description="Papers discovered from the identifiers you connected. Each one is yours alone — nothing here is shared between accounts."
      />

      <TabBar
        current="/inbox"
        tabs={[
          { href: '/inbox', label: 'Papers', count: papers.length },
          { href: '/sources', label: 'Sources', count: sourceCount },
        ]}
      />

      {papers.length === 0 ? (
        <EmptyState
          title="No papers yet"
          description="Connect an ORCID iD or an OpenAlex author ID and the poller will start importing your publications within a few minutes."
          action={
            <Link href="/sources" className="btn btn-primary btn-sm">
              Connect a source
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {papers.map((paper) => {
            const analysis = paper.analyses[0];
            const draft = paper.drafts[0];

            return (
              <Card key={paper.id} as="article">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{humanise(paper.fullTextStatus)}</Badge>
                      {paper.venue && <Badge tone="neutral">{paper.venue}</Badge>}
                      {analysis && (
                        <Badge tone={analysis.confidence >= 0.7 ? 'ok' : 'warn'}>
                          {Math.round(analysis.confidence * 100)}% confidence
                        </Badge>
                      )}
                      {paper.isRetracted && <Badge tone="danger">Retracted</Badge>}
                    </div>

                    <h2 className="text-base font-semibold leading-snug tracking-tight text-ink-900">
                      {paper.landingUrl ? (
                        <a
                          href={paper.landingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-clay-600"
                        >
                          {paper.title} ↗
                        </a>
                      ) : (
                        paper.title
                      )}
                    </h2>

                    <p className="mt-1.5 text-xs text-ink-500">
                      {paper.authors.map((a) => a.name).join(', ') || 'Authors unlisted'} ·{' '}
                      {formatDate(paper.publicationDate)}
                    </p>

                    {paper.abstract && (
                      <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-ink-600">
                        {paper.abstract}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {draft ? (
                      <Link href={`/drafts/${draft.id}`} className="btn btn-primary btn-sm">
                        {draft.status === 'PUBLISHED' ? 'View post' : 'Review draft'} →
                      </Link>
                    ) : (
                      <Badge tone={statusTone('PENDING')}>Queued for analysis</Badge>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
