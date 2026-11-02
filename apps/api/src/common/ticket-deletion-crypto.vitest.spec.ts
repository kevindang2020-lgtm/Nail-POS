import { describe, it, expect } from 'vitest';
import { encryptDeletionCode, decryptDeletionCode } from './ticket-deletion-crypto';
import { generateDeletionCode, verifyDeletionCode as verifyPlain } from '@aipowersalon/super-admin';
const verifyDeletionCode = (supplied: string, enc: string) => verifyPlain(supplied, (() => { try { return decryptDeletionCode(enc); } catch { return ''; } })());

describe('ticket deletion code crypto (epic Req §10)', () => {
  it('generates a zero-padded six-digit CSPRNG code', () => {
    for (let i = 0; i < 300; i++) expect(generateDeletionCode()).toMatch(/^\d{6}$/);
  });

  it('encrypts and decrypts round-trip; ciphertext is versioned and not the plaintext', () => {
    const code = '004217';
    const enc = encryptDeletionCode(code);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain(code);
    expect(decryptDeletionCode(enc)).toBe(code);
  });

  it('verifies the correct code and rejects wrong / short / empty ones', () => {
    const enc = encryptDeletionCode('123456');
    expect(verifyDeletionCode('123456', enc)).toBe(true);
    expect(verifyDeletionCode('123457', enc)).toBe(false);
    expect(verifyDeletionCode('12345', enc)).toBe(false);
    expect(verifyDeletionCode('', enc)).toBe(false);
  });

  it('two encryptions of the same code differ (random IV)', () => {
    expect(encryptDeletionCode('111111')).not.toBe(encryptDeletionCode('111111'));
  });
});
