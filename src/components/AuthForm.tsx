'use client';

/**
 * Sign-in and sign-up, one component.
 *
 * Both flows end the same way — `signIn('credentials', …)` with a real
 * password — so keeping them together means the redirect handling, error
 * surface, and loading state cannot drift between the two screens.
 */

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup';
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/';

  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (isSignup) {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email,
            password,
            title: title || undefined,
            // The account's posting schedule is interpreted in this zone.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? 'Could not create the account.');
          return;
        }
      }

      const result = await signIn('credentials', { email, password, redirect: false });

      if (result?.error) {
        setError(
          isSignup
            ? 'Account created, but signing in failed. Try logging in.'
            : 'That email and password do not match an account.',
        );
        return;
      }

      router.push(next);
      router.refresh();
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-2xl bg-rust-100 px-4 py-3 text-xs font-medium text-rust-500"
        >
          {error}
        </p>
      )}

      {isSignup && (
        <>
          <div>
            <label className="label" htmlFor="name">
              Full name
            </label>
            <input
              id="name"
              className="input"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dr Amina Rahman"
            />
          </div>
          <div>
            <label className="label" htmlFor="title">
              Title <span className="normal-case tracking-normal text-ink-500">(optional)</span>
            </label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Postdoctoral Researcher, Computational Biology"
            />
          </div>
        </>
      )}

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="input"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="researcher@university.edu"
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          required
          minLength={isSignup ? 8 : undefined}
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isSignup ? 'At least 8 characters' : '••••••••'}
        />
      </div>

      <button type="submit" disabled={busy} className="btn btn-primary w-full uppercase tracking-[0.14em]">
        {busy ? 'Working…' : isSignup ? 'Create account' : 'Sign in'}
      </button>

      <p className="pt-1 text-center text-xs text-ink-500">
        {isSignup ? 'Already have an account? ' : 'New here? '}
        <Link
          href={isSignup ? '/login' : '/signup'}
          className="font-semibold text-clay-600 hover:text-clay-700"
        >
          {isSignup ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
