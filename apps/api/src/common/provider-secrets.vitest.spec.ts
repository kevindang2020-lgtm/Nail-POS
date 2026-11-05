// provider-secrets.vitest.spec — the ProviderSecrets port the API provides to modules (Constitution 13 §94) is the SAME
// sealing the API has always used: a value sealed through the port opens with provider-crypto and vice versa, so no
// stored row changes when a module switches from importing provider-crypto to injecting the port.
import { describe, it, expect } from 'vitest';
import { PROVIDER_SECRETS, MFA_SECRETS, PAYMENT_SECRETS } from '@aipowersalon/security';
import { providerSecrets, mfaSecrets, paymentSecrets, secretSealers, ProviderSecretsModule } from './provider-secrets.module';
import { encryptKey, decryptKey } from './ai-provider-crypto';
import { encryptFunding, decryptFunding } from './funding-crypto';
import { encryptDeletionCode, decryptDeletionCode } from './ticket-deletion-crypto';
import { encryptSecret as encWebhook, decryptSecret as decWebhook } from './webhook-crypto';
import { SECRET_SEALERS } from '@aipowersalon/security';
import { encryptSecret as encMfa, decryptSecret as decMfa, encryptPaymentSecret, decryptPaymentSecret } from './mfa-enc';
import { encryptSecret, decryptSecret } from './provider-crypto';

describe('ProviderSecrets port', () => {
  it('round-trips, and is wire-compatible with provider-crypto in both directions', () => {
    expect(providerSecrets.decrypt(providerSecrets.encrypt('tw-auth-token'))).toBe('tw-auth-token');
    expect(decryptSecret(providerSecrets.encrypt('a'))).toBe('a');
    expect(providerSecrets.decrypt(encryptSecret('b'))).toBe('b');
  });
  it('refuses a malformed value (callers fall back; a send never crashes on it)', () => {
    expect(() => providerSecrets.decrypt('not-sealed')).toThrow();
  });
  it('is provided globally under the package token', () => {
    const meta = Reflect.getMetadata('providers', ProviderSecretsModule) as any[];
    expect(meta.some((p) => p.provide === PROVIDER_SECRETS)).toBe(true);
    expect(Reflect.getMetadata('__module:global__', ProviderSecretsModule)).toBe(true);
  });
  it('MFA_SECRETS and PAYMENT_SECRETS are wire-compatible with mfa-enc both ways (no stored factor or credential changes)', () => {
    expect(decMfa(mfaSecrets.encrypt('totp'))).toBe('totp'); expect(mfaSecrets.decrypt(encMfa('totp2'))).toBe('totp2');
    expect(decryptPaymentSecret(paymentSecrets.encrypt('api-user'))).toBe('api-user'); expect(paymentSecrets.decrypt(encryptPaymentSecret('pw'))).toBe('pw');
    expect(paymentSecrets.needsReencrypt('v1:legacy')).toBe(true); expect(paymentSecrets.needsReencrypt(paymentSecrets.encrypt('x'))).toBe(false);
    const meta = Reflect.getMetadata('providers', ProviderSecretsModule) as any[];
    for (const t of [PROVIDER_SECRETS, MFA_SECRETS, PAYMENT_SECRETS]) expect(meta.some((p) => p.provide === t), t).toBe(true);
  });
  it('SECRET_SEALERS: every purpose is wire-compatible with its adapter both ways (nothing stored changes)', () => {
    const pairs: [any, (p: string) => string, (e: string) => string][] = [
      ['ai_provider', encryptKey, decryptKey], ['funding', encryptFunding, decryptFunding],
      ['ticket_deletion', encryptDeletionCode, decryptDeletionCode], ['webhook', encWebhook, decWebhook],
    ];
    for (const [purpose, enc, dec] of pairs) {
      const s = secretSealers.forPurpose(purpose);
      expect(dec(s.encrypt('plain-' + purpose)), purpose).toBe('plain-' + purpose);
      expect(s.decrypt(enc('stored-' + purpose)), purpose).toBe('stored-' + purpose);
    }
    expect(secretSealers.forPurpose('mfa')).toBe(mfaSecrets); expect(secretSealers.forPurpose('payments')).toBe(paymentSecrets); expect(secretSealers.forPurpose('provider')).toBe(providerSecrets);
    expect(() => secretSealers.forPurpose('nope' as any)).toThrow(/no sealer/);
    const meta = Reflect.getMetadata('providers', ProviderSecretsModule) as any[];
    expect(meta.some((p) => p.provide === SECRET_SEALERS)).toBe(true);
  });
});
