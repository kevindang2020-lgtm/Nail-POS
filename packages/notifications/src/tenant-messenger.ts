// tenant-messenger.ts — THE way anything in the platform texts someone (BUILD_PLAN Phase 2; Constitution 8 §79).
//
// Before Oct 2026 receipts, activation codes and other system texts went straight to an `SmsSender` built from the
// PLATFORM's Twilio variables: no tenant number, no opt-out check, no ledger, no event — and the activation path passed
// a context with no tenant to the notifications service, which refused it, so customer activation codes were never sent.
// The messenger is implemented by the communications module's NotificationsService (one send path): for a salon it uses
// the salon's own Twilio account or its registered number, honours opt-outs (except account/security texts), meters
// credits when asked, writes the notification ledger and emits communication.sms_sent / communication.sms_delivery_failed.
// For a platform text (no salon yet, e.g. a customer proving their phone before choosing a salon) it uses the platform's
// default sender; there is no salon ledger to write.
//
// Modules inject it by token (TENANT_MESSENGER) — no module needs to import the communications module.
export const TENANT_MESSENGER = 'TENANT_MESSENGER';

export type MessagePurpose = 'receipt' | 'reminder' | 'followup' | 'marketing' | 'account' | 'notification';

export interface TenantSmsRequest {
  /** The salon the text is from; null for a platform text (no salon involved yet). */
  tenantId: string | null;
  branchId?: string | null;
  to: string;
  body: string;
  purpose: MessagePurpose;
  customerId?: string | null;
  /** Consume one SMS credit from the salon's allowance (marketing / staff-initiated messages). Default false. */
  meter?: boolean;
}

export interface TenantSendResult {
  sent: boolean;
  status: 'sent' | 'blocked' | 'failed';
  reason?: string;
  providerId?: string;
  /** True when no real SMS provider is configured (development): the message was recorded, not delivered. */
  simulated?: boolean;
}

export interface TenantMessenger {
  sendSms(req: TenantSmsRequest): Promise<TenantSendResult>;
}

/** A send the messenger did not hand to a provider (blocked by an opt-out or credits, or the provider failed). */
export class MessengerSendError extends Error {
  constructor(readonly status: 'blocked' | 'failed', readonly reason: string) { super(`sms ${status}: ${reason}`); this.name = 'MessengerSendError'; }
}

/**
 * The messenger behind the older `SmsSender` port (send(to, body) → { sid }, throws on failure), for the call sites that
 * were built on it: the platform's account/security texts (password resets, the Super Admin OTP, the old-number
 * warning) and a salon's own texts where the call site knows the tenant. A failed or blocked send THROWS, exactly as a
 * provider error did, so no caller starts treating "not sent" as sent.
 */
export class MessengerSmsSender {
  constructor(private readonly messenger: TenantMessenger, private readonly opts: { tenantId: string | null; purpose: MessagePurpose; customerId?: string | null }) {}
  /** True after a send the messenger reported as simulated (no provider configured). */
  lastSimulated = false;
  async send(toE164: string, body: string): Promise<{ sid: string }> {
    const r = await this.messenger.sendSms({ tenantId: this.opts.tenantId, to: toE164, body, purpose: this.opts.purpose, customerId: this.opts.customerId ?? null });
    if (!r.sent) throw new MessengerSendError(r.status === 'blocked' ? 'blocked' : 'failed', r.reason ?? 'send_failed');
    this.lastSimulated = r.simulated === true;
    return { sid: r.providerId ?? '' };
  }
}

/** The platform's account/security sender: the messenger when the API loaded it, else `fallback` (module tests). */
export function platformSmsSender<T>(messenger: TenantMessenger | null | undefined, fallback: () => T): MessengerSmsSender | T {
  return messenger ? new MessengerSmsSender(messenger, { tenantId: null, purpose: 'account' }) : fallback();
}
