// twilio-a2p-client.ts — thin, dependency-free REST client for the Twilio A2P 10DLC ISV APIs (no twilio npm dep, same
// pattern as TwilioSmsSender). All calls authenticate with the ISV's primary account (Account SID + Auth Token). The
// endpoints and field names match Twilio's current API (verified against docs 2026): BrandRegistrations, Messaging
// Services, and the UsAppToPerson campaign resource — including the now-required PrivacyPolicyUrl /
// TermsAndConditionsUrl. Supports Twilio's Mock=true for fee-free dry runs. `http` is injectable for tests.
export interface A2pCreds { accountSid: string; authToken: string }

export interface BrandInput { customerProfileBundleSid: string; a2pProfileBundleSid: string; brandType: 'STANDARD' | 'SOLE_PROPRIETOR'; mock: boolean }
export interface CampaignInput {
  brandRegistrationSid: string; description: string; messageSamples: string[]; usAppToPersonUsecase: string;
  messageFlow: string; optInMessage?: string; optOutMessage?: string; helpMessage?: string;
  privacyPolicyUrl: string; termsAndConditionsUrl: string; hasEmbeddedLinks: boolean; hasEmbeddedPhone: boolean;
}

export class TwilioA2pClient {
  constructor(private readonly creds: A2pCreds, private readonly http: typeof fetch = fetch) {}

  private auth() { return 'Basic ' + Buffer.from(this.creds.accountSid + ':' + this.creds.authToken).toString('base64'); }

  private async post(url: string, form: Record<string, string | string[]>): Promise<any> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) v.forEach((item) => body.append(k, item));   // repeated key for arrays (MessageSamples)
      else if (v !== undefined && v !== null && v !== '') body.set(k, String(v));
    }
    const res = await this.http(url, { method: 'POST', headers: { Authorization: this.auth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('a2p_failed:' + (j?.message || res.status));
    return j;
  }
  private async get(url: string): Promise<any> {
    const res = await this.http(url, { headers: { Authorization: this.auth() } });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('a2p_failed:' + (j?.message || res.status));
    return j;
  }

  /** Register an A2P Brand for a salon (uses its Secondary Customer Profile + A2P profile bundles). Returns { sid, status }. */
  async createBrand(input: BrandInput): Promise<{ sid: string; status: string }> {
    const j = await this.post('https://messaging.twilio.com/v1/a2p/BrandRegistrations', {
      CustomerProfileBundleSid: input.customerProfileBundleSid,
      A2PProfileBundleSid: input.a2pProfileBundleSid,
      BrandType: input.brandType,
      Mock: input.mock ? 'true' : 'false',
    });
    return { sid: j.sid, status: j.status };
  }
  async getBrand(brandSid: string): Promise<{ sid: string; status: string }> {
    const j = await this.get('https://messaging.twilio.com/v1/a2p/BrandRegistrations/' + brandSid);
    return { sid: j.sid, status: j.status };
  }

  /** Create a NEW Messaging Service for this salon's A2P traffic (Twilio recommends a dedicated one). Returns MG sid. */
  async createMessagingService(friendlyName: string): Promise<{ sid: string }> {
    const j = await this.post('https://messaging.twilio.com/v1/Services', { FriendlyName: friendlyName });
    return { sid: j.sid };
  }

  /** Create the A2P Campaign (UsAppToPerson) under the salon's Messaging Service. Returns { sid, status }. */
  async createCampaign(messagingServiceSid: string, c: CampaignInput): Promise<{ sid: string; status: string }> {
    const j = await this.post(`https://messaging.twilio.com/v1/Services/${messagingServiceSid}/Compliance/Usa2p`, {
      BrandRegistrationSid: c.brandRegistrationSid,
      Description: c.description,
      MessageSamples: c.messageSamples,
      UsAppToPersonUsecase: c.usAppToPersonUsecase,
      MessageFlow: c.messageFlow,
      OptInMessage: c.optInMessage ?? '',
      OptOutMessage: c.optOutMessage ?? '',
      HelpMessage: c.helpMessage ?? '',
      PrivacyPolicyUrl: c.privacyPolicyUrl,               // required by Twilio since 2026-06-30
      TermsAndConditionsUrl: c.termsAndConditionsUrl,     // required by Twilio since 2026-06-30
      HasEmbeddedLinks: c.hasEmbeddedLinks ? 'true' : 'false',
      HasEmbeddedPhone: c.hasEmbeddedPhone ? 'true' : 'false',
    });
    return { sid: j.sid, status: j.campaign_status ?? j.status };
  }
  async getCampaign(messagingServiceSid: string): Promise<{ sid: string; status: string }> {
    const j = await this.get(`https://messaging.twilio.com/v1/Services/${messagingServiceSid}/Compliance/Usa2p`);
    return { sid: j.sid, status: j.campaign_status ?? j.status };
  }

  /** Attach a phone number (PN sid) to the salon's Messaging Service so it can send under the approved campaign. */
  async attachNumber(messagingServiceSid: string, phoneNumberSid: string): Promise<{ sid: string }> {
    const j = await this.post(`https://messaging.twilio.com/v1/Services/${messagingServiceSid}/PhoneNumbers`, { PhoneNumberSid: phoneNumberSid });
    return { sid: j.sid };
  }
}
