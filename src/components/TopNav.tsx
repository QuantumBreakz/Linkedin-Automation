'use client';

/**
 * The floating pill navigation.
 *
 * Client-side only because it needs `usePathname()` to mark the active
 * section; the counts it renders are computed on the server and passed in, so
 * no data fetching happens here.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';

interface NavItem {
  href: string;
  label: string;
  /** Extra paths that should light this item up. */
  match?: string[];
  count?: number;
}

export function TopNav({
  reviewCount,
  userName,
}: {
  reviewCount: number;
  userName: string;
}) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: '/', label: 'Dashboard' },
    { href: '/inbox', label: 'Research', match: ['/sources'] },
    { href: '/drafts', label: 'Drafts', count: reviewCount },
    { href: '/chat', label: 'Chat' },
    { href: '/schedule', label: 'Schedule' },
    { href: '/settings', label: 'Profile' },
  ];

  function isActive(item: NavItem): boolean {
    if (item.href === '/') return pathname === '/';
    if (pathname.startsWith(item.href)) return true;
    return (item.match ?? []).some((prefix) => pathname.startsWith(prefix));
  }

  return (
    <header className="sticky top-0 z-50 bg-cream-100/85 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-lg bg-clay-500 text-[0.8rem] font-bold text-cream-50"
          >
            R
          </span>
          <span className="text-sm font-semibold tracking-[0.22em] text-ink-900">RESEARCHLY</span>
        </Link>

        <nav
          aria-label="Main"
          className="hidden items-center gap-1 rounded-full bg-ink-900 p-1.5 md:flex"
        >
          {items.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] transition-colors ${
                  active
                    ? 'bg-clay-500 text-cream-50'
                    : 'text-cream-100/65 hover:text-cream-100'
                }`}
              >
                {item.label}
                {item.count !== undefined && item.count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[0.65rem] ${
                      active ? 'bg-cream-50/25' : 'bg-clay-500/25 text-clay-300'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-medium text-ink-500 lg:inline">{userName}</span>
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: '/login' })}
            className="btn btn-primary btn-sm uppercase tracking-[0.14em]"
          >
            Sign out
          </button>
        </div>
      </div>

      {/* Compact nav: the same destinations, scrollable, below md. */}
      <nav
        aria-label="Main (compact)"
        className="flex gap-1.5 overflow-x-auto px-5 pb-3 md:hidden"
      >
        {items.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`chip shrink-0 ${active ? 'chip-active' : ''}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
