// booking-verification-provider.ts — sending and checking a six-digit code, through the TENANT'S OWN Twilio.
//
// ── The rule that shapes this whole file ────────────────────────────────────────────────────────────────
// "Shared Twilio credentials across tenants are not allowed by default."
//
// The platform already has a per-tenant credential resolver (`tenant-number.service.ts`) — and it FALLS BACK to
// a shared AI PowerSalon account (`TWILIO_ACCOUNT_SID`) when a tenant has none. That is the right behaviour for
// buying a phone number. It is the WRONG behaviour here, and copying it would have been the easy mistake:
//
//   • verification traffic would be billed to us instead of the tenant,
//   • the code would arrive from a sender the customer has never seen from that salon,
//   • one tenant's SMS-pumping abuse would burn the platform's own Twilio balance and reputation,
//   • and a tenant who never connected Twilio would silently appear to have a working verification system.
//
// So this resolver FAILS CLOSED. No tenant credentials → `not_configured` → the policy resolver returns
// `provider_not_configured` → the booking is REFUSED. A tenant who has not connected Twilio cannot enable
// verification, which is exactly what the spec demands.
import { twilioVerifyBase, verifyAuthHeader } from '@aipowersalon/notifications';

export type VerificationProviderKind = 'twilio_verify' | 'internal_otp';

/** What a tenant's own Twilio looks like once resolved. Never shared, never from env. */
export interface TenantTwilioCredentials {
  accountSid: string;
  authToken: string;
  /** The tenant's own Verify Service. Required for twilio_verify; absent means we cannot use Verify. */
  verifyServiceSid?: string | null;
  /** The tenant's own sender, for the internal-OTP fallback. */
  fromNumber?: string | null;
  /** Phase 4: a Twilio API key (SK…) + secret, used to sign Verify calls instead of the account auth token. */
  apiKeySid?: string | null;
  apiKeySecret?: string | null;
}

export interface CredentialResolution {
  status: 'configured' | 'not_configured';
  credentials?: TenantTwilioCredentials;
  /** Which mechanism this tenant can actually use, given what they configured. */
  kind?: VerificationProviderKind;
  reason?: string;
}

/** Resolves a TENANT's (or branch's) own Twilio. Never falls back to a platform account. */
export interface TenantCredentialResolver {
  resolve(tenantId: string, branchId: string): Promise<CredentialResolution>;
}

export interface SendResult {
  ok: boolean;
  /** Twilio's handle for this verification attempt. Recorded for idempotency; it is NOT a secret. */
  providerVerificationSid?: string;
  /** Present ONLY for the internal-OTP path, and ONLY so the caller can hash and store it. Never logged, never
   *  returned to a client, never persisted in plaintext. Twilio Verify never gives us the code at all — which is
   *  precisely why it is the preferred path. */
  plaintextCode?: string;
  error?: string;
  reason?: 'not_configured' | 'invalid_number' | 'provider_error' | 'rate_limited';
}

export interface CheckResult {
  ok: boolean;
  error?: string;
  reason?: 'incorrect' | 'expired' | 'not_found' | 'provider_error';
}

export interface VerificationProvider {
  readonly kind: VerificationProviderKind;
  send(creds: TenantTwilioCredentials, toE164: string, opts: { locale?: string }): Promise<SendResult>;
  check(creds: TenantTwilioCredentials, toE164: string, code: string): Promise<CheckResult>;
}

// ── Twilio Verify (PREFERRED) ────────────────────────────────────────────────────────────────────────────
//
// Twilio generates, sends, expires and checks the code. WE NEVER SEE IT. That is the entire security argument
// for preferring Verify over our own OTP: a code we never possess is a code we cannot log, cannot leak in an
// APM span, cannot accidentally persist, and cannot expose in a stack trace. The internal-OTP path below is a
// genuine fallback, not an equal option.
// The base URL and the signing live in @aipowersalon/notifications (shared with the salon's "Test Verify").
export { twilioVerifyBase } from '@aipowersalon/notifications';

export class TwilioVerifyProvider implements VerificationProvider {
  readonly kind = 'twilio_verify' as const;
  constructor(private readonly http: typeof fetch = fetch, private readonly base: string = twilioVerifyBase()) {}

  private auth(c: TenantTwilioCredentials): string {
    return verifyAuthHeader(c);   // the salon's API key when it gave one, else its account auth token
  }

  async send(creds: TenantTwilioCredentials, toE164: string, opts: { locale?: string } = {}): Promise<SendResult> {
    if (!creds.verifyServiceSid) return { ok: false, reason: 'not_configured', error: 'No Verify Service is configured for this salon.' };
    try {
      const url = `${this.base}/v2/Services/${creds.verifyServiceSid}/Verifications`;
      const form = new URLSearchParams({ To: toE164, Channel: 'sms' });
      if (opts.locale) form.set('Locale', opts.locale);      // the code itself is never translated; the wrapper is
      const res = await this.http(url, {
        method: 'POST',
        headers: { Authorization: this.auth(creds), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Twilio's own error text can name the account and the service. It is useful in an audit record and
        // must never reach the customer, so the caller keeps it and shows the policy's safe message instead.
        return { ok: false, reason: res.status === 429 ? 'rate_limited' : 'provider_error', error: String(body?.message ?? `Twilio returned ${res.status}`) };
      }
      // NOTE what is NOT here: a code. Verify keeps it.
      return { ok: true, providerVerificationSid: String(body?.sid ?? '') };
    } catch (e: any) {
      return { ok: false, reason: 'provider_error', error: e?.message ?? 'Could not reach the verification provider.' };
    }
  }

  async check(creds: TenantTwilioCredentials, toE164: string, code: string): Promise<CheckResult> {
    if (!creds.verifyServiceSid) return { ok: false, reason: 'provider_error', error: 'No Verify Service is configured.' };
    try {
      const url = `${this.base}/v2/Services/${creds.verifyServiceSid}/VerificationCheck`;
      const res = await this.http(url, {
        method: 'POST',
        headers: { Authorization: this.auth(creds), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: toE164, Code: code }),
      });
      const body: any = await res.json().catch(() => ({}));
      // 404 = the verification has already expired or been consumed. Twilio deletes it, which is the behaviour
      // we want — but it means "not found" and "expired" are the same observable thing, and we must not invent a
      // distinction the provider does not give us.
      if (res.status === 404) return { ok: false, reason: 'expired', error: 'This code has expired. Request a new one.' };
      if (!res.ok) return { ok: false, reason: 'provider_error', error: String(body?.message ?? `Twilio returned ${res.status}`) };
      if (body?.status === 'approved' && body?.valid === true) return { ok: true };
      return { ok: false, reason: 'incorrect', error: 'That code is incorrect.' };
    } catch (e: any) {
      return { ok: false, reason: 'provider_error', error: e?.message ?? 'Could not reach the verification provider.' };
    }
  }
}

