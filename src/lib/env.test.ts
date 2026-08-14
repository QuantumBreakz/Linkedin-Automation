import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError } from './errors';
import { REQUIRED_ENV_KEYS, parseEnv } from './env';

/** A complete, valid environment. Tests mutate a copy of this. */
function validEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/research_linkedin',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    NEXTAUTH_SECRET: randomBytes(32).toString('base64'),
    NEXTAUTH_URL: 'http://localhost:3000',
    LINKEDIN_CLIENT_ID: 'client-id',
    LINKEDIN_CLIENT_SECRET: 'client-secret',
    LINKEDIN_REDIRECT_URI: 'http://localhost:3000/api/linkedin/callback',
    OPENROUTER_API_KEY: 'sk-or-test',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_BUCKET: 'research-linkedin',
    S3_ACCESS_KEY_ID: 'minioadmin',
    S3_SECRET_ACCESS_KEY: 'minioadmin',
    CONTACT_EMAIL: 'you@example.com',
  };
}

describe('parseEnv — happy path', () => {
  it('accepts a complete environment', () => {
    expect(() => parseEnv(validEnv())).not.toThrow();
  });

  it('applies documented defaults', () => {
    const env = parseEnv(validEnv());
    expect(env.LINKEDIN_DRY_RUN).toBe(true);
    expect(env.LINKEDIN_API_VERSION).toBe('202601');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.S3_REGION).toBe('us-east-1');
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(env.APP_NAME).toBe('research-to-linkedin');
  });

  it('leaves optional variables undefined rather than empty strings', () => {
    const env = parseEnv(validEnv());
    expect(env.NCBI_API_KEY).toBeUndefined();
    expect(env.CRON_SECRET).toBeUndefined();
    expect(env.S3_PUBLIC_URL).toBeUndefined();
  });

  it('trims surrounding whitespace, which .env files add freely', () => {
    const env = parseEnv({ ...validEnv(), LINKEDIN_CLIENT_ID: '  client-id  ' });
    expect(env.LINKEDIN_CLIENT_ID).toBe('client-id');
  });

  it('treats an empty optional variable as unset', () => {
    const env = parseEnv({ ...validEnv(), NCBI_API_KEY: '', LOG_LEVEL: '' });
    expect(env.NCBI_API_KEY).toBeUndefined();
    expect(env.LOG_LEVEL).toBe('info');
  });
});

describe('LINKEDIN_DRY_RUN — the publishing kill switch', () => {
  it('defaults to true when unset, so a forgotten variable cannot post', () => {
    expect(parseEnv(validEnv()).LINKEDIN_DRY_RUN).toBe(true);
  });

  it('defaults to true when set to an empty string', () => {
    expect(parseEnv({ ...validEnv(), LINKEDIN_DRY_RUN: '' }).LINKEDIN_DRY_RUN).toBe(true);
  });

  it.each(['true', 'TRUE', '1', 'yes', 'on'])('reads %s as true', (raw) => {
    expect(parseEnv({ ...validEnv(), LINKEDIN_DRY_RUN: raw }).LINKEDIN_DRY_RUN).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no', 'off'])('reads %s as false', (raw) => {
    expect(parseEnv({ ...validEnv(), LINKEDIN_DRY_RUN: raw }).LINKEDIN_DRY_RUN).toBe(false);
  });

  it('rejects a value it cannot interpret instead of silently disabling the switch', () => {
    // The dangerous failure is a typo like `LINKEDIN_DRY_RUN=flase` quietly
    // becoming `false` and publishing for real.
    expect(() => parseEnv({ ...validEnv(), LINKEDIN_DRY_RUN: 'flase' })).toThrow(ConfigError);
  });
});

describe('parseEnv — validation failures', () => {
  it.each(REQUIRED_ENV_KEYS)('reports %s when it is missing', (key) => {
    const source = validEnv();
    delete source[key];
    expect(() => parseEnv(source)).toThrow(new RegExp(key));
  });

  it('lists every problem at once, not just the first', () => {
    const source = validEnv();
    delete source.DATABASE_URL;
    delete source.REDIS_URL;
    delete source.S3_BUCKET;

    let message = '';
    try {
      parseEnv(source);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('REDIS_URL');
    expect(message).toContain('S3_BUCKET');
    expect(message).toContain('3 problems');
  });

  it('throws a ConfigError that is never exposed to clients', () => {
    const source = validEnv();
    delete source.DATABASE_URL;
    try {
      parseEnv(source);
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).expose).toBe(false);
      expect((error as ConfigError).toResponseBody().error.message).not.toContain('DATABASE_URL');
    }
  });

  it('treats an empty required variable as missing', () => {
    expect(() => parseEnv({ ...validEnv(), LINKEDIN_CLIENT_ID: '' })).toThrow(
      /LINKEDIN_CLIENT_ID/,
    );
  });

  it('points at .env.example so the fix is obvious', () => {
    const source = validEnv();
    delete source.CONTACT_EMAIL;
    expect(() => parseEnv(source)).toThrow(/\.env\.example/);
  });
});

describe('ENCRYPTION_KEY validation', () => {
  it('rejects a key that is not 32 bytes', () => {
    expect(() =>
      parseEnv({ ...validEnv(), ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    ).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects a non-base64 key', () => {
    expect(() => parseEnv({ ...validEnv(), ENCRYPTION_KEY: 'not base64 at all!!!' })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });

  it('accepts exactly 32 bytes', () => {
    expect(() =>
      parseEnv({ ...validEnv(), ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    ).not.toThrow();
  });
});

describe('other field validation', () => {
  it('requires NEXTAUTH_SECRET to be long enough to be worth having', () => {
    expect(() => parseEnv({ ...validEnv(), NEXTAUTH_SECRET: 'short' })).toThrow(
      /NEXTAUTH_SECRET/,
    );
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'NEXTAUTH_URL', 'LINKEDIN_REDIRECT_URI', 'S3_ENDPOINT'])(
    'requires %s to be an absolute URL',
    (key) => {
      expect(() => parseEnv({ ...validEnv(), [key]: 'localhost:3000' })).toThrow(new RegExp(key));
    },
  );

  it('requires CONTACT_EMAIL to look like an address', () => {
    // Sent to OpenAlex, Crossref and NCBI as our identity. A junk value here
    // gets our IP range throttled (docs/01 §D5).
    expect(() => parseEnv({ ...validEnv(), CONTACT_EMAIL: 'not-an-email' })).toThrow(
      /CONTACT_EMAIL/,
    );
  });

  it('requires LINKEDIN_API_VERSION to be YYYYMM', () => {
    expect(() => parseEnv({ ...validEnv(), LINKEDIN_API_VERSION: '2026-01' })).toThrow(
      /LINKEDIN_API_VERSION/,
    );
    expect(parseEnv({ ...validEnv(), LINKEDIN_API_VERSION: '202603' }).LINKEDIN_API_VERSION).toBe(
      '202603',
    );
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => parseEnv({ ...validEnv(), LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it.each(['debug', 'info', 'warn', 'error', 'silent'])('accepts LOG_LEVEL=%s', (level) => {
    expect(parseEnv({ ...validEnv(), LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
  });
});

describe('module import safety', () => {
  it('does not throw on import with an empty environment', async () => {
    // Every service transitively imports @/lib/env. If importing it validated
    // eagerly, no unit test could run without a full .env.
    await expect(import('./env')).resolves.toBeDefined();
  });
});
