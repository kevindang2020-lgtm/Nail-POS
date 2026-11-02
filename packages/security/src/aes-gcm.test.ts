import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, open, openWith, parse, looksSealed } from './aes-gcm';
import { maskEmail, maskPhone, maskSecret } from './mask';

const k1 = randomBytes(32), k2 = randomBytes(32);
describe('aes-gcm — both wire formats, rotation', () => {
  it('round-trips the dotted (base64url) format and the prefixed (base64) format', () => {
    for (const fmt of [{ layout: 'dotted' } as const, { layout: 'prefixed', prefix: 'v1' } as const]) {
      const s = seal(k1, 'sk_live_secret ✓', fmt); expect(openWith(k1, s, fmt)).toBe('sk_live_secret ✓');
    }
  });
  it('writes EXACTLY the layouts the seven API modules wrote (data at rest must keep decrypting)', () => {
    expect(seal(k1, 'x', { layout: 'dotted' })).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/);
    expect(seal(k1, 'x', { layout: 'prefixed', prefix: 'v1' })).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/);
  });
  it('rotation: a value sealed under the previous key still opens when the current key is tried first', () => {
    const s = seal(k1, 'old', { layout: 'dotted' }); expect(open([k2, k1], s, { layout: 'dotted' })).toBe('old');
  });
  it('a wrong key, a tampered ciphertext, and a wrong prefix are all refused', () => {
    const s = seal(k1, 'secret', { layout: 'prefixed', prefix: 'v1' });
    expect(() => openWith(k2, s, { layout: 'prefixed', prefix: 'v1' })).toThrow();
    expect(() => openWith(k1, s.slice(0, -2) + 'AA', { layout: 'prefixed', prefix: 'v1' })).toThrow();
    expect(parse(s, { layout: 'prefixed', prefix: 'v2' })).toBeNull();
    expect(looksSealed('plain-text-value', { layout: 'dotted' })).toBe(false);
    expect(() => seal(randomBytes(16), 'x', { layout: 'dotted' })).toThrow(/32 bytes/);
  });
});
describe('masking', () => {
  it('maskEmail keeps first letter + domain', () => { expect(maskEmail('Jane.Doe@Example.com')).toBe('j•••@example.com'); expect(maskEmail('')).toBe('•••'); expect(maskEmail('nope')).toBe('•••'); });
  it('maskPhone keeps the last four', () => { expect(maskPhone('+1 (856) 555-0142')).toBe('•••• 0142'); expect(maskPhone('12')).toBe('•••'); expect(maskPhone('')).toBeUndefined(); });
  it('maskSecret hides the middle of long values and all of short ones', () => { expect(maskSecret('sk_live_abcdefghijklmnop')).toBe('sk_l••••••••mnop'); expect(maskSecret('short')).toBe('••••••'); });
});
