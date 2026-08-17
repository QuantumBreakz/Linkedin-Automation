/**
 * NextAuth v5 configuration.
 *
 * Email + password against our own `User` table. Three things this file is
 * careful about:
 *
 *  1. **`authorize()` never creates an account.** The previous version
 *     upserted a user for any email typed into the login box, which meant
 *     typing a colleague's address signed you in *as them* and handed you
 *     their papers, drafts and LinkedIn connection. Signing up is an explicit
 *     POST to /api/auth/signup.
 *  2. **Failures are indistinguishable.** Unknown email, password-less
 *     account, and wrong password all return `null` after doing the same work,
 *     so the response does not reveal which addresses are registered.
 *  3. **The JWT carries the user id.** Every query in the app is scoped by it
 *     (see src/lib/session.ts), so it must come from the signed token and
 *     never from a request body or query parameter.
 *
 * No Prisma adapter: with `strategy: 'jwt'` and a credentials provider the
 * adapter is never called, and wiring one in implies Account/Session tables
 * that do not exist in the schema.
 */

import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { authConfig } from '@/lib/auth.config';
import { verifyPassword } from '@/lib/password';
import { logger } from '@/lib/logger';

/** Same shape as `hashPassword` output — burned once so a missing-user path costs the same as a wrong-password path. */
const DUMMY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'JHBOOTZDRWJvZ3VzaGFzaHVzZWRvbmx5Zm9ydGltaW5nZXF1YWxpc2F0aW9uMDAwMDAwMDA=';

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    CredentialsProvider({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === 'string' ? credentials.email.toLowerCase().trim() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';

        if (!email || !password) return null;

        const user = await db.user.findUnique({
          where: { email },
          select: { id: true, email: true, name: true, passwordHash: true },
        });

        // Run the KDF either way: an unregistered email must not return
        // measurably faster than a registered one with a bad password.
        const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !user.passwordHash || !ok) {
          logger.warn('Rejected sign-in attempt', { email });
          return null;
        }

        // Best-effort: a failed bookkeeping write must not block a valid login.
        db.user
          .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
          .catch(() => {});

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
