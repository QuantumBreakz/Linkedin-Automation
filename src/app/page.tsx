import Link from 'next/link';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export default async function DashboardPage() {
  const session = await auth();
  const userId = session?.user?.id;

  let stats = { papers: 0, pendingReview: 0, scheduled: 0, published: 0 };
  let pendingDrafts: Array<{
    id: string;
    format: string;
    body: string;
    paper: { title: string; venue: string | null };
    verificationStatus: string;
  }> = [];

  if (userId) {
    const [papersCount, reviewCount, schedCount, pubCount, drafts] = await Promise.all([
      db.researchPaper.count({ where: { userId, dismissed: false } }),
      db.contentDraft.count({ where: { userId, status: 'NEEDS_REVIEW' } }),
      db.contentDraft.count({ where: { userId, status: 'SCHEDULED' } }),
      db.contentDraft.count({ where: { userId, status: 'PUBLISHED' } }),
      db.contentDraft.findMany({
        where: { userId, status: 'NEEDS_REVIEW' },
        include: { paper: { select: { title: true, venue: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    stats = {
      papers: papersCount,
      pendingReview: reviewCount,
      scheduled: schedCount,
      published: pubCount,
    };
    pendingDrafts = drafts;
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
            Research Command Center
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Transform scientific breakthroughs into verified, high-impact LinkedIn posts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sources"
            className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 transition-all hover:bg-slate-800"
          >
            + Add Source
          </Link>
          <Link
            href="/inbox"
            className="px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all"
          >
            Review Inbox ({stats.papers})
          </Link>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Ingested Papers</span>
            <span>📥</span>
          </div>
          <p className="text-3xl font-bold text-white mt-3">{stats.papers}</p>
          <p className="text-xs text-slate-400 mt-1">Auto-polled from ORCID & OpenAlex</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-amber-400 text-xs font-semibold uppercase tracking-wider">
            <span>Needs Review</span>
            <span>✍️</span>
          </div>
          <p className="text-3xl font-bold text-amber-300 mt-3">{stats.pendingReview}</p>
          <p className="text-xs text-slate-400 mt-1">Generated & fact-checked</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-indigo-400 text-xs font-semibold uppercase tracking-wider">
            <span>Scheduled</span>
            <span>🗓️</span>
          </div>
          <p className="text-3xl font-bold text-indigo-300 mt-3">{stats.scheduled}</p>
          <p className="text-xs text-slate-400 mt-1">Queued for publishing slots</p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-sm">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            <span>Published</span>
            <span>🚀</span>
          </div>
          <p className="text-3xl font-bold text-emerald-300 mt-3">{stats.published}</p>
          <p className="text-xs text-slate-400 mt-1">Live on LinkedIn feed</p>
        </div>
      </div>

      {/* Main Review Section */}
      <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Pending Fact-Check & Approval</h2>
            <p className="text-xs text-slate-400">
              Drafts verified against extracted paper evidence. Review before publishing.
            </p>
          </div>
          <Link
            href="/drafts"
            className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            View all drafts →
          </Link>
        </div>

        {pendingDrafts.length === 0 ? (
          <div className="py-12 text-center rounded-xl border border-dashed border-slate-800 bg-slate-950/40">
            <p className="text-sm font-medium text-slate-400">No drafts currently waiting for review.</p>
            <p className="text-xs text-slate-500 mt-1">
              Add your ORCID or OpenAlex ID in Sources to automatically import your papers.
            </p>
            <Link
              href="/sources"
              className="inline-block mt-4 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-all"
            >
              Connect Research Source
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {pendingDrafts.map((draft) => (
              <div
                key={draft.id}
                className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-800/20 px-3 rounded-xl transition-colors"
              >
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {draft.format.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                        draft.verificationStatus === 'PASSED'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {draft.verificationStatus}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-200 line-clamp-1">
                    {draft.paper.title}
                  </h3>
                  <p className="text-xs text-slate-400 line-clamp-2">{draft.body}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/drafts/${draft.id}`}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all"
                  >
                    Inspect & Approve
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
