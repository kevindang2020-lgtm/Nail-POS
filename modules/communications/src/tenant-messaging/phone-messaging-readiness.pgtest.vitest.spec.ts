// phone-messaging-readiness.pgtest — Phone & Messaging + Text Messaging Setup (owner guide, Oct 30 2026), on the real
// migrated schema (721), with two salons and a FAKE Twilio (an injected http — nothing here reaches the network, sends a
// real text or buys a real number).
//
//   • readiness: Unknown until an authenticated check of THIS configuration; Connected only after it; Stale after 24 h;
//     a config change → Unknown again; independent A2P / inbound / Verify / outbound models
//   • the Health Check: records the result with a safe code, rate-limited per salon
//   • save: validate first (wrong token / number not on the account / unreachable → nothing written), API key pairing,
//     one transaction with the number registry
//   • Test SMS: readiness required, idempotent, recorded; Delivered only from the signed status callback
//   • number purchase: only with the server-issued confirmation bound to salon + number; replay is idempotent
//   • tenant isolation throughout
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { computeTwilioSignature } from '@aipowersalon/notifications';
import { OutboxWriter } from '@aipowersalon/events';
import { TenantMessagingCredentialsService, CredentialsInputError } from './tenant-messaging-credentials.service';
import { TenantMessagingReadinessService, ReadinessInputError } from './tenant-messaging-readiness.service';
import { TenantNumberService, NumberPurchaseError } from './tenant-number.service';
import { evaluateReadiness, CHECK_STALE_AFTER_MS } from './messaging-readiness-model';
import { TwilioInboundService } from '../messaging-inbound/twilio-inbound.service';
import { TenantRegistrationSyncService } from './registration-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';

const A = '7a100000-0000-4000-8000-00000000000a', B = '7a100000-0000-4000-8000-00000000000b';
const BR_A = '7a1b0000-0000-4000-8000-00000000000a', BR_B = '7a1b0000-0000-4000-8000-00000000000b';
const U = '7a1u0000-0000-4000-8000-000000000001'.replace('u', 'c');
const AC_A = 'AC' + '1'.repeat(32), AC_B = 'AC' + '2'.repeat(32), AC_X = 'AC' + '3'.repeat(32);
const SK = 'SK' + '4'.repeat(32), SK2 = 'SK' + '5'.repeat(32);
const VA = 'VA' + '6'.repeat(32);
const TOK_A = 'fixture-token-a', TOK_B = 'fixture-token-b', KEY_SECRET = 'fixture-key-secret';   // test fixtures, not credentials
const NUM_A = '+18565550401', NUM_B = '+18565550402', NUM_TF = '+18885550403', NUM_BUY = '+18565550499';
const DEST = '+15551230404';
const API_BASE = 'https://api.example.test';
const IN_URL = `${API_BASE}/webhooks/twilio/sms/inbound`, ST_URL = `${API_BASE}/webhooks/twilio/sms/status`;

// ── the fake Twilio ──
const BN = 'BN' + 'a'.repeat(32), QE = 'QE' + 'b'.repeat(32), MG = 'MG' + '7'.repeat(32);
const tw = { campaign: 'IN_PROGRESS', badTokens: new Set<string>(), down: false, owned: new Set<string>([NUM_A, NUM_B, NUM_TF]), smsUrl: IN_URL as string | null, price: { current_price: '1.15', number_type: 'local' } as any, sent: [] as string[], bought: [] as string[], seq: 0 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fake = vi.fn(async (url: any, init?: any) => {
  if (tw.down) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const u = String(url);
  const auth = Buffer.from(String(init?.headers?.Authorization ?? '').replace(/^Basic /, ''), 'base64').toString();
  const [user, pass] = auth.split(':');
  if (tw.badTokens.has(pass)) return json({ message: 'Authenticate' }, 401);
  if (u.startsWith('https://pricing.twilio.com/')) return json(tw.price ? { price_unit: 'usd', phone_number_prices: [tw.price] } : { phone_number_prices: [] });
  if (u.startsWith('https://verify.twilio.com/')) return json({ sid: VA, friendly_name: 'Fixture Verify' });
  if (u.includes('/AvailablePhoneNumbers/')) return json({ available_phone_numbers: [{ phone_number: NUM_BUY, friendly_name: '(856) 555-0499', capabilities: { voice: true, SMS: true, MMS: false } }] });
  if (u.endsWith('/Messages.json') && init?.method === 'POST') { tw.sent.push(String(init.body)); return json({ sid: `SM${String(++tw.seq).padStart(32, '0')}`, status: 'queued' }, 201); }
  if (u.endsWith('/IncomingPhoneNumbers.json') && init?.method === 'POST') { const n = new URLSearchParams(String(init.body)).get('PhoneNumber')!; tw.bought.push(n); tw.owned.add(n); return json({ sid: `PN${String(++tw.seq).padStart(32, '0')}`, phone_number: n }, 201); }
  if (u.includes('IncomingPhoneNumbers.json?PhoneNumber=')) {
    const n = decodeURIComponent(u.split('PhoneNumber=')[1]);
    return json({ incoming_phone_numbers: tw.owned.has(n) ? [{ phone_number: n, capabilities: { sms: true, voice: true, mms: false }, sms_url: tw.smsUrl }] : [] });
  }
  if (u.includes('IncomingPhoneNumbers.json')) return json({ incoming_phone_numbers: [] });
  // PM-03: the provider's registration reads (round 2) — brand approved, campaign as `tw.campaign`, number in the service
  if (u.includes('/a2p/BrandRegistrations/')) return json({ sid: u.split('/').pop(), status: 'APPROVED' });
  if (u.endsWith('/Compliance/Usa2p')) return json({ compliance: [{ sid: QE, campaign_status: tw.campaign }] });
  if (u.includes('/PhoneNumbers?')) return json({ phone_numbers: tw.campaign === 'VERIFIED' ? [{ sid: 'PN' + '8'.repeat(32), phone_number: NUM_A }] : [] });
  if (/messaging\.twilio\.com\/v1\/Services\/MG[0-9a-f]{32}$/.test(u)) return json({ sid: MG, us_app_to_person_registered: tw.campaign === 'VERIFIED' });
  const m = u.match(/\/Accounts\/(AC[0-9a-f]{32})\.json$/);
  if (m) return json({ sid: m[1], status: 'active', type: 'Full', user });
  return json({}, 404);
});

let pg: any; let db: any;
const audit = { record: vi.fn(async () => ({})) };
const creds = () => { const s = new TenantMessagingCredentialsService(db, audit as any, testProviderSecrets); s.http = fake as any; return s; };
let clock = Date.now();
const readiness = (limited = false) => { const s = new TenantMessagingReadinessService(db, audit as any, testProviderSecrets); s.http = fake as any; s.now = () => new Date(clock); if (!limited) s.minIntervalMs = 0; return s; };
const numbers = () => { const s = new TenantNumberService(db, audit as any, testProviderSecrets); s.http = fake as any; return s; };
const tick = (ms = 60_000) => { clock += ms; };
const credRow = async (t: string) => (await sql`select * from tenant_messaging_credentials where tenant_id = ${t} and branch_id is null`.execute(db)).rows[0] as any;
const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e: any) { return e?.apiCode ?? e?.message; } };
const env = { base: process.env.PUBLIC_API_BASE_URL, sc: process.env.TWILIO_STATUS_CALLBACK_URL, sid: process.env.TWILIO_ACCOUNT_SID, tok: process.env.TWILIO_AUTH_TOKEN };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
    ('${A}', 'Salon A LLC', 'Salon A', 'pm-a', 'PMA', 'active'), ('${B}', 'Salon B LLC', 'Salon B', 'pm-b', 'PMB', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${BR_A}', '${A}', 'Main A', 'active'), ('${BR_B}', '${B}', 'Main B', 'active');`);
}, 180_000);
beforeEach(() => { process.env.PUBLIC_API_BASE_URL = API_BASE; process.env.TWILIO_STATUS_CALLBACK_URL = ST_URL; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; tw.down = false; tw.badTokens.clear(); });
afterAll(() => {
  for (const [k, v] of [['PUBLIC_API_BASE_URL', env.base], ['TWILIO_STATUS_CALLBACK_URL', env.sc], ['TWILIO_ACCOUNT_SID', env.sid], ['TWILIO_AUTH_TOKEN', env.tok]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('saving credentials: validate first, then one transaction', () => {
  it('first save is checked with Twilio and records a Connected check for exactly this configuration', async () => {
    await creds().set(U, A, { accountSid: AC_A, authToken: TOK_A, fromNumber: NUM_A });
    const r = await readiness().readiness(A, null);
    expect(r.account).toMatchObject({ state: 'connected', accountSidLast4: '1111', mode: 'tenant_owned' });
    expect(r.sender).toMatchObject({ state: 'assigned', number: NUM_A, capabilities: { sms: true, voice: true, mms: false } });
    expect(JSON.stringify(r)).not.toContain(TOK_A);
    expect(r.diagnostics.checks[0]).toMatchObject({ trigger: 'save', accountState: 'connected', current: true });
  });
  it('a wrong auth token is refused by the provider check and NOTHING is changed (the working config stays)', async () => {
    const before = await credRow(A);
    tw.badTokens.add('wrong-token');
    expect(await code(creds().set(U, A, { accountSid: AC_A, authToken: 'wrong-token', fromNumber: NUM_A }))).toBe('TWILIO_AUTH_FAILED');
    const after = await credRow(A);
    expect(after.auth_token_enc).toBe(before.auth_token_enc);
    expect(after.config_version).toBe(before.config_version);
  });
  it('a sending number that is not on the account is refused before the registry or the credentials move', async () => {
    expect(await code(creds().set(U, A, { accountSid: AC_A, fromNumber: '+18565550777' }))).toBe('TWILIO_NUMBER_NOT_ON_ACCOUNT');
    expect((await credRow(A)).from_number).toBe(NUM_A);
    expect((await sql`select count(*)::int n from tenant_messaging_numbers where phone_number = '+18565550777'`.execute(db)).rows[0]).toMatchObject({ n: 0 });
  });
  it('another salon’s number is refused inside the transaction: neither the registry nor B’s credentials are written', async () => {
    expect(await code(creds().set(U, B, { accountSid: AC_B, authToken: TOK_B, fromNumber: NUM_A }))).toBe('MESSAGING_NUMBER_TAKEN');
    expect(await credRow(B)).toBeUndefined();
    expect((await sql`select tenant_id::text t from tenant_messaging_numbers where phone_number = ${NUM_A}`.execute(db)).rows[0]).toMatchObject({ t: A });
    expect((await sql`select count(*)::int n from tenant_messaging_health_checks where tenant_id = ${B}`.execute(db)).rows[0]).toMatchObject({ n: 0 });
  });
  it('Twilio unreachable → refused unless the owner confirms saving unverified; then it is Unknown, never Connected', async () => {
    tw.down = true;
    expect(await code(creds().set(U, B, { accountSid: AC_B, authToken: TOK_B, fromNumber: NUM_B }))).toBe('MESSAGING_PROVIDER_UNREACHABLE');
    expect(await credRow(B)).toBeUndefined();
    await creds().set(U, B, { accountSid: AC_B, authToken: TOK_B, fromNumber: NUM_B, confirmUnverified: true });
    tw.down = false;
    const r = await readiness().readiness(B, null);
    expect(r.account.state).toBe('unknown');
    expect(r.account.reasonCode).toBe('PROVIDER_UNREACHABLE');
    expect(r.outbound.state).not.toBe('ready_to_attempt');
  });
  it('leave-blank keeps the token; a different Account SID needs its own token', async () => {
    const before = await credRow(A);
    await creds().set(U, A, { accountSid: AC_A, fromNumber: NUM_A, verifyServiceSid: VA });
    expect((await credRow(A)).auth_token_enc).toBe(before.auth_token_enc);
    expect(await code(creds().set(U, A, { accountSid: AC_X, fromNumber: NUM_A }))).toBe('TWILIO_AUTH_TOKEN_REQUIRED_FOR_NEW_ACCOUNT');
  });
});

describe('API key SID + secret are one pair', () => {
  it('a new API key SID without its secret is refused (a SID is not a secret)', async () => {
    expect(await code(creds().set(U, A, { accountSid: AC_A, apiKeySid: SK }))).toBe('TWILIO_API_KEY_SECRET_REQUIRED');
    expect((await credRow(A)).api_key_sid).toBeNull();
  });
  it('a secret without a SID is refused', async () => {
    expect(await code(creds().set(U, A, { accountSid: AC_A, apiKeySid: '', apiKeySecret: KEY_SECRET }))).toBe('TWILIO_API_KEY_SID_REQUIRED');
  });
  it('SID + secret save (checked against the account); re-saving the SAME SID may leave the secret blank', async () => {
    await creds().set(U, A, { accountSid: AC_A, apiKeySid: SK, apiKeySecret: KEY_SECRET });
    const used = fake.mock.calls.map((c) => String(c[1]?.headers?.Authorization ?? '')).filter((h) => Buffer.from(h.replace('Basic ', ''), 'base64').toString().startsWith(SK));
    expect(used.length).toBeGreaterThan(0);
    await creds().set(U, A, { accountSid: AC_A, apiKeySid: SK });
    expect((await credRow(A)).api_key_secret_enc).toBeTruthy();
  });
  it('CHANGING the SID without a new secret is refused — the stored secret belongs to the old key', async () => {
    expect(await code(creds().set(U, A, { accountSid: AC_A, apiKeySid: SK2 }))).toBe('TWILIO_API_KEY_SECRET_REQUIRED');
    expect((await credRow(A)).api_key_sid).toBe(SK);
  });
  it('a rejected key is refused and the stored key is untouched', async () => {
    tw.badTokens.add('bad-key-secret');
    expect(await code(creds().set(U, A, { accountSid: AC_A, apiKeySid: SK2, apiKeySecret: 'bad-key-secret' }))).toBe('TWILIO_API_KEY_REJECTED');
    expect((await credRow(A)).api_key_sid).toBe(SK);
  });
});

describe('the Health Check and the readiness it feeds', () => {
  it('records an authenticated check (account, key, number, inbound URL, Verify) and Verify readiness follows it', async () => {
    tick();
    const r = await readiness().healthCheck({ userId: U, tenantId: A }, null);
    expect(r.account.state).toBe('connected');
    expect(r.account.apiKey).toMatchObject({ sid: 'SK…4444', sidLast4: '4444', hasSecret: true, state: 'connected', scope: 'sufficient' });   // PM-02: masked
    expect(r.inbound.state).toBe('configured');            // the number's SMS URL is ours — not yet "verified"
    expect(r.inbound.reasonCode).toBe('NO_VERIFIED_INBOUND_EVENT');
    expect((await credRow(A)).last_validated_at).not.toBeNull();   // the Verify probe is Test Verify
    expect(r.verify.state).toBe('disabled');                // the salon toggle is off — Verify is separate from SMS
    expect(r.verify.reasonCode).toBe('TENANT_DISABLED');
  });
  it('is rate-limited per salon (and only per salon)', async () => {
    expect(await code(readiness(true).healthCheck({ userId: U, tenantId: A }, null))).toBe('HEALTH_CHECK_RATE_LIMITED');
    await expect(readiness(true).healthCheck({ userId: U, tenantId: B }, null)).resolves.toBeTruthy();
  });
  it('a check older than 24 h is Stale — never green', async () => {
    const s = readiness(); s.now = () => new Date(clock + CHECK_STALE_AFTER_MS + 60_000);
    const r = await s.readiness(A, null);
    expect(r.account.state).toBe('stale');
    expect(r.sender.state).toBe('unknown');
    expect(r.checklist.find((c) => c.key === 'connect')!.state).not.toBe('done');
  });
  it('an invalid token found by the check is Invalid with a safe code (no provider text)', async () => {
    tick(); tick();
    tw.badTokens.add(TOK_B);
    const r = await readiness().healthCheck({ userId: U, tenantId: B }, null);
    expect(r.account).toMatchObject({ state: 'invalid', reasonCode: 'TWILIO_AUTH_FAILED' });
    expect(r.outbound.state).toBe('blocked');
    tw.badTokens.delete(TOK_B);
  });
  it('A2P: brand approved + campaign pending → Pending and outbound Blocked; approved + number in the service → Approved', async () => {
    await sql`insert into tenant_a2p_registrations (tenant_id, brand_sid, brand_status, campaign_sid, campaign_status, messaging_service_sid, status)
      values (${A}, ${BN}, 'APPROVED', ${QE}, 'IN_PROGRESS', ${MG}, 'campaign_submitted')`.execute(db);
    let r = await readiness().readiness(A, null);
    // round 2 (PM-03): the Super Admin record alone is a claim — the brand is "not verified", the campaign pending
    expect(r.a2p).toMatchObject({ state: 'pending', reasonCode: 'CAMPAIGN_PENDING', brand: { state: 'unable_to_verify', reasonCode: 'NOT_VERIFIED_WITH_PROVIDER' }, campaign: { state: 'pending' } });
    expect(r.outbound.blockers).toContain('A2P_PENDING');
    const sync = new TenantRegistrationSyncService(db, audit as any, testProviderSecrets); sync.http = fake as any;
    await sync.refresh(A, { trigger: 'manual', idempotencyKey: 'a2p-test-0001', actorUserId: U });
    r = await readiness().readiness(A, null);
    expect(r.a2p).toMatchObject({ state: 'pending', brand: { state: 'approved', verified: true }, campaign: { state: 'pending', verified: true } });
    await sql`update tenant_a2p_registrations set campaign_status = 'VERIFIED', number_sid = 'PN1', status = 'number_attached' where tenant_id = ${A}`.execute(db);
    r = await readiness().readiness(A, null);
    expect(r.a2p.state).not.toBe('approved');            // the record moved; the provider has not confirmed it yet
    tw.campaign = 'VERIFIED';
    sync.minIntervalMs = 0;
    await sync.refresh(A, { trigger: 'manual', idempotencyKey: 'a2p-test-0002', actorUserId: U });
    r = await readiness().readiness(A, null);
    expect(r.a2p).toMatchObject({ state: 'approved', providerVerified: true });
    expect(r.outbound.state).toBe('ready_to_attempt');
  });
  it('a toll-free sender is "Not applicable" for A2P 10DLC, not "approved"', () => {
    const m = evaluateReadiness({ now: new Date(), source: 'tenant_default', sharedPlatformAccount: false, lastCheck: null, registryNumber: null, a2p: null, webhooks: { inbound: null, status: null }, expectedInboundUrl: null, statusCallbackUrl: null,
      verify: { tenantEnabled: false, requiredByPlatform: false, blockedByPlatform: false, emergencyDisabled: false, moduleDisabled: false, source: 'default' }, lastTest: null,
      cred: { accountMode: 'tenant_owned', accountSid: AC_A, authTokenLast4: 'en-a', fromNumber: NUM_TF, verifyServiceSid: null, apiKeySid: null, hasApiKeySecret: false, messagingServiceSid: null, lastValidatedAt: null, lastValidationError: false, updatedAt: new Date(), updatedByUserId: null, fingerprint: 'x' } });
    expect(m.a2p).toMatchObject({ state: 'not_applicable', applicable: false, reasonCode: 'TOLL_FREE_VERIFICATION_SEPARATE' });
    // nothing configured at all: registration is "Not started" (not "Not applicable"), the account is Not configured
    const none = evaluateReadiness({ now: new Date(), source: 'none', sharedPlatformAccount: false, lastCheck: null, registryNumber: null, a2p: null, webhooks: { inbound: null, status: null }, expectedInboundUrl: null, statusCallbackUrl: null,
      verify: { tenantEnabled: false, requiredByPlatform: false, blockedByPlatform: false, emergencyDisabled: false, moduleDisabled: false, source: 'default' }, lastTest: null, cred: null });
    expect(none.a2p.state).toBe('not_started');
    expect(none.account.state).toBe('not_configured');
    expect(none.outbound.state).toBe('blocked');
  });
  it('booking Verify: tenant on + validated → Ready; the platform kill switch → Disabled', async () => {
    await sql`insert into booking_verification_settings (tenant_id, branch_id, enabled) values (${A}, null, true)`.execute(db);
    let r = await readiness().readiness(A, null);
    expect(r.verify.state).toBe('ready');
    await sql`insert into booking_verification_platform_policy (tenant_id, emergency_disabled) values (null, true)`.execute(db);
    r = await readiness().readiness(A, null);
    expect(r.verify).toMatchObject({ state: 'disabled', reasonCode: 'PLATFORM_EMERGENCY_OFF' });
    await sql`delete from booking_verification_platform_policy where tenant_id is null`.execute(db);
  });
  it('a branch without its own Twilio inherits the salon default and says so', async () => {
    const r = await readiness().readiness(A, BR_A);
    expect(r.source).toBe('tenant_default');
    expect(r.scope).toMatchObject({ branchId: BR_A, inheritsFromDefault: true, branchName: 'Main A' });
  });
  it('tenant isolation: another salon’s branch is refused; B never sees A’s checks, tests or numbers', async () => {
    expect(await code(readiness().readiness(A, BR_B))).toBe('BRANCH_NOT_FOUND');
    expect(await code(readiness().healthCheck({ userId: U, tenantId: B }, BR_A))).toBe('BRANCH_NOT_FOUND');
    const r = await readiness().readiness(B, null);
    expect(JSON.stringify(r)).not.toContain(NUM_A);
    expect(r.diagnostics.checks.every((c) => c.id)).toBe(true);
    const ids = (await sql`select id::text from tenant_messaging_health_checks where tenant_id = ${A}`.execute(db)).rows.map((x: any) => x.id);
    expect(r.diagnostics.checks.some((c) => ids.includes(c.id))).toBe(false);
  });
  it('the check history is append-only', async () => {
    await expect(sql`update tenant_messaging_health_checks set account_state = 'connected' where tenant_id = ${B}`.execute(db)).rejects.toThrow(/append-only/);
  });
});

describe('Test SMS: confirmed, idempotent, recorded — Delivered only from the signed callback', () => {
  let inbound: TwilioInboundService;
  beforeAll(() => {
    const notifications = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), {} as any, {} as any, undefined, new KyselyOptOutRepository(db));
    inbound = new TwilioInboundService(db, notifications, testProviderSecrets);
  });
  it('sends ONCE per idempotency key, stores a masked destination, and reports Accepted (not Delivered)', async () => {
    tick(); tick();
    await readiness().healthCheck({ userId: U, tenantId: A }, null);
    const before = tw.sent.length;
    const one = await creds().testSend(U, A, DEST, { idempotencyKey: 'key-0000-0001', requireReady: true });
    expect(one).toMatchObject({ ok: true, status: 'accepted', destinationMasked: '•••0404' });
    const two = await creds().testSend(U, A, DEST, { idempotencyKey: 'key-0000-0001', requireReady: true });
    expect(two).toMatchObject({ replayed: true, eventId: one.eventId, status: 'accepted' });
    expect(tw.sent.length).toBe(before + 1);
    const row = (await sql`select * from sms_test_events where tenant_id = ${A} and id = ${one.eventId}::uuid`.execute(db)).rows[0] as any;
    expect(row.destination_masked).toBe('•••0404');
    expect(JSON.stringify(row)).not.toContain(DEST);
    const r = await readiness().readiness(A, null);
    expect(r.lastTest).toMatchObject({ status: 'accepted', final: false });
    expect(r.checklist.find((c) => c.key === 'test')!.state).toBe('pending');
  });
  it('a check made BEFORE a config change does not count: refused with TEST_SMS_NOT_READY', async () => {
    await creds().set(U, B, { accountSid: AC_B, authToken: TOK_B, fromNumber: NUM_B });   // fresh save-check for B …
    await sql`update tenant_messaging_credentials set verify_service_sid = ${VA} where tenant_id = ${B}`.execute(db);   // … then the config moves
    expect(await code(creds().testSend(U, B, DEST, { idempotencyKey: 'key-b-000001', requireReady: true }))).toBe('TEST_SMS_NOT_READY');
  });
  it('the signed status callback moves it to Delivered; a late "sent" never moves it back; another salon’s token cannot', async () => {
    const ev = (await sql`select provider_message_sid sid from sms_test_events where tenant_id = ${A} order by created_at desc limit 1`.execute(db)).rows[0] as any;
    const forged = { MessageSid: ev.sid, MessageStatus: 'failed', AccountSid: AC_B };
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'failed', signature: computeTwilioSignature(TOK_B, ST_URL, forged), url: ST_URL, params: forged })).toMatchObject({ status: 'ignored' });
    const p = { MessageSid: ev.sid, MessageStatus: 'delivered', AccountSid: AC_A };
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'delivered', signature: computeTwilioSignature(TOK_A, ST_URL, p), url: ST_URL, params: p })).toEqual({ status: 'recorded', updated: 1 });
    const late = { MessageSid: ev.sid, MessageStatus: 'sent', AccountSid: AC_A };
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'sent', signature: computeTwilioSignature(TOK_A, ST_URL, late), url: ST_URL, params: late })).toEqual({ status: 'recorded', updated: 0 });
    const r = await readiness().readiness(A, null);
    expect(r.lastTest).toMatchObject({ status: 'delivered', final: true });
    expect(r.inbound.statusCallback.state).toBe('verified');
    expect(r.checklist.find((c) => c.key === 'test')!.state).toBe('done');
    // extras TEXT MESSAGING SETUP 11 (round 10): each verified callback is kept (append-only), the late one marked not applied;
    // the forged one (bad signature) never reaches the log
    const log = (await sql<any>`select provider_status, applied, signature_verified from notification_delivery_events where tenant_id = ${A} and provider_message_sid = ${ev.sid} order by received_at, id`.execute(db)).rows;
    expect(log).toEqual([{ provider_status: 'delivered', applied: true, signature_verified: true }, { provider_status: 'sent', applied: false, signature_verified: true }]);
    expect((await inbound.handleStatus({ sid: ev.sid, status: 'delivered', signature: computeTwilioSignature(TOK_A, ST_URL, p), url: ST_URL, params: p }))).toEqual({ status: 'recorded', updated: 0 });   // a repeat
    expect((await sql<any>`select count(*)::int n from notification_delivery_events where tenant_id = ${A} and provider_message_sid = ${ev.sid}`.execute(db)).rows[0].n).toBe(2);   // deduplicated
  });
  it('a signed inbound text makes inbound "Verified" (never inferred from the outbound test)', async () => {
    const p = { From: DEST, To: NUM_A, Body: 'hello', AccountSid: AC_A };
    await inbound.handleInbound({ from: DEST, to: NUM_A, body: 'hello', signature: computeTwilioSignature(TOK_A, IN_URL, p), url: IN_URL, params: p });
    expect((await readiness().readiness(A, null)).inbound.state).toBe('verified');
    expect((await readiness().readiness(B, null)).inbound.state).not.toBe('verified');
  });
});

describe('number purchase needs the server-issued confirmation', () => {
  let token = '';
  it('step 1 quotes availability, capabilities and the PROVIDER price, and buys nothing', async () => {
    const q: any = await numbers().quote(U, A, NUM_BUY);
    expect(q).toMatchObject({ ok: true, phoneNumber: NUM_BUY, capabilities: { sms: true, voice: true, mms: false }, price: { amount: '1.15', unit: 'USD' }, billedTo: 'salon_account', replacesNumber: NUM_A });
    expect(tw.bought).toEqual([]);
    token = q.confirmationToken;
    expect((await sql`select token_hash from tenant_number_purchase_quotes where tenant_id = ${A}`.execute(db)).rows[0]).not.toMatchObject({ token_hash: token });
  });
  it('no price from the provider → says so (never estimated)', async () => {
    tw.price = null;
    expect(await numbers().quote(U, A, NUM_BUY)).toMatchObject({ price: null, priceNote: 'price_not_returned_by_provider' });
    tw.price = { current_price: '1.15', number_type: 'local' };
  });
  it('without, with another number, or as another salon: refused', async () => {
    expect(await code(numbers().confirmPurchase(U, A, NUM_BUY, ''))).toBe('NUMBER_PURCHASE_CONFIRMATION_REQUIRED');
    expect(await code(numbers().confirmPurchase(U, A, '+18565550498', token))).toBe('NUMBER_QUOTE_INVALID');
    expect(await code(numbers().confirmPurchase(U, B, NUM_BUY, token))).toBe('NUMBER_QUOTE_INVALID');
    expect(tw.bought).toEqual([]);
  });
  it('buys once; a replay returns the recorded result without buying again', async () => {
    expect(await numbers().confirmPurchase(U, A, NUM_BUY, token)).toMatchObject({ ok: true, number: NUM_BUY });
    expect(await numbers().confirmPurchase(U, A, NUM_BUY, token)).toMatchObject({ ok: true, number: NUM_BUY, replayed: true });
    expect(tw.bought).toEqual([NUM_BUY]);
  });
  it('an expired confirmation is refused', async () => {
    const q: any = await numbers().quote(U, A, NUM_BUY);
    await sql`update tenant_number_purchase_quotes set expires_at = now() - interval '1 minute' where tenant_id = ${A} and consumed_at is null`.execute(db);
    expect(await code(numbers().confirmPurchase(U, A, NUM_BUY, q.confirmationToken))).toBe('NUMBER_QUOTE_EXPIRED');
  });
});

describe('error classes', () => {
  it('refusals are the coded input errors the controller maps to their registry status', () => {
    expect(new CredentialsInputError('x')).toBeInstanceOf(Error);
    expect(new NumberPurchaseError('x')).toBeInstanceOf(Error);
    expect(new ReadinessInputError('x')).toBeInstanceOf(Error);
  });
});
