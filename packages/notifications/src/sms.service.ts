// sms.service.ts — SMS port + Twilio impl (direct REST fetch, no twilio npm dep) + Mock for pilot/tests.
/** wave 3 PAYI §77: the provider's segment count rides back with the SID when it reports one (Twilio num_segments). */
export interface SmsSender { send(toE164: string, body: string, from?: string): Promise<{ sid: string; segments?: number }>; }

/** wave 3 PAYI §60: a sender is a phone number (From) OR a Messaging Service SID (MG…, MessagingServiceSid) — Twilio then
 *  picks the number from the service's pool and the A2P campaign attached to it. */
export const isMessagingServiceSid = (s: string | undefined | null): boolean => /^MG[0-9a-fA-F]{32}$/.test(String(s ?? ''));

export class TwilioSmsSender implements SmsSender {
  constructor(private cfg: { accountSid: string; authToken: string; from: string }, private http: typeof fetch = instrumentedFetch('twilio', fetch) as typeof fetch) {}
  async send(toE164: string, body: string, from?: string): Promise<{ sid: string }> {
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
    if (!res.ok) throw new Error("sms_failed:" + (j?.message || res.status));
    const segments = Number(j?.num_segments);
    return { sid: j.sid, ...(Number.isFinite(segments) && segments > 0 ? { segments } : {}) };
  }
}
export class MockSmsSender implements SmsSender {
  public sent: { to: string; body: string; from?: string }[] = [];
  async send(toE164: string, body: string, from?: string) { this.sent.push({ to: toE164, body, from }); return { sid: "SM-MOCK-" + this.sent.length, segments: Math.max(1, Math.ceil(body.length / 160)) }; }
}
import { instrumentedFetch } from '@aipowersalon/observability';

