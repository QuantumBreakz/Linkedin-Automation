/**
 * NextAuth v5 configuration and session helpers.
 */

import NextAuth from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { db } from '@/lib/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'researcher@university.edu' },
      },
      async authorize(credentials) {
        if (!credentials?.email || typeof credentials.email !== 'string') {
          return null;
        }

        const email = credentials.email.toLowerCase().trim();

        // Upsert user for seamless local development / demo access
        let user = await db.user.findUnique({
          where: { email },
        });

        if (!user) {
          user = await db.user.create({
            data: {
              email,
              name: email.split('@')[0] ?? 'Researcher',
              timezone: 'UTC',
            },
          });

          // Create default brand profile
          await db.brandProfile.create({
            data: {
              userId: user.id,
              tone: 'PROFESSIONAL',
              technicality: 'INTERMEDIATE',
              postLength: 'MEDIUM',
              emojiUsage: 'LOW',
            },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  },
  pages: {
    signIn: '/login',
  },
});
