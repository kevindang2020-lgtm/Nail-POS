// twilio-subaccount-client.ts — B-16 (Oct 20 2026): the Twilio REST calls a PLATFORM-MANAGED salon needs (account_mode
// 'platform_managed', §185): its own subaccount under the AIPowerSalon master account, a Messaging Service in that subaccount
// (the sender; A2P campaigns attach to it), and its purchased number attached to the service. Dependency-free, same pattern
// as TwilioNumbersClient (search / purchase stay there). `http` injectable for tests.
//
// Find-or-create: a subaccount is looked up by the salon's friendly name before one is created, so a retry after a lost
// answer (Twilio created it, we never stored the SID) reuses it instead of opening a second, billed account.
import { instrumentedFetch } from '@aipowersalon/observability';

export interface TwilioCreds { accountSid: string; authToken: string }
const API = 'https://api.twilio.com/2010-04-01';
const MESSAGING = 'https://messaging.twilio.com/v1';

export class TwilioSubaccountClient {
  constructor(private readonly creds: TwilioCreds, private readonly http: typeof fetch = instrumentedFetch('twilio', fetch) as typeof fetch) {}
  private auth() { return 'Basic ' + Buffer.from(this.creds.accountSid + ':' + this.creds.authToken).toString('base64'); }
  private async call(method: 'GET' | 'POST' | 'DELETE', url: string, form?: Record<string, string>): Promise<{ status: number; body: any }> {
    const res = await this.http(url, {
      method, headers: { Authorization: this.auth(), ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
    const body: any = await res.json().catch(() => ({}));
    return { status: res.status, body };
  }
  private fail(r: { status: number; body: any }): never { throw new Error('twilio_failed:' + (r.body?.message || r.status)); }

  /** The salon's subaccount under THIS (master) account: an active one with the friendly name is reused; else created. */
  async findOrCreateSubaccount(friendlyName: string): Promise<{ accountSid: string; authToken: string; created: boolean }> {
    const found = await this.call('GET', `${API}/Accounts.json?${new URLSearchParams({ FriendlyName: friendlyName, PageSize: '20' }).toString()}`);
    if (found.status < 200 || found.status >= 300) this.fail(found);
    // a CLOSED subaccount (an offboarded salon that came back, §149) is history — a new one is opened
    const existing = (found.body?.accounts ?? []).filter((a: any) => a?.sid && a.sid !== this.creds.accountSid && String(a.status) !== 'closed');
    if (existing.length) {
      const a = existing[0];
      if (String(a.status) !== 'active') throw new Error(`twilio_failed:subaccount ${a.sid} for this salon is ${a.status} — reopen or close it in the Twilio console first`);
      return { accountSid: String(a.sid), authToken: String(a.auth_token), created: false };
    }
    const made = await this.call('POST', `${API}/Accounts.json`, { FriendlyName: friendlyName });
    if (made.status < 200 || made.status >= 300 || !made.body?.sid || !made.body?.auth_token) this.fail(made);
    return { accountSid: String(made.body.sid), authToken: String(made.body.auth_token), created: true };
  }

  /** A Messaging Service in THIS (sub)account, its inbound webhook pointed at the app. Returns the MG… SID. */
  async createMessagingService(friendlyName: string, inboundUrl?: string): Promise<string> {
    const form: Record<string, string> = { FriendlyName: friendlyName };
    if (inboundUrl) { form.InboundRequestUrl = inboundUrl; form.InboundMethod = 'POST'; }
    const r = await this.call('POST', `${MESSAGING}/Services`, form);
    if (r.status < 200 || r.status >= 300 || !r.body?.sid) this.fail(r);
    return String(r.body.sid);
  }

  /** Put a number (PN…) into the service's sender pool. Already in it (Twilio 21710) = done. */
  async attachNumber(messagingServiceSid: string, phoneNumberSid: string): Promise<void> {
    const r = await this.call('POST', `${MESSAGING}/Services/${encodeURIComponent(messagingServiceSid)}/PhoneNumbers`, { PhoneNumberSid: phoneNumberSid });
    if (r.status >= 200 && r.status < 300) return;
    if (Number(r.body?.code) === 21710) return;
    this.fail(r);
  }

  /** §149 offboarding: release a number (PN…) bought in THIS (sub)account. Gone already (404 / 20404) = done. Irreversible —
   *  the number goes back to Twilio's pool. */
  async releaseNumber(phoneNumberSid: string): Promise<{ released: boolean; alreadyGone: boolean }> {
    const r = await this.call('DELETE', `${API}/Accounts/${encodeURIComponent(this.creds.accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberSid)}.json`);
    if (r.status === 204 || (r.status >= 200 && r.status < 300)) return { released: true, alreadyGone: false };
    if (r.status === 404 || Number(r.body?.code) === 20404) return { released: false, alreadyGone: true };
    this.fail(r);
  }

  /** §149 offboarding: close a subaccount of THIS (master) account. Already closed = done. Never the master itself. */
  async closeSubaccount(subaccountSid: string): Promise<{ closed: boolean; alreadyClosed: boolean }> {
    if (!subaccountSid || subaccountSid === this.creds.accountSid) throw new Error('twilio_failed:refusing to close the master account');
    const r = await this.call('POST', `${API}/Accounts/${encodeURIComponent(subaccountSid)}.json`, { Status: 'closed' });
    if (r.status >= 200 && r.status < 300) return { closed: true, alreadyClosed: false };
    if (r.status === 404 || Number(r.body?.code) === 20404) return { closed: false, alreadyClosed: true };
    this.fail(r);
  }
}
