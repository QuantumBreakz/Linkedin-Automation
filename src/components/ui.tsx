/**
 * Presentational primitives shared across pages.
 *
 * Pure and server-renderable — none of these hold state or reach for a
 * browser API, so a page only becomes a client component when it genuinely
 * needs interaction. The visual vocabulary (cream cards, uppercase eyebrows,
 * terracotta actions) lives in globals.css; this file just composes it.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

// ────────────────────────────────  page  ────────────────────────────────

/**
 * `compact` trims the bottom padding for pages that size themselves to the
 * viewport (chat), where the usual scroll runway is wasted space.
 */
export function PageShell({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-5 pt-8 sm:px-8 ${compact ? 'pb-6' : 'pb-24'}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        {title && (
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900 sm:text-[1.75rem]">
            {title}
          </h1>
        )}
        {description && <p className="mt-1.5 max-w-2xl text-sm text-ink-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

/** Row of pill links used as sub-navigation inside a section. */
export function TabBar({
  tabs,
  current,
}: {
  tabs: Array<{ href: string; label: string; count?: number }>;
  current: string;
}) {
  return (
    <nav className="mb-7 flex flex-wrap gap-2.5">
      {tabs.map((tab) => {
        const active = tab.href === current;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`chip ${active ? 'chip-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
            {typeof tab.count === 'number' && tab.count > 0 && (
              <span className={active ? 'opacity-80' : 'text-clay-600'}>· {tab.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ───────────────────────────────  surfaces  ─────────────────────────────

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'li';
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-ink-900">{title}</h2>
        {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-ink-900/15 bg-cream-50/60 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-ink-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-ink-500">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

// ────────────────────────────────  data  ────────────────────────────────

/**
 * A number worth glancing at. The ring echoes the compatibility dials in the
 * reference design: `tone` picks its colour, `progress` (0–1) its sweep.
 */
export function StatTile({
  label,
  value,
  hint,
  progress,
  tone = 'clay',
}: {
  label: string;
  value: number | string;
  hint?: string;
  progress?: number;
  tone?: 'clay' | 'ink' | 'sage' | 'warn';
}) {
  const stroke = {
    clay: 'var(--color-clay-500)',
    ink: 'var(--color-ink-900)',
    sage: 'var(--color-sage-500)',
    warn: 'var(--color-amber-warn)',
  }[tone];

  const pct = Math.max(0, Math.min(1, progress ?? 0));
  const circumference = 2 * Math.PI * 20;

  return (
    <div className="card flex items-center justify-between gap-4 p-6">
      <div className="min-w-0">
        <p className="label mb-1.5">{label}</p>
        <p className="text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
        {hint && <p className="mt-1 truncate text-xs text-ink-500">{hint}</p>}
      </div>
      {progress !== undefined && (
        <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="24" cy="24" r="20" fill="none" stroke="var(--color-cream-400)" strokeWidth="3.5" />
          <circle
            cx="24"
            cy="24"
            r="20"
            fill="none"
            stroke={stroke}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={`${(pct * circumference).toFixed(2)} ${circumference.toFixed(2)}`}
          />
        </svg>
      )}
    </div>
  );
}

const BADGE_TONES = {
  neutral: 'badge-neutral',
  ok: 'badge-ok',
  warn: 'badge-warn',
  danger: 'badge-danger',
  clay: 'badge-clay',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return <span className={`badge ${BADGE_TONES[tone]}`}>{children}</span>;
}

/** Draft/verification statuses → a badge tone, in one place. */
export function statusTone(status: string): keyof typeof BADGE_TONES {
  switch (status) {
    case 'PUBLISHED':
    case 'PASSED':
    case 'APPROVED':
    case 'OK':
    case 'ACTIVE':
      return 'ok';
    case 'NEEDS_REVIEW':
    case 'FLAGGED':
    case 'PENDING':
    case 'EXPIRING':
      return 'warn';
    case 'FAILED':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'REVOKED':
      return 'danger';
    case 'SCHEDULED':
    case 'PUBLISHING':
      return 'clay';
    default:
      return 'neutral';
  }
}

export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Initials in a cream circle. No remote avatars, so nothing to fail to load. */
export function Avatar({
  name,
  src,
  size = 40,
  tone = 'cream',
}: {
  name: string;
  src?: string | null;
  size?: number;
  tone?: 'cream' | 'ink' | 'clay';
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  const tones = {
    cream: 'bg-cream-400 text-ink-800',
    ink: 'bg-ink-900 text-cream-100',
    clay: 'bg-clay-500 text-cream-50',
  } as const;

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary remote URLs from LinkedIn; next/image would need a host allowlist we cannot know ahead of time
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tones[tone]}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || '·'}
    </span>
  );
}

/** Whole days from now until `date`, floored at zero. */
export function daysUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

/** Honorifics that should not be mistaken for a first name. */
const HONORIFICS = new Set(['dr', 'dr.', 'prof', 'prof.', 'professor', 'mr', 'mr.', 'ms', 'ms.', 'mrs', 'mrs.', 'mx', 'mx.']);

/** "Dr. Elena Rostova" → "Elena". Falls back to the whole string. */
export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts.find((part) => !HONORIFICS.has(part.toLowerCase()));
  return first ?? fullName.trim() ?? '';
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
