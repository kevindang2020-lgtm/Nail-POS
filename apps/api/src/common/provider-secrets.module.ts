// provider-secrets.module.ts — the API's implementation of the ProviderSecrets port (@aipowersalon/security), over the
// key ring (Constitution 12 §40–47). @Global so any module can list PROVIDER_SECRETS in a factory's inject array
// without importing this module — the same shape as DATABASE. Domain modules never import the key ring itself.
import { KEY_SOURCES } from './key-ring';   // the one registry of key env names (never a name invented here)
import { Global, Module } from '@nestjs/common';
import { PROVIDER_SECRETS, MFA_SECRETS, PAYMENT_SECRETS, SECRET_SEALERS, type ProviderSecrets, type PaymentSecrets, type SecretSealers, type SealPurpose } from '@aipowersalon/security';
import { encryptKey, decryptKey, isProviderKekConfigured } from './ai-provider-crypto';
import { encryptFunding, decryptFunding, isFundingVaultConfigured } from './funding-crypto';
import { encryptDeletionCode, decryptDeletionCode, isTicketDeletionKekConfigured } from './ticket-deletion-crypto';
import { encryptSecret as encWebhook, decryptSecret as decWebhook, isProductionKekConfigured } from './webhook-crypto';
import { encryptSecret as encMfa, decryptSecret as decMfa, encryptPaymentSecret, decryptPaymentSecret, paymentSecretNeedsReencrypt } from './mfa-enc';
import { encryptSecret, decryptSecret, isProviderVaultConfigured } from './provider-crypto';

export const providerSecrets: ProviderSecrets = { encrypt: encryptSecret, decrypt: decryptSecret, isConfigured: isProviderVaultConfigured };
export const mfaSecrets: ProviderSecrets = { encrypt: encMfa, decrypt: decMfa, isConfigured: () => !!process.env[KEY_SOURCES.mfa.env] };
export const paymentSecrets: PaymentSecrets = { encrypt: encryptPaymentSecret, decrypt: decryptPaymentSecret, needsReencrypt: paymentSecretNeedsReencrypt, isConfigured: () => !!process.env[KEY_SOURCES.payments.env] };

// One sealer per purpose, each over its own key (Constitution 12 §40–47), exposed through the SECRET_SEALERS port.
const byPurpose: Record<SealPurpose, ProviderSecrets> = {
  provider: providerSecrets, mfa: mfaSecrets, payments: paymentSecrets,
  ai_provider: { encrypt: encryptKey, decrypt: decryptKey, isConfigured: isProviderKekConfigured },
  funding: { encrypt: encryptFunding, decrypt: decryptFunding, isConfigured: isFundingVaultConfigured },
  ticket_deletion: { encrypt: encryptDeletionCode, decrypt: decryptDeletionCode, isConfigured: isTicketDeletionKekConfigured },
  webhook: { encrypt: encWebhook, decrypt: decWebhook, isConfigured: isProductionKekConfigured },
};
export const secretSealers: SecretSealers = { forPurpose: (p) => { const s = byPurpose[p]; if (!s) throw new Error(`no sealer for purpose ${String(p)}`); return s; } };

@Global()
@Module({
  providers: [{ provide: PROVIDER_SECRETS, useValue: providerSecrets }, { provide: MFA_SECRETS, useValue: mfaSecrets }, { provide: PAYMENT_SECRETS, useValue: paymentSecrets }, { provide: SECRET_SEALERS, useValue: secretSealers }],
  exports: [PROVIDER_SECRETS, MFA_SECRETS, PAYMENT_SECRETS, SECRET_SEALERS],
})
export class ProviderSecretsModule {}
