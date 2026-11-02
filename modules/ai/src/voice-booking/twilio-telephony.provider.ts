// twilio-telephony.provider.ts — the LIVE Twilio adapter implementing TelephonyProvisioningPort. Real HTTP against the
// Twilio REST API (2010-04-01): search AvailablePhoneNumbers, purchase via IncomingPhoneNumbers, set the inbound
// VoiceUrl on assign, and release via DELETE. Auth is HTTP Basic (AccountSid:AuthToken). fetch is injectable so the
// adapter is unit-testable without a real account. This is the "single live adapter" the go-live path needs; it is
// wired in resolveTelephonyProvider() only when credentials are present, so with no creds the honest NotConnected
// default is used instead (no fake calls, no accidental spend).
import type { TelephonyProvisioningPort, ProviderStatus, AvailableNumber, PurchasedNumber } from './provider-ports';

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

export interface TwilioConfig { accountSid: string; authToken: string; voiceWebhookUrl?: string | null; country?: string }

export class TwilioApiError extends Error {
  constructor(public readonly status: number, public readonly code: number | null, message: string) { super(message); this.name = 'TwilioApiError'; }
}

const BASE = 'https://api.twilio.com/2010-04-01';

export class TwilioTelephonyProvider implements TelephonyProvisioningPort {
  private readonly country: string;
  constructor(private readonly cfg: TwilioConfig, private readonly fetchImpl: FetchLike = fetch as any) {
    this.country = (cfg.country || 'US').toUpperCase();
  }

  status(): ProviderStatus { return { state: 'connected', provider: 'twilio', detail: `Connected (account ${this.cfg.accountSid.slice(0, 6)}\u2026)` }; }

  private authHeader(): string { return 'Basic ' + Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64'); }

  private async call(method: 'GET' | 'POST' | 'DELETE', path: string, form?: Record<string, string>): Promise<any> {
    const headers: Record<string, string> = { Authorization: this.authHeader() };
    let url = `${BASE}/Accounts/${this.cfg.accountSid}${path}`;
    let body: string | undefined;
    if (method === 'GET' && form) { url += '?' + new URLSearchParams(form).toString(); }
    else if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await this.fetchImpl(url, { method, headers, body });
    if (res.status === 204) return null;
    let json: any = null;
    try { json = await res.json(); } catch { /* some deletes return empty */ }
    if (!res.ok) {
      const code = json && typeof json.code === 'number' ? json.code : null;
      const msg = (json && json.message) || `Twilio request failed (${res.status})`;
      throw new TwilioApiError(res.status, code, msg);
    }
    return json;
  }

  async searchNumbers(opts: { areaCode?: string; tollFree?: boolean }): Promise<AvailableNumber[]> {
    const type = opts.tollFree ? 'TollFree' : 'Local';
    const form: Record<string, string> = { VoiceEnabled: 'true' };
    if (opts.areaCode) form.AreaCode = opts.areaCode;
    const json = await this.call('GET', `/AvailablePhoneNumbers/${this.country}/${type}.json`, form);
    const rows: any[] = json?.available_phone_numbers ?? [];
    return rows.map((r) => ({
      phoneNumber: r.phone_number,
      locality: r.locality ?? null,
      capabilities: { voice: !!(r.capabilities?.voice ?? r.capabilities?.Voice), sms: !!(r.capabilities?.sms ?? r.capabilities?.SMS) },
    }));
  }

  async purchaseNumber(phoneNumber: string): Promise<PurchasedNumber> {
    const form: Record<string, string> = { PhoneNumber: phoneNumber };
    if (this.cfg.voiceWebhookUrl) { form.VoiceUrl = this.cfg.voiceWebhookUrl; form.VoiceMethod = 'POST'; }
    const json = await this.call('POST', `/IncomingPhoneNumbers.json`, form);
    return { phoneNumber: json.phone_number, providerNumberId: json.sid };
  }

  async assignNumber(providerNumberId: string, providerAgentId: string): Promise<void> {
    if (!this.cfg.voiceWebhookUrl) throw new TwilioApiError(400, null, 'No inbound VoiceUrl configured (set AI_RECEPTIONIST_VOICE_WEBHOOK_URL).');
    // Route inbound calls for this number to the agent by tagging the configured voice webhook with the agent id.
    const sep = this.cfg.voiceWebhookUrl.includes('?') ? '&' : '?';
    const voiceUrl = `${this.cfg.voiceWebhookUrl}${sep}agentId=${encodeURIComponent(providerAgentId)}`;
    await this.call('POST', `/IncomingPhoneNumbers/${providerNumberId}.json`, { VoiceUrl: voiceUrl, VoiceMethod: 'POST' });
  }

  async releaseNumber(providerNumberId: string): Promise<void> {
    await this.call('DELETE', `/IncomingPhoneNumbers/${providerNumberId}.json`);
  }

  /** Live-call redirect (B-14): update the in-progress call with TwiML that <Dial>s the destination. A call that has
   *  already ended answers 404 / 20404 — surfaced as TwilioApiError, never swallowed into a success. */
  async transferCall(input: { providerCallId: string; destination: string }): Promise<void> {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${escapeXml(input.destination)}</Dial></Response>`;
    await this.call('POST', `/Calls/${encodeURIComponent(input.providerCallId)}.json`, { Twiml: twiml });
  }
}

function escapeXml(s: string): string {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}
