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

/** 'conversation' (Communications guide, Oct 30 2026): a staff reply typed in the SMS Inbox — transactional, not marketing. */
export type MessagePurpose = 'receipt' | 'reminder' | 'followup' | 'marketing' | 'account' | 'notification' | 'conversation';

export interface TenantSmsRequest {
  /** The salon the text is from; null for a platform text (no salon involved yet). */
  tenantId: string | null;
  /** The branch the text belongs to: its own Twilio override is used when it has one, else the salon default. */
  branchId?: string | null;
  to: string;
  body: string;
  purpose: MessagePurpose;
  customerId?: string | null;
  /** Consume one SMS credit from the salon's allowance (marketing / staff-initiated messages). Default false. */
  meter?: boolean;
  /** Only the salon's OWN Twilio account (branch override or salon default) may carry this text — never the platform's shared
   *  sender. Without one the send is refused as `not_configured` (SMS Inbox replies; owner rule: no platform workaround). */
  requireOwnAccount?: boolean;
  /** What produced the text (Customer Notifications guide §13): recorded on the ledger row so Notifications can link the
   *  appointment / receipt / campaign / thread / follow-up and search by it. Optional — older callers simply leave it out. */
  source?: { type: 'appointment' | 'ticket' | 'campaign' | 'thread' | 'follow_up' | 'retry' | 'template_test' | 'manual' | 'phone_change'; id: string } | null;
  /** the ledger row this send re-sends (Notifications → authorized Retry only); the original stays as it was */
  retryOf?: string | null;
}

export interface TenantSendResult {
  sent: boolean;
  status: 'sent' | 'blocked' | 'failed';
  reason?: string;
  providerId?: string;
  /** True when no real SMS provider is configured (development): the message was recorded, not delivered. */
  simulated?: boolean;
  /** The ledger row (notifications.id) this attempt wrote, when one was written — its status callbacks move it. */
  notificationId?: string;
}

/** Email guide (Oct 31 2026): the transactional / staff email request — the twin of TenantSmsRequest. */
export interface TenantEmailRequest {
  tenantId: string;
  branchId?: string | null;
  to: string;
  subject: string;
  /** plain text the salon wrote; the messenger wraps it in the branded layout (HTML + a plain-text alternative) */
  body: string;
  purpose: MessagePurpose;
  /** which salon setting governs this email: a booking confirmation honours "Send booking confirmations by email", a
   *  receipt honours "Email receipts to customers" — switched off, nothing is sent and the attempt is recorded as blocked */
  category?: 'booking_confirmation' | 'receipt' | 'test' | 'manual' | 'marketing';
  customerId?: string | null;
  source?: TenantSmsRequest['source'];
  /** one key → one attempt (claim-before-send): a replay returns the first attempt's result and sends nothing */
  idempotencyKey?: string | null;
  meter?: boolean;
  retryOf?: string | null;
}

export interface TenantMessenger {
  sendSms(req: TenantSmsRequest): Promise<TenantSendResult>;
  /** optional so older messengers (tests, fakes) stay valid; callers fall back to their own sender when it is missing */
  sendEmail?(req: TenantEmailRequest): Promise<TenantSendResult & { duplicate?: boolean }>;
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
