import { describe, it, expect } from 'vitest';
import { normalizeCode, hashCode, codeHint, generateCodes, validateSharedCode, lookupBlocked, CODE_ALPHABET, walletQrPayload, parseWalletQr, LOOKUP_FAILURES_PER_ACTOR } from './coupons';

describe('coupon codes', () => {
  it('normalizes the way the backfill did (upper, letters/digits only)', () => {
    expect(normalizeCode(' spring-10 ')).toBe('SPRING10');
    expect(normalizeCode(42)).toBe('');
  });
  it('hashes per salon: the same code in two salons is two different hashes; formatting does not matter', () => {
    expect(hashCode('t1', 'spring-10')).toBe(hashCode('t1', 'SPRING10'));
    expect(hashCode('t1', 'SPRING10')).not.toBe(hashCode('t2', 'SPRING10'));
    expect(hashCode('t1', 'SPRING10')).toMatch(/^[0-9a-f]{64}$/);
    expect(codeHint('ab-cd-ef12')).toBe('EF12');
  });
  it('generates distinct, unambiguous codes with an optional prefix', () => {
    const codes = generateCodes(500, 'vip');
    expect(new Set(codes).size).toBe(500);
    for (const c of codes) { expect(c).toMatch(/^VIP-[A-Z2-9]{4}-[A-Z2-9]{4}$/); for (const ch of c.replace(/-/g, '').slice(3)) expect(CODE_ALPHABET).toContain(ch); }
    expect(() => generateCodes(0)).toThrow(RangeError);
    expect(() => generateCodes(10_001)).toThrow(RangeError);
    expect(() => generateCodes(1, 'x')).toThrow(RangeError);
  });
  it('a shared code is 4–32 characters', () => {
    expect(validateSharedCode('ab')).toMatch(/4–32/);
    expect(validateSharedCode('SPRING10')).toBeNull();
  });
  it('the lookup limit trips per person and per salon', () => {
    expect(lookupBlocked(LOOKUP_FAILURES_PER_ACTOR - 1, 0)).toBe(false);
    expect(lookupBlocked(LOOKUP_FAILURES_PER_ACTOR, 0)).toBe(true);
    expect(lookupBlocked(0, 200)).toBe(true);
  });
  it('a wallet QR carries a reference, never a code', () => {
    const id = '0b5c6a3e-1111-4222-8333-444455556666';
    expect(parseWalletQr(walletQrPayload(id))).toBe(id);
    expect(parseWalletQr('SPRING10')).toBeNull();
    expect(parseWalletQr('APS-CPN:not-a-uuid')).toBeNull();
  });
});
