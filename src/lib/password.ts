/**
 * Password hashing.
 *
 * scrypt from Node's own `crypto`, not bcrypt/argon2. Two reasons:
 *
 *  1. **No native build step.** bcrypt and argon2 both ship prebuilt binaries
 *     that break on a Node major-version bump; this app already asks a
 *     developer to run Postgres, Redis and MinIO before `npm run dev`.
 *  2. **scrypt is memory-hard**, which is the property that matters against
 *     GPU-parallel cracking. PBKDF2 is not.
 *
 * The stored envelope is self-describing so the cost parameters can be raised
 * later without invalidating existing hashes:
 *
 *     scrypt$<N>$<r>$<p>$<salt base64>$<derived key base64>
 *
 * Verification always reads the parameters back out of the stored string, so
 * an old hash keeps verifying with the cost it was created at.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Current cost. N=2^16 ≈ 64 MiB of memory per hash at r=8. */
const PARAMS = { N: 65_536, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/** Node's default maxmem (32 MiB) is below what N=65536,r=8 needs. */
function maxmemFor(N: number, r: number): number {
  return 256 * N * r * 2;
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Why a password is unacceptable, or `null` when it is fine.
 *
 * Deliberately not a complexity ruleset — length is the property that
 * actually correlates with strength, and symbol requirements push people
 * toward `Password1!`.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (/^\s+$/.test(password)) {
    return 'Password cannot be only whitespace.';
  }
  return null;
}

/** Hashes a plaintext password into the storable envelope. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification.
 *
 * Returns `false` — never throws — for a malformed or absent stored hash, so
 * a corrupt row behaves like a wrong password rather than a 500 that tells an
 * attacker the account exists.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64');
    expected = Buffer.from(parts[5]!, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: maxmemFor(N, r),
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
