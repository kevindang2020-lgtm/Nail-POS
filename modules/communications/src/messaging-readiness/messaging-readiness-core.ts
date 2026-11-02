// messaging-readiness-core.ts — pure evaluation of the messaging environment configuration. Given the (already-safe)
// presence/shape of env values, it produces a readiness report. It NEVER receives or returns secret values — callers
// pass booleans and safe derived facts (e.g. a KEK length), so nothing sensitive can leak through this surface.
export interface ReadinessCheck { key: string; label: string; ok: boolean; required: boolean; detail: string }
export interface ReadinessReport {
  overall: 'ready' | 'partial' | 'not_configured';
  checks: ReadinessCheck[];
  webhooks: { inbound: string; status: string };
  /** Can this platform actually DELIVER an invitation? See evaluateInvitationDelivery. */
  invitations: InvitationDeliveryReadiness;
}

// ── invitation delivery ──────────────────────────────────────────────────────────────────────────────────

export interface InvitationDeliveryReadiness {
  status: 'ready' | 'partial' | 'not_connected';
  canSendSms: boolean;
  canSendEmail: boolean;
  hasNotifierFallback: boolean;
  hasAcceptUrl: boolean;
  /** Plain-English consequence, for the operator who is about to hire somebody. */
  consequence: string;
  blockers: string[];
}

export interface InvitationDeliveryInput {
  hasTwilio: boolean;          // ACCOUNT_SID + AUTH_TOKEN + a valid TWILIO_FROM
  hasSendGrid: boolean;        // SENDGRID_API_KEY (SENDGRID_FROM optional — defaults to nailsalons@aipowersalon.com)
  hasNotifierUrl: boolean;     // INVITE_NOTIFIER_URL — the generic relay
  hasAppBaseUrl: boolean;      // APP_BASE_URL — the host that serves /accept-invite
}

/**
 * Can this platform actually deliver an invitation — and if not, does anybody KNOW?
 *
 * == WHY THIS EXISTS ======================================================================================
 *
 * `smsFromEnv()` and `emailFromEnv()` fall back to a Mock sender when their env vars are unset. Nothing throws.
 * Nothing logs. SMS and email simply do not happen — for technician invitations, password resets, and customer
 * OTPs alike — and the only place that fact ever surfaced was inside a single hire, one technician at a time,
 * at the exact moment it was too late to matter.
 *
 * An operator finding out that invitations do not send because a technician phoned to ask why she never got her
 * text is not a configuration story. It is a system that knew and did not say.
 *
 * SMS matters more than email here, and the report says so: a nail technician frequently has a phone and no
 * email address, so a platform with SendGrid but no Twilio can invite the office staff and not the technicians.
 * That is `partial`, and it is named.
 */
export function evaluateInvitationDelivery(i: InvitationDeliveryInput): InvitationDeliveryReadiness {
  const blockers: string[] = [];
  if (!i.hasTwilio) blockers.push('No SMS sender — set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM. Most nail technicians have a phone and no email; without this they cannot be invited.');
  if (!i.hasSendGrid) blockers.push('No email sender — set SENDGRID_API_KEY (sender defaults to nailsalons@aipowersalon.com)');
  if (!i.hasTwilio && !i.hasSendGrid && !i.hasNotifierUrl) blockers.push('No delivery route at all. Invitations will be created and reported as not_connected, and the one-time link must be handed over by hand.');
  if (!i.hasAppBaseUrl) blockers.push('APP_BASE_URL is not set — invitation links are built from a guessed host. A link to a host provisioned in no DNS config fails silently, and only the person clicking it ever finds out.');

  const canSendSms = i.hasTwilio || i.hasNotifierUrl;
  const canSendEmail = i.hasSendGrid || i.hasNotifierUrl;

  const status: InvitationDeliveryReadiness['status'] =
    canSendSms && canSendEmail ? 'ready'
      : canSendSms || canSendEmail ? 'partial'
        : 'not_connected';

  const consequence =
    status === 'ready' ? 'Invitations will be sent.'
      : status === 'partial' && !canSendSms ? 'Invitations can only be EMAILED. A technician with a phone and no email address cannot be invited at all.'
        : status === 'partial' ? 'Invitations can only be TEXTED. A technician with an email and no phone cannot be invited at all.'
          : 'NOTHING WILL BE SENT. Every invitation is created, reported as not_connected, and its one-time link must be delivered by hand.';

  return { status, canSendSms, canSendEmail, hasNotifierFallback: i.hasNotifierUrl, hasAcceptUrl: i.hasAppBaseUrl, consequence, blockers };
}

export interface ReadinessInput {
  /**
   * Optional, and FAIL-CLOSED when absent: an unsupplied delivery config reports `not_connected`, never `ready`.
   * A readiness surface whose default answer is "you're fine" is the one thing it must never be.
   */
  invitations?: InvitationDeliveryInput;
  hasAccountSid: boolean; hasAuthToken: boolean;
  fromNumber: string | null;                 // safe to include (a sending number is not a secret)
  hasStatusCallbackUrl: boolean; statusCallbackUrl: string | null;
  vaultKekLength: number;                     // length only, never the key itself
  publicApiBaseUrl: string | null;            // for rendering the webhook URLs to paste into Twilio
  isvEmailSet: boolean; primaryProfileSid: string | null;
}

function isE164(n: string | null): boolean { return !!n && /^\+[1-9]\d{6,15}$/.test(n); }

export function evaluateMessagingReadiness(i: ReadinessInput): ReadinessReport {
  const base = (i.publicApiBaseUrl || '').replace(/\/+$/, '');
  const webhooks = { inbound: `${base || '<public-api>'}/webhooks/twilio/sms/inbound`, status: `${base || '<public-api>'}/webhooks/twilio/sms/status` };

  const checks: ReadinessCheck[] = [
    { key: 'account_sid', label: 'Twilio Account SID', required: true, ok: i.hasAccountSid, detail: i.hasAccountSid ? 'Set' : 'Set TWILIO_ACCOUNT_SID' },
    { key: 'auth_token', label: 'Twilio Auth Token', required: true, ok: i.hasAuthToken, detail: i.hasAuthToken ? 'Set — also verifies inbound/status webhook signatures' : 'Set TWILIO_AUTH_TOKEN' },
    { key: 'from', label: 'Shared from number', required: true, ok: isE164(i.fromNumber), detail: isE164(i.fromNumber) ? `Set (${i.fromNumber})` : 'Set TWILIO_FROM to an E.164 number (+1…)' },
    { key: 'status_callback', label: 'Delivery receipts', required: false, ok: i.hasStatusCallbackUrl, detail: i.hasStatusCallbackUrl ? `On (${i.statusCallbackUrl})` : 'Optional: set TWILIO_STATUS_CALLBACK_URL to record delivered/failed' },
    { key: 'vault_kek', label: 'Per-tenant credential encryption key', required: false, ok: i.vaultKekLength >= 32, detail: i.vaultKekLength === 0 ? 'Not set — required only to store per-tenant Twilio credentials (PROVIDER_VAULT_KEK, ≥32 chars)' : i.vaultKekLength >= 32 ? 'Set (≥32 chars)' : `Too short (${i.vaultKekLength} chars) — PROVIDER_VAULT_KEK must be ≥32` },
    { key: 'isv_email', label: 'A2P: ISV email', required: false, ok: i.isvEmailSet, detail: i.isvEmailSet ? 'Set' : 'Optional: set TWILIO_ISV_EMAIL to automate A2P registration' },
    { key: 'primary_profile', label: 'A2P: ISV Primary Profile SID', required: false, ok: /^BU[0-9a-fA-F]{32}$/.test(i.primaryProfileSid || ''), detail: i.primaryProfileSid ? 'Set' : 'Optional: set TWILIO_PRIMARY_PROFILE_SID (BU…) to automate A2P registration' },
  ];

  const requiredOk = checks.filter((c) => c.required).every((c) => c.ok);
  const anySet = i.hasAccountSid || i.hasAuthToken || isE164(i.fromNumber);
  const overall: ReadinessReport['overall'] = requiredOk ? 'ready' : anySet ? 'partial' : 'not_configured';
  return {
    overall, checks, webhooks,
    invitations: evaluateInvitationDelivery(i.invitations ?? { hasTwilio: false, hasSendGrid: false, hasNotifierUrl: false, hasAppBaseUrl: false }),
  };
}
