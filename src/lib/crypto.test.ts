import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CURRENT_ENVELOPE_VERSION,
  decryptToken,
  encryptToken,
  getEncryptionKey,
  isSupportedEnvelope,
  parseEncryptionKey,
  resetEncryptionKeyCache,
  safeEqual,
} from './crypto';
import { CryptoError } from './errors';

const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);

/** A realistic LinkedIn access token: long, opaque, base64url-ish. */
const TOKEN = `AQV${randomBytes(240).toString('base64url')}`;

afterEach(() => {
  resetEncryptionKeyCache();
  delete process.env.ENCRYPTION_KEY;
});

describe('parseEncryptionKey', () => {
  it('accepts a 32-byte base64 key', () => {
    const key = parseEncryptionKey(KEY_A.toString('base64'));
    expect(key).toHaveLength(32);
    expect(key.equals(KEY_A)).toBe(true);
  });

  it('tolerates surrounding whitespace, which .env files love to add', () => {
    expect(parseEncryptionKey(`  ${KEY_A.toString('base64')}\n`).equals(KEY_A)).toBe(true);
  });

  it('rejects a key of the wrong length rather than padding it', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => parseEncryptionKey(short)).toThrow(CryptoError);
    expect(() => parseEncryptionKey(short)).toThrow(/exactly 32 bytes/);
  });

  it('rejects an empty key', () => {
    expect(() => parseEncryptionKey('   ')).toThrow(CryptoError);
  });
});

describe('round trip', () => {
  it('recovers the exact plaintext', () => {
    expect(decryptToken(encryptToken(TOKEN, KEY_A), KEY_A)).toBe(TOKEN);
  });

  it('handles an empty string', () => {
    expect(decryptToken(encryptToken('', KEY_A), KEY_A)).toBe('');
  });

  it('handles multi-byte UTF-8 without corruption', () => {
    const value = 'Zürich · 東京 · 🧬 · Müller-Straße';
    expect(decryptToken(encryptToken(value, KEY_A), KEY_A)).toBe(value);
  });

  it('handles a large payload', () => {
    const value = 'x'.repeat(200_000);
    expect(decryptToken(encryptToken(value, KEY_A), KEY_A)).toBe(value);
  });

  it('returns a Buffer suitable for a Prisma Bytes column', () => {
    expect(Buffer.isBuffer(encryptToken(TOKEN, KEY_A))).toBe(true);
  });

  it('accepts a plain Uint8Array on the way back in', () => {
    const envelope = encryptToken(TOKEN, KEY_A);
    const asUint8 = new Uint8Array(envelope);
    expect(decryptToken(asUint8, KEY_A)).toBe(TOKEN);
  });
});

describe('envelope format', () => {
  it('is v1:<iv>:<tag>:<ciphertext>', () => {
    const parts = encryptToken(TOKEN, KEY_A).toString('utf8').split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe(CURRENT_ENVELOPE_VERSION);
    expect(Buffer.from(parts[1] as string, 'base64')).toHaveLength(12); // 96-bit IV
    expect(Buffer.from(parts[2] as string, 'base64')).toHaveLength(16); // GCM tag
  });

  it('uses a fresh IV per call, so identical tokens do not produce identical rows', () => {
    const first = encryptToken(TOKEN, KEY_A).toString('utf8');
    const second = encryptToken(TOKEN, KEY_A).toString('utf8');
    expect(first).not.toBe(second);
    expect(first.split(':')[1]).not.toBe(second.split(':')[1]);
  });

  it('never leaks the plaintext into the envelope', () => {
    const envelope = encryptToken(TOKEN, KEY_A).toString('utf8');
    expect(envelope).not.toContain(TOKEN);
    expect(envelope).not.toContain(TOKEN.slice(0, 24));
  });

  it('recognises a well-formed envelope without needing the key', () => {
    expect(isSupportedEnvelope(encryptToken(TOKEN, KEY_A))).toBe(true);
    expect(isSupportedEnvelope(Buffer.from('not an envelope', 'utf8'))).toBe(false);
  });
});

describe('wrong key rejection', () => {
  it('refuses to decrypt with a different key', () => {
    const envelope = encryptToken(TOKEN, KEY_A);
    expect(() => decryptToken(envelope, KEY_B)).toThrow(CryptoError);
    expect(() => decryptToken(envelope, KEY_B)).toThrow(/authentication failed/i);
  });

  it('does not reveal which of a wrong key or tampering occurred', () => {
    const envelope = encryptToken(TOKEN, KEY_A);
    const tampered = tamperCiphertext(envelope);

    const wrongKeyMessage = messageOf(() => decryptToken(envelope, KEY_B));
    const tamperedMessage = messageOf(() => decryptToken(tampered, KEY_A));
    expect(wrongKeyMessage).toBe(tamperedMessage);
  });

  it('rejects a key of the wrong size outright', () => {
    const envelope = encryptToken(TOKEN, KEY_A);
    expect(() => decryptToken(envelope, randomBytes(16))).toThrow(/32-byte Buffer/);
  });

  it('rejects an empty key list', () => {
    expect(() => decryptToken(encryptToken(TOKEN, KEY_A), [])).toThrow(/at least one key/);
  });
});

describe('tamper detection', () => {
  it('rejects a modified ciphertext', () => {
    expect(() => decryptToken(tamperCiphertext(encryptToken(TOKEN, KEY_A)), KEY_A)).toThrow(
      CryptoError,
    );
  });

  it('rejects a modified IV', () => {
    const parts = encryptToken(TOKEN, KEY_A).toString('utf8').split(':');
    const iv = Buffer.from(parts[1] as string, 'base64');
    iv[0] = (iv[0] as number) ^ 0xff;
    parts[1] = iv.toString('base64');
    expect(() => decryptToken(Buffer.from(parts.join(':'), 'utf8'), KEY_A)).toThrow(CryptoError);
  });

  it('rejects a modified auth tag', () => {
    const parts = encryptToken(TOKEN, KEY_A).toString('utf8').split(':');
    const tag = Buffer.from(parts[2] as string, 'base64');
    tag[0] = (tag[0] as number) ^ 0xff;
    parts[2] = tag.toString('base64');
    expect(() => decryptToken(Buffer.from(parts.join(':'), 'utf8'), KEY_A)).toThrow(CryptoError);
  });

  it('rejects a truncated ciphertext', () => {
    const parts = encryptToken(TOKEN, KEY_A).toString('utf8').split(':');
    const ciphertext = Buffer.from(parts[3] as string, 'base64');
    parts[3] = ciphertext.subarray(0, ciphertext.length - 8).toString('base64');
    expect(() => decryptToken(Buffer.from(parts.join(':'), 'utf8'), KEY_A)).toThrow(CryptoError);
  });

  it('rejects a swapped-in IV from another envelope', () => {
    const mine = encryptToken(TOKEN, KEY_A).toString('utf8').split(':');
    const theirs = encryptToken('a different token', KEY_A).toString('utf8').split(':');
    mine[1] = theirs[1] as string;
    expect(() => decryptToken(Buffer.from(mine.join(':'), 'utf8'), KEY_A)).toThrow(CryptoError);
  });
});

describe('malformed envelopes', () => {
  it.each([
    ['empty buffer', ''],
    ['no separators', 'garbage'],
    ['too few parts', 'v1:aaaa:bbbb'],
    ['too many parts', 'v1:a:b:c:d'],
    ['unknown version', 'v9:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'],
    ['non-base64 iv', 'v1:!!!!:AAAAAAAAAAAAAAAAAAAAAA==:AAAA'],
  ])('rejects %s', (_label, payload) => {
    expect(() => decryptToken(Buffer.from(payload, 'utf8'), KEY_A)).toThrow(CryptoError);
  });

  it('names the unsupported version so a rotation bug is diagnosable', () => {
    const envelope = encryptToken(TOKEN, KEY_A).toString('utf8').replace(/^v1/, 'v2');
    expect(() => decryptToken(Buffer.from(envelope, 'utf8'), KEY_A)).toThrow(/v2/);
  });

  it('rejects an IV of the wrong length', () => {
    const parts = encryptToken(TOKEN, KEY_A).toString('utf8').split(':');
    parts[1] = randomBytes(16).toString('base64');
    expect(() => decryptToken(Buffer.from(parts.join(':'), 'utf8'), KEY_A)).toThrow(
      /IV must be 12 bytes/,
    );
  });
});

describe('key rotation', () => {
  it('decrypts with any key in the candidate list', () => {
    const oldEnvelope = encryptToken(TOKEN, KEY_A);
    const newEnvelope = encryptToken(TOKEN, KEY_B);

    // During rotation both keys are configured; both rows must stay readable.
    expect(decryptToken(oldEnvelope, [KEY_B, KEY_A])).toBe(TOKEN);
    expect(decryptToken(newEnvelope, [KEY_B, KEY_A])).toBe(TOKEN);
  });

  it('still fails when no candidate matches', () => {
    const envelope = encryptToken(TOKEN, randomBytes(32));
    expect(() => decryptToken(envelope, [KEY_A, KEY_B])).toThrow(CryptoError);
  });
});

describe('getEncryptionKey', () => {
  it('throws a readable error when ENCRYPTION_KEY is unset', () => {
    delete process.env.ENCRYPTION_KEY;
    resetEncryptionKeyCache();
    expect(() => getEncryptionKey()).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('reads and memoises the environment key', () => {
    process.env.ENCRYPTION_KEY = KEY_A.toString('base64');
    resetEncryptionKeyCache();

    expect(getEncryptionKey().equals(KEY_A)).toBe(true);

    // Cached: changing the variable without a reset has no effect.
    process.env.ENCRYPTION_KEY = KEY_B.toString('base64');
    expect(getEncryptionKey().equals(KEY_A)).toBe(true);
  });

  it('round-trips using the ambient key when none is passed', () => {
    process.env.ENCRYPTION_KEY = KEY_A.toString('base64');
    resetEncryptionKeyCache();
    expect(decryptToken(encryptToken(TOKEN))).toBe(TOKEN);
  });
});

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('state-abc-123', 'state-abc-123')).toBe(true);
  });

  it('rejects different strings of equal length', () => {
    expect(safeEqual('state-abc-123', 'state-abc-124')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(safeEqual('short', 'considerably-longer')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

// ─────────────────────────────  helpers  ──────────────────────────────

function tamperCiphertext(envelope: Buffer): Buffer {
  const parts = envelope.toString('utf8').split(':');
  const ciphertext = Buffer.from(parts[3] as string, 'base64');
  ciphertext[0] = (ciphertext[0] as number) ^ 0xff;
  parts[3] = ciphertext.toString('base64');
  return Buffer.from(parts.join(':'), 'utf8');
}

function messageOf(fn: () => unknown): string {
  try {
    fn();
    return '<did not throw>';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
