/**
 * The split screen behind /login and /signup: an ink panel that says what the
 * product does, and a cream card that gets on with the form.
 */

import type { ReactNode } from 'react';

const PILLARS = [
  ['Discover', 'ORCID, OpenAlex, arXiv, PubMed and Crossref, polled for you.'],
  ['Draft', 'Posts written in your voice, with every claim traced to the paper.'],
  ['Approve', 'Nothing reaches your feed until you have seen it and said yes.'],
] as const;

export function AuthLayout({
  eyebrow,
  heading,
  blurb,
  children,
}: {
  eyebrow: string;
  heading: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[1.05fr_1fr]">
      <section className="card-ink hidden h-full flex-col justify-between p-10 lg:flex">
        <div>
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-clay-500 text-sm font-bold text-cream-50"
            >
              R
            </span>
            <span className="text-sm font-semibold tracking-[0.22em]">RESEARCHLY</span>
          </div>

          <h2 className="mt-14 max-w-sm text-3xl font-semibold leading-tight tracking-tight">
            Your research, posted the way you would have written it.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-cream-100/60">
            A publishing pipeline for academics — from a newly indexed paper to a verified LinkedIn
            post, without the copy-paste evening.
          </p>
        </div>

        <ul className="mt-14 space-y-5">
          {PILLARS.map(([title, description], index) => (
            <li key={title} className="flex gap-4">
              <span className="mt-0.5 text-[0.7rem] font-semibold tracking-[0.2em] text-clay-300">
                0{index + 1}
              </span>
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-cream-100/55">{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card-raised p-8 sm:p-10">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">{heading}</h1>
        <p className="mb-7 mt-1.5 text-sm text-ink-500">{blurb}</p>
        {children}
      </section>
    </div>
  );
}
