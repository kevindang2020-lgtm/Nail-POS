import { describe, it, expect } from 'vitest';
import { totpCode, verifyTotp, base32Encode, base32Decode, generateSecret } from './totp';

// RFC 6238 test vector: ASCII "12345678901234567890" → base32, SHA1, T=59s → 8-digit 94287082 (6-digit 287082).
const SECRET = base32Encode(Buffer.from('12345678901234567890'));
describe('totp (RFC 6238)', () => {
  it('matches the standard vector at T=59s', () => {
    expect(totpCode(SECRET, 59_000, { digits: 8 })).toBe('94287082');
    expect(totpCode(SECRET, 59_000, { digits: 6 })).toBe('287082');
  });
  it('base32 round-trips', () => { expect(base32Decode(base32Encode(Buffer.from('hello'))).toString()).toBe('hello'); });
  it('verifies the current code and rejects a wrong one', () => {
    const now = 1_700_000_000_000; const code = totpCode(SECRET, now);
    expect(verifyTotp(SECRET, code, now)).toBe(true);
    expect(verifyTotp(SECRET, '000000', now)).toBe(false);
  });
  it('accepts a ±1 step drift but not beyond', () => {
    const now = 1_700_000_000_000; const prev = totpCode(SECRET, now - 30_000);
    expect(verifyTotp(SECRET, prev, now)).toBe(true);
    const old = totpCode(SECRET, now - 120_000);
    expect(verifyTotp(SECRET, old, now)).toBe(false);
  });
  it('generates distinct 32-char secrets', () => { const a = generateSecret(); expect(a).toHaveLength(32); expect(a).not.toBe(generateSecret()); });
});
