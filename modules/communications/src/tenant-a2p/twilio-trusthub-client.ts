// twilio-trusthub-client.ts — dependency-free REST client for Twilio's TrustHub API, used to AUTOMATE creation of a
// salon's Secondary Customer Profile and A2P profile bundle (the prerequisite for Brand/Campaign). Endpoints and field
// names match Twilio's TrustHub docs (verified 2026). Authenticates with the ISV primary account. `http` injectable.
//
// IMPORTANT (verify with your Twilio account): the two Policy SIDs below are Twilio's documented fixed policies for the
// Secondary Customer Profile and the A2P Messaging TrustProduct. Twilio can change these; override via
// TWILIO_SECONDARY_PROFILE_POLICY_SID / TWILIO_A2P_POLICY_SID if your account requires different values. Likewise the
// business-info Attribute keys follow Twilio's "Gather Business Information" schema and should be checked against the
// current docs before a live submission.
export const SECONDARY_PROFILE_POLICY_SID = process.env.TWILIO_SECONDARY_PROFILE_POLICY_SID || 'RNdfbf3fae0e1107f8aded0e7cead80bf5';
export const A2P_PROFILE_POLICY_SID = process.env.TWILIO_A2P_POLICY_SID || 'RNb0d4771c2c98518d916a3d4cd70a8f8b';

export interface TrustHubCreds { accountSid: string; authToken: string; isvEmail: string }

export interface BusinessInfo {
  businessName: string; einTaxId: string; businessType?: string; businessIndustry?: string; businessRegistrationIdentifier?: string;
  websiteUrl?: string; regionsOfOperation?: string;
  street: string; city: string; region: string; postalCode: string; isoCountry: string;
  repFirstName: string; repLastName: string; repEmail: string; repPhone: string; repBusinessTitle?: string; repJobPosition?: string;
}

export class TwilioTrustHubClient {
  constructor(private readonly creds: TrustHubCreds, private readonly http: typeof fetch = instrumentedFetch('twilio', fetch) as typeof fetch) {}
  private auth() { return 'Basic ' + Buffer.from(this.creds.accountSid + ':' + this.creds.authToken).toString('base64'); }

  private async post(url: string, form: Record<string, string>): Promise<any> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) if (v !== undefined && v !== null && v !== '') body.set(k, v);
    const res = await this.http(url, { method: 'POST', headers: { Authorization: this.auth(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('trusthub_failed:' + (j?.message || res.status));
    return j;
  }

  // ── Secondary Customer Profile ──────────────────────────────────────────────
  async createCustomerProfile(friendlyName: string): Promise<{ sid: string }> {
    const j = await this.post('https://trusthub.twilio.com/v1/CustomerProfiles', { FriendlyName: friendlyName, Email: this.creds.isvEmail, PolicySid: SECONDARY_PROFILE_POLICY_SID });
    return { sid: j.sid };
  }
  async createBusinessInfoEndUser(friendlyName: string, b: BusinessInfo): Promise<{ sid: string }> {
    const attributes = {
      business_name: b.businessName,
      business_registration_identifier: b.businessRegistrationIdentifier || 'EIN',
      business_registration_number: b.einTaxId,
      business_identity: 'direct_customer',
      business_type: b.businessType || 'Limited Liability Company',
      business_industry: b.businessIndustry || 'PROFESSIONAL_SERVICES',
      business_regions_of_operation: b.regionsOfOperation || 'USA_AND_CANADA',
      website_url: b.websiteUrl || '',
    };
    const j = await this.post('https://trusthub.twilio.com/v1/EndUsers', { FriendlyName: friendlyName, Type: 'customer_profile_business_information', Attributes: JSON.stringify(attributes) });
    return { sid: j.sid };
  }
  async createAuthorizedRep(friendlyName: string, b: BusinessInfo): Promise<{ sid: string }> {
    const attributes = { first_name: b.repFirstName, last_name: b.repLastName, email: b.repEmail, phone_number: b.repPhone, business_title: b.repBusinessTitle || 'Owner', job_position: b.repJobPosition || 'Director' };
    const j = await this.post('https://trusthub.twilio.com/v1/EndUsers', { FriendlyName: friendlyName, Type: 'authorized_representative_1', Attributes: JSON.stringify(attributes) });
    return { sid: j.sid };
  }
  /** Address lives on the main API (2010-04-01), then is wrapped in a SupportingDocument for TrustHub. */
  async createAddress(friendlyName: string, b: BusinessInfo): Promise<{ sid: string }> {
    const j = await this.post(`https://api.twilio.com/2010-04-01/Accounts/${this.creds.accountSid}/Addresses.json`, {
      FriendlyName: friendlyName, CustomerName: b.businessName, Street: b.street, City: b.city, Region: b.region, PostalCode: b.postalCode, IsoCountry: b.isoCountry,
    });
    return { sid: j.sid };
  }
  async createAddressSupportingDocument(friendlyName: string, addressSid: string): Promise<{ sid: string }> {
    const j = await this.post('https://trusthub.twilio.com/v1/SupportingDocuments', { FriendlyName: friendlyName, Type: 'customer_profile_address', Attributes: JSON.stringify({ address_sids: addressSid }) });
    return { sid: j.sid };
  }
  async assignToCustomerProfile(customerProfileSid: string, objectSid: string): Promise<{ sid: string }> {
    const j = await this.post(`https://trusthub.twilio.com/v1/CustomerProfiles/${customerProfileSid}/EntityAssignments`, { ObjectSid: objectSid });
    return { sid: j.sid };
  }
  async evaluateCustomerProfile(customerProfileSid: string): Promise<{ status: string }> {
    const j = await this.post(`https://trusthub.twilio.com/v1/CustomerProfiles/${customerProfileSid}/Evaluations`, { PolicySid: SECONDARY_PROFILE_POLICY_SID });
    return { status: j.status };   // 'compliant' | 'noncompliant'
  }
  async submitCustomerProfile(customerProfileSid: string): Promise<{ status: string }> {
    const j = await this.post(`https://trusthub.twilio.com/v1/CustomerProfiles/${customerProfileSid}`, { Status: 'pending-review' });
    return { status: j.status };
  }

  // ── A2P Messaging TrustProduct ──────────────────────────────────────────────
  async createTrustProduct(friendlyName: string): Promise<{ sid: string }> {
    const j = await this.post('https://trusthub.twilio.com/v1/TrustProducts', { FriendlyName: friendlyName, Email: this.creds.isvEmail, PolicySid: A2P_PROFILE_POLICY_SID });
    return { sid: j.sid };
  }
  async createA2pMessagingEndUser(friendlyName: string, companyType: string): Promise<{ sid: string }> {
    const j = await this.post('https://trusthub.twilio.com/v1/EndUsers', { FriendlyName: friendlyName, Type: 'us_a2p_messaging_profile_information', Attributes: JSON.stringify({ company_type: companyType }) });
    return { sid: j.sid };
  }
  async assignToTrustProduct(trustProductSid: string, objectSid: string): Promise<{ sid: string }> {
    const j = await this.post(`https://trusthub.twilio.com/v1/TrustProducts/${trustProductSid}/EntityAssignments`, { ObjectSid: objectSid });
    return { sid: j.sid };
  }
  async evaluateTrustProduct(trustProductSid: string): Promise<{ status: string }> {
    const j = await this.post(`https://trusthub.twilio.com/v1/TrustProducts/${trustProductSid}/Evaluations`, { PolicySid: A2P_PROFILE_POLICY_SID });
    return { status: j.status };
  }
  async submitTrustProduct(trustProductSid: string): Promise<{ status: string }> {
    const j = await this.post(`https://trusthub.twilio.com/v1/TrustProducts/${trustProductSid}`, { Status: 'pending-review' });
    return { status: j.status };
  }
}import { instrumentedFetch } from '@aipowersalon/observability';

