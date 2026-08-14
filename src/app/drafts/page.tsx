import Link from 'next/link';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  const { status } = await searchParams;

  const validStatus = status as any;

  const drafts = userId
    ? await db.contentDraft.findMany({
        where: {
          userId,
          ...(validStatus ? { status: validStatus } : {}),
        },
        include: {
          paper: { select: { title: true, venue: true, doi: true } },
          visuals: { where: { isPrimary: true }, take: 1 },
          published: true,
        },
        orderBy: { createdAt: 'desc' },
      })
    : [];

  const tabs = [
    { label: 'All Drafts', value: undefined },
    { label: 'Needs Review', value: 'NEEDS_REVIEW' },
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Scheduled', value: 'SCHEDULED' },
    { label: 'Published', value: 'PUBLISHED' },
  ];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Content Drafts</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Review, edit, and approve AI-generated research breakdowns before publishing.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {tabs.map((tab) => {
          const isActive = status === tab.value;
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/drafts?status=${tab.value}` : '/drafts'}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {drafts.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8">
          <p className="text-sm font-semibold text-slate-300">No drafts in this category.</p>
          <p className="text-xs text-slate-500 mt-1">
            New drafts are generated automatically when new papers are ingested into your inbox.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drafts.map((draft) => (
            <div
              key={draft.id}
              className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition-all flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {draft.format.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold ${
                      draft.status === 'PUBLISHED'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : draft.status === 'SCHEDULED'
                          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                          : draft.status === 'APPROVED'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {draft.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <div>
                  <p className="text-xs font-semibold text-slate-400 line-clamp-1">
                    {draft.paper.title}
                  </p>
                  <p className="text-sm text-slate-200 mt-1 line-clamp-4 leading-relaxed whitespace-pre-wrap">
                    {draft.body}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Verification: <strong className="text-slate-200">{draft.verificationStatus}</strong>
                </span>
                <Link
                  href={`/drafts/${draft.id}`}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-all"
                >
                  Open Editor →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
