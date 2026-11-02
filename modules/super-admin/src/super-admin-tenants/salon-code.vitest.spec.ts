import { describe, it, expect } from 'vitest';
import {
  slugifyName,
  namePrefix,
  randomSuffix,
  isValidSalonCode,
  generateSalonCode,
  allocateSalonCode,
} from './salon-code';

// Deterministic PRNG (mulberry32) so suffix output is reproducible in tests.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('salon-code', () => {
  it('slugifies names (accents, symbols, spaces)', () => {
    expect(slugifyName('Luxe Nails & Spa')).toBe('LUXENAILSSPA');
    expect(slugifyName('Belle Palace — NJ')).toBe('BELLEPALACENJ');
    expect(slugifyName('Café Crème')).toBe('CAFECREME');
  });

  it('builds a padded letter prefix', () => {
    expect(namePrefix('Luxe Nails')).toBe('LUXE');
    expect(namePrefix('Hi')).toBe('HIXX');
    expect(namePrefix('', 4)).toBe('SALO'); // falls back to SALON
    expect(namePrefix('Marlton Day Spa', 3)).toBe('MAR');
  });

  it('produces a suffix only from the unambiguous alphabet', () => {
    const s = randomSuffix(40, seeded(7));
    expect(/^[A-HJ-NP-Z2-9]+$/.test(s)).toBe(true); // no I, O, 0, 1
    expect(s.length).toBe(40);
  });

  it('generates a validly-shaped code', () => {
    const code = generateSalonCode('Luxe Nails & Spa', { rnd: seeded(1) });
    expect(code.startsWith('LUXE')).toBe(true);
    expect(isValidSalonCode(code)).toBe(true);
  });

  it('isValidSalonCode accepts good and rejects bad', () => {
    expect(isValidSalonCode('LUXE7K2')).toBe(true);
    expect(isValidSalonCode('BELLEPALACE99')).toBe(true);
    expect(isValidSalonCode('luxe7k2')).toBe(false); // lowercase
    expect(isValidSalonCode('LU XE')).toBe(false);   // space
    expect(isValidSalonCode('A')).toBe(false);       // too short
    expect(isValidSalonCode('')).toBe(false);
  });

  it('allocates a unique code, retrying past collisions', async () => {
    const taken = new Set(['LUXEAAA', 'LUXEAAB']);
    let calls = 0;
    const exists = (c: string) => { calls++; return taken.has(c); };
    const code = await allocateSalonCode('Luxe Nails', exists, { rnd: seeded(3) });
    expect(taken.has(code)).toBe(false);
    expect(isValidSalonCode(code)).toBe(true);
    expect(calls).toBeGreaterThan(0);
  });

  it('widens the suffix when the base space is exhausted', async () => {
    // Everything 7 chars is "taken"; allocator must widen to length 9.
    const exists = (c: string) => c.length === 7;
    const code = await allocateSalonCode('Luxe Nails', exists, { rnd: seeded(9), maxTries: 5 });
    expect(code.length).toBe(9);
    expect(isValidSalonCode(code)).toBe(true);
  });

  it('throws only when truly unable to allocate', async () => {
    const always = () => true;
    await expect(allocateSalonCode('X', always, { maxTries: 3 })).rejects.toThrow();
  });
});
