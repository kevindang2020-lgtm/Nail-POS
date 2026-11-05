import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from './password';

describe('auth/password', () => {
  it('hashes then verifies the same password', async () => {
    const h = await hashPassword('Sup3rSecret!');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Sup3rSecret!', h)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const h = await hashPassword('Sup3rSecret!');
    expect(await verifyPassword('wrong-password', h)).toBe(false);
  });

  it('uses a random salt (two hashes of the same password differ)', async () => {
    const a = await hashPassword('Sup3rSecret!');
    const b = await hashPassword('Sup3rSecret!');
    expect(a).not.toEqual(b);
    expect(await verifyPassword('Sup3rSecret!', a)).toBe(true);
    expect(await verifyPassword('Sup3rSecret!', b)).toBe(true);
  });

  it('returns false (never throws) on malformed/garbage stored hashes', async () => {
    for (const bad of ['', 'not-a-hash', 'scrypt$only$three', 'bcrypt$16384$8$1$x$y', 'scrypt$0$8$1$x$y']) {
      expect(await verifyPassword('whatever', bad as string)).toBe(false);
    }
  });

  it('needsRehash flags non-scrypt or weaker-parameter hashes', async () => {
    const h = await hashPassword('Sup3rSecret!');
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash('scrypt$1024$8$1$x$y')).toBe(true);
    expect(needsRehash('garbage')).toBe(true);
  });
});
