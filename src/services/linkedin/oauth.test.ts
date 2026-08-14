import { describe, it, expect, beforeEach } from 'vitest';
import { generatePkce, buildAuthUrl, parseCallbackParams } from './oauth';

describe('linkedin/oauth', () => {
  beforeEach(() => {
    process.env.CONTACT_EMAIL = 'test@example.com';
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    process.env.NEXTAUTH_SECRET = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    process.env.LINKEDIN_CLIENT_ID = 'test-client-id';
    process.env.LINKEDIN_CLIENT_SECRET = 'test-client-secret';
    process.env.LINKEDIN_REDIRECT_URI = 'http://localhost:3000/callback';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ACCESS_KEY_ID = 'test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
  });

  describe('generatePkce', () => {
    it('generates high-entropy base64url verifier and challenge', () => {
      const { verifier, challenge } = generatePkce();
      expect(verifier).toBeDefined();
      expect(challenge).toBeDefined();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(challenge.length).toBeGreaterThanOrEqual(43);
      expect(verifier).not.toEqual(challenge);
    });
  });

  describe('buildAuthUrl', () => {
    it('constructs valid LinkedIn OAuth URL with PKCE parameters', () => {
      const url = buildAuthUrl({
        state: 'test-state-123',
        codeChallenge: 'test-challenge-abc',
      });
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://www.linkedin.com');
      expect(parsed.pathname).toBe('/oauth/v2/authorization');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('state')).toBe('test-state-123');
      expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge-abc');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('scope')).toContain('w_member_social');
    });
  });

  describe('parseCallbackParams', () => {
    it('parses valid code and state', () => {
      const parsed = parseCallbackParams('https://app.test/callback?code=abc1234&state=xyz');
      expect(parsed).toEqual({ code: 'abc1234', state: 'xyz', error: null, errorDescription: null });
    });

    it('parses error callback parameters', () => {
      const parsed = parseCallbackParams('https://app.test/callback?error=user_cancelled&error_description=The+user+cancelled');
      expect(parsed.error).toBe('user_cancelled');
      expect(parsed.errorDescription).toBe('The user cancelled');
      expect(parsed.code).toBeNull();
    });
  });
});

