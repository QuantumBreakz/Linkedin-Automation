/**
 * Session access for route handlers and server components.
 *
 * Every read and write in this app belongs to exactly one user. The rule the
 * codebase follows is: **no query without an owner**. These helpers exist so
 * that rule is one import away and impossible to forget halfway through a
 * handler — `requireUserId()` either returns an id or ends the request.
 *
 * Middleware (src/middleware.ts) already blocks unauthenticated requests, but
 * that is a convenience, not the boundary. It can be bypassed by a mismatched
 * matcher or a direct server-side call, so authorisation is re-checked here
 * on every single request.
 */

import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** The signed-in user, or `null`. Never throws. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    email: user.email ?? '',
    name: user.name ?? '',
  };
}

/**
 * Thrown by `requireUserId()`. Carries the 401 response so a handler can
 * `catch (e) { if (e instanceof UnauthorizedError) return e.response; }` — but
 * the normal path is `withUser()` below, which does that for you.
 */
export class UnauthorizedError extends Error {
  readonly response: NextResponse;

  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
    this.response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

/** The signed-in user's id, or a thrown `UnauthorizedError`. */
export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}

/**
 * Wraps an API handler so it only ever runs with a real user id.
 *
 * ```ts
 * export const GET = () => withUser(async (userId) => {
 *   const rows = await db.contentDraft.findMany({ where: { userId } });
 *   return NextResponse.json({ rows });
 * });
 * ```
 */
export async function withUser(
  handler: (userId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) return err.response;
    throw err;
  }
  return handler(userId);
}

/** Server-component guard: returns the user or redirects to /login. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}

/** 404 rather than 403: a user should not learn that another user's id exists. */
export function notFound(entity = 'Resource'): NextResponse {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 });
}

/** 400 with a message the UI can show verbatim. */
export function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
