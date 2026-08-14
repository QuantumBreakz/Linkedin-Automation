import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Research to LinkedIn | Academic Social Automation',
  description: 'Turn your published research into authentic, verified LinkedIn posts.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  let linkedinStatus: { status: string; daysLeft: number } | null = null;
  let counts = { inbox: 0, drafts: 0, scheduled: 0 };

  if (session?.user?.id) {
    const [account, paperCount, reviewCount, schedCount] = await Promise.all([
      db.linkedInAccount.findUnique({
        where: { userId: session.user.id },
        select: { status: true, accessTokenExpires: true },
      }),
      db.researchPaper.count({
        where: { userId: session.user.id, dismissed: false },
      }),
      db.contentDraft.count({
        where: { userId: session.user.id, status: 'NEEDS_REVIEW' },
      }),
      db.contentDraft.count({
        where: { userId: session.user.id, status: 'SCHEDULED' },
      }),
    ]);

    if (account) {
      const daysLeft = Math.max(
        0,
        Math.ceil(
          (account.accessTokenExpires.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        ),
      );
      linkedinStatus = { status: account.status, daysLeft };
    }

    counts = {
      inbox: paperCount,
      drafts: reviewCount,
      scheduled: schedCount,
    };
  }

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased flex flex-col md:flex-row font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
        {/* Sidebar */}
        <aside className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-800/80 bg-slate-900/60 backdrop-blur-xl p-5 flex flex-col justify-between shrink-0">
          <div>
            {/* App Brand */}
            <Link href="/" className="flex items-center gap-3 mb-8 group">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-200">
                <span className="text-white font-bold text-lg">⚡</span>
              </div>
              <div>
                <h1 className="font-bold text-base leading-tight tracking-tight text-white group-hover:text-indigo-300 transition-colors">
                  Research2Post
                </h1>
                <p className="text-xs text-slate-400 font-medium">LinkedIn Engine</p>
              </div>
            </Link>

            {/* Navigation links */}
            <nav className="space-y-1.5 text-sm font-medium">
              <Link
                href="/"
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/70 text-slate-300 hover:text-white transition-all"
              >
                <span className="text-slate-400 text-base">📊</span> Dashboard
              </Link>
              <Link
                href="/inbox"
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/70 text-slate-300 hover:text-white transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-base">📥</span> Research Inbox
                </div>
                {counts.inbox > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
                    {counts.inbox}
                  </span>
                )}
              </Link>
              <Link
                href="/drafts"
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/70 text-slate-300 hover:text-white transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-base">✍️</span> Drafts & Review
                </div>
                {counts.drafts > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {counts.drafts}
                  </span>
                )}
              </Link>
              <Link
                href="/schedule"
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl hover:bg-slate-800/70 text-slate-300 hover:text-white transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-base">🗓️</span> Schedule
                </div>
                {counts.scheduled > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {counts.scheduled}
                  </span>
                )}
              </Link>
              <Link
                href="/sources"
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/70 text-slate-300 hover:text-white transition-all"
              >
                <span className="text-slate-400 text-base">🔬</span> Sources
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-800/70 text-slate-300 hover:text-white transition-all"
              >
                <span className="text-slate-400 text-base">⚙️</span> Voice & Settings
              </Link>
            </nav>
          </div>

          {/* Bottom Card / LinkedIn Status */}
          <div className="mt-8 pt-4 border-t border-slate-800/80">
            <Link
              href="/settings"
              className="block p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  <span className="text-sky-400 font-bold">in</span> LinkedIn
                </span>
                {linkedinStatus?.status === 'ACTIVE' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    Disconnected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {linkedinStatus?.status === 'ACTIVE'
                  ? `Expires in ${linkedinStatus.daysLeft} days`
                  : 'Connect to publish'}
              </p>
            </Link>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-950 min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}
