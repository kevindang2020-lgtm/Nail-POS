// legacy-cipher-rows — Constitution 13 §200–202 / §81: consolidating seven AES-GCM modules into @aipowersalon/security
// must never require re-encrypting a row. These values are built in the EXACT byte layouts the original modules wrote
// (dotted base64url; prefixed base64), and must open through the adapters that replaced them.
import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes, createHash } from 'node:crypto';
const key = createHash('sha256').update('legacy-rows-test-key').digest();
const dotted = (plain: string) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return [iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.'); };
const prefixed = (prefix: string, plain: string) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key, iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return `${prefix}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`; };
describe('rows written by the ORIGINAL cipher modules open through the @aipowersalon/security adapters', () => {
  it('provider / webhook / funding / ai-provider (dotted) · mfa / payments / ticket-deletion (prefixed)', async () => {
    for (const v of ['PROVIDER_VAULT_KEK', 'WEBHOOK_SIGNING_KEK', 'FUNDING_VAULT_KEK', 'AI_PROVIDER_KEK', 'MFA_ENC_KEY', 'PAYMENT_ENC_KEY', 'TICKET_DELETION_ENC_KEY']) process.env[v] = key.toString('hex');
    const p = await import('./provider-crypto'); expect(p.decryptSecret(dotted('twilio-token'))).toBe('twilio-token');
    const w = await import('./webhook-crypto'); expect(w.decryptSecret(dotted('whsec'))).toBe('whsec');
    const f = await import('./funding-crypto'); expect(f.decryptFunding(dotted('021000021'))).toBe('021000021');
    const a = await import('./ai-provider-crypto'); expect(a.decryptKey(dotted('sk-live'))).toBe('sk-live');
    const m = await import('./mfa-enc');
    expect(m.decryptSecret(prefixed('v1', 'JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
    expect(m.decryptPaymentSecret(prefixed('v2p', 'merchant-key'))).toBe('merchant-key');
    expect(m.decryptPaymentSecret(prefixed('v1', 'old-merchant-key'))).toBe('old-merchant-key');   // pre-PAYMENT_ENC_KEY row, under the MFA key
    expect(m.decryptSecret('plain-legacy')).toBe('plain-legacy');                                   // plaintext tolerance kept
    // Constitution 13: the sealer opens the row; the constant-time compare lives with ticket removal and takes the plain code
    const t = await import('./ticket-deletion-crypto'); const { verifyDeletionCode } = await import('@aipowersalon/super-admin');
    expect(verifyDeletionCode('004217', t.decryptDeletionCode(prefixed('v1', '004217')))).toBe(true);
  }, 60_000);   // cold dynamic imports of the crypto adapters + @aipowersalon/super-admin take ~20 s under a full lane
  it('and a value sealed by an adapter today has the same layout the originals wrote', async () => {
    const p = await import('./provider-crypto'); expect(p.encryptSecret('x')).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/);
    const m = await import('./mfa-enc'); expect(m.encryptSecret('x')).toMatch(/^v1:/); expect(m.encryptPaymentSecret('x')).toMatch(/^v2p:/);
  });
});
