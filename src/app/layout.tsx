import type { Metadata } from 'next';
import './globals.css';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/session';
import { TopNav } from '@/components/TopNav';

export const metadata: Metadata = {
  title: 'Researchly — research to LinkedIn',
  description: 'Turn your published research into authentic, verified LinkedIn posts.',
};

/**
 * The shell.
 *
 * The nav is only rendered for a signed-in user, and the one query behind it
 * is scoped to that user's id. Signed-out routes (/login, /signup) get a bare
 * page — they are full-bleed by design.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();

  let reviewCount = 0;
  if (user) {
    reviewCount = await db.contentDraft
      .count({ where: { userId: user.id, status: 'NEEDS_REVIEW' } })
      .catch(() => 0);
  }

  return (
    <html lang="en">
      <body>
        {user && <TopNav reviewCount={reviewCount} userName={user.name || user.email} />}
        <main>{children}</main>
      </body>
    </html>
  );
}
