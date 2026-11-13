// messaging-setup-center.pgtest — Text Messaging Setup & SMS Readiness guide (Oct 31 2026) §10–§16 on the real migrated
// schema (721/725/741/744), two salons and a FAKE Twilio (an injected http: nothing reaches the network, sends a real text,
// buys a number or registers a carrier).
//   • six independent parts: Connected is not readiness; inbound only from a verified webhook; delivery from reports
//   • wizard resumes at the first unfinished step; a not-approved registration is never "done"
//   • editable test text: plain, ≤ 160 characters
//   • activity: search beyond page 1, kind / state / branch filters, salon-local inclusive days, date basis, newest first,
//     pages of 10/20/50, exact totals; tenant and branch isolation; detail never leaks across salons
//   • nightly run: 'scheduled' check (not rate-limited), ONE de-duplicated alert per failing part, its own tenant only
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { TenantMessagingCredentialsService } from './tenant-messaging-credentials.service';
import { TenantMessagingReadinessService } from './tenant-messaging-readiness.service';
import { MessagingSetupCenter, runScheduledHealthJob, dispatchScheduledHealth, MESSAGING_HEALTH_JOB } from './messaging-setup-center';

const A = '7a440000-0000-4000-8000-00000000000a', B = '7a440000-0000-4000-8000-00000000000b';
const BR_A = '7a44b000-0000-4000-8000-00000000000a', BR_A2 = '7a44b000-0000-4000-8000-0000000000a2', BR_B = '7a44b000-0000-4000-8000-00000000000b';
const U = '7a44c000-0000-4000-8000-000000000001';
const AC_A = 'AC' + '1'.repeat(32);
const TOK_A = 'fixture-token-a';   // a test fixture, not a credential
const NUM_A = '+18565550441';
const API_BASE = 'https://api.example.test';
const IN_URL = `${API_BASE}/webhooks/twilio/sms/inbound`, ST_URL = `${API_BASE}/webhooks/twilio/sms/status`;

const tw = { sent: [] as string[], seq: 0, smsUrl: IN_URL as string | null };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const fake = vi.fn(async (url: any, init?: any) => {
  const u = String(url);
  if (u.startsWith('https://verify.twilio.com/')) return json({}, 404);
  if (u.endsWith('/Messages.json') && init?.method === 'POST') { tw.sent.push(String(init.body)); return json({ sid: `SM${String(++tw.seq).padStart(32, '0')}`, status: 'queued' }, 201); }
  if (u.includes('IncomingPhoneNumbers.json?PhoneNumber=')) {
    const n = decodeURIComponent(u.split('PhoneNumber=')[1]);
    return json({ incoming_phone_numbers: n === NUM_A ? [{ phone_number: n, capabilities: { sms: true, voice: true, mms: false }, sms_url: tw.smsUrl }] : [] });
  }
  if (u.includes('IncomingPhoneNumbers.json')) return json({ incoming_phone_numbers: [] });
  const m = u.match(/\/Accounts\/(AC[0-9a-f]{32})\.json$/);
  if (m) return json({ sid: m[1], status: 'active', type: 'Full' });
  return json({}, 404);
});

let db: any;
const audit = { record: vi.fn(async () => ({})) };
const creds = () => { const s = new TenantMessagingCredentialsService(db, audit as any, testProviderSecrets); s.http = fake as any; return s; };
const readiness = (limited = false) => { const s = new TenantMessagingReadinessService(db, audit as any, testProviderSecrets); s.http = fake as any; if (!limited) s.minIntervalMs = 0; return s; };
const center = () => new MessagingSetupCenter(db, readiness());
const ctxA = { tenantId: A, userId: U, branchId: BR_A }, ctxB = { tenantId: B, userId: U, branchId: BR_B };
const code = async (p: Promise<unknown>) => { try { await p; return 'NO_ERROR'; } catch (e: any) { return e?.apiCode ?? e?.response?.code ?? e?.message; } };
const part = (o: any, k: string) => o.parts.find((p: any) => p.key === k);
const env = { base: process.env.PUBLIC_API_BASE_URL, sc: process.env.TWILIO_STATUS_CALLBACK_URL, sched: process.env.MESSAGING_HEALTH_SCHEDULE_ENABLED };

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values
    (${A}, 'Salon A LLC', 'Salon A', 'ms-a', 'MSA', 'active'), (${B}, 'Salon B LLC', 'Salon B', 'ms-b', 'MSB', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status, timezone, created_at) values (${BR_A}, ${A}, 'Main A', 'active', 'America/New_York', now() - interval '2 days'),
    (${BR_A2}, ${A}, 'Second A', 'active', 'America/New_York', now() - interval '1 day'), (${BR_B}, ${B}, 'Main B', 'active', 'America/Los_Angeles', now())`.execute(db);
}, 180_000);
beforeEach(() => { process.env.PUBLIC_API_BASE_URL = API_BASE; process.env.TWILIO_STATUS_CALLBACK_URL = ST_URL; });
afterAll(() => {
  for (const [k, v] of [['PUBLIC_API_BASE_URL', env.base], ['TWILIO_STATUS_CALLBACK_URL', env.sc], ['MESSAGING_HEALTH_SCHEDULE_ENABLED', env.sched]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('six independent readiness parts + wizard (§11, §12)', () => {
  it('nothing configured: account and sender need attention, Booking Verify is Off, the wizard resumes at "connect"', async () => {
    const o: any = await center().overview(ctxA, null, null);
    expect(o.parts.map((p: any) => p.key)).toEqual(['account', 'sender', 'registration', 'inbound', 'delivery', 'booking_verify']);
    expect(part(o, 'account').state).toBe('attention_required');
    expect(part(o, 'sender').state).toBe('attention_required');
    expect(part(o, 'booking_verify').state).toBe('off');
    expect(o.wizard.resumeAt).toBe('connect');
    expect(o.wizard.steps.find((s: any) => s.key === 'summary').state).toBe('blocked');
    for (const p of o.parts) { expect(p.summary).toBeTruthy(); expect(['ready', 'attention_required', 'pending', 'failed', 'unknown', 'off']).toContain(p.state); }
  });
  it('after a connected save: Account Ready and Sender Ready, but registration is NOT ready and inbound is only Pending — Connected is not readiness', async () => {
    await creds().set(U, A, { accountSid: AC_A, authToken: TOK_A, fromNumber: NUM_A });
    await readiness().healthCheck({ userId: U, tenantId: A }, null);
    const o: any = await center().overview(ctxA, null, null);
    expect(part(o, 'account').state).toBe('ready');
    expect(part(o, 'sender').state).toBe('ready');
    expect(part(o, 'registration').state).not.toBe('ready');
    expect(part(o, 'inbound').state).toBe('pending');
    expect(o.overall).not.toBe('ready');
    expect(o.wizard.steps.find((s: any) => s.key === 'connect').state).toBe('done');
    expect(o.wizard.steps.find((s: any) => s.key === 'registration').state).not.toBe('done');
    expect(o.wizard.steps.find((s: any) => s.key === 'summary').state).toBe('blocked');
    expect(JSON.stringify(o)).not.toContain(TOK_A);
    expect(JSON.stringify(o)).not.toContain(AC_A);   // the Account SID is masked everywhere
  });
  it('inbound becomes Ready only with a signature-verified inbound webhook on record', async () => {
    await sql`insert into tenant_messaging_webhook_activity (tenant_id, webhook_kind) values (${A}, 'inbound') on conflict do nothing`.execute(db);
    await readiness().healthCheck({ userId: U, tenantId: A }, null);
    expect(part(await center().overview(ctxA, null, null), 'inbound').state).toBe('ready');
  });
  it('delivery: no callback URL → attention; configured with no report → pending; a failure in 24 h → attention; reports arriving → ready', async () => {
    delete process.env.TWILIO_STATUS_CALLBACK_URL;
    expect(part(await center().overview(ctxA, null, null), 'delivery').state).toBe('attention_required');
    process.env.TWILIO_STATUS_CALLBACK_URL = ST_URL;
    const cfg: any = await center().overview(ctxA, null, null);
    // configured, no report yet → Pending; but ≥ 3 accepted texts waiting > 2 h (the seeded history) → Unknown, never Ready
    expect(part(cfg, 'delivery').state).toBe(cfg.delivery.waitingOver2h >= 3 ? 'unknown' : 'pending');
    await sql`insert into sms_test_events (tenant_id, idempotency_key, destination_masked, destination_hash, sender, status, error_code, status_updated_at)
      values (${A}, 'fail-key-0001', '•••0001', 'h1', ${NUM_A}, 'undelivered', '30003', now() - interval '1 hour')`.execute(db);
    const o: any = await center().overview(ctxA, null, null);
    expect(part(o, 'delivery')).toMatchObject({ state: 'attention_required' });
    expect(o.delivery.failedTests24h).toBe(1);
    await sql`update sms_test_events set status_updated_at = now() - interval '3 days' where tenant_id = ${A} and idempotency_key = 'fail-key-0001'`.execute(db);
    await sql`insert into tenant_messaging_webhook_activity (tenant_id, webhook_kind) values (${A}, 'status') on conflict do nothing`.execute(db);
    // scoped to Main A (the seeded history lives on Second A): reports arriving, nothing failed or waiting → Ready
    const scoped: any = await center().overview(ctxA, BR_A, null);
    expect(scoped.delivery).toMatchObject({ failedTests24h: 0, waitingOver2h: 0 });
    expect(part(scoped, 'delivery').state).toBe('ready');
  });
});

describe('editable test text (§10)', () => {
  it('a custom plain text is sent as written; over 160 characters or a control character is refused before any send', async () => {
    await readiness().healthCheck({ userId: U, tenantId: A }, null);
    const r: any = await creds().testSend(U, A, '+15551230444', { idempotencyKey: 'custom-text-0001', requireReady: true, message: '  Hello from   Salon A  ' });
    expect(r.ok).toBe(true);
    expect(decodeURIComponent(tw.sent.at(-1)!.replace(/\+/g, ' '))).toContain('Body=Hello from Salon A');
    const before = tw.sent.length;
    expect(await code(creds().testSend(U, A, '+15551230444', { idempotencyKey: 'custom-text-0002', requireReady: true, message: 'x'.repeat(161) }))).toBe('TEST_SMS_TEXT_INVALID');
    expect(await code(creds().testSend(U, A, '+15551230444', { idempotencyKey: 'custom-text-0003', requireReady: true, message: 'bad\u0007bell' }))).toBe('TEST_SMS_TEXT_INVALID');
    expect(tw.sent.length).toBe(before);
  });
});

describe('activity history (§14–§16)', () => {
  beforeAll(async () => {
    // 24 test texts for A on branch BR_A2, one per hour going back; the 5th newest is delivered; B gets 3 of its own
    for (let i = 0; i < 24; i++) {
      await sql`insert into sms_test_events (tenant_id, branch_id, idempotency_key, destination_masked, destination_hash, sender, status, provider_message_sid, created_at, status_updated_at, delivered_at)
        values (${A}, ${BR_A2}, ${'hist-a-' + String(i).padStart(4, '0')}, ${'•••' + String(7000 + i)}, ${'ha' + i}, ${NUM_A}, ${i === 4 ? 'delivered' : 'accepted'},
          ${'SM' + String(900 + i).padStart(32, 'f')}, now() - make_interval(hours => ${i + 10}), now() - make_interval(hours => ${i + 10}), ${i === 4 ? sql`now() - interval '5 hours'` : sql`null`})`.execute(db);
    }
    for (let i = 0; i < 3; i++) await sql`insert into sms_test_events (tenant_id, branch_id, idempotency_key, destination_masked, destination_hash, sender, status)
      values (${B}, ${BR_B}, ${'hist-b-' + i + '-000'}, ${'•••' + String(7000 + i)}, ${'hb' + i}, '+18565550499', 'accepted')`.execute(db);
  });
  it('newest first with an exact total, pages of 10/20/50, and search reaches records beyond page 1', async () => {
    const p1: any = await center().activity(ctxA, { kind: 'test_sms', pageSize: 10 }, null);
    expect(p1.totalItems).toBeGreaterThanOrEqual(24);
    expect(p1.items).toHaveLength(10);
    const ts = p1.items.map((x: any) => x.createdAt);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect((await center().activity(ctxA, { kind: 'test_sms', pageSize: 50 }, null)).items.length).toBe(p1.totalItems);
    expect((await center().activity(ctxA, { kind: 'test_sms', pageSize: 7 }, null)).pageSize).toBe(10);   // unsupported size → 10
    const deep: any = await center().activity(ctxA, { q: '7023' }, null);   // recipient last 4 of the OLDEST seeded row
    expect(deep.items.map((x: any) => x.recipient)).toEqual(['•••7023']);
    const bySid: any = await center().activity(ctxA, { q: 'SM' + String(915).padStart(32, 'f') }, null);
    expect(bySid.items).toHaveLength(1);
  });
  it('kind / state / branch filters and the delivered date basis', async () => {
    expect((await center().activity(ctxA, { state: 'ok', kind: 'test_sms' }, null)).items.every((x: any) => x.state === 'ok')).toBe(true);
    expect((await center().activity(ctxA, { kind: 'health_check' }, null)).items.every((x: any) => x.kind === 'health_check')).toBe(true);
    const br: any = await center().activity(ctxA, { branchId: BR_A2, pageSize: 50 }, null);
    expect(br.totalItems).toBe(24);
    const del: any = await center().activity(ctxA, { basis: 'delivered', preset: 'year' }, null);
    expect(del.items.map((x: any) => x.rawStatus)).toEqual(['delivered']);
    expect(await code(center().activity(ctxA, { kind: 'secrets' }, null))).toBe('MESSAGING_SETUP_INVALID_FILTER');
    expect(await code(center().activity(ctxA, { preset: 'custom', from: '2026-10-31', to: '2026-10-01' }, null))).toBe('MESSAGING_SETUP_INVALID_FILTER');
  });
  it('salon-local inclusive days: 23:30 New York on Oct 20 (03:30 UTC Oct 21) belongs to Oct 20, not Oct 21', async () => {
    await sql`insert into sms_test_events (tenant_id, idempotency_key, destination_masked, destination_hash, sender, status, created_at, status_updated_at)
      values (${A}, 'tz-edge-00001', '•••5555', 'tz', ${NUM_A}, 'accepted', '2026-10-21T03:30:00Z', '2026-10-21T03:30:00Z')`.execute(db);
    const d20: any = await center().activity(ctxA, { preset: 'custom', from: '2026-10-20', to: '2026-10-20', q: '5555' }, null);
    const d21: any = await center().activity(ctxA, { preset: 'custom', from: '2026-10-21', to: '2026-10-21', q: '5555' }, null);
    expect(d20.totalItems).toBe(1); expect(d21.totalItems).toBe(0);
    expect(d20.period).toMatchObject({ tz: 'America/New_York', from: '2026-10-20', to: '2026-10-20' });
  });
  it('tenant isolation: B never sees A, A never sees B, a detail of another salon is Not Found', async () => {
    const b: any = await center().activity(ctxB, { pageSize: 50 }, null);
    expect(b.totalItems).toBe(3);
    expect(b.items.every((x: any) => x.number === '+18565550499')).toBe(true);
    const aRow = (await center().activity(ctxA, { kind: 'test_sms' }, null)).items[0];
    expect(await code(center().detail(ctxB, 'test_sms', aRow.id, null))).toBe('MESSAGING_ACTIVITY_NOT_FOUND');
    const d: any = await center().detail(ctxA, 'test_sms', aRow.id, null);
    expect(d).toMatchObject({ id: aRow.id, kind: 'test_sms' });
    expect(d.meaning).toMatch(/accepted is not delivered|carrier reported delivery|not delivered/);
    // extras TEXT MESSAGING SETUP 11 (round 10): the end-to-end trace — request time, provider acceptance (a SID) and every
    // verified callback for that SID in arrival order, with whether it moved the record
    const sid = (await sql<any>`select provider_message_sid from sms_test_events where id = ${aRow.id}::uuid`.execute(db)).rows[0].provider_message_sid;
    await sql`insert into notification_delivery_events (tenant_id, provider_message_sid, provider_status, applied, signature_verified, received_at) values
      (${A}, ${sid}, 'sent', true, true, now() - interval '2 minutes'), (${A}, ${sid}, 'delivered', true, true, now() - interval '1 minute'), (${B}, ${sid}, 'failed', true, true, now())`.execute(db);
    const t: any = await center().detail(ctxA, 'test_sms', aRow.id, null);
    expect(t.providerAccepted).toBe(true); expect(t.requestedAt).toMatch(/^\d{4}-/);
    expect(t.callbacks.map((c: any) => [c.status, c.applied, c.signatureVerified])).toEqual([['sent', true, true], ['delivered', true, true]]);   // never another salon's event
  });
  it('a branch-confined actor: rows of other branches are hidden; filtering another branch is 403', async () => {
    const confined: any = await center().activity(ctxA, { pageSize: 50, kind: 'test_sms' }, [BR_A]);
    expect(confined.items.some((x: any) => x.branchId === BR_A2)).toBe(false);
    expect(await code(center().activity(ctxA, { branchId: BR_A2 }, [BR_A]))).toBe('BRANCH_ACCESS_DENIED');
  });
});

describe('branch senders (§13)', () => {
  it('every authorized branch shows the sender it would actually use: inherited from the salon default here', async () => {
    const r: any = await center().branches(ctxA, null);
    expect(r.branches.map((b: any) => b.branchId).sort()).toEqual([BR_A, BR_A2].sort());
    for (const b of r.branches) { expect(b).toMatchObject({ inherits: true, sender: NUM_A }); expect(b.parts).toHaveLength(6); expect(JSON.stringify(b)).not.toContain(AC_A); }
    expect(r.salonDefault.sender).toBe(NUM_A);
    expect((await center().branches(ctxA, [BR_A])).branches.map((b: any) => b.branchId)).toEqual([BR_A]);
  });
  // extras TEXT MESSAGING SETUP 07 / 09 (round 10): per-branch Ready / Pending / Blocked with next actions, and what each kind of
  // text would use — from the same six parts / readiness view; nothing sent
  it('each branch carries its Ready / Pending / Blocked summary with the parts\' own next actions, and its routes per kind of text', async () => {
    const r: any = await center().branches(ctxA, null);
    const ov: any = await center().overview(ctxA, BR_A, null);
    for (const b of r.branches) {
      expect(b.summary.ready + b.summary.pending + b.summary.blocked).toBe(6);
      expect(b.nextActions.every((a: any) => typeof a.nextAction === 'string' && a.nextAction.length > 0 && typeof a.fixLink === 'string')).toBe(true);
      expect(b.nextActions.map((a: any) => a.key)).not.toContain(b.parts.find((p: any) => p.state === 'ready')?.key ?? '__none__');
      expect(b.routes.reminders).toMatchObject({ number: NUM_A, stopRule: 'blocked_by_stop' });
      expect(b.routes.testSms).toMatchObject({ number: NUM_A, via: 'number', stopRule: 'not_applicable' });
      expect(b.routes.otp.stopRule).toBe('sent_despite_stop');
      expect(JSON.stringify(b.routes)).not.toContain(AC_A);   // the account stays masked
    }
    const a = r.branches.find((b: any) => b.branchId === BR_A);
    const blocked = ov.parts.filter((p: any) => p.state === 'failed' || p.state === 'attention_required').length;
    expect(a.summary.blocked).toBe(blocked);   // the same parts the branch's own overview shows
    expect(a.nextActions.some((x: any) => x.key === 'registration')).toBe(true);   // registration was never approved
  });
});

describe('controlled nightly run (§11)', () => {
  it('records a scheduled check even right after a manual one (no manual rate limit) and opens ONE alert per failing part; a re-run updates it', async () => {
    await readiness().healthCheck({ userId: U, tenantId: A }, null);   // a MANUAL check just ran…
    // …and the scheduled run (with the manual rate limit ON) still runs
    const r1 = await runScheduledHealthJob(db, readiness(true), A, { night: `${A}:2026-10-31` });
    const r2 = await runScheduledHealthJob(db, readiness(true), A, { night: `${A}:2026-10-31` });
    const failing = (await center().overview(ctxA, null, null)).parts.filter((p: any) => p.state === 'failed' || p.state === 'attention_required').map((p: any) => `sms_setup:${p.key}`).sort();
    expect(r1.opened).toBeGreaterThanOrEqual(1);
    expect(r2.opened).toBe(0); expect(r2.updated).toBe(r1.opened);
    const alerts = (await sql<any>`select metadata->>'dedupeKey' as k, (metadata->>'detections')::int as n from owner_alerts where tenant_id = ${A} and category = 'messaging_failure' and metadata->>'rule' = 'sms_setup'`.execute(db)).rows;
    expect(new Set(alerts.map((a: any) => a.k)).size).toBe(alerts.length);
    expect(alerts.map((a: any) => a.k).sort()).toEqual(failing);   // exactly the failing parts — a Ready part opens nothing
    expect(failing).toContain('sms_setup:registration');   // registration was never approved
    expect(alerts.every((a: any) => a.n === 2)).toBe(true);
    expect((await sql<any>`select count(*)::int n from tenant_messaging_health_checks where tenant_id = ${A} and trigger_kind = 'scheduled'`.execute(db)).rows[0].n).toBe(2);
    expect((await sql<any>`select count(*)::int n from owner_alerts where tenant_id = ${B} and metadata->>'rule' = 'sms_setup'`.execute(db)).rows[0].n).toBe(0);
  });
  it('a job that names another salon is refused permanently (nothing recorded)', async () => {
    expect(await code(runScheduledHealthJob(db, readiness(), A, { night: `${B}:2026-10-31` }))).toBe('VALIDATION_FAILED');
    expect(await code(runScheduledHealthJob(db, readiness(), null, { night: `x` }))).toBe('VALIDATION_FAILED');
  });
  it('the dispatcher enqueues a salon only in its own 02:00–05:00 night, once per salon-local day', async () => {
    // pick a fixed-offset zone where it is 03:xx right now
    const h = new Date().getUTCHours();
    let zone = 'Etc/GMT';
    for (let off = -12; off <= 14; off++) { if (((h + off) % 24 + 24) % 24 === 3) { zone = off === 0 ? 'Etc/GMT' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`; break; } }
    await sql`update branches set timezone = ${zone} where tenant_id = ${A}`.execute(db);
    await sql`delete from tenant_messaging_health_checks where tenant_id = ${A} and trigger_kind = 'scheduled'`.execute(db).catch(() => null);   // append-only trigger may refuse: then the 20 h guard is exercised instead
    const left = (await sql<any>`select count(*)::int n from tenant_messaging_health_checks where tenant_id = ${A} and trigger_kind = 'scheduled'`.execute(db)).rows[0].n;
    const d1 = await dispatchScheduledHealth(db);
    const d2 = await dispatchScheduledHealth(db);
    const jobs = (await sql<any>`select count(*)::int n from jobs where job_type = ${MESSAGING_HEALTH_JOB} and tenant_id = ${A}`.execute(db)).rows[0].n;
    if (left === 0) { expect(d1.enqueued).toBe(1); expect(d2).toMatchObject({ enqueued: 0, duplicates: 1 }); expect(jobs).toBe(1); }
    else { expect(d1.enqueued).toBe(0); expect(jobs).toBe(0); }   // a scheduled check within 20 h → not due tonight
    await sql`update branches set timezone = 'America/New_York' where tenant_id = ${A}`.execute(db);
  });
});

// extras TEXT MESSAGING SETUP 10 (round 10): a registration whose provider status has been stuck pending past the stale window
// becomes ATTENTION, so the nightly check opens its ONE deduplicated owner alert (an ordinary fresh wait stays Pending)
describe('stale registration status alerts', () => {
  it('pending for longer than the stale window → registration needs attention and the nightly run alerts once; fresh pending → Pending', async () => {
    await sql`delete from tenant_a2p_registrations where tenant_id = ${A}`.execute(db);
    await sql`insert into tenant_a2p_registrations (tenant_id, brand_sid, brand_status, campaign_sid, campaign_status, messaging_service_sid, status, updated_at)
      values (${A}, ${'BN' + 'b'.repeat(32)}, 'APPROVED', ${'QE' + 'c'.repeat(32)}, 'IN_PROGRESS', ${'MG' + 'd'.repeat(32)}, 'campaign_submitted', now() - interval '10 days')`.execute(db);
    const o: any = await center().overview(ctxA, null, null);
    const reg = part(o, 'registration');
    expect(reg).toMatchObject({ state: 'attention_required' });
    expect(reg.summary).toMatch(/stale/); expect(reg.evidence).toMatch(/stale/); expect(reg.nextAction).toMatch(/Refresh Status/);
    const r1 = await runScheduledHealthJob(db, readiness(true), A, { night: `${A}:2026-11-13` });
    const r2 = await runScheduledHealthJob(db, readiness(true), A, { night: `${A}:2026-11-13` });
    expect(r1.opened + r1.updated).toBeGreaterThanOrEqual(1); expect(r2.opened).toBe(0);
    const keys = (await sql<any>`select metadata->>'dedupeKey' as k from owner_alerts where tenant_id = ${A} and metadata->>'rule' = 'sms_setup' and metadata->>'dedupeKey' = 'sms_setup:registration'`.execute(db)).rows;
    expect(keys).toHaveLength(1);
    await sql`update tenant_a2p_registrations set updated_at = now() where tenant_id = ${A}`.execute(db);
    expect(part(await center().overview(ctxA, null, null), 'registration').state).toBe('pending');
  });
});
