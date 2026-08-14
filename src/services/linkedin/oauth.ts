/**
 * LinkedIn OAuth 2.0 (PKCE) flow.
 *
 * Scopes used:
 *   openid profile email  — Sign In with LinkedIn using OpenID Connect
 *   w_member_social        — Share on LinkedIn (post text + images)
 *
 * Token facts (docs/01 §D3):
 *   - Access token: 60 days, returned as `access_token`
 *   - Refresh token: partner-only (Community Management API). Self-serve apps
 *     get `null` here. The schema stores it optionally; we record it if it
 *     ever arrives, but we do not depend on it.
 */

import { randomBytes, createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { UpstreamError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';

export const LINKEDIN_SCOPES = ['openid', 'profile', 'email', 'w_member_social'] as const;
export type LinkedInScope = (typeof LINKEDIN_SCOPES)[number];

// ─────────────────────────────  PKCE  ──────────────────────────────

/**
 * Generates a PKCE code verifier (random 32-byte URL-safe base64 string)
 * and its S256 challenge.
 */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Generates a cryptographically random OAuth state parameter.
 * Stored in the user's session; compared on callback.
 */
export function generateState(): string {
  return randomBytes(24).toString('base64url');
}

// ──────────────────────────  authorisation URL  ─────────────────────

export interface AuthUrlOptions {
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}

/** Builds the LinkedIn authorisation redirect URL. */
export function buildAuthUrl(opts: AuthUrlOptions): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.LINKEDIN_CLIENT_ID,
    redirect_uri: env.LINKEDIN_REDIRECT_URI,
    state: opts.state,
    scope: (opts.scopes ?? LINKEDIN_SCOPES).join(' '),
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface CallbackParams {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

/** Parses code, state, and error from a callback URL or search string. */
export function parseCallbackParams(urlOrQuery: string): CallbackParams {
  const url = urlOrQuery.startsWith('http')
    ? new URL(urlOrQuery)
    : new URL(urlOrQuery, 'http://localhost');

  return {
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
    errorDescription: url.searchParams.get('error_description'),
  };
}

// ──────────────────────────  token exchange  ─────────────────────────

export interface TokenResponse {
  accessToken: string;
  /** Seconds until expiry — typically 5_184_000 (60 days). */
  expiresIn: number;
  expiresAt: Date;
  /** `null` for self-serve apps; only returned for MDP partners. */
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
}

/**
 * Exchanges an authorisation code for tokens.
 *
 * Does NOT store anything — the caller persists the result to the DB
 * via `storeTokens` in `src/services/linkedin/store.ts`.
 */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.LINKEDIN_REDIRECT_URI,
    client_id: env.LINKEDIN_CLIENT_ID,
    client_secret: env.LINKEDIN_CLIENT_SECRET,
    code_verifier: codeVerifier,
  });

  let raw: Response;
  try {
    raw = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (cause) {
    throw new UpstreamError('LinkedIn', 'Token exchange network failure', { cause, retryable: true });
  }

  if (!raw.ok) {
    const text = await raw.text().catch(() => '');
    logger.warn('LinkedIn token exchange failed', { status: raw.status, body: text });
    throw new UpstreamError('LinkedIn', `Token exchange returned HTTP ${raw.status}`, {
      status: raw.status,
      details: text,
      retryable: raw.status >= 500,
    });
  }

  let data: Record<string, unknown>;
  try {
    data = (await raw.json()) as Record<string, unknown>;
  } catch (cause) {
    throw new UpstreamError('LinkedIn', 'Token exchange returned non-JSON body', { cause });
  }

  const accessToken = String(data['access_token'] ?? '');
  const expiresIn = Number(data['expires_in'] ?? 5_184_000); // 60 days default
  const refreshToken = data['refresh_token'] ? String(data['refresh_token']) : null;
  const refreshExpiresIn = data['refresh_token_expires_in']
    ? Number(data['refresh_token_expires_in'])
    : null;

  if (!accessToken) {
    throw new UpstreamError('LinkedIn', 'Token exchange response missing access_token', {
      details: data,
    });
  }

  const now = new Date();
  return {
    accessToken,
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1_000),
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresIn
      ? new Date(now.getTime() + refreshExpiresIn * 1_000)
      : null,
    scopes: data['scope'] ? String(data['scope']).split(' ') : [],
  };
}

// ──────────────────────────  userinfo  ──────────────────────────────

export interface LinkedInUserInfo {
  sub: string; // urn:li:person:{sub} is the person URN
  name: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  picture?: string;
}

/**
 * Fetches the OIDC userinfo endpoint with the freshly-exchanged access token.
 * `sub` is the bare person identifier — prefix it with `urn:li:person:` for API calls.
 */
export async function fetchUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  let raw: Response;
  try {
    raw = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (cause) {
    throw new UpstreamError('LinkedIn', 'userinfo network failure', { cause, retryable: true });
  }

  if (!raw.ok) {
    const text = await raw.text().catch(() => '');
    throw new UpstreamError('LinkedIn', `userinfo returned HTTP ${raw.status}`, {
      status: raw.status,
      details: text,
      retryable: raw.status >= 500,
    });
  }

  return (await raw.json()) as LinkedInUserInfo;
}
