import Link from 'next/link';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export default async function InboxPage() {
  const session = await auth();
  const userId = session?.user?.id;

  const papers = userId
    ? await db.researchPaper.findMany({
        where: { userId, dismissed: false },
        include: {
          authors: { orderBy: { position: 'asc' } },
          analyses: { take: 1, orderBy: { createdAt: 'desc' } },
          drafts: {
            select: { id: true, status: true, format: true, verificationStatus: true },
          },
        },
        orderBy: { discoveredAt: 'desc' },
      })
    : [];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Research Inbox</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            All discovered papers from your connected ORCID and OpenAlex sources.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/sources"
            className="px-4 py-2 rounded-xl text-sm font-medium bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 transition-all"
          >
            Manage Sources
          </Link>
        </div>
      </div>

      {papers.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 space-y-3">
          <div className="text-4xl">📚</div>
          <h3 className="text-base font-semibold text-white">Your inbox is empty</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Connect an ORCID or OpenAlex author ID to automatically import your research publications.
          </p>
          <Link
            href="/sources"
            className="inline-block mt-2 px-4 py-2 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-all"
          >
            Add Research Source
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {papers.map((paper) => {
            const analysis = paper.analyses[0];
            const draft = paper.drafts[0];

            return (
              <div
                key={paper.id}
                className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700/80 transition-all space-y-3"
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-800 text-slate-300">
                        {paper.fullTextStatus.replace(/_/g, ' ')}
                      </span>
                      {paper.venue && (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-800 text-slate-400">
                          {paper.venue}
                        </span>
                      )}
                      {analysis && (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          Confidence: {Math.round(analysis.confidence * 100)}%
                        </span>
                      )}
                      {paper.isRetracted && (
                        <span className="px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          RETRACTED
                        </span>
                      )}
                    </div>

                    <h2 className="text-base font-bold text-white hover:text-indigo-300 transition-colors">
                      {paper.landingUrl ? (
                        <a href={paper.landingUrl} target="_blank" rel="noreferrer">
                          {paper.title} ↗
                        </a>
                      ) : (
                        paper.title
                      )}
                    </h2>

                    <p className="text-xs text-slate-400">
                      Authors:{' '}
                      {paper.authors.length > 0
                        ? paper.authors.map((a) => a.name).join(', ')
                        : 'Unspecified'}
                    </p>

                    {paper.abstract && (
                      <p className="text-xs text-slate-300/80 line-clamp-2 leading-relaxed">
                        {paper.abstract}
                      </p>
                    )}
                  </div>

                  <div className="flex md:flex-col items-center md:items-end gap-2 shrink-0">
                    {draft ? (
                      <Link
                        href={`/drafts/${draft.id}`}
                        className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-all"
                      >
                        View Draft ({draft.status})
                      </Link>
                    ) : (
                      <span className="text-xs font-medium text-slate-500 bg-slate-800/50 px-3 py-1.5 rounded-xl">
                        Queued for Analysis
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
