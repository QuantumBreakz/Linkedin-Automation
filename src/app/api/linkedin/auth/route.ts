import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { generatePkce, generateState, buildAuthUrl } from '@/services/linkedin/oauth';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { verifier, challenge } = generatePkce();
  const state = generateState();

  const authUrl = buildAuthUrl({
    state,
    codeChallenge: challenge,
  });

  const cookieStore = await cookies();
  cookieStore.set('linkedin_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });
  cookieStore.set('linkedin_oauth_verifier', verifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  return NextResponse.redirect(authUrl);
}
