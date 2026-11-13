// receptionist-center.pgtest — AI Receptionist guide §17–§18 on the REAL schema (through 754).
// VO-01…VO-07 readiness truth, BK-05 handoff-only enforcement, KPI definitions, SR-01/02 search, DT-01/02 salon-day
// window across DST, PG-01/02 paging + priority order, AI-01/02 action approval, HL-01/02 read-only health, SEC-01 isolation.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceptionistCenter, stageOf, maskPhone, capabilityMatrix, maskInsightLabel, topCounts, type RcCtx, type RcAccessRepo } from './receptionist-center';

const P = 'c7540000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), BB = id('b2'), OWNER = id('e1'), FD = id('e2'), C1 = id('c1'), C2 = id('c2'), C3 = id('c3');
const own: RcCtx = { tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const ownB: RcCtx = { tenantId: TB, branchId: BB, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const allowed: RcAccessRepo = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'active' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) as any };
const denied: RcAccessRepo = { loadSnapshot: async () => ({ tenantStatus: 'active', packageEnabled: true, subscription: { status: 'cancelled' }, usage: { used: 0, limit: 0, overageEnabled: false }, hasPermission: true }) as any };
const bizOk = { readiness: async () => ({ core: [{ key: 'hours', status: 'READY', detail: 'ok' }, { key: 'services', status: 'READY', detail: 'ok' }, { key: 'technicians', status: 'READY', detail: 'ok' }] }) };
const bizBad = { readiness: async () => ({ core: [{ key: 'hours', status: 'NEEDS_SETUP', detail: 'Store hours are the platform default.' }] }) };
const ENV_PLATFORM_TWILIO = { TWILIO_ACCOUNT_SID: 'ACxxxxxxxx', TWILIO_AUTH_TOKEN: 'tok' } as NodeJS.ProcessEnv;
const ENV_FULL = { ...ENV_PLATFORM_TWILIO, RETELL_API_KEY: 'rk', VOICE_WRITE_TOOLS_ENABLED: 'true' } as NodeJS.ProcessEnv;
let db: any; let k = 0;
const key = () => 'rc-test-key-' + String(++k).padStart(4, '0');
const q1 = async (s: any) => (await s.execute(db)).rows[0];
const mk = (env: NodeJS.ProcessEnv, access: RcAccessRepo | null = allowed, biz: any = bizOk) => new ReceptionistCenter(db, access, biz, env);
const st = async (c: ReceptionistCenter, ck: string, ctx = own) => (await c.checks(ctx)).find((x) => x.id === ck)!;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.message; } }
async function call(t: string, b: string, ref: string, f: Record<string, unknown> = {}) {
  await sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, ended_at, duration_seconds, intents, booking_outcome, handoff_outcome, abandoned, follow_up_required, error_category, summary, created_at)
    values (${t}, ${b}, 'retell', ${ref}, ${(f.started as string) ?? null}, ${(f.ended as string) ?? null}, ${(f.dur as number) ?? null}, ${JSON.stringify(f.intents ?? ['booking'])}::jsonb,
      ${(f.booking as string) ?? null}, ${(f.handoff as string) ?? null}, ${!!f.abandoned}, ${!!f.followUp}, ${(f.error as string) ?? null}, ${(f.summary as string) ?? null}, coalesce(${(f.created as string) ?? null}::timestamptz, now()))`.execute(db);
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${TA}, 'A', 'Salon A', 'rc-a', 'RCA001', 'active'), (${TB}, 'B', 'Salon B', 'rc-b', 'RCB001', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${BA}, ${TA}, 'Main', 'America/New_York'), (${BB}, ${TB}, 'Main', 'America/New_York')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values
    (${C1}, ${TA}, ${BA}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'ava@x.test', 'active'),
    (${C2}, ${TA}, ${BA}, 'Ben', 'Kim', 'Ben Kim', '+16095550142', null, 'active'),
    (${C3}, ${TB}, ${BB}, 'Ava', 'Other', 'Ava Other', '+16095550199', null, 'active')`.execute(db);
}, 240_000);

describe('readiness truth — guide §03 root cause, VO-01…VO-07', () => {
  it('VO-01 the platform’s Twilio env is NOT the salon’s account; salon creds without a call are not a proven route', async () => {
    const c = mk(ENV_PLATFORM_TWILIO);
    const tw = await st(c, 'tw.account');
    expect(tw.state).toBe('NOT_CONFIGURED'); expect(tw.detail).toMatch(/platform also has its own Twilio/);
    await sql`insert into tenant_messaging_credentials (tenant_id, provider, account_sid, auth_token_enc, from_number, status, last_validated_at, branch_id)
      values (${TA}, 'twilio', 'AC_salon_a', 'enc', '+16095550100', 'configured', now(), null)`.execute(db);
    expect((await st(c, 'tw.account')).state).toBe('READY');
    const route = await st(c, 'tw.route');
    expect(route.state).toBe('UNKNOWN'); expect(route.detail).toMatch(/not verified/);
    const r = await c.readiness(own);
    expect(r.connections.twilio).toBe('configured_route_unverified');
    expect(['not_configured', 'configured']).toContain(r.stage);
  });
  it('VO-02 no Retell key → actionable FAILED; a saved key is only WARNING (never "connected")', async () => {
    expect((await st(mk({}), 'rt.key')).state).toBe('FAILED');
    const w = await st(mk({ RETELL_API_KEY: 'rk' } as any), 'rt.key');
    expect(w.state).toBe('WARNING'); expect(w.detail).toMatch(/not a connection/); expect(JSON.stringify(w)).not.toContain('rk"');
  });
  it('VO-03 a provider agent linked to another salon is forbidden', async () => {
    await sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values (${TB}, ${BB}, 'B desk', 'live', 'retell', 'agent_shared')`.execute(db);
    await sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values (${TA}, ${BA}, 'A desk', 'live', 'retell', 'agent_shared')`.execute(db);
    const a = await st(mk(ENV_FULL), 'rt.agent');
    expect(a.state).toBe('FAILED'); expect(a.detail).toMatch(/another salon/);
    await sql`update ai_receptionist_agents set provider_agent_id = 'agent_a_only' where tenant_id = ${TA}`.execute(db);
    expect((await st(mk(ENV_FULL), 'rt.agent')).state).toBe('READY');
  });
  it('VO-04 missing / expired / revoked integration key → explicit state, never "issued"', async () => {
    expect((await st(mk(ENV_FULL), 'key.active')).state).toBe('NOT_CONFIGURED');
    await sql`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash, expires_at) values (${TA}, ${BA}, 'old', 'retell', 'vk_old', 'h1', now() - interval '1 day')`.execute(db);
    expect((await st(mk(ENV_FULL), 'key.active')).detail).toMatch(/expired/);
    await sql`update voice_integration_keys set revoked_at = now(), expires_at = null where tenant_id = ${TA}`.execute(db);
    const r = await st(mk(ENV_FULL), 'key.active'); expect(r.state).toBe('FAILED'); expect(r.detail).toMatch(/revoked/);
    await sql`insert into voice_integration_keys (tenant_id, branch_id, label, provider, prefix, secret_hash) values (${TA}, ${BA}, 'live', 'retell', 'vk_live', 'h2')`.execute(db);
    expect((await st(mk(ENV_FULL), 'key.active')).state).toBe('READY');
  });
  it('VO-07 every gate passes but no test call → "ready for test", NOT production verified; entitlement denial blocks', async () => {
    await call(TA, BA, 'call_route_proof', { started: new Date(Date.now() - 3600_000).toISOString(), ended: new Date().toISOString(), dur: 60 });
    const r = await mk(ENV_FULL).readiness(own);
    expect(r.stage).toBe('ready_for_test');
    expect(r.checks.find((x) => x.id === 'rd.test_call')!.detail).toMatch(/not production verified/);
    expect(r.steps.find((s) => s.key === 'test_call')!.state).toBe('incomplete');
    expect((await st(mk(ENV_FULL, denied), 'ent.package')).state).toBe('FAILED');
    expect((await mk(ENV_FULL, denied).readiness(own)).stage).toBe('configured');
  });
  it('stageOf never claims more than the evidence', () => {
    expect(stageOf({ configuredAll: true, readyAll: true, testVerified: false, activated: true })).toBe('degraded');
    expect(stageOf({ configuredAll: false, readyAll: false, testVerified: false, activated: false })).toBe('not_configured');
  });
});

describe('per-salon control — BK-05 handoff-only, test call, activation (gated, versioned, append-only)', () => {
  it('arming is refused while a gate fails or the platform switch is off; armed salon gets writes only with the switch on', async () => {
    const bad = await mk(ENV_FULL, allowed, bizBad).controlAction(own, { action: 'arm_booking', expectedVersion: 0, reason: 'ready to book', idempotencyKey: key() }).catch((e) => e);
    expect(bad.code).toBe('AI_RCPT_GATES_NOT_MET'); expect(bad.details.failing).toContain('biz.setup');
    const off = await mk({ ...ENV_FULL, VOICE_WRITE_TOOLS_ENABLED: '' }).controlAction(own, { action: 'arm_booking', expectedVersion: 0, reason: 'ready to book', idempotencyKey: key() }).catch((e) => e);
    expect(off.details.failing).toContain('platform_switch');
    expect(await code(mk(ENV_FULL).controlAction(own, { action: 'arm_booking', expectedVersion: 0, reason: 'x', idempotencyKey: key() }))).toBe('AI_RCPT_REASON_REQUIRED');
    expect(await mk(ENV_FULL).bookingArmed(TA, BA)).toBe(false);
    const k1 = key();
    const ok = await mk(ENV_FULL).controlAction(own, { action: 'arm_booking', expectedVersion: 0, reason: 'gates passed, owner approved', idempotencyKey: k1 });
    expect(ok.control!.bookingArmed).toBe(true);
    expect((await mk(ENV_FULL).controlAction(own, { action: 'arm_booking', expectedVersion: 0, reason: 'gates passed, owner approved', idempotencyKey: k1 })).replayed).toBe(true);
    expect(await mk(ENV_FULL).bookingArmed(TA, BA)).toBe(true);
    expect(await mk({ ...ENV_FULL, VOICE_WRITE_TOOLS_ENABLED: '' }).bookingArmed(TA, BA)).toBe(false);   // switch is the master
    expect(await mk(ENV_FULL).bookingArmed(TB, BB)).toBe(false);                                         // salon B never armed
    expect(await code(mk(ENV_FULL).controlAction(own, { action: 'disarm_booking', expectedVersion: 1, reason: 'stale', idempotencyKey: key() }))).toBe('AI_RCPT_VERSION_CONFLICT');
  });
  it('a test call is proven only by a real recorded call of THIS salon; activation needs it; history is append-only', async () => {
    const v = (await mk(ENV_FULL).control(own))!.version;
    expect(await code(mk(ENV_FULL).controlAction(own, { action: 'verify_test_call', expectedVersion: v, reason: 'owner placed the test call', providerCallRef: 'nope', idempotencyKey: key() }))).toBe('AI_RCPT_TEST_CALL_NOT_FOUND');
    await call(TB, BB, 'call_b_only', {});
    expect(await code(mk(ENV_FULL).controlAction(own, { action: 'verify_test_call', expectedVersion: v, reason: 'owner placed the test call', providerCallRef: 'call_b_only', idempotencyKey: key() }))).toBe('AI_RCPT_TEST_CALL_NOT_FOUND');
    await call(TA, BA, 'call_err', { error: 'tool_timeout' });
    expect(await code(mk(ENV_FULL).controlAction(own, { action: 'verify_test_call', expectedVersion: v, reason: 'owner placed the test call', providerCallRef: 'call_err', idempotencyKey: key() }))).toBe('AI_RCPT_TEST_CALL_FAILED');
    const a1 = await mk(ENV_FULL).controlAction(own, { action: 'activate', expectedVersion: v, reason: 'go live please', idempotencyKey: key() }).catch((e) => e);
    expect(a1.code).toBe('AI_RCPT_GATES_NOT_MET'); expect(a1.details.failing).toContain('rd.test_call');
    const t = await mk(ENV_FULL).controlAction(own, { action: 'verify_test_call', expectedVersion: v, reason: 'owner placed the test call', providerCallRef: 'call_route_proof', idempotencyKey: key() });
    expect(t.control!.testCallVerifiedAt).toBeTruthy();
    expect((await mk(ENV_FULL).readiness(own)).stage).toBe('test_call_verified');
    const live = await mk(ENV_FULL).controlAction(own, { action: 'activate', expectedVersion: t.control!.version, reason: 'go live please', idempotencyKey: key() });
    expect(live.control!.activated).toBe(true);
    expect((await mk(ENV_FULL).readiness(own)).stage).toBe('live');
    expect((await mk(ENV_FULL, denied).readiness(own)).stage).toBe('degraded');   // live but a gate now fails
    const h = await mk(ENV_FULL).controlHistory(own, {});
    expect(h.items.map((x: any) => x.action)).toEqual(['activate', 'verify_test_call', 'arm_booking']);
    expect(h.items[0].before.activated).toBe(false); expect(h.items[0].after.activated).toBe(true);
    expect(await sql`update ai_receptionist_control_events set reason = 'x' where tenant_id = ${TA}`.execute(db).then(() => 'ok', (e: any) => String(e?.message))).toMatch(/append-only/);
    expect(N(await q1(sql`select count(*)::int n from audit_events where tenant_id = ${TA} and module = 'ai_receptionist' and action like 'control.%'`))).toBe(3);
  });
  it('disarming also ends activation (no "live" without booking safeguards)', async () => {
    const v = (await mk(ENV_FULL).control(own))!.version;
    const d = await mk(ENV_FULL).controlAction(own, { action: 'disarm_booking', expectedVersion: v, reason: 'pause bookings', idempotencyKey: key() });
    expect(d.control).toMatchObject({ bookingArmed: false, activated: false });
    expect(await mk(ENV_FULL).bookingArmed(TA, BA)).toBe(false);
  });
});
const N = (v: any) => Number(v?.n ?? v ?? 0);

describe('KPIs, history, search, priority — guide §06–§08, §12, §14', () => {
  it('KPI definitions: booked vs requested, handoff requested/completed/failed, abandoned flag, avg of ended only; salon-day window across DST', async () => {
    // Nov 2 2025 is the DST end in New York: 03:30Z is still Nov 1 local (23:30 EDT); 05:30Z is Nov 2 local (00:30 EDT)
    await call(TA, BA, 'k1', { started: '2025-11-02T03:30:00Z', ended: '2025-11-02T03:33:00Z', dur: 180, booking: 'booked' });
    await call(TA, BA, 'k2', { started: '2025-11-02T05:30:00Z', ended: '2025-11-02T05:31:00Z', dur: 60, booking: 'pending_verification', handoff: 'transferred' });
    await call(TA, BA, 'k3', { started: '2025-11-02T06:30:00Z', handoff: 'failed', abandoned: true });
    const oct31 = await mk(ENV_FULL).kpis(own, { period: 'custom', from: '2025-11-01', to: '2025-11-01' });
    expect(oct31.calls).toBe(1); expect(oct31.booked.confirmed).toBe(1);
    const nov1 = await mk(ENV_FULL).kpis(own, { period: 'custom', from: '2025-11-02', to: '2025-11-02' });
    expect(nov1.calls).toBe(2);
    expect(nov1.booked).toMatchObject({ confirmed: 0, requested: 1 });
    expect(nov1.handoffs).toMatchObject({ requested: 2, completed: 1, failed: 1 });
    expect(nov1.abandoned.count).toBe(1);
    expect(nov1.avgDurationSeconds).toBe(60);                // k3 never ended → excluded, not counted as 0
    const none = await mk(ENV_FULL).kpis(own, { period: 'custom', from: '2025-01-01', to: '2025-01-02' });
    expect(none.calls).toBe(0); expect(none.avgDurationSeconds).toBeNull(); expect(none.booked.ratePct).toBeNull();
    expect(await code(mk(ENV_FULL).kpis(own, { period: 'custom', from: '2026-11-02', to: '2026-11-01' }))).toBe('AI_RCPT_INVALID_FILTER');
  });
  it('PG-01/SR-02 call history: newest first, numbered pages, exact total, search beyond page 1 by call id / outcome; masked caller', async () => {
    for (let i = 0; i < 12; i++) await call(TA, BA, `hist_${String(i).padStart(2, '0')}`, { started: new Date(Date.parse('2026-10-20T15:00:00Z') + i * 60_000).toISOString(), summary: i === 0 ? 'asked about gel removal' : null });
    await sql`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, provider_call_id, caller_phone, customer_id, source) values (${TA}, ${BA}, 'CALLBACK', 'hist_00', '+16095550142', ${C1}, 'ai_receptionist')`.execute(db);
    const p1 = await mk(ENV_FULL).calls(own, { pageSize: 10 });
    expect(p1.pagination.totalItems).toBeGreaterThanOrEqual(16); expect(p1.items).toHaveLength(10);
    const times = p1.items.map((x: any) => x.startedAt); expect([...times].sort().reverse()).toEqual(times);
    const p2 = await mk(ENV_FULL).calls(own, { pageSize: 10, page: 2 });
    expect(p2.items.some((x: any) => p1.items.find((y: any) => y.id === x.id))).toBe(false);
    const s = await mk(ENV_FULL).calls(own, { q: 'gel removal' });
    expect(s.items.map((x: any) => x.callRef)).toEqual(['hist_00']);
    expect(s.items[0].callerMasked).toBe('•••• 0142'); expect(JSON.stringify(s)).not.toContain('6095550142');
    expect((await mk(ENV_FULL).calls(own, { q: '0142' })).items.map((x: any) => x.callRef)).toEqual(['hist_00']);
    expect((await mk(ENV_FULL).calls(own, { status: 'failed' })).items.map((x: any) => x.callRef)).toEqual(['call_err']);
    expect((await mk(ENV_FULL).calls(own, { outcome: 'booked' })).items.map((x: any) => x.callRef)).toEqual(['k1']);
  });
  it('A15 / A10 Nov 6: missed and in-progress statuses, agent / service / direction / length filters, caller + dialed number columns and search, more date bases', async () => {
    const now = Date.now(), iso = (ms: number) => new Date(ms).toISOString();
    await call(TA, BA, 'nov6_missed', { started: iso(now - 3600_000), ended: iso(now - 3595_000), dur: 5, abandoned: true });
    await call(TA, BA, 'nov6_gaveup', { started: iso(now - 3500_000), ended: iso(now - 3400_000), dur: 100, abandoned: true });
    await call(TA, BA, 'nov6_live', { started: iso(now - 60_000) });
    await call(TA, BA, 'nov6_stale', { started: iso(now - 5 * 3600_000) });
    await call(TA, BA, 'nov6_long', { started: iso(now - 7200_000), ended: iso(now - 6000_000), dur: 1200, intents: ['gel removal'] });
    await sql`update voice_call_outcomes set agent_ref = 'agent_rose', direction = 'inbound', caller_number = '+16095557711', dialed_number = '+18565550100', last_event_at = now() where tenant_id = ${TA} and provider_call_id = 'nov6_long'`.execute(db);
    const r = mk(ENV_FULL); const refs = async (f: any) => (await r.calls(own, f)).items.map((x: any) => x.callRef).filter((x: string) => x.startsWith('nov6_')).sort();
    expect(await refs({ status: 'missed' })).toEqual(['nov6_missed']);
    expect(await refs({ status: 'abandoned' })).toEqual(['nov6_gaveup']);
    expect(await refs({ status: 'in_progress' })).toEqual(['nov6_live']);                 // a 5-hour-old open call is a sync gap, not live
    const all = (await r.calls(own, { q: 'nov6_' })).items as any[];
    expect(all.find((x) => x.callRef === 'nov6_stale').status).toBe('no_end_recorded');
    expect(await refs({ agent: 'agent_rose' })).toEqual(['nov6_long']);
    expect(await refs({ service: 'gel removal' })).toEqual(['nov6_long']);
    expect(await refs({ direction: 'inbound' })).toEqual(['nov6_long']);
    expect(await refs({ minSeconds: 600 })).toEqual(['nov6_long']);
    expect(await refs({ minSeconds: 1, maxSeconds: 10 })).toEqual(['nov6_missed']);
    await expect(r.calls(own, { minSeconds: 20, maxSeconds: 10 })).rejects.toMatchObject({ code: 'AI_RCPT_INVALID_FILTER' });
    const long = all.find((x) => x.callRef === 'nov6_long');
    expect(long).toMatchObject({ callerMasked: '•••• 7711', dialedMasked: '•••• 0100', direction: 'inbound', agentRef: 'agent_rose' });
    expect(JSON.stringify(all)).not.toContain('6095557711');
    expect(await refs({ q: '5557711' })).toEqual(['nov6_long']);                           // caller digits
    expect(await refs({ q: '5550100' })).toEqual(['nov6_long']);                           // dialed digits
    expect((await r.calls(own, { dateBasis: 'call_ended', period: 'today' })).dateBasis).toBe('call_ended');
    expect(await refs({ dateBasis: 'last_event', period: 'today', q: 'nov6_long' })).toEqual(['nov6_long']);
  });
  it('SR-01 customer search: name / phone / email / id, masked, shared phone flagged (never merged); SEC-01 tenant isolation', async () => {
    const r = await mk(ENV_FULL).search(own, { scope: 'customers', q: '0142' });
    expect(r.items.map((x: any) => x.name).sort()).toEqual(['Ava Kim', 'Ben Kim']);
    expect(r.items.every((x: any) => x.sharedPhone)).toBe(true); expect(JSON.stringify(r)).not.toContain('6095550142');
    expect((await mk(ENV_FULL).search(own, { scope: 'customers', q: 'Ava' })).items.map((x: any) => x.name)).toEqual(['Ava Kim']);   // salon B's Ava is invisible
    expect(await code(mk(ENV_FULL).callDetail(own, 'call_b_only', true))).toBe('AI_RCPT_CALL_NOT_FOUND');
    expect((await mk(ENV_FULL).calls(ownB, {})).items.map((x: any) => x.callRef)).toEqual(['call_b_only']);
  });
  it('UI-04 call overlay: generated summary flagged, shared-phone identity is a candidate, transcript gated + audited', async () => {
    await sql`insert into call_transcripts (tenant_id, branch_id, provider, provider_call_id, status) values (${TA}, ${BA}, 'retell', 'hist_00', 'completed')`.execute(db);
    const fd = await mk(ENV_FULL).callDetail({ ...own, userId: FD, role: 'FRONT_DESK', permissions: ['ai.use'] }, 'hist_00', false);
    expect(fd.call.summary).toEqual({ text: 'asked about gel removal', generated: true });
    expect(fd.caller.identity).toBe('candidate_shared_phone'); expect(fd.caller.explanation).toMatch(/never merged/);
    expect(fd.transcript).toEqual({ available: true, restricted: true });
    const ow = await mk(ENV_FULL).callDetail(own, 'hist_00', true);
    expect(ow.transcript!.route).toMatch(/voice-transcriptions/); expect(N(await q1(sql`select count(*)::int n from audit_events where tenant_id = ${TA} and action = 'call.transcript_viewed'`))).toBe(1);
  });
  it('PG-02 / OPS-01 priority: urgent + oldest first, pending verification visible; AI-01 prepare ≠ executed; confirm needs a manager; text/booking refused', async () => {
    await call(TA, BA, 'missed_old', { started: '2026-10-29T14:00:00Z', abandoned: true, created: new Date(Date.now() - 2 * 86400_000).toISOString() });
    await call(TA, BA, 'missed_new', { started: '2026-10-30T14:00:00Z', abandoned: true });
    await sql`insert into ai_receptionist_handoffs (tenant_id, branch_id, reason, status, requested_at) values (${TA}, ${BA}, 'wants a manager', 'requested', now() - interval '3 hours')`.execute(db);
    await sql`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, channel, provider, status, phone_hash, phone_mask, expires_at)
      values (${TA}, ${BA}, gen_random_uuid(), 'ai_receptionist', 'twilio_verify', 'pending', 'h', '•••• 0142', now() + interval '8 minutes')`.execute(db);
    const w = await mk(ENV_FULL).priority(own, {});
    const kinds = w.items.map((x: any) => `${x.kind}:${x.sourceRef}`);
    expect(kinds[0]).toMatch(/^person_requested:/);                              // urgency 1 first
    expect(kinds.some((x: string) => x.startsWith('pending_verification:'))).toBe(true);
    expect(kinds.indexOf('missed_call:missed_old')).toBeLessThan(kinds.indexOf('missed_call:missed_new'));   // older missed call not buried
    expect(kinds.some((x: string) => x.startsWith('missed_call:hist_00'))).toBe(false);                       // already has a follow-up
    const item = w.items.find((x: any) => x.sourceRef === 'missed_old')!;
    expect(item.recommendationState).toBe('recommended'); expect(item.canPrepare).toBe(true);
    expect(await code(mk(ENV_FULL).prepareAction(own, { sourceType: 'call', sourceRef: 'missed_old', kind: 'send_sms', idempotencyKey: key() }))).toBe('AI_RCPT_ACTION_NOT_EXECUTABLE');
    expect(await code(mk(ENV_FULL).prepareAction(own, { sourceType: 'call', sourceRef: 'call_b_only', kind: 'create_follow_up', idempotencyKey: key() }))).toBe('AI_RCPT_SOURCE_NOT_FOUND');
    const fdCtx = { ...own, userId: FD, role: 'FRONT_DESK', permissions: ['ai.use'] };
    const prep = await mk(ENV_FULL).prepareAction(fdCtx, { sourceType: 'call', sourceRef: 'missed_old', kind: 'create_follow_up', reason: 'customer hung up', idempotencyKey: key() });
    expect(prep.status).toBe('awaiting_confirmation');
    expect(N(await q1(sql`select count(*)::int n from ai_receptionist_follow_ups where tenant_id = ${TA} and provider_call_id = 'missed_old'`))).toBe(0);   // nothing executed
    expect(await code(mk(ENV_FULL).prepareAction(fdCtx, { sourceType: 'call', sourceRef: 'missed_old', kind: 'create_follow_up', idempotencyKey: key() }))).toBe('AI_RCPT_ACTION_EXISTS');
    const done = await mk(ENV_FULL).decideAction(own, prep.id, { decision: 'confirm', expectedVersion: 1, reason: 'call back today' });
    expect(done.status).toBe('confirmed'); expect(done.resultRef).toBeTruthy();
    expect((await mk(ENV_FULL).decideAction(own, prep.id, { decision: 'confirm', expectedVersion: 1 })).replayed).toBe(true);
    expect(N(await q1(sql`select count(*)::int n from ai_receptionist_follow_ups where tenant_id = ${TA} and provider_call_id = 'missed_old'`))).toBe(1);
    expect((await mk(ENV_FULL).priority(own, {})).items.some((x: any) => x.sourceRef === 'missed_old')).toBe(false);
  });
  it('HL-01/02 health check lists issue/evidence/remedy, changes nothing, is rate-limited and recorded', async () => {
    const before = await mk(ENV_FULL).control(own);
    const h = await mk({}, null, bizBad).health(own);
    expect(h.overall).toBe('FAILED');
    const rt = h.checks.find((x: any) => x.id === 'rt.key')!; expect(rt.remedy).toBeTruthy(); expect(rt.evidence).toBe('RETELL_API_KEY absent');
    expect(h.checks.find((x: any) => x.id === 'op.provider_live')!.state).toBe('BLOCKED_EXTERNAL');
    expect(await code(mk({}).health(own))).toBe('AI_RCPT_HEALTH_RATE_LIMITED');
    expect(await mk(ENV_FULL).control(own)).toEqual(before);
    expect((await mk(ENV_FULL).lastHealth(own))!.overall).toBe('FAILED');
  });
  it('maskPhone shows the last four only', () => { expect(maskPhone('+1 (609) 555-0142')).toBe('•••• 0142'); expect(maskPhone(null)).toBeNull(); });
});

// extras AI Receptionist 04 — AI Agent Capability Matrix: Configured / Tested / Active / Allowed per capability, each from
// its own evidence; "tested" only from a SUCCESSFUL real tool use of this salon in 90 days; unknown stays null ("—").
describe('AI Agent Capability Matrix (extras AI Receptionist 04)', () => {
  const ready = (ids: string[], state = 'READY') => ids.map((x) => ({ id: x, state }));
  it('capabilityMatrix: four separate facts; writes need armed booking AND the platform switch; unknown is null, never green', () => {
    const all = [...ready(['ent.package', 'key.active', 'biz.setup', 'bk.actions', 'cm.sms'])];
    const m = Object.fromEntries(capabilityMatrix(all, { writeSwitch: true, activated: true, lastUse: { get_services: '2026-11-01T15:00:00.000Z' } }).map((r) => [r.key, r]));
    expect(Object.keys(m)).toEqual(['hours', 'services', 'availability', 'booking', 'reschedule', 'cancel', 'sms', 'handoff']);
    expect(m.services).toMatchObject({ configured: true, tested: true, lastTestedAt: '2026-11-01T15:00:00.000Z', active: true, allowed: true });
    expect(m.booking).toMatchObject({ configured: true, tested: false, active: true, allowed: true });   // configured + allowed, no real use yet
    expect(m.sms).toMatchObject({ tool: null, tested: null });                                        // no voice tool proves texts
    const off = Object.fromEntries(capabilityMatrix(all, { writeSwitch: false, activated: true, lastUse: {} }).map((r) => [r.key, r]));
    expect(off.booking).toMatchObject({ allowed: false, active: false }); expect(off.hours).toMatchObject({ allowed: true, active: true });
    const notArmed = [...ready(['ent.package', 'key.active', 'biz.setup', 'cm.sms']), { id: 'bk.actions', state: 'DISABLED' }];
    expect(capabilityMatrix(notArmed, { writeSwitch: true, activated: true, lastUse: {} }).find((r) => r.key === 'cancel')).toMatchObject({ configured: false, active: false });
    const unknownPlan = [{ id: 'ent.package', state: 'UNKNOWN' }, ...ready(['key.active', 'biz.setup'])];
    expect(capabilityMatrix(unknownPlan, { writeSwitch: true, activated: false, lastUse: {} }).find((r) => r.key === 'hours')).toMatchObject({ configured: true, allowed: null, active: false });
    const denied2 = [{ id: 'ent.package', state: 'FAILED' }, ...ready(['key.active', 'biz.setup'])];
    expect(capabilityMatrix(denied2, { writeSwitch: true, activated: true, lastUse: {} }).find((r) => r.key === 'services')).toMatchObject({ allowed: false, active: false });
  });
  it('readiness carries the matrix; "tested" counts only this salon’s successful tool uses in the last 90 days', async () => {
    const ex = (t: string, b: string, tool: string, status: string, ref: string, daysAgo = 1) => sql`insert into voice_tool_executions (tenant_id, branch_id, provider_call_id, invocation_key, tool_name, tool_kind, status, finished_at, created_at, requested_at)
      values (${t}, ${b}, ${ref}, ${ref + tool}, ${tool}, 'read', ${status}, now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}), now() - make_interval(days => ${daysAgo}))`.execute(db);
    await ex(TA, BA, 'get_services', 'succeeded', 'cm-1'); await ex(TA, BA, 'create_appointment', 'failed', 'cm-2');
    await ex(TA, BA, 'cancel_appointment', 'succeeded', 'cm-3', 120); await ex(TB, BB, 'get_business_info', 'succeeded', 'cm-4');
    const before = N(await q1(sql`select count(*)::int n from voice_tool_executions`));
    const r = await mk(ENV_FULL).readiness(own);
    const m = Object.fromEntries(r.capabilities.map((c: any) => [c.key, c]));
    expect(m.services.tested).toBe(true); expect(m.services.lastTestedAt).toBeTruthy();
    expect(m.booking.tested).toBe(false);     // a failed attempt is not a test
    expect(m.cancel.tested).toBe(false);      // older than 90 days
    expect(m.hours.tested).toBe(false);       // the other salon's use never counts here
    expect(m.sms.tested).toBeNull();
    expect(m.booking.active).toBe(false);     // disarmed above: not configured, so not active
    const b = Object.fromEntries((await mk(ENV_FULL).readiness(ownB)).capabilities.map((c: any) => [c.key, c]));
    expect(b.hours.tested).toBe(true); expect(b.services.tested).toBe(false);
    const sw = Object.fromEntries((await mk({ ...ENV_FULL, VOICE_WRITE_TOOLS_ENABLED: '' }).readiness(own)).capabilities.map((c: any) => [c.key, c]));
    expect(sw.reschedule.allowed).toBe(false); expect(sw.services.allowed).toBe(true);
    expect(N(await q1(sql`select count(*)::int n from voice_tool_executions`))).toBe(before);   // read-only
  });
});

describe('Extras · AI Receptionist 08 — Consent-Safe Call Insights (counts only, same window as the KPIs)', () => {
  it('question categories = the AI\'s intent labels (masked, merged, counted); service interests = services on AI-booked appointments the tool ledger links to; another salon never counts', async () => {
    const day = '2024-03-12T15:00:00Z';   // its own window — no other test writes calls on Mar 12 2024
    await call(TA, BA, 'ins1', { started: day, intents: ['check_availability', 'book_appointment'] });
    await call(TA, BA, 'ins2', { started: day, intents: ['check_availability', 'call me at 609-555-0142'] });
    await call(TA, BA, 'ins3', { started: day, intents: ['call me at (856) 555 0101'] });
    await call(TA, BA, 'ins4', { started: day, intents: [] });
    await call(TB, BB, 'insB', { started: day, intents: ['check_availability', 'pricing'] });
    const CAT = id('f1'), SVC = id('f2'), SVC2 = id('f3'), TECH = id('f4'), AP1 = id('f5'), AP2 = id('f6');
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${TA}, ${BA}, 'Nails')`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SVC}, ${TA}, ${BA}, ${CAT}, 'Gel manicure', 45, 4500, 'active'), (${SVC2}, ${TA}, ${BA}, ${CAT}, 'Spa pedicure', 50, 5500, 'active')`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${TA}, ${BA}, 'Lan', 'Tran', 'Lan Tran', 'active', true)`.execute(db);
    for (const [ap, svcs] of [[AP1, [SVC, SVC2]], [AP2, [SVC]]] as const) {
      await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, duration_minutes, status, services)
        values (${ap}, ${TA}, ${BA}, ${TECH}, 'Guest', '2024-03-14'::date, '10:00', '10:45', 45, 'booked', ${JSON.stringify(svcs.map((x) => ({ serviceId: x })))}::jsonb)`.execute(db);
    }
    await sql`insert into voice_tool_executions (tenant_id, branch_id, provider_call_id, invocation_key, tool_name, tool_kind, status, related_type, related_id, requested_at) values
      (${TA}, ${BA}, 'ins1', 'ins1-book', 'book_appointment', 'write', 'succeeded', 'appointment', ${AP1}, ${day}),
      (${TA}, ${BA}, 'ins2', 'ins2-book', 'book_appointment', 'write', 'succeeded', 'appointment', ${AP2}, ${day}),
      (${TA}, ${BA}, 'ins3', 'ins3-book', 'book_appointment', 'write', 'failed', 'appointment', ${AP2}, ${day})`.execute(db);
    const k = await mk(ENV_FULL).kpis(own, { period: 'custom', from: '2024-03-12', to: '2024-03-12' });
    expect(k.calls).toBe(4);
    expect(k.insights.questionCategories).toEqual([
      { label: 'call me at [number]', count: 2 },   // two different phone numbers → one masked label, never the number
      { label: 'check_availability', count: 2 },
      { label: 'book_appointment', count: 1 },
    ]);
    expect(k.insights.callsWithCategories).toBe(3);   // ins4 had none
    expect(k.insights.serviceInterests).toEqual([{ label: 'Gel manicure', count: 2 }, { label: 'Spa pedicure', count: 1 }]);   // the failed tool run never counts
    expect(k.insights.sources).toEqual({ questionCategories: 'ai_derived', serviceInterests: 'recorded' });
    expect(JSON.stringify(k.insights)).not.toMatch(/609|856|555|Guest/);
    const empty = await mk(ENV_FULL).kpis(own, { period: 'custom', from: '2024-03-20', to: '2024-03-20' });
    expect(empty.insights).toMatchObject({ questionCategories: [], serviceInterests: [], callsWithCategories: 0 });
  });
  it('the masking and merging rules', () => {
    expect(maskInsightLabel('email ava@x.test please')).toBe('email [email] please');
    expect(maskInsightLabel('+1 609 555 0142')).toBe('[number]');
    expect(maskInsightLabel('book 2 services')).toBe('book 2 services');
    expect(topCounts([{ label: 'a', n: 1 }, { label: 'b', n: 3 }, { label: 'a', n: 2 }, { label: '', n: 9 }])).toEqual([{ label: 'a', count: 3 }, { label: 'b', count: 3 }]);
  });
});
