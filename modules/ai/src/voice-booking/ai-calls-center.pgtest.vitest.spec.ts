// ai-calls-center.pgtest — AI Calls & Voice Intelligence guide §22 on the REAL schema (through 755).
// PI provider/ingestion (signed accepted, bad signature refused, duplicate, out-of-order, unknown/ambiguous agent, outcome
// post never erases), TL tool ledger (requested ≠ succeeded, repeat, refused), KP honest metrics (unknown ≠ 0, AI-reported
// vs verified booking, stale), CD call detail (audited view, transcript gate, recording honesty, tool activity), HC read-only
// health (distinct states, recorded, rate limited), PG paging + newest first, SEC cross-tenant denial, RC reconciliation.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceptionistCenter, type RcCtx } from './receptionist-center';
import { AiCallsIngest, parseRetellEvent, toolOutcome } from './ai-calls-ingest';
import { AiCallsCenter } from './ai-calls-center';
import { AiCallsPublicController } from './ai-calls-public.controller';
import { RetellVoiceAdapter } from './retell-voice.adapter';
import { KyselyCallOutcomeRepo } from './voice-call-outcome.kysely.repository';
import { normalizeCallOutcome } from './voice-call-outcome-core';

const P = 'c7550000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), TC = id('a3'), BA = id('b1'), BB = id('b2'), BC1 = id('b3'), BC2 = id('b4'), OWNER = id('e1'), FD = id('e2'), C1 = id('c1'), TECH = id('d1');
const own: RcCtx = { tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const desk: RcCtx = { tenantId: TA, branchId: BA, userId: FD, role: 'FRONT_DESK', permissions: ['ai.use'] };
const ownB: RcCtx = { tenantId: TB, branchId: BB, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const KEY = 'retell-test-signing-key';
let db: any; let ingest: AiCallsIngest; let ac: AiCallsCenter; let acNoKey: AiCallsCenter;
const N = (v: unknown) => Number(v ?? 0);
const q1 = async (s: any) => (await s.execute(db)).rows[0];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e: any) { return e?.code ?? e?.message; } }
const at = (minAgo: number) => Date.now() - minAgo * 60_000;
const ev = (event: string, callId: string, agent: string, c: Record<string, unknown> = {}) => ({ event, call: { call_id: callId, agent_id: agent, direction: 'inbound', ...c } });
const send = (body: unknown) => { const raw = JSON.stringify(body); return ingest.applyRetellEvent(raw, JSON.parse(raw)); };
const row = (ref: string) => q1(sql`select * from voice_call_outcomes where provider_call_id = ${ref}`);
function res() { const r: any = { code: 0, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; }
function signed(body: unknown, key = KEY) { const raw = JSON.stringify(body); const ts = Date.now(); return { rawBody: Buffer.from(raw), headers: { 'x-retell-signature': `v=${ts},d=${createHmac('sha256', key).update(raw + ts).digest('hex')}` } }; }

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${TA}, 'A', 'Salon A', 'ac-a', 'ACA001', 'active'),
    (${TB}, 'B', 'Salon B', 'ac-b', 'ACB001', 'active'), (${TC}, 'C', 'Salon C', 'ac-c', 'ACC001', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${BA}, ${TA}, 'Main', 'America/New_York'), (${BB}, ${TB}, 'Main', 'America/New_York'),
    (${BC1}, ${TC}, 'One', 'America/New_York'), (${BC2}, ${TC}, 'Two', 'America/New_York')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${C1}, ${TA}, ${BA}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'active')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${TA}, ${BA}, 'Vy', 'Tran', 'Vy Tran', 'active', true)`.execute(db);
  await sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values
    (${TA}, ${BA}, 'A agent', 'live', 'retell', 'agent_a'), (${TB}, ${BB}, 'B agent', 'live', 'retell', 'agent_b'),
    (${TC}, null, 'C agent', 'live', 'retell', 'agent_c'),
    (${TA}, ${BA}, 'shared', 'ready', 'retell', 'agent_shared'), (${TB}, ${BB}, 'shared', 'ready', 'retell', 'agent_shared')`.execute(db);   // ready: one LIVE agent per route (756); ingest ignores status
  ingest = new AiCallsIngest(db);
  const rc = new ReceptionistCenter(db, null, null, { RETELL_WEBHOOK_SIGNING_KEY: KEY } as any);
  ac = new AiCallsCenter(db, rc, { RETELL_WEBHOOK_SIGNING_KEY: KEY } as any);
  acNoKey = new AiCallsCenter(db, new ReceptionistCenter(db, null, null, {} as any), {} as any);
}, 240_000);

describe('provider / ingestion — guide §14, §22 Provider / ingestion', () => {
  it('HC-00 with no history the page is honestly empty, and health says WHY (no signing key → NOT_CONFIGURED)', async () => {
    const k = await ac.kpis(own, { period: 'month' });
    expect(k.total).toBe(0); expect(k.avgDurationSeconds).toBeNull(); expect(k.bookings.verified).toBeNull(); expect(k.voiceMinutes).toBeNull();
    const checks = await acNoKey.checks(own);
    expect(checks.find((c) => c.id === 'webhook_signing')!.state).toBe('NOT_CONFIGURED');
    expect(checks.find((c) => c.id === 'history')!.state).toBe('NOT_CONFIGURED');
    expect(JSON.stringify(checks)).not.toContain(KEY);
  });
  it('PI-01 the webhook refuses unsigned / bad signatures and answers 503 without a key; a valid signature is applied', async () => {
    const ctl = new AiCallsPublicController(new RetellVoiceAdapter(), ingest);
    const body = ev('call_started', 'call_sig_1', 'agent_a', { start_timestamp: at(10) });
    const old = process.env.RETELL_WEBHOOK_SIGNING_KEY;
    try {
      delete process.env.RETELL_WEBHOOK_SIGNING_KEY;
      let r = res(); await ctl.events(signed(body), r, body); expect(r.code).toBe(503);
      process.env.RETELL_WEBHOOK_SIGNING_KEY = KEY;
      r = res(); await ctl.events(signed(body, 'wrong-key'), r, body); expect(r.code).toBe(403); expect(r.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
      r = res(); await ctl.events({ rawBody: Buffer.from(JSON.stringify(body)), headers: {} }, r, body); expect(r.code).toBe(403);
      expect(await row('call_sig_1')).toBeUndefined();
      r = res(); await ctl.events(signed(body), r, body); expect(r.code).toBe(200); expect(r.body).toMatchObject({ accepted: true, disposition: 'applied' });
      const o = await row('call_sig_1'); expect(o.tenant_id).toBe(TA); expect(o.branch_id).toBe(BA); expect(o.ended_at).toBeNull();
    } finally { if (old === undefined) delete process.env.RETELL_WEBHOOK_SIGNING_KEY; else process.env.RETELL_WEBHOOK_SIGNING_KEY = old; }
  });
  it('PI-02 a duplicate delivery does not duplicate the call or the event (deliveries counted)', async () => {
    const b = ev('call_ended', 'call_dup', 'agent_a', { start_timestamp: at(30), end_timestamp: at(25), duration_ms: 300_000, disconnection_reason: 'agent_hangup' });
    expect((await send(b)).duplicate).toBeFalsy();
    expect((await send(b)).duplicate).toBe(true);
    const e = await q1(sql`select count(*)::int n, max(deliveries)::int d from voice_call_events where provider_call_id = 'call_dup'`);
    expect({ n: N(e.n), d: N(e.d) }).toEqual({ n: 1, d: 2 });
    expect(N((await q1(sql`select count(*)::int n from voice_call_outcomes where provider_call_id = 'call_dup'`)).n)).toBe(1);
    expect(N((await row('call_dup')).duration_seconds)).toBe(300);
  });
  it('PI-03 out-of-order events converge: end before start keeps the end; an older summary never replaces a newer one', async () => {
    await send(ev('call_ended', 'call_ooo', 'agent_a', { start_timestamp: at(20), end_timestamp: at(15), duration_ms: 300_000 }));
    await send(ev('call_started', 'call_ooo', 'agent_a', { start_timestamp: at(20) }));
    let o = await row('call_ooo'); expect(o.ended_at).not.toBeNull(); expect(o.started_at).not.toBeNull();
    await send(ev('call_analyzed', 'call_ooo', 'agent_a', { start_timestamp: at(20), end_timestamp: at(15), call_analysis: { call_summary: 'Newer summary', user_sentiment: 'Positive' } }));
    const r = await send(ev('call_analyzed', 'call_ooo', 'agent_a', { start_timestamp: at(40), end_timestamp: at(35), call_analysis: { call_summary: 'Older summary' } }));
    expect(r.disposition).toBe('stale_kept_newer');
    o = await row('call_ooo'); expect(o.summary).toBe('Newer summary'); expect(o.sentiment).toBe('positive');
    expect(new Date(o.ended_at).getTime()).toBeGreaterThan(at(16));   // the stale event did not rewind the end
  });
  it('PI-04 an agent not linked to a salon, or claimed by two salons, is refused — nothing is written', async () => {
    expect(await send(ev('call_started', 'call_x', 'agent_unknown', { start_timestamp: at(5) }))).toMatchObject({ accepted: false, reason: 'agent_not_linked' });
    expect(await send(ev('call_started', 'call_y', 'agent_shared', { start_timestamp: at(5) }))).toMatchObject({ accepted: false, reason: 'agent_ambiguous' });
    expect(N((await q1(sql`select count(*)::int n from voice_call_events where provider_call_id in ('call_x', 'call_y')`)).n)).toBe(0);
    expect(parseRetellEvent({ event: 'transcript_updated', call: { call_id: 'z' } })).toBeNull();
  });
  it('PI-05 the agent’s own outcome post never erases what the provider already reported', async () => {
    await send(ev('call_ended', 'call_post', 'agent_a', { start_timestamp: at(50), end_timestamp: at(45), duration_ms: 300_000 }));
    const repo = new KyselyCallOutcomeRepo(db);
    await repo.upsert({ tenantId: TA, branchId: BA } as any, 'retell', normalizeCallOutcome({ providerCallId: 'call_post', bookingOutcome: 'booked', abandoned: false } as any));
    await ingest.recordOutcomePosted({ tenantId: TA, branchId: BA }, 'call_post', '{"bookingOutcome":"booked"}');
    const o = await row('call_post');
    expect(o.ended_at).not.toBeNull(); expect(N(o.duration_seconds)).toBe(300); expect(o.booking_outcome).toBe('booked'); expect(o.last_synced_at).not.toBeNull();
    expect(N((await q1(sql`select count(*)::int n from voice_call_events where provider_call_id = 'call_post' and event_type = 'outcome_posted' and auth = 'integration_key'`)).n)).toBe(1);
  });
  it('RC-01 an event whose branch cannot be resolved is kept as failed and shows up in reconciliation (no call invented)', async () => {
    expect(await send(ev('call_started', 'call_nobranch', 'agent_c', { start_timestamp: at(5) }))).toMatchObject({ accepted: true, disposition: 'failed' });
    expect(await row('call_nobranch')).toBeUndefined();
    const rec = await ac.reconciliation({ ...own, tenantId: TC, branchId: BC1 });
    expect(rec.eventsWithoutCall.map((x) => x.callRef)).toContain('call_nobranch');
    expect(rec.providerSideComparison).toMatch(/BLOCKED_EXTERNAL/);
  });
});

describe('tool ledger — guide §15', () => {
  it('TL-01 a request is written before it runs; the result and business result are separate; a repeat never rewrites it', async () => {
    const r1 = (await ingest.toolRequested({ tenantId: TA, branchId: BA }, 'call_ooo', 'hold_slot', 'write', '{"n":1}'))!;
    expect((await q1(sql`select status from voice_tool_executions where id = ${r1.id}`)).status).toBe('requested');
    await ingest.toolFinished(TA, r1.id, toolOutcome('hold_slot', { data: { held: true, holdId: 'h1' } }));
    const again = (await ingest.toolRequested({ tenantId: TA, branchId: BA }, 'call_ooo', 'hold_slot', 'write', '{"n":1}'))!;
    expect(again).toEqual({ id: r1.id, repeat: true });
    await ingest.toolFinished(TA, r1.id, { status: 'failed', errorCategory: 'late' });   // a finished row never moves again
    const x = await q1(sql`select status, business_result, related_id, requests from voice_tool_executions where id = ${r1.id}`);
    expect(x).toMatchObject({ status: 'succeeded', business_result: 'slot_held', related_id: 'h1' }); expect(N(x.requests)).toBe(2);
    expect(toolOutcome('book', { error: 'That action isn’t available yet.' }).status).toBe('refused');
    expect(toolOutcome('get_availability', { data: [] }).businessResult).toBe('no_availability');
    expect(toolOutcome('hold_slot', { data: { held: false, slotUnavailable: true }, error: 'That time was just taken.' }).businessResult).toBe('slot_taken');
    expect(toolOutcome('get_services', { data: null, error: 'boom' })).toMatchObject({ status: 'failed', errorCategory: 'tool_error' });
  });
});

describe('metrics, detail, health, paging, isolation — guide §07–§12, §17, §19', () => {
  it('KP-01 AI-reported "booked" is not a verified booking until Booking holds the linked appointment', async () => {
    await sql`update voice_call_outcomes set booking_outcome = 'booked' where provider_call_id = 'call_dup'`.execute(db);
    let k = await ac.kpis(own, { period: 'today' });
    expect(k.bookings.aiReported).toBeGreaterThanOrEqual(1); expect(k.bookings.verified).toBeNull();
    const appt = (await q1(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, source, status)
      values (${TA}, ${BA}, ${TECH}, ${C1}, 'Ava Kim', current_date + 1, '10:00', '11:00', 'ai', 'booked') returning id`)).id;
    const gone = (await q1(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, source, status)
      values (${TA}, ${BA}, ${TECH}, ${C1}, 'Ava Kim', current_date + 2, '10:00', '11:00', 'ai', 'cancelled') returning id`)).id;
    for (const [a, body] of [[appt, '{"b":1}'], [gone, '{"b":2}']] as const) {
      const r = (await ingest.toolRequested({ tenantId: TA, branchId: BA }, 'call_dup', 'create_appointment', 'write', body))!;
      await ingest.toolFinished(TA, r.id, { status: 'succeeded', businessResult: 'appointment_created', relatedType: 'appointment', relatedId: String(a) });
    }
    // waiting for the six-digit code: Booking holds NO appointment yet — only a booking session
    const p = (await ingest.toolRequested({ tenantId: TA, branchId: BA }, 'call_dup', 'create_appointment', 'write', '{"b":3}'))!;
    await ingest.toolFinished(TA, p.id, { status: 'succeeded', businessResult: 'pending_verification', relatedType: 'booking_session', relatedId: 'bs-1' });
    k = await ac.kpis(own, { period: 'today' });
    expect(k.bookings.verified).toBe(1);   // neither the code-pending request nor the cancelled appointment counts
    const d = await ac.detail(own, 'call_dup', true);
    expect(d.booking.verified.map((x) => x.confirmed).sort()).toEqual([false, true]);
  });
  it('KP-02 a call with no end event after 2 hours is Unknown and stale — never Completed', async () => {
    await send(ev('call_started', 'call_stale', 'agent_a', { start_timestamp: at(180) }));
    // a range that always holds a call that started 3 hours ago: in the salon's first hours of the day it started yesterday
    // ('today' then rightly leaves it out — this failed in the 07:20 UTC full run of Nov 6 2026)
    const k = await ac.kpis(own, { from: '2000-01-01' });
    expect(k.stale).toBeGreaterThanOrEqual(1);
    const page = await ac.calls(own, { q: 'call_stale' });
    expect(page.items[0].status).toBe('unknown');
    expect((await ac.reconciliation(own)).staleInProgress.map((x) => x.callRef)).toContain('call_stale');
  });
  it('A10 (Nov 5): the dialed salon number and the caller are kept from the signed event; the list shows which number was called', async () => {
    await send(ev('call_started', 'call_nums', 'agent_a', { start_timestamp: at(5), from_number: '+12155550199', to_number: '+18565550100' }));
    const o = await q1(sql`select caller_number, dialed_number from voice_call_outcomes where tenant_id = ${TA} and provider_call_id = 'call_nums'`);
    expect(o).toMatchObject({ caller_number: '+12155550199', dialed_number: '+18565550100' });
    await send(ev('call_ended', 'call_nums', 'agent_a', { start_timestamp: at(5), end_timestamp: at(1), from_number: '+19999999999', to_number: '+18565550100' }));
    expect((await q1(sql`select caller_number from voice_call_outcomes where tenant_id = ${TA} and provider_call_id = 'call_nums'`)).caller_number).toBe('+12155550199');   // first value wins
    const page = await ac.calls(own, { q: 'call_nums' });
    expect(page.items[0]).toMatchObject({ dialedNumber: '+18565550100' });
  });
  it('CD-01 opening a call is audited; Front Desk sees no transcript link; recording is honest (no consent → none)', async () => {
    await sql`insert into call_transcripts (tenant_id, branch_id, provider, provider_call_id, status) values (${TA}, ${BA}, 'retell', 'call_ooo', 'completed')`.execute(db).catch(() => undefined);
    const before = N((await q1(sql`select count(*)::int n from audit_events where tenant_id = ${TA} and action = 'ai_call.viewed'`)).n);
    const fd = await ac.detail(desk, 'call_ooo', false);
    expect(N((await q1(sql`select count(*)::int n from audit_events where tenant_id = ${TA} and action = 'ai_call.viewed'`)).n)).toBe(before + 1);
    if (fd.transcript) expect(fd.transcript).toMatchObject({ restricted: true });
    expect(fd.recording.state).toBe('consent_unknown');
    expect(fd.toolActivity.map((t) => t.tool)).toContain('hold_slot');
    expect(fd.events.length).toBeGreaterThanOrEqual(3); expect(JSON.stringify(fd.events)).not.toMatch(/Newer summary|agent_a/);
    await sql`insert into call_consent_records (tenant_id, branch_id, provider, provider_call_id, consent_status, recording_enabled) values (${TA}, ${BA}, 'retell', 'call_ooo', 'granted', true)`.execute(db);
    expect((await ac.detail(own, 'call_ooo', true)).recording.state).toBe('not_imported');
  });
  it('SEC-01 another salon cannot open, list or search this salon’s calls', async () => {
    expect(await code(ac.detail(ownB, 'call_ooo', true))).toBe('AI_RCPT_CALL_NOT_FOUND');
    expect((await ac.calls(ownB, {})).items.map((i) => i.callRef)).not.toContain('call_ooo');
    expect((await ac.search(ownB, { scope: 'calls', q: 'call_ooo' })).items).toHaveLength(0);
  });
  it('PG-01 server pages 10/20/50, newest first, stable for identical timestamps, beyond page 1', async () => {
    const ts = new Date(at(60)).toISOString();
    for (let i = 0; i < 25; i++) await sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, ended_at, duration_seconds)
      values (${TB}, ${BB}, 'retell', ${'pg_' + String(i).padStart(2, '0')}, ${ts}, ${ts}, 60)`.execute(db);
    const p1 = await ac.calls(ownB, { pageSize: 10, page: 1 }); const p3 = await ac.calls(ownB, { pageSize: 10, page: 3 });
    expect(p1.pagination).toMatchObject({ totalItems: 25, totalPages: 3 }); expect(p3.items).toHaveLength(5);
    const all = [...p1.items, ...(await ac.calls(ownB, { pageSize: 10, page: 2 })).items, ...p3.items].map((i) => i.callRef);
    expect(new Set(all).size).toBe(25);
    const again = (await ac.calls(ownB, { pageSize: 10, page: 1 })).items.map((i) => i.callRef);
    expect(again).toEqual(p1.items.map((i) => i.callRef));
    expect((await ac.calls(ownB, { q: 'pg_03', pageSize: 10 })).items.map((i) => i.callRef)).toEqual(['pg_03']);
  });
  it('HC-01 Check AI Calls System is read-only, distinct per dependency, recorded, and rate limited', async () => {
    const before = await q1(sql`select count(*)::int n, max(updated_at) u from voice_call_outcomes where tenant_id = ${TA}`);
    const h = await ac.health(own);
    const ids = h.checks.map((c) => c.id);
    for (const k of ['webhook_signing', 'event_failures', 'history', 'reconciliation', 'actions', 'recording', 'errors']) expect(ids).toContain(k);
    expect(h.checks.find((c) => c.id === 'webhook_signing')!.state).toBe('READY');
    expect(h.checks.find((c) => c.id === 'recording')!.state).toBe('BLOCKED_EXTERNAL');
    expect(h.checks.every((c) => c.traceId && c.checkedAt && c.evidence)).toBe(true);
    expect(await code(ac.health(own))).toBe('AI_CALLS_CHECK_RATE_LIMITED');
    expect((await ac.lastHealth(own))!.overall).toBe(h.overall);
    const after = await q1(sql`select count(*)::int n, max(updated_at) u from voice_call_outcomes where tenant_id = ${TA}`);
    expect(after).toEqual(before);
  });
});
