import { mockOutbox } from './email.service';
// sms.service.ts — SMS port + Twilio impl (direct REST fetch, no twilio npm dep) + Mock for pilot/tests.
/** wave 3 PAYI §77: the provider's segment count rides back with the SID when it reports one (Twilio num_segments). */
/** Oct 23 2026 (P2-2): `senderFrom` = the address the text actually left from — the From number or the Messaging Service
 *  id (MG…) — when the sender knows it; the ledger records it on every row (the platform's default sender used to be NULL).
 *  An address, never a credential. */
export interface SmsSender { send(toE164: string, body: string, from?: string): Promise<{ sid: string; segments?: number; senderFrom?: string }>; }

/** wave 3 PAYI §60: a sender is a phone number (From) OR a Messaging Service SID (MG…, MessagingServiceSid) — Twilio then
 *  picks the number from the service's pool and the A2P campaign attached to it. */
export const isMessagingServiceSid = (s: string | undefined | null): boolean => /^MG[0-9a-fA-F]{32}$/.test(String(s ?? ''));

/** a provider refusal: `message` stays "sms_failed:<provider text>" (callers match on it); `providerCode` is the provider's own
 *  numeric error code when it gave one; `httpStatus` the HTTP status of the refusal */
export class SmsProviderError extends Error {
  constructor(message: string, readonly providerCode: string | null, readonly httpStatus: number | null) { super(message); this.name = 'SmsProviderError'; }
}

export class TwilioSmsSender implements SmsSender {
  constructor(private cfg: { accountSid: string; authToken: string; from: string }, private http: typeof fetch = instrumentedFetch('twilio', fetch) as typeof fetch) {}
  async send(toE164: string, body: string, from?: string): Promise<{ sid: string; segments?: number; senderFrom?: string }> {
    const url = "https://api.twilio.com/2010-04-01/Accounts/" + this.cfg.accountSid + "/Messages.json";
    const sender = from || this.cfg.from;   // per-tenant number (or Messaging Service) when provided
    const form = new URLSearchParams({ To: toE164, Body: body });
    if (isMessagingServiceSid(sender)) form.set('MessagingServiceSid', sender); else form.set('From', sender);
    const statusCb = process.env.TWILIO_STATUS_CALLBACK_URL;   // only set when the owner wants delivery receipts
    if (statusCb) form.set("StatusCallback", statusCb);
    const res = await this.http(url, { method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(this.cfg.accountSid + ":" + this.cfg.authToken).toString("base64"),
                 "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
    const j: any = await res.json();
    // Customer Notifications guide §08: keep the provider's numeric error code (e.g. 20003 auth, 21408 region, 21211 invalid To)
    // beside the message — the ledger stores the code and support classifies by it instead of parsing English text.
    if (!res.ok) throw new SmsProviderError("sms_failed:" + (j?.message || res.status), j?.code != null ? String(j.code) : null, res.status);
    const segments = Number(j?.num_segments);
    // what Twilio says it used (from / messaging_service_sid), else what was asked for — the default From included
    const used = String(j?.messaging_service_sid || j?.from || sender || '').trim();
    return { sid: j.sid, ...(Number.isFinite(segments) && segments > 0 ? { segments } : {}), ...(used ? { senderFrom: used } : {}) };
  }
}
export class MockSmsSender implements SmsSender {
  public sent: { to: string; body: string; from?: string }[] = [];
  constructor(private readonly defaultFrom?: string) {}
  async send(toE164: string, body: string, from?: string) { this.sent.push({ to: toE164, body, from }); mockOutbox({ channel: 'sms', to: toE164, body }); const used = from || this.defaultFrom; return { sid: "SM-MOCK-" + this.sent.length, segments: Math.max(1, Math.ceil(body.length / 160)), ...(used ? { senderFrom: used } : {}) }; }
}
import { instrumentedFetch } from '@aipowersalon/observability';

