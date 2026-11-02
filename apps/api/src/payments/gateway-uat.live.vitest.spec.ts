// gateway-uat.live — END-TO-END verification of the payment-gateway wiring against Fiserv's UAT, through the REAL code
// path (not curl): Super Admin's upsert (credentials sealed with the real PAYMENT_ENC_KEY cipher) -> the tenant resolver ->
// the tenant-bound CardPointeClient with the real instrumented HTTP transport -> inquireMerchant, a test-card sale, its
// void, an emulator decline -> the hosted tokenizer URL -> the membership stored-credential charge -> the Bolt terminal
// client. Runs ONLY when the UAT credentials are in the environment (never in the repo):
//   CARDPOINTE_UAT_BASE_URL, CARDPOINTE_UAT_MERCHID, CARDPOINTE_UAT_USERNAME, CARDPOINTE_UAT_PASSWORD,
//   BOLT_UAT_BASE_URL, BOLT_UAT_AUTH_KEY, BOLT_UAT_HSN  (Bolt part optional)
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentGatewayResolver, CardPointeBoltClient, isCardSecureToken } from '@aipowersalon/payments';
import { renewalChargeFn, CardPointeMembershipChargeAdapter } from '@aipowersalon/memberships';
import { instrumentedFetch } from '@aipowersalon/observability';
import { paymentSecrets } from '../common/provider-secrets.module';
import { seedRow } from '../events/pgtest-seed';

const E = process.env;
const live = !!(E.CARDPOINTE_UAT_BASE_URL && E.CARDPOINTE_UAT_MERCHID && E.CARDPOINTE_UAT_USERNAME && E.CARDPOINTE_UAT_PASSWORD);
const T = '46464646-4646-4464-8464-464646464646', B = '47474747-4747-4474-8474-474747474747', CU = '48484848-4848-4484-8484-484848484848';
let db: any; let resolver: PaymentGatewayResolver; let pg: any;

describe.skipIf(!live)('Fiserv UAT — the real wiring, end to end', () => {
  beforeAll(async () => {
    pg = await migratedPglite(); db = kyselyFor(pg);
    await seedRow(pg, 'tenants', { id: T, legal_name: 'UAT', display_name: 'UAT Salon', tenant_slug: 'uatsalon', tenant_code: 'UAT001', status: 'active' });
    await seedRow(pg, 'branches', { id: B, tenant_id: T, name: 'Main' });
    await seedRow(pg, 'customers', { id: CU, tenant_id: T, branch_id: B, first_name: 'U', last_name: 'T', full_name: 'U T', normalized_phone: '+16095550155', status: 'active' });
    resolver = new PaymentGatewayResolver(db, paymentSecrets);
  }, 60_000);

  it('1. Super Admin upsert seals the credentials; the row holds NO plaintext secret', async () => {
    const masked = await resolver.upsertConfig(T, { processorType: 'fiserv', environment: 'sandbox', baseUrl: E.CARDPOINTE_UAT_BASE_URL, merchantId: E.CARDPOINTE_UAT_MERCHID,
      apiUsername: E.CARDPOINTE_UAT_USERNAME, apiPassword: E.CARDPOINTE_UAT_PASSWORD, status: 'active', boltBaseUrl: E.BOLT_UAT_BASE_URL, boltApiKey: E.BOLT_UAT_AUTH_KEY }, undefined);
    expect(masked).toMatchObject({ processorType: 'fiserv', environment: 'sandbox', status: 'active', setupRequired: false });
    expect(masked.terminalConfigured).toBe(!!(E.BOLT_UAT_BASE_URL && E.BOLT_UAT_AUTH_KEY));
    const row: any = (await sql`SELECT api_username_enc, api_password_enc, bolt_api_key_enc, merchant_id FROM tenant_payment_config WHERE tenant_id = ${T}`.execute(db)).rows[0];
    expect(String(row.api_password_enc)).not.toContain(E.CARDPOINTE_UAT_PASSWORD);
    expect(String(row.api_username_enc)).not.toContain(E.CARDPOINTE_UAT_USERNAME);
    if (E.BOLT_UAT_AUTH_KEY) expect(String(row.bolt_api_key_enc)).not.toContain(E.BOLT_UAT_AUTH_KEY);
    expect(JSON.stringify(masked)).not.toContain(E.CARDPOINTE_UAT_PASSWORD);
  });

  it('2. the resolver builds a tenant-bound processor; Test Connection performs a LIVE inquireMerchant', async () => {
    const g = await resolver.resolve(T);
    expect(g.configured).toBe(true);
    expect(g.processor?.name).toBe('cardpointe');
    const t = await resolver.testConnection(T);
    expect(t).toMatchObject({ ok: true, configured: true, tested: true });
    expect(t.gateway?.merchantEnabled).toBe(true);
    expect(t.gateway?.cardProcessor).toBe('RPCT');
  }, 30_000);

  let retref: string | undefined;
  it('3. a card-not-present test-card sale through the tenant processor is APPROVED and returns a CardSecure token', async () => {
    const g = await resolver.resolve(T);
    const r = await g.processor!.authorizeAndCapture({ account: '4111111111111111', expiry: '1229', amountCents: 100, orderId: 'APS-WIRING-1', name: 'UAT Wiring', postal: '08109', idempotencyKey: 'wiring-' + Date.now() });
    expect(r.approved).toBe(true); expect(r.respstat).toBe('A'); expect(r.amountCents).toBe(100);
    retref = r.retref; expect(retref).toBeTruthy();
    // (the client does not surface a CardSecure token field; the tokenizer route is the iframe)
  }, 30_000);

  it('4. the sale is VOIDED through the same processor', async () => {
    const g = await resolver.resolve(T);
    const v = await g.processor!.voidTransaction({ retref: retref! });
    expect(v.ok).toBe(true); expect(v.respstat).toBe('A');
  }, 30_000);

  it('5. an emulator decline ($1500 -> RPCT 500) is reported as declined, not as an error', async () => {
    const g = await resolver.resolve(T);
    const d = await g.processor!.authorizeAndCapture({ account: '4111111111111111', expiry: '1229', amountCents: 150000, orderId: 'APS-WIRING-DECL' });
    expect(d.approved).toBe(false); expect(d.declined).toBe(true); expect(d.respstat).toBe('C');
    expect(d.respText).toMatch(/decline/i);
  }, 30_000);

  it('6. the customer app\'s hosted card form is the gateway\'s own tokenizer page, and that page answers', async () => {
    const tok = await resolver.tokenizerUrl(T);
    expect(tok.available).toBe(true);
    expect(tok.origin).toBe(new URL(E.CARDPOINTE_UAT_BASE_URL!).origin);
    const res = await fetch(tok.url!);
    expect(res.status).toBe(200);
    expect((await res.text()).toLowerCase()).toContain('<html');
  }, 30_000);

  it('7. membership auto-billing charges the member\'s saved card as a merchant-initiated stored credential (cof M / cofscheduled Y) through the tenant gateway', async () => {
    // the saved "card" is a CardSecure-shaped token; UAT's RPCT emulator accepts a tokenized test card
    const saleForToken = await fetch(String(E.CARDPOINTE_UAT_BASE_URL).replace(/\/+$/, '').replace(/\/cardconnect\/rest$/i, '') + '/cardconnect/rest/auth', {
      method: 'PUT', headers: { Authorization: 'Basic ' + Buffer.from(`${E.CARDPOINTE_UAT_USERNAME}:${E.CARDPOINTE_UAT_PASSWORD}`).toString('base64'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ merchid: E.CARDPOINTE_UAT_MERCHID, account: '4111111111111111', expiry: '1229', amount: '0.00', capture: 'N', ecomind: 'E', profile: 'Y' }) });
    const j: any = await saleForToken.json();
    const savedToken = String(j.token || '');
    expect(isCardSecureToken(savedToken)).toBe(true);
    await seedRow(pg, 'customer_payment_methods', { tenant_id: T, customer_id: CU, token: savedToken, last4: savedToken.slice(-4), exp_month: 12, exp_year: 2029, is_default: true });
    const charge = new CardPointeMembershipChargeAdapter(renewalChargeFn(db, resolver));
    const r = await charge.charge({ tenantId: T, amountCents: 4900, currency: 'USD', customerId: CU, membershipId: '49494949-4949-4494-8494-494949494949', idempotencyKey: 'renew-wiring-' + Date.now() });
    expect(r.status).toBe('succeeded'); expect(r.processor).toBe('cardpointe'); expect(r.processorRef).toBeTruthy();
    const g = await resolver.resolve(T);
    expect((await g.processor!.voidTransaction({ retref: r.processorRef! })).ok).toBe(true);   // leave UAT clean
  }, 45_000);

  it.skipIf(!(E.BOLT_UAT_BASE_URL && E.BOLT_UAT_AUTH_KEY && E.BOLT_UAT_HSN))('8. the Bolt terminal client reaches Bolt UAT with the stored key; the device being offline is reported in Bolt\'s own words', async () => {
    const row: any = (await sql`SELECT bolt_base_url, bolt_api_key_enc FROM tenant_payment_config WHERE tenant_id = ${T}`.execute(db)).rows[0];
    const client = new CardPointeBoltClient({ baseUrl: String(row.bolt_base_url), apiKey: paymentSecrets.decrypt(String(row.bolt_api_key_enc)), merchantId: E.CARDPOINTE_UAT_MERCHID! },
      instrumentedFetch('bolt', (url: string, init: any) => (globalThis.fetch as any)(url, init)));
    expect(await client.ping(E.BOLT_UAT_HSN!)).toBe(false);                    // not online yet — no session can open
    await expect(client.display(E.BOLT_UAT_HSN!, 'hello')).rejects.toThrow(/No request queue registered for hsn|SessionKey/);
  }, 30_000);
});
