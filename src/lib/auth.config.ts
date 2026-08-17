/**
 * The half of the NextAuth config that is safe to run on the edge.
 *
 * Middleware runs in the edge runtime, where Prisma cannot be imported. So the
 * config is split: everything here is pure (no database, no Node built-ins)
 * and is used by *both* src/middleware.ts and src/lib/auth.ts. The credentials
 * provider — the only part that touches the database — is added on top in
 * src/lib/auth.ts, which only ever runs in Node.
 *
 * This is the NextAuth v5 "split config" pattern; without it, middleware
 * fails at build time with a Prisma edge-runtime error.
 */

import type { NextAuthConfig } from 'next-auth';

/**
 * v5 looks for `AUTH_SECRET`; this project's `.env` (and `src/lib/env.ts`)
 * standardise on `NEXTAUTH_SECRET`. Read both rather than making every
 * deployment set the same value twice.
 */
const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

export const authConfig = {
  secret,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  // Providers are attached in src/lib/auth.ts. An empty list here is correct:
  // middleware only ever *reads* an existing token, it never signs anyone in.
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
} satisfies NextAuthConfig;
