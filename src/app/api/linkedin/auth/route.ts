import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';
import { generatePkce, generateState, buildAuthUrl } from '@/services/linkedin/oauth';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // LinkedIn self-serve OAuth does not support PKCE; sending a verifier at the
  // token step fails client authentication. Opt in with LINKEDIN_USE_PKCE=true
  // if LinkedIn ever ships support.
  const usePkce = env.LINKEDIN_USE_PKCE;
  const pkce = usePkce ? generatePkce() : null;
  const state = generateState();

  const authUrl = buildAuthUrl({
    state,
    ...(pkce ? { codeChallenge: pkce.challenge } : {}),
  });

  const cookieStore = await cookies();
  cookieStore.set('linkedin_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });
  if (pkce) {
    cookieStore.set('linkedin_oauth_verifier', pkce.verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
  }

  return NextResponse.redirect(authUrl);
}
