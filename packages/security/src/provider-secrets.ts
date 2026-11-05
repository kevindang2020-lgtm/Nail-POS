// provider-secrets.ts — the PORT through which a domain module seals and opens a tenant's provider credentials (a
// salon's Twilio auth token, …) without knowing where keys come from (Constitution 13 §94: modules depend on stable
// interfaces; §81: this package stays pure — no environment, no key storage).
//
// The API provides the implementation under this token (keys from its key ring, Constitution 12 §40–47: current key
// first, previous key for rotation; wire format iv.tag.ct). A module injects it:
//   { provide: X, useFactory: (secrets: ProviderSecrets) => new X(secrets), inject: [PROVIDER_SECRETS] }
// A plain string token — no NestJS import, so the root entry stays framework-free (§113).
export const PROVIDER_SECRETS = 'PROVIDER_SECRETS';

export interface ProviderSecrets {
  /** Seal a provider credential for storage. */
  encrypt(plain: string): string;
  /** Open a stored credential; throws on a malformed or undecryptable value (callers fall back, never crash a send). */
  decrypt(enc: string): string;  /** Whether a real key is configured for sealing (not a dev fallback). A caller that must not store credentials
   *  under a fallback key (review-platform connections) checks this first. */
  isConfigured(): boolean;
}

/** MFA (TOTP) secrets — the same encrypt/decrypt contract, under the MFA key (Constitution 12 §40–47: MFA_ENC_KEY,
 *  with rotation). Provided by the API's ProviderSecretsModule beside PROVIDER_SECRETS. */
export const MFA_SECRETS = 'MFA_SECRETS';
/** Payment-processor credentials — their own key (PAYMENT_ENC_KEY); values written before it existed were sealed under
 *  the MFA key and are re-sealed on the next write, which needsReencrypt reports. */
export const PAYMENT_SECRETS = 'PAYMENT_SECRETS';
export interface PaymentSecrets extends ProviderSecrets { needsReencrypt(stored: string | null | undefined): boolean }

/** Every purpose the platform seals under its own key (Constitution 12 §40–47: one key per purpose, rotation per key). */
export type SealPurpose = 'mfa' | 'payments' | 'provider' | 'funding' | 'webhook' | 'ai_provider' | 'ticket_deletion';

/** The ONE port for purpose-keyed sealing: `forPurpose('funding')` is the sealer for merchant funding credentials, and
 *  so on. The API provides it over its key ring; a module never sees a key. PROVIDER_SECRETS, MFA_SECRETS and
 *  PAYMENT_SECRETS remain as the three most-used purposes bound directly. */
export const SECRET_SEALERS = 'SECRET_SEALERS';
export interface SecretSealers { forPurpose(purpose: SealPurpose): ProviderSecrets }

/** The Super Admin security overview reads the platform's key / rotation / network posture through this port; the API
 *  provides it (the key ring and rotation state are the API's). Constitution 12 §270. */
export const SECURITY_POSTURE = 'SECURITY_POSTURE';
export interface SecurityPosturePort { snapshot(): Promise<unknown> }

/** A PLATFORM lockdown needs two things only the API can do: revoke every non-Super-Admin session (keeping the
 *  initiator's) and make the auth gate re-read the lockdown flag at once. Constitution 12 M13. */
export const PLATFORM_LOCKDOWN = 'PLATFORM_LOCKDOWN';
export interface PlatformLockdownPort { revokeAllNonSuperAdmin(reason: string, keepSessionId: string | null): Promise<number>; invalidate(): void }
