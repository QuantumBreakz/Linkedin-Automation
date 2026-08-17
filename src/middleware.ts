/**
 * Route protection.
 *
 * Default-deny: everything the matcher covers requires a session, and the
 * public routes are an explicit short list. Adding a new page therefore makes
 * it private automatically — the failure mode of forgetting to update this
 * file is "logged-out users get bounced to /login", never "a page leaks".
 *
 * This is a fast pre-filter, not the security boundary. Reads and writes are
 * scoped by the session user id inside each handler (src/lib/session.ts).
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth.config';

// A second, provider-less NextAuth instance: it can verify and read the JWT
// without importing Prisma, which the edge runtime cannot load.
const { auth } = NextAuth(authConfig);

/** Reachable while signed out. */
const PUBLIC_PATHS = ['/login', '/signup'];

/** Auth endpoints must stay reachable — that is how you get a session. */
const PUBLIC_API_PREFIXES = ['/api/auth'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const signedIn = Boolean(req.auth?.user);

  if (isPublic(pathname)) {
    // A signed-in user has no business on the login screen.
    if (signedIn && (pathname === '/login' || pathname === '/signup')) {
      return NextResponse.redirect(new URL('/', req.nextUrl));
    }
    return NextResponse.next();
  }

  if (signedIn) return NextResponse.next();

  // API callers get a status code they can branch on; page requests get sent
  // to the login screen with a return path so the click is not lost.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', req.nextUrl);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  // Everything except Next's own assets and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)'],
};
