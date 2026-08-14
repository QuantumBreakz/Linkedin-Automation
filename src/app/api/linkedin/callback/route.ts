import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import { parseCallbackParams, exchangeCode, fetchUserInfo } from '@/services/linkedin/oauth';
import { encryptToken } from '@/lib/crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const { code, state, error, errorDescription } = parseCallbackParams(req.url);

  if (error || !code) {
    logger.warn('LinkedIn OAuth error returned in callback', { error, errorDescription });
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(error ?? 'oauth_failed')}`, req.url));
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get('linkedin_oauth_state')?.value;
  const verifier = cookieStore.get('linkedin_oauth_verifier')?.value;

  // Clear OAuth cookies
  cookieStore.delete('linkedin_oauth_state');
  cookieStore.delete('linkedin_oauth_verifier');

  if (!savedState || savedState !== state || !verifier) {
    logger.warn('LinkedIn OAuth state mismatch or missing verifier');
    return NextResponse.redirect(new URL('/settings?error=invalid_state', req.url));
  }

  try {
    const tokenResponse = await exchangeCode(code, verifier);
    const userInfo = await fetchUserInfo(tokenResponse.accessToken);
    const personUrn = `urn:li:person:${userInfo.sub}`;

    const accessTokenEnc = new Uint8Array(encryptToken(tokenResponse.accessToken));
    const refreshTokenEnc = tokenResponse.refreshToken
      ? new Uint8Array(encryptToken(tokenResponse.refreshToken))
      : null;

    await db.linkedInAccount.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        personUrn,
        displayName: userInfo.name || null,
        avatarUrl: userInfo.picture || null,
        accessTokenEnc,
        accessTokenExpires: tokenResponse.expiresAt,
        refreshTokenEnc,
        refreshTokenExpires: tokenResponse.refreshTokenExpiresAt,
        scopes: tokenResponse.scopes,
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
      },
      update: {
        personUrn,
        displayName: userInfo.name || null,
        avatarUrl: userInfo.picture || null,
        accessTokenEnc,
        accessTokenExpires: tokenResponse.expiresAt,
        refreshTokenEnc,
        refreshTokenExpires: tokenResponse.refreshTokenExpiresAt,
        scopes: tokenResponse.scopes,
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
        expiryNoticesSent: 0,
      },
    });

    logger.info('LinkedIn account connected successfully', {
      userId: session.user.id,
      personUrn,
    });

    return NextResponse.redirect(new URL('/settings?linkedin=connected', req.url));
  } catch (err) {
    logger.error('Failed to complete LinkedIn token exchange in callback', { err });
    return NextResponse.redirect(new URL('/settings?error=exchange_failed', req.url));
  }
}
