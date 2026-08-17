import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, validatePasswordStrength } from './password';

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('salts, so the same password hashes differently each time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('stores the cost parameters in the envelope', async () => {
    const hash = await hashPassword('anything');
    expect(hash.split('$').slice(0, 4)).toEqual(['scrypt', '65536', '8', '1']);
  });

  it('returns false rather than throwing for a missing or malformed hash', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', undefined)).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$4$5')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abc$8$1$c2FsdA==$aGFzaA==')).toBe(false);
  });

  it('treats unicode-equivalent passwords as the same password', async () => {
    // "é" composed vs decomposed — the same keystrokes on different keyboards.
    const hash = await hashPassword('café-password');
    expect(await verifyPassword('café-password', hash)).toBe(true);
  });
});

describe('validatePasswordStrength', () => {
  it('accepts a password of at least 8 characters', () => {
    expect(validatePasswordStrength('12345678')).toBeNull();
  });

  it('rejects short passwords', () => {
    expect(validatePasswordStrength('short')).toMatch(/at least 8/);
  });

  it('rejects whitespace-only passwords', () => {
    expect(validatePasswordStrength('          ')).toMatch(/whitespace/);
  });

  it('rejects absurdly long passwords', () => {
    expect(validatePasswordStrength('a'.repeat(201))).toMatch(/at most/);
  });
});
