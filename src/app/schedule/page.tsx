import Link from 'next/link';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export default async function SchedulePage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [scheduledDrafts, publishedPosts] = userId
    ? await Promise.all([
        db.contentDraft.findMany({
          where: { userId, status: 'SCHEDULED' },
          include: { paper: { select: { title: true } } },
          orderBy: { scheduledFor: 'asc' },
        }),
        db.publishedPost.findMany({
          where: { draft: { userId } },
          include: { draft: { select: { body: true, format: true, paper: { select: { title: true } } } } },
          orderBy: { publishedAt: 'desc' },
          take: 10,
        }),
      ])
    : [[], []];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Publishing Schedule</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Manage upcoming queued posts and review your published LinkedIn posts.
        </p>
      </div>

      {/* Upcoming Queued Posts */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🗓️</span> Scheduled Queue ({scheduledDrafts.length})
        </h2>

        {scheduledDrafts.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 text-slate-400 text-xs">
            No posts currently scheduled. Approve a draft to schedule it for auto-publishing.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {scheduledDrafts.map((draft) => (
              <div
                key={draft.id}
                className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300">
                      {draft.format.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs font-semibold text-slate-300">
                      {draft.scheduledFor ? new Date(draft.scheduledFor).toLocaleString() : 'Pending slot'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white line-clamp-1">{draft.paper.title}</p>
                </div>

                <Link
                  href={`/drafts/${draft.id}`}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-all"
                >
                  Edit / Reschedule →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Published Post History */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🚀</span> Recently Published
        </h2>

        {publishedPosts.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-slate-800 bg-slate-900/40 text-slate-400 text-xs">
            No published posts yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {publishedPosts.map((post) => (
              <div
                key={post.id}
                className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800/80 flex items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-400 line-clamp-1">
                    {post.draft.paper.title}
                  </p>
                  <p className="text-xs text-slate-300 line-clamp-2">{post.draft.body}</p>
                  <p className="text-[11px] text-slate-500">
                    Published: {post.publishedAt ? new Date(post.publishedAt).toLocaleString() : 'Recently'}
                  </p>
                </div>

                {post.permalink && (
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition-all shrink-0"
                  >
                    View on LinkedIn ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
