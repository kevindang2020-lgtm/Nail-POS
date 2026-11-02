// receptionist-center.pgtest — AI Receptionist guide §17–§18 on the REAL schema (through 754).
// VO-01…VO-07 readiness truth, BK-05 handoff-only enforcement, KPI definitions, SR-01/02 search, DT-01/02 salon-day
// window across DST, PG-01/02 paging + priority order, AI-01/02 action approval, HL-01/02 read-only health, SEC-01 isolation.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceptionistCenter, stageOf, maskPhone, type RcCtx, type RcAccessRepo } from './receptionist-center';

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
