// twilio-numbers-client.ts — dependency-free REST client for searching and buying Twilio phone numbers (2010-04-01
// API), same pattern as TwilioSmsSender. Authenticates with whichever account owns the salon's messaging (its own
// per-tenant account if configured, else the shared ISV account). `http` injectable for tests.
export interface NumbersCreds { accountSid: string; authToken: string }
/** `capabilities` is what Twilio reports for the number (voice / SMS / MMS) — shown before any purchase */
export interface AvailableNumber { phoneNumber: string; friendlyName: string; locality: string | null; region: string | null; capabilities: { sms: boolean; voice: boolean; mms: boolean } | null }

export class TwilioNumbersClient {
  constructor(private readonly creds: NumbersCreds, private readonly http: typeof fetch = instrumentedFetch('twilio', fetch) as typeof fetch) {}
  private auth() { return 'Basic ' + Buffer.from(this.creds.accountSid + ':' + this.creds.authToken).toString('base64'); }

  /** Search purchasable local, SMS-capable numbers. `areaCode` optional; `country` ISO (default US). */
  async searchLocal(opts: { country?: string; areaCode?: string; limit?: number }): Promise<AvailableNumber[]> {
    const country = (opts.country || 'US').toUpperCase();
    const qs = new URLSearchParams({ SmsEnabled: 'true', PageSize: String(Math.min(20, opts.limit || 10)) });
    if (opts.areaCode) qs.set('AreaCode', opts.areaCode);
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/AvailablePhoneNumbers/${country}/Local.json?${qs.toString()}`;
    const res = await this.http(url, { headers: { Authorization: this.auth() } });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('numbers_failed:' + (j?.message || res.status));
    return (j.available_phone_numbers || []).map((n: any) => ({ phoneNumber: n.phone_number, friendlyName: n.friendly_name, locality: n.locality ?? null, region: n.region ?? null,
      capabilities: n.capabilities ? { sms: !!(n.capabilities.SMS ?? n.capabilities.sms), voice: !!(n.capabilities.voice ?? n.capabilities.Voice), mms: !!(n.capabilities.MMS ?? n.capabilities.mms) } : null }));
  }

  /** Purchase a number and (optionally) set its inbound SMS webhook so STOP/replies route to the app. Returns { sid, phoneNumber }. */
  async purchase(phoneNumber: string, opts: { smsUrl?: string } = {}): Promise<{ sid: string; phoneNumber: string }> {
    const form = new URLSearchParams({ PhoneNumber: phoneNumber });
    if (opts.smsUrl) { form.set('SmsUrl', opts.smsUrl); form.set('SmsMethod', 'POST'); }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/IncomingPhoneNumbers.json`;
    const res = await this.http(url, { method: 'POST', headers: { Authorization: this.auth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('numbers_failed:' + (j?.message || res.status));
    return { sid: j.sid, phoneNumber: j.phone_number };
  }
}import { instrumentedFetch } from '@aipowersalon/observability';

