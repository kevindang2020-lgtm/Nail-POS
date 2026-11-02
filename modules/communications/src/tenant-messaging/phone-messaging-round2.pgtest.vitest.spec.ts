// phone-messaging-round2.pgtest — Four-Module Completion Guide §6–§7 / §17 (Oct 30 2026), Phone & Messaging round 2,
// on the real migrated schema (721 + 725) with a FAKE Twilio (an injected http — nothing reaches the network, no text is
// sent, nothing is registered or bought):
//   PM-01 branch test SMS: tenant default vs branch override pick the right account + sender; a branch check never
//         counts for another configuration; an unauthorized branch → 403 (controller, real services); another
//         salon's branch → BRANCH_NOT_FOUND; the signed status callback routes by the branch's own token
//   PM-02 secret safety: every credentials / readiness / status / refresh response (and the audit rows) scanned for a
//         full Account SID, API key SID, auth token or key secret; the masked echo keeps the stored SID; the reveal
//         is the one privileged path and is audited
//   PM-03 10DLC provider sync fixtures: approved / pending / rejected / outage (Unknown with the last success, retry
//         state), Super Admin "approved" never green without the provider, idempotent + rate-limited refresh, the
//         scheduled dispatcher (idempotent, tenant-bound job), append-only snapshots
//   PM-04 toll-free: number-type mapping, its own verification states + next action, 10DLC not required, no submission
//   OPS-01 config validation, Restricted API key scope reported (not rejected), per-number inbound webhook check,
//         signed callback idempotency + STOP opt-out handling
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { computeTwilioSignature } from '@aipowersalon/notifications';
import { OutboxWriter } from '@aipowersalon/events';
import { TenantMessagingCredentialsService } from './tenant-messaging-credentials.service';
import { TenantMessagingReadinessService } from './tenant-messaging-readiness.service';
import { TenantNumberService } from './tenant-number.service';
import { TenantMessagingSelfController } from './tenant-messaging.tenant.controller';
import { TenantRegistrationSyncService, dispatchRegistrationRefresh, runRegistrationRefreshJob, REGISTRATION_REFRESH_JOB } from './registration-sync.service';
import { numberTypeOf, tollfreeNextAction, normalizeTollfree, itemView, REGISTRATION_STALE_AFTER_MS } from './registration-model';
import { messagingConfigDiagnostics } from './messaging-config-diagnostics';
import { testDisplayState, maskSid, isMaskedSid } from './messaging-readiness-model';
import { TwilioInboundService } from '../messaging-inbound/twilio-inbound.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';

const id = (p: string, n: number) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id('7a250000', 1), B = id('7a250000', 2), C = id('7a250000', 3), D = id('7a250000', 4);
const BR_A1 = id('7a25b000', 1), BR_A2 = id('7a25b000', 2), BR_B = id('7a25b000', 3);
const U = id('7a25c000', 1);
const AC_A = 'AC' + 'a1'.repeat(16), AC_X = 'AC' + 'e7'.repeat(16), AC_B = 'AC' + 'b2'.repeat(16), AC_C = 'AC' + 'c3'.repeat(16), AC_D = 'AC' + 'd4'.repeat(16);
const SK = 'SK' + '5a'.repeat(16);
const TOK = { A: 'fixture-token-a', X: 'fixture-token-branch', B: 'fixture-token-b', C: 'fixture-token-c', D: 'fixture-token-d' };   // test fixtures, not credentials
const KEY_SECRET = 'fixture-key-secret-r2';
const NUM_A = '+18565550601', NUM_A2 = '+18565550602', NUM_A3 = '+18565550603', NUM_B = '+18565550604', NUM_C = '+18565550605', NUM_TF = '+18885550606';
const DEST = '+15551230607';
const BN = 'BN' + 'f1'.repeat(16), QE = 'QE' + 'f2'.repeat(16), MG = 'MG' + 'f3'.repeat(16);
const API_BASE = 'https://api.example.test';
const IN_URL = `${API_BASE}/webhooks/twilio/sms/inbound`, ST_URL = `${API_BASE}/webhooks/twilio/sms/status`;

// ── the fake Twilio ──
const tw = {
  down: false, msgDown: false, keyForbidden: false, sent: [] as { url: string; user: string; from: string | null }[], seq: 0, posts: [] as string[],
  smsUrl: new Map<string, string | null>([[NUM_A3, 'https://elsewhere.example/sms']]),
  brand: 'APPROVED', campaign: 'VERIFIED', inService: true,
  tollfree: null as null | { status: string; rejection_reason?: string; error_code?: number; edit_allowed?: boolean },
};
const owned = new Set([NUM_A, NUM_A2, NUM_A3, NUM_B, NUM_C, NUM_TF]);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fake = vi.fn(async (url: any, init?: any) => {
  if (tw.down) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  const u = String(url);
  const [user] = Buffer.from(String(init?.headers?.Authorization ?? '').replace(/^Basic /, ''), 'base64').toString().split(':');
  if (init?.method === 'POST' && u.startsWith('https://messaging.twilio.com/')) { tw.posts.push(u); return json({ message: 'the app must never submit' }, 400); }
  if (u.startsWith('https://messaging.twilio.com/')) {
    if (tw.msgDown) return json({ message: 'Service Unavailable' }, 503);
    if (u.includes('/a2p/BrandRegistrations/')) return json({ sid: BN, status: tw.brand, date_created: '2026-10-01T12:00:00Z' });
    if (u.endsWith('/Compliance/Usa2p')) return json({ compliance: [{ sid: QE, campaign_status: tw.campaign, date_created: '2026-10-02T12:00:00Z' }] });
    if (u.includes('/PhoneNumbers?')) return json({ phone_numbers: tw.inService ? [{ sid: 'PN' + '0c'.repeat(16), phone_number: NUM_C }] : [] });
    if (u.includes('/Tollfree/Verifications?')) return json({ verifications: tw.tollfree ? [{ sid: 'HH' + '9d'.repeat(16), tollfree_phone_number_sid: 'PN' + '7e'.repeat(16), date_created: '2026-10-03T12:00:00Z', ...tw.tollfree }] : [] });
    if (/\/v1\/Services\/MG[0-9a-f]{32}$/.test(u)) return json({ sid: MG, us_app_to_person_registered: tw.campaign === 'VERIFIED' });
    return json({}, 404);
  }
  if (u.startsWith('https://verify.twilio.com/')) return json({ sid: 'VA' + '1'.repeat(32) });
  if (u.endsWith('/Messages.json') && init?.method === 'POST') { tw.sent.push({ url: u, user, from: new URLSearchParams(String(init.body)).get('From') }); return json({ sid: `SM${String(++tw.seq).padStart(32, '0')}`, status: 'queued' }, 201); }
  if (u.includes('IncomingPhoneNumbers.json?PhoneNumber=')) {
    const n = decodeURIComponent(u.split('PhoneNumber=')[1]);
    return json({ incoming_phone_numbers: owned.has(n) ? [{ sid: n === NUM_TF ? 'PN' + '7e'.repeat(16) : 'PN' + '0a'.repeat(16), phone_number: n, capabilities: { sms: true, voice: true, mms: false }, sms_url: tw.smsUrl.has(n) ? tw.smsUrl.get(n) : IN_URL }] : [] });
  }
  if (u.includes('IncomingPhoneNumbers.json?PageSize=1')) return tw.keyForbidden && user.startsWith('SK') ? json({ code: 20403, message: 'Forbidden' }, 403) : json({ incoming_phone_numbers: [] });
  const m = u.match(/\/Accounts\/(AC[0-9a-f]{32})\.json$/);
  if (m) return json({ sid: m[1], status: 'active', type: 'Full' });
  return json({}, 404);
});

let pg: any; let db: any;
const audit = { record: vi.fn(async () => ({})) };
const creds = () => { const s = new TenantMessagingCredentialsService(db, audit as any, testProviderSecrets); s.http = fake as any; return s; };
const readiness = () => { const s = new TenantMessagingReadinessService(db, audit as any, testProviderSecrets); s.http = fake as any; s.minIntervalMs = 0; return s; };
const sync = (limited = false) => { const s = new TenantRegistrationSyncService(db, audit as any, testProviderSecrets); s.http = fake as any; if (!limited) s.minIntervalMs = 0; return s; };
const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e: any) { return e?.apiCode ?? e?.response?.code ?? e?.message; } };
const rows = async (q: any) => (await q.execute(db)).rows as any[];
let keyN = 0; const key = () => `r2-key-${String(++keyN).padStart(6, '0')}`;
const env = { base: process.env.PUBLIC_API_BASE_URL, sc: process.env.TWILIO_STATUS_CALLBACK_URL, sid: process.env.TWILIO_ACCOUNT_SID, tok: process.env.TWILIO_AUTH_TOKEN };
const responses: unknown[] = [];   // PM-02: every response below is collected and scanned at the end
const keep = <T>(x: T): T => { responses.push(x); return x; };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
    ('${A}', 'Salon A LLC', 'Salon A', 'r2-a', 'R2A', 'active'), ('${B}', 'Salon B LLC', 'Salon B', 'r2-b', 'R2B', 'active'),
    ('${C}', 'Salon C LLC', 'Salon C', 'r2-c', 'R2C', 'active'), ('${D}', 'Salon D LLC', 'Salon D', 'r2-d', 'R2D', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${BR_A1}', '${A}', 'A Inherits', 'active'), ('${BR_A2}', '${A}', 'A Own Twilio', 'active'), ('${BR_B}', '${B}', 'B Main', 'active');`);
  process.env.PUBLIC_API_BASE_URL = API_BASE; process.env.TWILIO_STATUS_CALLBACK_URL = ST_URL; delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
  await creds().set(U, A, { accountSid: AC_A, authToken: TOK.A, fromNumber: NUM_A });
  await creds().set(U, A, { accountSid: AC_X, authToken: TOK.X, fromNumber: NUM_A2 }, BR_A2);
  await creds().set(U, B, { accountSid: AC_B, authToken: TOK.B, fromNumber: NUM_B });
}, 180_000);
beforeEach(() => { tw.down = false; tw.msgDown = false; tw.keyForbidden = false; process.env.PUBLIC_API_BASE_URL = API_BASE; process.env.TWILIO_STATUS_CALLBACK_URL = ST_URL; });
afterAll(() => {
  for (const [k, v] of [['PUBLIC_API_BASE_URL', env.base], ['TWILIO_STATUS_CALLBACK_URL', env.sc], ['TWILIO_ACCOUNT_SID', env.sid], ['TWILIO_AUTH_TOKEN', env.tok]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('PM-01 branch-specific test SMS', () => {
  it('a branch WITHOUT its own Twilio sends with the tenant default account + sender, and the row says so', async () => {
    keep(await readiness().healthCheck({ userId: U, tenantId: A }, null));
    const before = tw.sent.length;
    const r = keep(await creds().testSend(U, A, DEST, { idempotencyKey: key(), requireReady: true, branchId: BR_A1 }));
    expect(r).toMatchObject({ ok: true, status: 'accepted', displayState: 'accepted', branchId: BR_A1, configSource: 'tenant_default', accountSidMasked: `AC…${AC_A.slice(-4)}`, sender: NUM_A });
    expect(tw.sent.length).toBe(before + 1);
    expect(tw.sent.at(-1)).toMatchObject({ user: AC_A, from: NUM_A });
    expect(tw.sent.at(-1)!.url).toContain(`/Accounts/${AC_A}/`);
    const row = (await rows(sql`select branch_id::text b, config_source, account_sid_last4, sender, sender_kind from sms_test_events where tenant_id = ${A} and id = ${r.eventId}::uuid`))[0];
    expect(row).toEqual({ b: BR_A1, config_source: 'tenant_default', account_sid_last4: AC_A.slice(-4), sender: NUM_A, sender_kind: 'number' });
  });
  it('a branch override needs ITS OWN fresh check — the default’s check never counts for it', async () => {
    expect(await code(creds().testSend(U, A, DEST, { idempotencyKey: key(), requireReady: true, branchId: BR_A2 }))).toBe('NO_ERROR');   // the save-check of the branch row is fresh
    await sql`insert into tenant_messaging_health_checks (tenant_id, branch_id, config_source, config_fingerprint, account_state, checked_at)
      values (${A}, ${BR_A2}, 'branch_override', 'stale-other-config', 'connected', now())`.execute(db);
    expect(await code(creds().testSend(U, A, DEST, { idempotencyKey: key(), requireReady: true, branchId: BR_A2 }))).toBe('TEST_SMS_NOT_READY');
    keep(await readiness().healthCheck({ userId: U, tenantId: A }, BR_A2));
  });
  it('a branch WITH its own Twilio sends with that branch’s account + sender — never the default’s', async () => {
    const r = keep(await creds().testSend(U, A, DEST, { idempotencyKey: key(), requireReady: true, branchId: BR_A2 }));
    expect(r).toMatchObject({ ok: true, branchId: BR_A2, configSource: 'branch_override', accountSidMasked: `AC…${AC_X.slice(-4)}`, sender: NUM_A2 });
    expect(tw.sent.at(-1)).toMatchObject({ user: AC_X, from: NUM_A2 });
    expect(tw.sent.at(-1)!.url).toContain(`/Accounts/${AC_X}/`);
    // the branch readiness view shows its own configuration and only its own tests
    const rb = keep(await readiness().readiness(A, BR_A2));
    expect(rb.source).toBe('branch_override');
    expect(rb.account.accountSidMasked).toBe(`AC…${AC_X.slice(-4)}`);
    expect(rb.diagnostics.tests.every((t: any) => t.branchId === BR_A2)).toBe(true);
    expect(rb.scope.authorizedBranches.map((b: any) => [b.branchId, b.source])).toEqual(expect.arrayContaining([[BR_A1, 'tenant_default'], [BR_A2, 'branch_override']]));
  });
  it('another salon’s branch is refused (BRANCH_NOT_FOUND) and nothing is sent or stored', async () => {
    const n = tw.sent.length;
    expect(await code(creds().testSend(U, A, DEST, { idempotencyKey: key(), requireReady: true, branchId: BR_B }))).toBe('BRANCH_NOT_FOUND');
    expect(await code(creds().testSend(U, B, DEST, { idempotencyKey: key(), requireReady: true, branchId: BR_A2 }))).toBe('BRANCH_NOT_FOUND');
    expect(tw.sent.length).toBe(n);
    expect((await rows(sql`select count(*)::int n from sms_test_events where tenant_id = ${B}`))[0].n).toBe(0);
  });
  it('an actor confined to one branch is refused another branch of the SAME salon (403) — through the real controller', async () => {
    const ctrl = new TenantMessagingSelfController(creds(), new TenantNumberService(db, audit as any, testProviderSecrets), readiness(), sync());
    const confined = { ctx: { tenantId: A, userId: U, branchId: BR_A1, permissions: ['settings.edit', 'settings.view'], authz: { scope: 'BRANCH', branchIds: [BR_A1] } } };
    const n = tw.sent.length;
    const before = (await rows(sql`select count(*)::int n from sms_test_events where tenant_id = ${A}`))[0].n;
    await expect(ctrl.testBranch(confined, BR_A2, { to: DEST, confirm: true, idempotencyKey: key() })).rejects.toMatchObject({ status: 403, response: { code: 'BRANCH_ACCESS_DENIED' } });
    expect(tw.sent.length).toBe(n);
    expect((await rows(sql`select count(*)::int n from sms_test_events where tenant_id = ${A}`))[0].n).toBe(before);
    // its own branch is allowed; its readiness lists only that branch as testable
    const view = keep(await ctrl.readiness(confined) as any);
    expect(view.scope.authorizedBranches.map((b: any) => b.branchId)).toEqual([BR_A1]);
    keep(await ctrl.testBranch(confined, BR_A1, { to: DEST, confirm: true, idempotencyKey: key() }));
    expect(tw.sent.at(-1)).toMatchObject({ user: AC_A, from: NUM_A });
  });
  it('display states: requested / accepted / sent / delivered / undelivered / failed / unknown', () => {
    const now = new Date(); const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(testDisplayState('sending', ago(1000), now)).toBe('requested');
    expect(testDisplayState('sending', ago(11 * 60_000), now)).toBe('unknown');
    expect(testDisplayState('accepted', ago(1000), now)).toBe('accepted');
    expect(testDisplayState('sent', ago(1000), now)).toBe('sent');
    expect(testDisplayState('accepted', ago(25 * 3600_000), now)).toBe('unknown');
    expect(testDisplayState('delivered', ago(1), now)).toBe('delivered');
    expect(testDisplayState('undelivered', ago(1), now)).toBe('undelivered');
    expect(testDisplayState('rejected', ago(1), now)).toBe('failed');
  });
});

describe('OPS-01 signed callbacks: tenant + branch routing, idempotency, opt-out', () => {
  let inbound: TwilioInboundService;
  beforeAll(() => {
    const notifications = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), {} as any, {} as any, undefined, new KyselyOptOutRepository(db));
    inbound = new TwilioInboundService(db, notifications, testProviderSecrets);
  });
  it('a branch test’s status callback verifies with THE BRANCH’s token; the default token cannot sign it; a replay is a no-op', async () => {
    const ev = (await rows(sql`select provider_message_sid sid from sms_test_events where tenant_id = ${A} and branch_id = ${BR_A2} and provider_message_sid is not null order by created_at desc limit 1`))[0];
    const p = { MessageSid: ev.sid, MessageStatus: 'delivered', AccountSid: AC_X };
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'delivered', signature: computeTwilioSignature(TOK.A, ST_URL, p), url: ST_URL, params: p })).toMatchObject({ status: 'ignored', reason: 'bad_signature' });
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'delivered', signature: computeTwilioSignature(TOK.X, ST_URL, p), url: ST_URL, params: p })).toEqual({ status: 'recorded', updated: 1 });
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'delivered', signature: computeTwilioSignature(TOK.X, ST_URL, p), url: ST_URL, params: p })).toEqual({ status: 'recorded', updated: 0 });
    const late = { MessageSid: ev.sid, MessageStatus: 'undelivered', AccountSid: AC_X };
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'undelivered', signature: computeTwilioSignature(TOK.X, ST_URL, late), url: ST_URL, params: late })).toEqual({ status: 'recorded', updated: 0 });
    const t = (await rows(sql`select status from sms_test_events where tenant_id = ${A} and provider_message_sid = ${ev.sid}`))[0];
    expect(t.status).toBe('delivered');
    // salon B's account cannot speak for salon A's message
    const forged = { MessageSid: ev.sid, MessageStatus: 'failed', AccountSid: AC_B };
    expect(await inbound.handleStatus({ sid: ev.sid, status: 'failed', signature: computeTwilioSignature(TOK.B, ST_URL, forged), url: ST_URL, params: forged })).toMatchObject({ status: 'ignored' });
  });
  it('a signed STOP to the salon’s number opts the sender out once (a replay stays opted out, one row)', async () => {
    const p = { From: DEST, To: NUM_A, Body: 'STOP', AccountSid: AC_A };
    expect(await inbound.handleInbound({ from: DEST, to: NUM_A, body: 'STOP', signature: computeTwilioSignature(TOK.A, IN_URL, p), url: IN_URL, params: p })).toEqual({ status: 'opted_out', tenantId: A });
    expect(await inbound.handleInbound({ from: DEST, to: NUM_A, body: 'STOP', signature: computeTwilioSignature(TOK.A, IN_URL, p), url: IN_URL, params: p })).toEqual({ status: 'opted_out', tenantId: A });
    expect((await rows(sql`select count(*)::int n from notification_opt_outs where tenant_id = ${A} and channel = 'sms'`))[0].n).toBe(1);
    expect((await rows(sql`select count(*)::int n from notification_opt_outs where tenant_id = ${B}`))[0].n).toBe(0);
    // an unsigned / wrongly signed STOP changes nothing
    expect(await inbound.handleInbound({ from: '+15551230999', to: NUM_A, body: 'STOP', signature: 'forged', url: IN_URL, params: { ...p, From: '+15551230999' } })).toMatchObject({ status: 'ignored', reason: 'bad_signature' });
  });
});

describe('OPS-01 configuration, API key scope, per-number inbound webhook', () => {
  it('PUBLIC_API_BASE_URL / TWILIO_STATUS_CALLBACK_URL: https, public host, the app’s route', () => {
    expect(messagingConfigDiagnostics({ PUBLIC_API_BASE_URL: API_BASE, TWILIO_STATUS_CALLBACK_URL: ST_URL }).state).toBe('ok');
    expect(messagingConfigDiagnostics({}).items.map((i) => i.reasonCodes[0])).toEqual(['PUBLIC_API_BASE_URL_NOT_SET', 'STATUS_CALLBACK_NOT_SET']);
    const bad = messagingConfigDiagnostics({ PUBLIC_API_BASE_URL: 'http://localhost:3000', TWILIO_STATUS_CALLBACK_URL: 'https://api.example.test/twilio/status?x=1' });
    expect(bad.state).toBe('invalid');
    expect(bad.items[0].reasonCodes).toEqual(expect.arrayContaining(['URL_NOT_HTTPS', 'URL_HOST_NOT_PUBLIC']));
    expect(bad.items[1].reasonCodes).toEqual(expect.arrayContaining(['URL_HAS_QUERY', 'STATUS_CALLBACK_ROUTE_MISMATCH']));
    expect(bad.items[1].value).toBe('https://api.example.test/twilio/status');   // never the query string
    const proxy = messagingConfigDiagnostics({ PUBLIC_API_BASE_URL: API_BASE, TWILIO_STATUS_CALLBACK_URL: 'https://hooks.example.test/webhooks/twilio/sms/status' });
    expect(proxy.items[1]).toMatchObject({ state: 'warning', reasonCodes: ['STATUS_CALLBACK_HOST_DIFFERS'] });
    expect(messagingConfigDiagnostics({ PUBLIC_API_BASE_URL: 'https://10.0.0.5', TWILIO_STATUS_CALLBACK_URL: ST_URL }).items[0].reasonCodes).toContain('URL_HOST_NOT_PUBLIC');
  });
  it('the readiness carries the diagnostics (a bad URL is a warning on outbound, shown on the page)', async () => {
    process.env.TWILIO_STATUS_CALLBACK_URL = 'http://api.example.test/webhooks/twilio/sms/status';
    const r = keep(await readiness().readiness(A, null));
    expect(r.config).toMatchObject({ state: 'invalid' });
    expect(r.outbound.warnings).toContain('MESSAGING_CONFIG_INVALID');
  });
  it('a Restricted API key that authenticates but may not read numbers is "limited" (insufficient scope) — saved, never rejected', async () => {
    tw.keyForbidden = true;
    keep(await creds().set(U, A, { accountSid: AC_A, apiKeySid: SK, apiKeySecret: KEY_SECRET }));   // no confirmUnverified needed
    expect((await rows(sql`select api_key_sid from tenant_messaging_credentials where tenant_id = ${A} and branch_id is null`))[0].api_key_sid).toBe(SK);
    const r = keep(await readiness().healthCheck({ userId: U, tenantId: A }, null));
    expect(r.account.apiKey).toMatchObject({ state: 'limited', scope: 'insufficient', sid: `SK…${SK.slice(-4)}` });
    expect(r.account.state).toBe('connected');
    expect(r.outbound.warnings).toContain('API_KEY_SCOPE_INSUFFICIENT');
    expect(r.outbound.blockers).not.toContain('TWILIO_API_KEY_REJECTED');
    expect((await rows(sql`select api_key_scope from tenant_messaging_health_checks where tenant_id = ${A} order by checked_at desc limit 1`))[0].api_key_scope).toBe('insufficient');
  });
  it('each registered number’s own inbound webhook is checked (one points elsewhere → shown per number)', async () => {
    await sql`insert into tenant_messaging_numbers (tenant_id, phone_number, channel, status) values (${A}, ${NUM_A3}, 'sms', 'active')`.execute(db);
    const r = keep(await readiness().healthCheck({ userId: U, tenantId: A }, null));
    const byNum = Object.fromEntries(r.inbound.numbers.map((n: any) => [n.number, n.state]));
    expect(byNum[NUM_A]).toBe('matches');
    expect(byNum[NUM_A3]).toBe('mismatch');
    expect(r.inbound.numbers.find((n: any) => n.number === NUM_A3).reasonCode).toBe('INBOUND_URL_MISMATCH');
  });
});

describe('PM-03 10DLC provider sync — fixtures: approved / pending / rejected / outage', () => {
  beforeAll(async () => {
    await creds().set(U, C, { accountSid: AC_C, authToken: TOK.C, fromNumber: NUM_C });
    // Super Admin submitted and its record already says APPROVED / VERIFIED / number attached
    await sql`insert into tenant_a2p_registrations (tenant_id, brand_sid, brand_status, campaign_sid, campaign_status, messaging_service_sid, number_sid, status)
      values (${C}, ${BN}, 'APPROVED', ${QE}, 'VERIFIED', ${MG}, 'PN1', 'live')`.execute(db);
    keep(await readiness().healthCheck({ userId: U, tenantId: C }, null));
  });
  it('submitted by Super Admin is NEVER "approved" without the provider: Unknown — not verified', async () => {
    const r = keep(await readiness().readiness(C, null));
    expect(r.a2p.state).not.toBe('approved');
    expect(r.a2p).toMatchObject({ state: 'unable_to_verify', providerVerified: false, brand: { state: 'unable_to_verify', reasonCode: 'NOT_VERIFIED_WITH_PROVIDER', verified: false } });
    expect(r.outbound.state).not.toBe('ready_to_attempt');
  });
  it('approved fixture: brand, campaign, service and number association each confirmed by the provider → Approved', async () => {
    tw.brand = 'APPROVED'; tw.campaign = 'VERIFIED'; tw.inService = true;
    const { run } = keep(await sync().refresh(C, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    expect(run).toMatchObject({ outcome: 'ok', itemsChecked: 4, accountSource: 'tenant_default' });
    const r = keep(await readiness().readiness(C, null));
    expect(r.a2p).toMatchObject({ state: 'approved', providerVerified: true, brand: { state: 'approved', verified: true, providerStatus: 'APPROVED', providerIdLast4: BN.slice(-4) },
      campaign: { state: 'approved', providerStatus: 'VERIFIED' }, numberAssociation: { state: 'approved' }, messagingService: { state: 'approved', numberAttached: true } });
    expect(r.outbound.blockers.filter((b: string) => b.startsWith('A2P_'))).toEqual([]);
    const snap = await rows(sql`select item_kind, provider_id, raw_status, normalized_state, verified, source, account_source, error_class, retry_count from tenant_messaging_registration_snapshots where tenant_id = ${C} order by item_kind`);
    expect(snap.map((s) => s.item_kind)).toEqual(['brand', 'campaign', 'messaging_service', 'number_association']);
    expect(snap.every((s) => s.verified && s.source === 'provider' && s.account_source === 'tenant_default' && !s.error_class && s.retry_count === 0)).toBe(true);
    // every read used salon C's OWN account, and the app never POSTed to the registration APIs
    const regCalls = fake.mock.calls.filter((c: any[]) => String(c[0]).startsWith('https://messaging.twilio.com/'));
    expect(regCalls.length).toBeGreaterThan(0);
    expect(regCalls.every((c: any[]) => Buffer.from(String(c[1]?.headers?.Authorization).replace('Basic ', ''), 'base64').toString().startsWith(AC_C + ':'))).toBe(true);
    expect(tw.posts).toEqual([]);
  });
  it('outage fixture: provider unreachable → Unknown — not verified, with the LAST SUCCESSFUL check time and a retry state', async () => {
    const lastOk = (await rows(sql`select max(checked_at) t from tenant_messaging_registration_snapshots where tenant_id = ${C} and item_kind = 'brand' and error_class is null`))[0].t;
    tw.msgDown = true;
    const { run } = keep(await sync().refresh(C, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    expect(run).toMatchObject({ outcome: 'provider_unreachable', errorClass: 'provider_unavailable' });
    const r = keep(await readiness().readiness(C, null));
    expect(r.a2p.state).toBe('unable_to_verify');
    expect(r.a2p.brand).toMatchObject({ state: 'unable_to_verify', errorClass: 'provider_unavailable', reasonCode: 'PROVIDER_READ_PROVIDER_UNAVAILABLE', retryCount: 1 });
    expect(new Date(r.a2p.brand.lastSuccessAt!).getTime()).toBe(new Date(lastOk).getTime());
    expect(r.a2p.lastProviderSuccessAt).not.toBeNull();
    expect(r.a2p.brand.nextRetryAt).not.toBeNull();
    keep(await sync().refresh(C, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    expect((await readiness().readiness(C, null)).a2p.brand.retryCount).toBe(2);   // consecutive failures back off
    tw.msgDown = false;
  });
  it('pending fixture: campaign in review → Pending, texting Blocked', async () => {
    tw.campaign = 'IN_PROGRESS'; tw.inService = false;
    keep(await sync().refresh(C, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    const r = keep(await readiness().readiness(C, null));
    expect(r.a2p).toMatchObject({ state: 'pending', reasonCode: 'CAMPAIGN_PENDING', brand: { state: 'approved', retryCount: 0 }, campaign: { state: 'pending', verified: true } });
    expect(r.outbound.blockers).toContain('A2P_PENDING');
  });
  it('rejected fixture: a failed brand is Rejected (provider-confirmed) and blocks texting; the change is audited', async () => {
    tw.brand = 'FAILED';
    audit.record.mockClear?.();
    keep(await sync().refresh(C, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    const r = keep(await readiness().readiness(C, null));
    expect(r.a2p).toMatchObject({ state: 'rejected', reasonCode: 'BRAND_REJECTED', brand: { state: 'rejected', verified: true } });
    expect(r.outbound.blockers).toContain('A2P_REJECTED');
    expect(audit.record.mock.calls.some((c: any[]) => c[1]?.action === 'registration.status_changed')).toBe(true);
    tw.brand = 'APPROVED'; tw.campaign = 'VERIFIED'; tw.inService = true;
  });
  it('a provider confirmation older than the freshness window is no longer green', () => {
    const snap = { kind: 'brand' as const, state: 'approved' as const, verified: true, source: 'provider' as const, providerId: BN, providerStatus: 'APPROVED', errorClass: null,
      checkedAt: new Date(Date.now() - REGISTRATION_STALE_AFTER_MS - 60_000), lastSuccessAt: new Date(), retryCount: 0, nextRetryAt: null, details: {} };
    expect(itemView('brand', snap, null, new Date())).toMatchObject({ state: 'unknown', stale: true, reasonCode: 'PROVIDER_CHECK_STALE' });
  });
  it('refresh is idempotent per request key and rate-limited per salon (manual)', async () => {
    const k = key();
    const one = await sync().refresh(C, { trigger: 'manual', idempotencyKey: k, actorUserId: U });
    const n = (await rows(sql`select count(*)::int n from tenant_messaging_registration_snapshots where tenant_id = ${C}`))[0].n;
    const two = await sync().refresh(C, { trigger: 'manual', idempotencyKey: k, actorUserId: U });
    expect(two).toMatchObject({ replayed: true, run: { id: one.run.id } });
    expect((await rows(sql`select count(*)::int n from tenant_messaging_registration_snapshots where tenant_id = ${C}`))[0].n).toBe(n);
    expect(await code(sync(true).refresh(C, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }))).toBe('REGISTRATION_REFRESH_RATE_LIMITED');
    await expect(sync(true).refresh(B, { trigger: 'manual', idempotencyKey: key(), actorUserId: U })).resolves.toBeTruthy();   // only per salon
  });
  it('the scheduled refresh: dispatcher enqueues each due salon once (idempotent); the job is bound to its tenant', async () => {
    const later = Date.now() + 13 * 3600 * 1000;   // past the 12 h cadence
    const first = await dispatchRegistrationRefresh(db, later);
    expect(first.enqueued).toBeGreaterThan(0);
    const again = await dispatchRegistrationRefresh(db, later);
    expect(again.enqueued).toBe(0);
    expect(again.duplicates).toBe(first.enqueued);
    const jobs = await rows(sql`select tenant_id::text t, payload, run_after from jobs where job_type = ${REGISTRATION_REFRESH_JOB} order by created_at`);
    expect(jobs.some((j) => j.t === C)).toBe(true);
    expect(jobs.every((j) => String((typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload).due).startsWith(j.t + ':'))).toBe(true);
    const job = jobs.find((j) => j.t === C)!;
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const out = await runRegistrationRefreshJob(sync(true), C, payload, 1);
    expect(out).toMatchObject({ outcome: 'ok', replayed: false });
    expect(await runRegistrationRefreshJob(sync(true), C, payload, 1)).toMatchObject({ replayed: true });   // a re-run of the same attempt reads once
    await expect(runRegistrationRefreshJob(sync(true), B, payload, 1)).rejects.toThrow(/its own tenant/);
    expect((await rows(sql`select trigger_kind from tenant_messaging_registration_sync_runs where tenant_id = ${C} order by started_at desc limit 1`))[0].trigger_kind).toBe('scheduled');
  });
  it('snapshots are append-only; another salon never sees C’s registration', async () => {
    await expect(sql`update tenant_messaging_registration_snapshots set verified = true where tenant_id = ${C}`.execute(db)).rejects.toThrow(/append-only/);
    const rb = keep(await readiness().readiness(B, null));
    expect(rb.a2p.brand.providerIdLast4).toBeNull();
    expect(JSON.stringify(rb)).not.toContain(BN.slice(-8));
  });
});

describe('PM-04 toll-free verification', () => {
  beforeAll(async () => {
    await creds().set(U, D, { accountSid: AC_D, authToken: TOK.D, fromNumber: NUM_TF });
    keep(await readiness().healthCheck({ userId: U, tenantId: D }, null));
  });
  it('number type: the seven NANP toll-free prefixes; local 10DLC; the provider’s type wins', () => {
    for (const p of ['800', '833', '844', '855', '866', '877', '888']) expect(numberTypeOf(`+1${p}5550100`)).toEqual({ type: 'toll_free', source: 'nanp_prefix' });
    expect(numberTypeOf('+18565550100')).toEqual({ type: 'local_10dlc', source: 'nanp_prefix' });
    expect(numberTypeOf('+18225550100').type).toBe('local_10dlc');   // 822 is not a toll-free prefix
    expect(numberTypeOf('+18565550100', 'TollFree')).toEqual({ type: 'toll_free', source: 'provider' });
    expect(normalizeTollfree('TWILIO_APPROVED', true)).toBe('approved');
    expect(normalizeTollfree('PENDING_REVIEW', true)).toBe('pending');
    expect(normalizeTollfree('IN_REVIEW', true)).toBe('pending');
    expect(normalizeTollfree('TWILIO_REJECTED', true)).toBe('rejected');
    expect(normalizeTollfree(null, false)).toBe('not_started');
    expect(tollfreeNextAction('rejected', false)).toBe('CONTACT_TWILIO_SUPPORT');
  });
  it('before any provider read: toll-free Unknown (not "not started"), 10DLC Not applicable, a warning — not an A2P blocker', async () => {
    const r = keep(await readiness().readiness(D, null));
    expect(r.a2p).toMatchObject({ state: 'not_applicable', applicable: false, reasonCode: 'TOLL_FREE_VERIFICATION_SEPARATE' });
    expect(r.tollFree).toMatchObject({ applicable: true, numberType: 'toll_free', state: 'unknown', nextAction: 'REFRESH_STATUS' });
    expect(r.outbound.warnings).toContain('TOLL_FREE_UNABLE_TO_VERIFY');
    expect(r.outbound.blockers.some((b: string) => b.startsWith('A2P_'))).toBe(false);
  });
  it('not submitted → Not started + "submit in the Twilio console"; pending → blocked + wait', async () => {
    tw.tollfree = null;
    keep(await sync().refresh(D, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    let r = keep(await readiness().readiness(D, null));
    expect(r.tollFree).toMatchObject({ state: 'not_started', verified: true, nextAction: 'SUBMIT_IN_TWILIO_CONSOLE' });
    expect(r.outbound.blockers).toContain('TOLL_FREE_NOT_STARTED');
    tw.tollfree = { status: 'PENDING_REVIEW' };
    keep(await sync().refresh(D, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    r = keep(await readiness().readiness(D, null));
    expect(r.tollFree).toMatchObject({ state: 'pending', nextAction: 'WAIT_FOR_REVIEW', verificationSidLast4: '9d9d', submittedAt: '2026-10-03T12:00:00.000Z' });
    expect(r.outbound.blockers).toContain('TOLL_FREE_PENDING');
    expect(r.checklist.find((c: any) => c.key === 'registration')).toMatchObject({ state: 'pending', reasonCode: 'WAIT_FOR_REVIEW' });
  });
  it('rejected → reason (digits scrubbed) + "edit and resubmit in the Twilio console"; approved → no 10DLC needed, not blocked', async () => {
    tw.tollfree = { status: 'TWILIO_REJECTED', rejection_reason: 'Opt-in proof missing for +18885550606 call 555-0100', error_code: 30445, edit_allowed: true };
    keep(await sync().refresh(D, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    let r = keep(await readiness().readiness(D, null));
    expect(r.tollFree).toMatchObject({ state: 'rejected', rejectionCode: '30445', nextAction: 'EDIT_AND_RESUBMIT_IN_TWILIO_CONSOLE' });
    expect(r.tollFree.rejectionReason).not.toMatch(/[0-9]{3}/);
    expect(r.outbound.blockers).toContain('TOLL_FREE_REJECTED');
    tw.tollfree = { status: 'TWILIO_APPROVED' };
    keep(await sync().refresh(D, { trigger: 'manual', idempotencyKey: key(), actorUserId: U }));
    r = keep(await readiness().readiness(D, null));
    expect(r.tollFree).toMatchObject({ state: 'approved', nextAction: null });
    expect(r.outbound.blockers.filter((b: string) => /^A2P_|^TOLL_FREE_/.test(b))).toEqual([]);
    expect(r.checklist.find((c: any) => c.key === 'registration')!.state).toBe('done');
    expect(tw.posts).toEqual([]);   // never submitted / resubmitted from the app
    const kinds = await rows(sql`select distinct item_kind from tenant_messaging_registration_snapshots where tenant_id = ${D}`);
    expect(kinds.map((k) => k.item_kind)).toEqual(['tollfree_verification']);   // no 10DLC reads for a toll-free sender
  });
});

describe('PM-02 consistent SID masking + secret safety', () => {
  it('the masked echo (or blank) keeps the stored Account SID; the edit form still saves', async () => {
    const before = (await rows(sql`select account_sid, auth_token_enc from tenant_messaging_credentials where tenant_id = ${B} and branch_id is null`))[0];
    const got = keep(await creds().getMasked(B, null));
    expect(got.accountSid).toBe(`AC…${AC_B.slice(-4)}`);
    expect(isMaskedSid(String(got.accountSid), 'AC')).toBe(true);
    keep(await creds().set(U, B, { accountSid: String(got.accountSid), fromNumber: NUM_B, verifyServiceSid: 'VA' + '1'.repeat(32) }));
    keep(await creds().set(U, B, { accountSid: '', fromNumber: NUM_B }));
    const after = (await rows(sql`select account_sid, auth_token_enc from tenant_messaging_credentials where tenant_id = ${B} and branch_id is null`))[0];
    expect(after).toEqual(before);
    expect(maskSid(null)).toBeNull();
  });
  it('the full SID only through the privileged reveal — and that is audited (scope + last 4, never the SID itself)', async () => {
    const r = await creds().revealAccountSid(U, B, null);
    expect(r.accountSid).toBe(AC_B);
    const a = await rows(sql`select action, metadata from audit_events where tenant_id = ${B} and action = 'tenant_credentials.sid_revealed'`);
    expect(a.length).toBe(1);
    expect(JSON.stringify(a[0].metadata)).not.toContain(AC_B);
  });
  it('API secret-safety scan: no credentials / readiness / status / refresh response, audit row or audit call holds a full SID or a secret', async () => {
    keep(await creds().getMasked(A, null)); keep(await creds().getMasked(A, BR_A2)); keep(await creds().getMasked(A, BR_A1)); keep(await creds().listBranchOverrides(A));
    keep(await readiness().readiness(A, null)); keep(await readiness().readiness(A, BR_A2)); keep(await readiness().readiness(D, null));
    const audits = await rows(sql`select tenant_id::text, metadata, summary from audit_events where tenant_id in (${A}, ${B}, ${C}, ${D}) and action <> 'tenant_credentials.sid_revealed'`);
    const blob = JSON.stringify([responses, audits, audit.record.mock.calls]);
    expect(responses.length).toBeGreaterThan(30);
    const leaks = blob.match(/(AC|SK)[0-9a-fA-F]{32}/g) ?? [];
    expect(leaks).toEqual([]);
    for (const secret of [...Object.values(TOK), KEY_SECRET]) expect(blob).not.toContain(secret);
    // ciphertext never leaves either
    const enc = (await rows(sql`select auth_token_enc from tenant_messaging_credentials where tenant_id = ${A} and branch_id is null`))[0].auth_token_enc;
    expect(blob).not.toContain(String(enc).slice(0, 24));
  });
});
