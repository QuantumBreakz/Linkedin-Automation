/**
 * AES-256-GCM envelope encryption for LinkedIn OAuth tokens.
 *
 * Threat model: an attacker with a copy of the database (a dump, a stolen
 * backup, a mis-scoped read replica) must not be able to post to any member's
 * feed. The key lives only in `ENCRYPTION_KEY`, never in Postgres.
 *
 * Envelope format — a UTF-8 string, stored in a `Bytes` column:
 *
 *     v1:<base64 iv>:<base64 auth tag>:<base64 ciphertext>
 *
 * The version prefix is what makes rotation possible later: `decryptToken`
 * dispatches on it, so a future `v2` (different cipher, different KDF, or a
 * key-id lookup) can be introduced while `v1` rows are still readable.
 *
 * Rotation today: pass every candidate key to `decryptToken` — the old one and
 * the new one — re-encrypt with the new key, then drop the old key from the
 * environment. GCM's auth tag makes "wrong key" indistinguishable from
 * "tampered ciphertext", which is exactly the behaviour we want; both are
 * rejected, neither leaks which.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { CryptoError } from './errors';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
/** 96-bit IV: the size GCM is specified for, and the only one worth using. */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SEPARATOR = ':';

export const CURRENT_ENVELOPE_VERSION = 'v1';
export const SUPPORTED_ENVELOPE_VERSIONS: readonly string[] = [CURRENT_ENVELOPE_VERSION];

/**
 * Decodes and validates a base64 `ENCRYPTION_KEY`.
 * Throws rather than padding or hashing a short key into shape — silently
 * accepting a weak key is worse than refusing to start.
 */
export function parseEncryptionKey(base64Key: string): Buffer {
  const trimmed = base64Key.trim();
  if (trimmed.length === 0) {
    throw new CryptoError('ENCRYPTION_KEY is empty.');
  }
  let key: Buffer;
  try {
    key = Buffer.from(trimmed, 'base64');
  } catch (cause) {
    throw new CryptoError('ENCRYPTION_KEY is not valid base64.', cause);
  }
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes, got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

let cachedKey: Buffer | undefined;

/**
 * The process encryption key, read lazily from the environment.
 *
 * Lazy on purpose: importing this module in a unit test must not require a
 * configured environment. Tests pass their own key explicitly.
 */
export function getEncryptionKey(): Buffer {
  if (cachedKey === undefined) {
    const raw = process.env.ENCRYPTION_KEY;
    if (raw === undefined || raw.trim() === '') {
      throw new CryptoError(
        'ENCRYPTION_KEY is not set. LinkedIn tokens cannot be read or written without it.',
      );
    }
    cachedKey = parseEncryptionKey(raw);
  }
  return cachedKey;
}

/** Test hook: forget the memoised key so a changed environment is picked up. */
export function resetEncryptionKeyCache(): void {
  cachedKey = undefined;
}

/**
 * Encrypts a token string.
 *
 * @param plaintext the raw access or refresh token
 * @param key 32-byte key; defaults to `ENCRYPTION_KEY`
 * @returns the envelope, ready for a Prisma `Bytes` column
 */
export function encryptToken(plaintext: string, key: Buffer = getEncryptionKey()): Buffer {
  assertKey(key);
  if (typeof plaintext !== 'string') {
    throw new CryptoError('encryptToken expects a string.');
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const envelope = [
    CURRENT_ENVELOPE_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(SEPARATOR);

  return Buffer.from(envelope, 'utf8');
}

/**
 * Decrypts an envelope produced by {@link encryptToken}.
 *
 * @param payload the stored `Bytes` value
 * @param keys one key, or an ordered list to try (oldest last) during rotation
 * @throws {CryptoError} on a malformed envelope, an unknown version, a wrong
 *   key, or any tampering — GCM authentication failure is not recoverable and
 *   is never swallowed.
 */
export function decryptToken(
  payload: Buffer | Uint8Array,
  keys: Buffer | readonly Buffer[] = getEncryptionKey(),
): string {
  const candidates: readonly Buffer[] = Buffer.isBuffer(keys) ? [keys] : keys;
  if (candidates.length === 0) {
    throw new CryptoError('decryptToken requires at least one key.');
  }
  for (const key of candidates) assertKey(key);

  const { iv, tag, ciphertext } = parseEnvelope(payload);

  for (const key of candidates) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Wrong key or tampered payload — indistinguishable by design. Try the
      // next candidate; if none work we throw a single generic error below.
    }
  }

  throw new CryptoError(
    'Token could not be decrypted: authentication failed. The ciphertext was modified, ' +
      'or none of the supplied keys match the one it was encrypted with.',
  );
}

/** Whether `payload` looks like an envelope this module can attempt to open. */
export function isSupportedEnvelope(payload: Buffer | Uint8Array): boolean {
  try {
    parseEnvelope(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison for opaque secrets (OAuth `state`, cron shared
 * secret, idempotency tokens). Length is not secret; content is.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ─────────────────────────────  internals  ─────────────────────────────

interface Envelope {
  version: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function parseEnvelope(payload: Buffer | Uint8Array): Envelope {
  if (payload === null || payload === undefined) {
    throw new CryptoError('Encrypted token payload is missing.');
  }
  const text = Buffer.from(payload).toString('utf8');
  const parts = text.split(SEPARATOR);
  if (parts.length !== 4) {
    throw new CryptoError(
      `Malformed token envelope: expected 4 ':'-separated parts, got ${parts.length}.`,
    );
  }

  const [version, ivB64, tagB64, ciphertextB64] = parts as [string, string, string, string];

  if (!SUPPORTED_ENVELOPE_VERSIONS.includes(version)) {
    throw new CryptoError(
      `Unsupported token envelope version '${version}'. Supported: ${SUPPORTED_ENVELOPE_VERSIONS.join(', ')}.`,
    );
  }

  const iv = decodeBase64(ivB64, 'iv');
  const tag = decodeBase64(tagB64, 'auth tag');
  const ciphertext = decodeBase64(ciphertextB64, 'ciphertext');

  if (iv.length !== IV_BYTES) {
    throw new CryptoError(`Malformed token envelope: IV must be ${IV_BYTES} bytes, got ${iv.length}.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new CryptoError(
      `Malformed token envelope: auth tag must be ${TAG_BYTES} bytes, got ${tag.length}.`,
    );
  }

  return { version, iv, tag, ciphertext };
}

/**
 * `Buffer.from(x, 'base64')` ignores garbage instead of failing, so we
 * round-trip to confirm the input really was base64.
 */
function decodeBase64(value: string, label: string): Buffer {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new CryptoError(`Malformed token envelope: ${label} is not valid base64.`);
  }
  return decoded;
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new CryptoError(
      `Encryption key must be a ${KEY_BYTES}-byte Buffer, got ${
        Buffer.isBuffer(key) ? `${key.length} bytes` : typeof key
      }.`,
    );
  }
}
