// tenant-a2p.vitest.spec.ts — the A2P orchestration. Verifies the pure status derivation, that the REST client shapes
// requests against the real Twilio endpoints (URL + key fields, arrays as repeated keys, required policy URLs), and
// that the service is honest when the ISV account isn't configured.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwilioA2pClient } from './twilio-a2p-client';
import { TwilioTrustHubClient } from './twilio-trusthub-client';
import { deriveOverallStatus, TenantA2pService } from './tenant-a2p.service';

describe('deriveOverallStatus', () => {
  it('walks brand → campaign → live and flags failures', () => {
    expect(deriveOverallStatus('not_started', { brandStatus: 'PENDING' })).toBe('brand_submitted');
    expect(deriveOverallStatus('brand_submitted', { brandStatus: 'APPROVED' })).toBe('brand_approved');
    expect(deriveOverallStatus('brand_approved', { brandStatus: 'APPROVED', campaignStatus: 'IN_PROGRESS' })).toBe('campaign_submitted');
    expect(deriveOverallStatus('campaign_submitted', { brandStatus: 'APPROVED', campaignStatus: 'VERIFIED' })).toBe('campaign_approved');
    expect(deriveOverallStatus('campaign_approved', { campaignStatus: 'VERIFIED', numberAttached: true })).toBe('live');
    expect(deriveOverallStatus('brand_submitted', { brandStatus: 'FAILED' })).toBe('failed');
    expect(deriveOverallStatus('campaign_submitted', { campaignStatus: 'FAILED' })).toBe('failed');
  });
});

describe('TwilioA2pClient request shaping', () => {
  function stub() {
    const calls: { url: string; body: string }[] = [];
    const http = vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), body: String(init?.body ?? '') }); return { ok: true, json: async () => ({ sid: 'BNxxx', status: 'PENDING', campaign_status: 'IN_PROGRESS' }) } as any; });
    return { calls, client: new TwilioA2pClient({ accountSid: 'AC1', authToken: 'tok' }, http as any) };
  }
  it('creates a brand at the real endpoint with the bundle SIDs + brand type + mock flag', async () => {
    const { calls, client } = stub();
    await client.createBrand({ customerProfileBundleSid: 'BUcp', a2pProfileBundleSid: 'BUa2p', brandType: 'STANDARD', mock: true });
    expect(calls[0].url).toBe('https://messaging.twilio.com/v1/a2p/BrandRegistrations');
    expect(calls[0].body).toContain('CustomerProfileBundleSid=BUcp');
    expect(calls[0].body).toContain('A2PProfileBundleSid=BUa2p');
    expect(calls[0].body).toContain('BrandType=STANDARD');
    expect(calls[0].body).toContain('Mock=true');
  });
  it('creates a campaign with required policy URLs and repeated MessageSamples keys', async () => {
    const { calls, client } = stub();
    await client.createCampaign('MG1', { brandRegistrationSid: 'BN1', description: 'Appointment reminders', messageSamples: ['Hi, reminder 1', 'Hi, reminder 2'], usAppToPersonUsecase: 'MIXED', messageFlow: 'x'.repeat(45), privacyPolicyUrl: 'https://s.com/p', termsAndConditionsUrl: 'https://s.com/t', hasEmbeddedLinks: false, hasEmbeddedPhone: false });
    expect(calls[0].url).toBe('https://messaging.twilio.com/v1/Services/MG1/Compliance/Usa2p');
    expect(calls[0].body).toContain('BrandRegistrationSid=BN1');
    expect(calls[0].body).toContain('PrivacyPolicyUrl=');
    expect(calls[0].body).toContain('TermsAndConditionsUrl=');
    expect((calls[0].body.match(/MessageSamples=/g) || []).length).toBe(2);   // arrays → repeated keys
  });
  it('throws a readable error on a Twilio failure', async () => {
    const http = vi.fn(async () => ({ ok: false, json: async () => ({ message: 'bundle not approved' }) } as any));
    const c = new TwilioA2pClient({ accountSid: 'AC1', authToken: 'tok' }, http as any);
    await expect(c.createBrand({ customerProfileBundleSid: 'x', a2pProfileBundleSid: 'y', brandType: 'STANDARD', mock: false })).rejects.toThrow(/bundle not approved/);
  });
});

describe('TwilioTrustHubClient request shaping', () => {
  function stub() {
    const calls: { url: string; body: string }[] = [];
    const http = vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), body: String(init?.body ?? '') }); return { ok: true, json: async () => ({ sid: 'BUxxx', status: 'compliant' }) } as any; });
    return { calls, client: new TwilioTrustHubClient({ accountSid: 'AC1', authToken: 'tok', isvEmail: 'isv@x.com' }, http as any) };
  }
  const biz = { businessName: 'Nails Co', einTaxId: '12-3456789', street: '1 Main', city: 'Merchantville', region: 'NJ', postalCode: '08109', isoCountry: 'US', repFirstName: 'Kevin', repLastName: 'S', repEmail: 'k@x.com', repPhone: '+18565551234' };
  it('creates a customer profile at the TrustHub endpoint with the ISV email + policy sid', async () => {
    const { calls, client } = stub();
    await client.createCustomerProfile('Nails Co Secondary');
    expect(calls[0].url).toBe('https://trusthub.twilio.com/v1/CustomerProfiles');
    expect(calls[0].body).toContain('Email=isv%40x.com');
    expect(calls[0].body).toContain('PolicySid=');
  });
  it('creates the business-info end user with the correct Type + attributes', async () => {
    const { calls, client } = stub();
    await client.createBusinessInfoEndUser('Nails Co Business', biz as any);
    expect(calls[0].url).toBe('https://trusthub.twilio.com/v1/EndUsers');
    expect(calls[0].body).toContain('Type=customer_profile_business_information');
    expect(decodeURIComponent(calls[0].body)).toContain('"business_registration_number":"12-3456789"');
  });
  it('creates the address on the 2010 API and assigns entities on TrustHub', async () => {
    const { calls, client } = stub();
    await client.createAddress('Nails Co Address', biz as any);
    expect(calls[0].url).toContain('/2010-04-01/Accounts/AC1/Addresses.json');
    const { calls: c2, client: cl2 } = stub();
    await cl2.assignToCustomerProfile('BUcp', 'ITbi');
    expect(c2[0].url).toBe('https://trusthub.twilio.com/v1/CustomerProfiles/BUcp/EntityAssignments');
    expect(c2[0].body).toContain('ObjectSid=ITbi');
  });
});

describe('TenantA2pService honesty (no ISV credentials)', () => {
  const audit = { record: vi.fn(async () => ({})) };
  beforeEach(() => { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; });
  afterEach(() => { delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; });
  it('get reports configured=false when no ISV account is set', async () => {
    const svc = new TenantA2pService(null as any, audit as any);
    const v = await svc.get('ten_1');
    expect(v.configured).toBe(false);
    expect(v.status).toBe('not_started');
  });
  it('submitBrand refuses (no fabricated SID) without ISV credentials', async () => {
    const svc = new TenantA2pService(null as any, audit as any);
    const v = await svc.submitBrand('admin', 'ten_1');
    expect(v.brandSid).toBeNull();
    expect(v.lastError).toMatch(/credentials not configured/i);
  });
  it('provisionSecondaryProfile refuses without ISV email/creds (no fabricated bundle)', async () => {
    delete process.env.TWILIO_ISV_EMAIL;
    const svc = new TenantA2pService(null as any, audit as any);
    const v = await svc.provisionSecondaryProfile('admin', 'ten_1');
    expect(v.inputs.customerProfileBundleSid).toBeNull();
    expect(v.lastError).toMatch(/TWILIO_ISV_EMAIL/i);
  });
});
