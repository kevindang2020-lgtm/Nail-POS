import { describe, it, expect } from 'vitest';
import { encryptKey, decryptKey, maskKey, keyFingerprint } from './ai-provider-crypto';

describe('ai-provider-crypto', () => {
  it('round-trips encryption', () => {
    const plain = 'sk_live_abc123DEF456ghi789X4K';
    const enc = encryptKey(plain);
    expect(enc).not.toContain(plain);          // ciphertext does not contain plaintext
    expect(decryptKey(enc)).toBe(plain);
  });

  it('produces different ciphertext each time (random IV) but decrypts to the same value', () => {
    const plain = 'sk_live_secret';
    expect(encryptKey(plain)).not.toBe(encryptKey(plain));
    expect(decryptKey(encryptKey(plain))).toBe(plain);
  });

  it('masks a key without revealing the middle', () => {
    const m = maskKey('sk_live_abc123DEF456ghi789X4K');
    expect(m.startsWith('sk_live_')).toBe(true);
    expect(m.endsWith('9X4K')).toBe(true);
    expect(m).toContain('•');
    expect(m).not.toContain('abc123');
  });

  it('fingerprint is stable, short, and not the key', () => {
    const fp = keyFingerprint('sk_live_secret');
    expect(fp).toHaveLength(12);
    expect(keyFingerprint('sk_live_secret')).toBe(fp);
    expect(fp).not.toContain('secret');
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptKey('garbage')).toThrow();
  });
});
