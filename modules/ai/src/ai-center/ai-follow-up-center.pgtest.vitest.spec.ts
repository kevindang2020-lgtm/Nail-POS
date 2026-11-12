// ai-follow-up-center.pgtest — AI Follow-Ups & Human Handoff Center guide §19/§20 on the REAL schema (through 759).
// Signed Retell events → handoff events → ONE durable task (T27–T32); manual create, idempotent (T04–T06); search beyond
// page 1, phone/email/ID, shared phone never merged (T07–T12); filters, salon-local date bases and DST (T13–T17);
// priority order (T18); assignment rules + audit (T23); lifecycle + reopen + resolution outcome (T24, T25); overdue
// escalation, one alert (T26); contact attempts and texts through the Copilot path, submitted ≠ delivered, duplicate
// protection + manager override (T34–T37); AI package lapse keeps manual tasks (T40/T41); read-only health (T42–T44);
// cross-tenant / branch / role denial (T45/T46).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiCallsIngest } from '../voice-booking/ai-calls-ingest';
import { KyselyFollowUpRepo, AiFollowUpService } from '../voice-booking/ai-follow-up.service';
import { AiFollowUpCenter, FollowUpCenterError, escalateOverdueFollowUps, expireFollowUpHolds, localToUtc, fuPeriod, type FuCtx, type FuTextPort } from './ai-follow-up-center';

const P = 'c7590000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), BA2 = id('b2'), BB = id('b3');
const OWNER = id('e1'), FD = id('e2'), MGR = id('e3'), GONE = id('e4'), OTHERB = id('e5'), TECHU = id('e6');
const C1 = id('c1'), C2 = id('c2'), C3 = id('c3');
const PERMS_FD = ['ai.use', 'communications.manage', 'reception_copilot.send_message'];
const own: FuCtx = { tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage', 'communications.manage', 'reception_copilot.send_message', 'pos.booking.create'] };
const desk: FuCtx = { tenantId: TA, branchId: BA, userId: FD, role: 'FRONT_DESK', permissions: PERMS_FD };
const viewer: FuCtx = { tenantId: TA, branchId: BA, userId: TECHU, role: 'TECHNICIAN', permissions: ['ai.use'] };
const ownB: FuCtx = { tenantId: TB, branchId: BB, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage', 'communications.manage'] };
let db: any; let fc: AiFollowUpCenter; let ingest: AiCallsIngest; let svc: AiFollowUpService;
const sent: any[] = [];
const textPort: FuTextPort = {
  async prepare(_c, a) { return { state: 'awaiting_confirmation', blocked: [], warnings: [], notices: [], token: 'tok-' + a.to, proposed: { to: '•••' + a.to.slice(-4) } }; },
  async confirm(_c, a, token) { if (token !== 'tok-' + a.to) return { ok: false, errorCode: 'COPILOT_PREPARE_INVALID' }; sent.push(a); return { ok: true, requestKey: 'cc:' + sent.length, state: 'submitted', record: { notificationId: null, testSender: true } }; },
};
const q1 = async (s: any) => (await s.execute(db)).rows[0];
const N = (v: unknown) => Number(v ?? 0);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof FollowUpCenterError ? e.code : (e as Error).message; } }
const send = (body: unknown) => { const raw = JSON.stringify(body); return ingest.applyRetellEvent(raw, JSON.parse(raw)); };
const ev = (event: string, callId: string, c: Record<string, unknown> = {}) => ({ event, event_id: `${event}:${callId}:${JSON.stringify(c).length}`, call: { call_id: callId, agent_id: 'agent_fu', direction: 'inbound', from_number: '+16095550142', start_timestamp: Date.now() - 120_000, end_timestamp: Date.now() - 60_000, ...c } });
const tasksFor = (call: string) => (async () => (await sql`select id, reason, status, customer_id, customer_match from ai_receptionist_follow_ups where provider_call_id = ${call} order by created_at`.execute(db)).rows as any[])();

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${TA}, 'A', 'Salon A', 'fu-a', 'FUA001', 'active'), (${TB}, 'B', 'Salon B', 'fu-b', 'FUB001', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${BA}, ${TA}, 'Main', 'America/New_York'), (${BA2}, ${TA}, 'Second', 'America/New_York'), (${BB}, ${TB}, 'Main', 'America/New_York')`.execute(db);
  await sql`insert into users (id, tenant_id, branch_id, full_name, email, status, role) values
    (${OWNER}, ${TA}, null, 'Olivia Owner', 'o@fu.test', 'active', 'OWNER'), (${FD}, ${TA}, ${BA}, 'Fiona Desk', 'f@fu.test', 'active', 'FRONT_DESK'),
    (${MGR}, ${TA}, ${BA}, 'Mark Manager', 'm@fu.test', 'active', 'MANAGER'), (${GONE}, ${TA}, ${BA}, 'Gina Gone', 'g@fu.test', 'inactive', 'FRONT_DESK'),
    (${OTHERB}, ${TA}, ${BA2}, 'Otto Other', 'x@fu.test', 'active', 'FRONT_DESK'), (${TECHU}, ${TA}, ${BA}, 'Tess Tech', 't@fu.test', 'active', 'TECHNICIAN')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values
    (${C1}, ${TA}, ${BA}, 'Ava', 'Kim', 'Ava Kim', '+16095550142', 'ava@fu.test', 'active'),
    (${C2}, ${TA}, ${BA}, 'Ben', 'Lee', 'Ben Lee', '+16095550177', 'ben@fu.test', 'active'),
    (${C3}, ${TA}, ${BA}, 'Bea', 'Lee', 'Bea Lee', '+16095550177', 'bea@fu.test', 'active')`.execute(db);
  await sql`insert into ai_receptionist_agents (tenant_id, branch_id, name, status, provider, provider_agent_id) values (${TA}, ${BA}, 'A agent', 'live', 'retell', 'agent_fu')`.execute(db);
  fc = new AiFollowUpCenter(db, textPort);
  ingest = new AiCallsIngest(db);
  svc = new AiFollowUpService(new KyselyFollowUpRepo(db));
}, 240_000);

describe('AI call → handoff → ONE durable task (§11, T27–T32)', () => {
  it('T27/T30/T32 a signed failed transfer creates one task linked to the single matching customer; a completed transfer creates none (T31)', async () => {
    expect((await send(ev('call_ended', 'call_fail', { disconnection_reason: 'transfer_failed' }))).accepted).toBe(true);
    const t = await tasksFor('call_fail');
    expect(t).toHaveLength(1); expect(t[0]).toMatchObject({ reason: 'CALLBACK', status: 'open', customer_id: C1, customer_match: 'phone_single' });
    expect((await q1(sql`select kind, callback_required, follow_up_id from ai_handoff_events where provider_call_id = 'call_fail'`))).toMatchObject({ kind: 'transfer_failed', callback_required: true, follow_up_id: t[0].id });
    await send(ev('call_ended', 'call_ok', { disconnection_reason: 'call_transfer' }));
    expect(await tasksFor('call_ok')).toHaveLength(0);
    expect((await q1(sql`select kind, callback_required from ai_handoff_events where provider_call_id = 'call_ok'`))).toMatchObject({ kind: 'transfer_completed', callback_required: false });
  });
  it('T28/T29 the same event delivered again, an analyzed event for the same call, the agent’s own handoff — still ONE callback; a complaint is its own task', async () => {
    await send(ev('call_ended', 'call_fail', { disconnection_reason: 'transfer_failed' }));
    await send(ev('call_analyzed', 'call_fail', { disconnection_reason: 'transfer_failed', call_analysis: { call_summary: 'Wants a call back', custom_analysis_data: { callback_requested: true, complaint: true } } }));
    await svc.createFromHandoff({ tenantId: TA, branchId: BA }, { reason: 'CALLBACK', providerCallId: 'call_fail', callerPhone: '+16095550142', priority: 'high' });
    const t = await tasksFor('call_fail');
    expect(t.map((x) => x.reason).sort()).toEqual(['CALLBACK', 'COMPLAINT']);
    expect(N((await q1(sql`select deliveries from voice_call_events where provider_call_id = 'call_fail' and event_type = 'call_ended'`)).deliveries)).toBe(2);
  });
  it('T28 a retry AFTER the task was resolved never re-creates it (durable key, not just "while open")', async () => {
    const [cb] = (await tasksFor('call_fail')).filter((x) => x.reason === 'CALLBACK');
    const v = N((await q1(sql`select version from ai_receptionist_follow_ups where id = ${cb.id}`)).version);
    await fc.transition(own, cb.id, { to: 'resolved', version: v, resolutionCategory: 'customer_reached', note: 'Called back' });
    await send(ev('call_ended', 'call_fail', { disconnection_reason: 'transfer_failed', end_timestamp: Date.now() }));
    await svc.createFromHandoff({ tenantId: TA, branchId: BA }, { reason: 'CALLBACK', providerCallId: 'call_fail' });
    expect((await tasksFor('call_fail')).filter((x) => x.reason === 'CALLBACK')).toHaveLength(1);
  });
  it('T32/T11 an unknown caller keeps the call context, unlinked; a shared number is ambiguous and never merged', async () => {
    await send({ ...ev('call_analyzed', 'call_unk', { call_analysis: { custom_analysis_data: { callback_requested: 'yes' } } }), call: { call_id: 'call_unk', agent_id: 'agent_fu', from_number: '+16095550999', call_analysis: { custom_analysis_data: { callback_requested: 'yes' } } } });
    await send({ ...ev('call_analyzed', 'call_shared'), call: { call_id: 'call_shared', agent_id: 'agent_fu', from_number: '+16095550177', call_analysis: { custom_analysis_data: { handoff_requested: true } } } });
    expect((await tasksFor('call_unk'))[0]).toMatchObject({ customer_id: null, customer_match: 'unmatched' });
    expect((await tasksFor('call_shared'))[0]).toMatchObject({ customer_id: null, customer_match: 'ambiguous' });
  });
});

describe('manual create, list, search, filters, paging (T02–T18)', () => {
  let made: string;
  it('T04/T05/T06 create persists, a double tap is ONE task, and it is first on page 1 of All', async () => {
    const b = { reason: 'BOOKING_HELP', description: 'Wants a pedicure Saturday', priority: 'normal', customerId: C2, idempotencyKey: 'create-key-0001' };
    const r1 = await fc.create(desk, b), r2 = await fc.create(desk, b);
    expect(r2).toEqual({ id: r1.id, duplicate: true }); made = r1.id;
    const all = await fc.list(desk, { status: 'all' });
    expect(all.items[0].id).toBe(made);
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_activity where follow_up_id = ${made} and event_type = 'created'`)).n)).toBe(1);
    expect((await q1(sql`select action from audit_events where resource_id = ${made}`)).action).toBe('follow_up.created');
  });
  it('T02/T03 Open is genuine; All returns every status; a missing customer or a bad link is refused', async () => {
    const open = await fc.list(own, { status: 'open' }), all = await fc.list(own, { status: 'all' });
    expect(all.totalItems).toBeGreaterThan(open.totalItems); expect(new Set(all.items.map((x) => x.status)).has('resolved')).toBe(true);
    expect(await code(fc.create(desk, { reason: 'OTHER', description: 'x issue', idempotencyKey: 'create-key-0002' }))).toBe('FOLLOWUP_CENTER_INVALID_FILTER');
    expect(await code(fc.create(desk, { reason: 'OTHER', description: 'x issue', callerPhone: '6095550101', idempotencyKey: 'create-key-0003' }))).toBe('FOLLOWUP_CENTER_INVALID_FILTER');
    expect(await code(fc.create(desk, { reason: 'OTHER', description: 'x issue', customerId: C1, appointmentId: id('99'), idempotencyKey: 'create-key-0004' }))).toBe('FOLLOWUP_LINK_INVALID');
  });
  it('T07–T10/T12 search by name, phone digits, email, task id and call id — across every page', async () => {
    for (let i = 0; i < 24; i++) await fc.create(desk, { reason: 'CALLBACK', description: `Filler ${i}`, callerPhone: `+1609555${String(2000 + i)}`, idempotencyKey: `filler-key-${i}-xx` });
    const page1 = await fc.list(desk, { status: 'all', pageSize: 10 });
    expect(page1.totalPages).toBeGreaterThan(2);
    expect((await fc.list(desk, { status: 'all', q: 'ben' })).items.map((x) => x.id)).toContain(made);
    expect((await fc.list(desk, { status: 'all', q: 'Ben Lee' })).items.map((x) => x.id)).toContain(made);
    expect((await fc.list(desk, { status: 'all', q: '(609) 555-0177' })).items.map((x) => x.id)).toContain(made);
    expect((await fc.list(desk, { status: 'all', q: 'ben@fu.test' })).items.map((x) => x.id)).toContain(made);
    expect((await fc.list(desk, { status: 'all', q: made.slice(0, 13) })).items.map((x) => x.id)).toEqual([made]);
    expect((await fc.list(desk, { status: 'all', q: 'call_unk' })).totalItems).toBe(1);
    const old = (await tasksFor('call_shared'))[0].id;   // created first → last page of newest-first
    expect(page1.items.map((x) => x.id)).not.toContain(old);
    expect((await fc.list(desk, { status: 'all', q: 'shared' })).items.map((x) => x.id)).toContain(old);
  });
  it('T13/T17 filters (priority, source, assignee, overdue) and stable paging 10/20/50 with no overlap', async () => {
    expect((await fc.list(own, { status: 'all', source: 'ai' })).items.every((x) => x.source === 'ai_receptionist')).toBe(true);
    expect((await fc.list(own, { status: 'all', source: 'complaint' })).items.every((x) => x.reason === 'COMPLAINT')).toBe(true);
    expect((await fc.list(own, { status: 'all', assignee: 'unassigned' })).items.every((x) => x.assignee === null)).toBe(true);
    const a = await fc.list(own, { status: 'all', pageSize: 10, page: 1 }), b = await fc.list(own, { status: 'all', pageSize: 10, page: 2 });
    expect(a.items.filter((x) => b.items.some((y) => y.id === x.id))).toEqual([]);
    expect((await fc.list(own, { status: 'all', pageSize: 37 })).pageSize).toBe(20);
    expect(await code(fc.list(own, { status: 'all', priority: 'whenever' }))).toBe('FOLLOWUP_CENTER_INVALID_FILTER');
  });
  it('T15/T16 salon-local From/To includes the whole final day across the DST change; the date basis is explicit', async () => {
    // Nov 1 2026 is the US fall-back day: 23:30 local on Nov 1 = 04:30Z Nov 2
    expect(localToUtc('2026-11-01T23:30', 'America/New_York')).toBe('2026-11-02T04:30:00.000Z');
    expect(localToUtc('2026-03-08T03:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    const t = (await fc.create(desk, { reason: 'OTHER', description: 'Due late Nov 1', customerId: C1, dueLocal: '2026-11-01T23:30', idempotencyKey: 'create-key-due1' })).id;
    const due = await fc.list(desk, { status: 'all', basis: 'due', preset: 'custom', from: '2026-11-01', to: '2026-11-01' });
    expect(due.items.map((x) => x.id)).toEqual([t]);
    expect(due.filters.basis).toBe('due');
    expect((await fc.list(desk, { status: 'all', basis: 'created', preset: 'custom', from: '2026-11-01', to: '2026-11-01' })).items.map((x) => x.id)).not.toContain(t);
    expect(await code(fc.list(desk, { status: 'all', preset: 'custom', from: '2026-11-05', to: '2026-11-01' }))).toBe('FOLLOWUP_CENTER_INVALID_FILTER');
    expect(fuPeriod({ preset: 'month' }, 'America/New_York', new Date('2027-01-01T03:00:00Z'))).toMatchObject({ from: '2026-12-01', to: '2026-12-31' });
  });
  it('T18 priority view: overdue urgent first, then oldest; a new low task never jumps ahead', async () => {
    const urgent = (await fc.create(desk, { reason: 'COMPLAINT', description: 'Burnt cuticle', priority: 'urgent', customerId: C1, dueLocal: '2026-01-02T09:00', idempotencyKey: 'create-key-urg1' })).id;
    await fc.create(desk, { reason: 'OTHER', description: 'Low thing', priority: 'low', customerId: C1, idempotencyKey: 'create-key-low1' });
    const pr = await fc.list(own, { status: 'all', sort: 'priority', pageSize: 50 });
    expect(pr.items[0].id).toBe(urgent); expect(pr.items[0].overdue).toBe(true);
  });
});

describe('assignment, lifecycle, escalation, contact (T23–T26, T34–T37)', () => {
  let t: string;
  const ver = async (x: string) => N((await q1(sql`select version from ai_receptionist_follow_ups where id = ${x}`)).version);
  it('T23 assign only to active staff in this branch; reassignment audited; a stale version is refused', async () => {
    t = (await fc.create(desk, { reason: 'CALLBACK', description: 'Assign me', customerId: C1, idempotencyKey: 'create-key-asg1' })).id;
    expect(await code(fc.assign(desk, t, { assignedUserId: GONE, version: 1 }))).toBe('FOLLOWUP_ASSIGNEE_INVALID');
    expect(await code(fc.assign(desk, t, { assignedUserId: OTHERB, version: 1 }))).toBe('FOLLOWUP_ASSIGNEE_INVALID');
    expect(await code(fc.assign(desk, t, { assignedUserId: TECHU, version: 1 }))).toBe('FOLLOWUP_ASSIGNEE_INVALID');
    const a = await fc.assign(desk, t, { assignedUserId: FD, version: 1 });
    expect(a).toMatchObject({ status: 'assigned', assignee: { id: FD } });
    expect(await code(fc.assign(desk, t, { assignedUserId: MGR, version: 1 }))).toBe('RECORD_CHANGED_RELOAD');
    await fc.assign(desk, t, { assignedUserId: MGR, version: await ver(t) });
    const acts = (await sql`select event_type, from_value, to_value from ai_follow_up_activity where follow_up_id = ${t} order by created_at`.execute(db)).rows as any[];
    // A13 Nov 6: assigning to someone else also notifies them (assignee_notified rows)
    expect(acts.map((x) => x.event_type).filter((e) => e !== 'assignee_notified')).toEqual(['created', 'assigned', 'reassigned']);
    expect(acts.some((x) => x.event_type === 'assignee_notified')).toBe(true);
    expect(N((await q1(sql`select count(*)::int n from audit_events where resource_id = ${t} and action = 'follow_up.assigned'`)).n)).toBe(2);
  });
  it('T24/T25 lifecycle via the canonical machine; Resolved needs an outcome; reopen needs a reason; a complaint needs a note', async () => {
    await fc.transition(desk, t, { to: 'in_progress', version: await ver(t) });
    expect(await code(fc.transition(desk, t, { to: 'waiting', version: await ver(t) }))).toBe('FOLLOWUP_REASON_REQUIRED');
    await fc.transition(desk, t, { to: 'waiting', version: await ver(t), note: 'Customer checking her calendar' });
    expect(await code(fc.transition(desk, t, { to: 'resolved', version: await ver(t) }))).toBe('FOLLOWUP_RESOLUTION_REQUIRED');
    const r = await fc.transition(desk, t, { to: 'resolved', version: await ver(t), resolutionCategory: 'booked', note: 'Booked Sat 10am' });
    expect(r.status).toBe('resolved'); expect(r.resolvedAt).not.toBeNull();
    expect(await code(fc.transition(desk, t, { to: 'in_progress', version: await ver(t) }))).toBe('FOLLOWUP_REASON_REQUIRED');
    const re = await fc.transition(desk, t, { to: 'in_progress', version: await ver(t), reason: 'She called again' });
    expect(re).toMatchObject({ status: 'in_progress', resolvedAt: null });
    expect(await code(fc.transition(desk, t, { to: 'assigned', version: await ver(t) + 5 }))).toBe('RECORD_CHANGED_RELOAD');
    const c = (await tasksFor('call_fail')).find((x) => x.reason === 'COMPLAINT')!;
    expect(await code(fc.transition(desk, c.id, { to: 'resolved', version: await ver(c.id), resolutionCategory: 'issue_resolved' }))).toBe('FOLLOWUP_RESOLUTION_REQUIRED');
  });
  it('T26 overdue tasks raise ONE manager alert each, however often the job runs; priority override is manager-only with a reason', async () => {
    const r1 = await escalateOverdueFollowUps(db), r2 = await escalateOverdueFollowUps(db);
    expect(r1.escalated).toBeGreaterThan(0); expect(r2.escalated).toBe(0);
    const urg = (await q1(sql`select id from ai_receptionist_follow_ups where description = 'Burnt cuticle'`)).id;
    expect((await q1(sql`select severity, owner_alert_id from ai_follow_up_escalations where follow_up_id = ${urg} and rule like 'overdue:%'`)).severity).toBe('high');
    expect(N((await q1(sql`select count(*)::int n from owner_alerts where category = 'ai_follow_up' and metadata->>'followUpId' = ${urg}`)).n)).toBe(1);
    expect(await code(fc.setPriority(desk, t, { priority: 'low', reason: 'not urgent', version: await ver(t) }))).toBe('PERMISSION_DENIED');
    const esc = await fc.setPriority(desk, t, { escalate: true, reason: 'Customer upset', version: await ver(t) });
    expect(esc).toMatchObject({ priority: 'urgent', escalationLevel: 1 });
    // Nov 3 audit: a second escalation raises its own alert (one per level), on the TASK's branch
    await fc.setPriority(desk, t, { escalate: true, reason: 'Still upset', version: await ver(t) });
    const alerts = (await sql`select o.branch_id, f.branch_id as task_branch from owner_alerts o join ai_receptionist_follow_ups f on f.id::text = o.metadata->>'followUpId' where o.category = 'ai_follow_up' and o.metadata->>'followUpId' = ${t} and o.metadata->>'rule' like 'manual%'`.execute(db)).rows as any[];
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a: any) => String(a.branch_id) === String(a.task_branch))).toBe(true);
    expect((await fc.setPriority(own, t, { priority: 'high', reason: 'Calmed down', version: await ver(t) })).priority).toBe('high');
  });
  it('Nov 3 audit — an edit without the row version is refused; edits are versioned and audited; a moved due time alerts again', async () => {
    expect(await code(fc.assign(desk, t, { assignedUserId: FD }))).toBe('VERSION_REQUIRED');
    expect(await code(fc.transition(desk, t, { to: 'waiting', note: 'x' }))).toBe('VERSION_REQUIRED');
    expect(await code(fc.note(desk, t, { note: 'no version' }))).toBe('VERSION_REQUIRED');
    expect(await code(fc.edit(desk, t, { description: 'New text' }))).toBe('VERSION_REQUIRED');
    expect(await code(fc.edit(desk, t, { description: 'Okay fine', version: (await ver(t)) + 3 }))).toBe('RECORD_CHANGED_RELOAD');
    expect(await code(fc.edit(desk, t, { description: 'x', version: await ver(t) }))).toBe('FOLLOWUP_CENTER_INVALID_FILTER');
    const e = await fc.edit(desk, t, { description: 'Customer wants a call after 3pm', dueLocal: '2020-01-02T09:00', version: await ver(t) });
    expect(e.description).toBe('Customer wants a call after 3pm');
    const acts = (await sql`select event_type from ai_follow_up_activity where follow_up_id = ${t} and event_type in ('due_changed','description_changed')`.execute(db)).rows as any[];
    expect(acts.map((a) => a.event_type).sort()).toEqual(['description_changed', 'due_changed']);
    // the task is overdue under its NEW due time → a new overdue alert, once
    const before = N((await q1(sql`select count(*)::int n from ai_follow_up_escalations where follow_up_id = ${t} and rule like 'overdue:%'`)).n);
    await escalateOverdueFollowUps(db); await escalateOverdueFollowUps(db);
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_escalations where follow_up_id = ${t} and rule like 'overdue:%'`)).n)).toBe(before + 1);
    await fc.edit(desk, t, { dueLocal: '2020-01-03T09:00', version: await ver(t) });
    await escalateOverdueFollowUps(db);
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_escalations where follow_up_id = ${t} and rule like 'overdue:%'`)).n)).toBe(before + 2);
  });
  it('T34/T35/T36 a recorded call is labelled an attestation; a text goes through prepare → confirm and is SUBMITTED, never delivered', async () => {
    expect((await fc.recordAttempt(desk, t, { channel: 'phone_call', outcome: 'no_answer', note: 'Rang twice', idempotencyKey: 'att-key-0001' })).duplicate).toBe(false);
    expect((await fc.recordAttempt(desk, t, { channel: 'phone_call', outcome: 'no_answer', idempotencyKey: 'att-key-0001' })).duplicate).toBe(true);
    const p = await fc.prepareText(desk, t, { body: 'Hi Ava, this is Salon A returning your call.' });
    expect(p.state).toBe('awaiting_confirmation'); expect(sent).toHaveLength(0);
    const c = await fc.confirmText(desk, t, { body: 'Hi Ava, this is Salon A returning your call.', token: p.token, idempotencyKey: 'sms-key-0001' });
    expect(c).toMatchObject({ ok: true, state: 'submitted', duplicate: false }); expect(sent).toHaveLength(1);
    expect((await fc.confirmText(desk, t, { body: 'x', token: p.token, idempotencyKey: 'sms-key-0001' })).duplicate).toBe(true); expect(sent).toHaveLength(1);
    const d = await fc.detail(own, t);
    expect(d.attempts.map((a: any) => [a.channel, a.outcome, a.attestation])).toEqual([['sms', 'submitted', false], ['phone_call', 'no_answer', true]]);
    expect(N((await q1(sql`select contact_attempts from ai_receptionist_follow_ups where id = ${t}`)).contact_attempts)).toBe(2);
  });
  it('T37 a second text within the cooldown is blocked; only a manager can override, with a reason (audited)', async () => {
    expect((await fc.prepareText(desk, t, { body: 'Again' })).state).toBe('blocked');
    expect((await fc.prepareText(desk, t, { body: 'Again', overrideReason: 'She asked' })).blocked.join(' ')).toMatch(/Only an owner or manager/);
    expect(await code(fc.confirmText(desk, t, { body: 'Again', token: 'tok-+16095550142', idempotencyKey: 'sms-key-0002' }))).toBe('FOLLOWUP_DUPLICATE_CONTACT');
    const p = await fc.prepareText(own, t, { body: 'Again', overrideReason: 'Customer asked for the address' });
    expect(p.state).toBe('awaiting_confirmation');
    await fc.confirmText(own, t, { body: 'Again', token: p.token, idempotencyKey: 'sms-key-0003', overrideReason: 'Customer asked for the address' });
    expect((await q1(sql`select action from audit_events where resource_id = ${t} and action = 'follow_up.duplicate_text_override'`)).action).toBeTruthy();
  });
});

describe('overlay, health, assistant, security (T33, T40–T46)', () => {
  it('T33/T22 the overlay links the original AI call and its handoffs; opening it is audited; unmatched callers are labelled', async () => {
    const cb = (await tasksFor('call_fail')).find((x) => x.reason === 'CALLBACK')!;
    const d = await fc.detail(own, cb.id);
    expect(d.call).toMatchObject({ providerCallId: 'call_fail', transfer: 'failed' });
    expect(d.call!.handoffs.map((h: any) => h.kind)).toEqual(expect.arrayContaining(['transfer_failed', 'callback_requested', 'complaint']));
    expect(d.customer).toMatchObject({ id: C1, name: 'Ava Kim', phone: '+16095550142' });
    expect((await q1(sql`select count(*)::int n from audit_events where resource_id = ${cb.id} and action = 'follow_up.viewed'`)).n).toBeGreaterThan(0);
    const unk = await fc.detail(viewer, (await tasksFor('call_unk'))[0].id);
    expect(unk.customer).toMatchObject({ id: null, unmatched: true }); expect(String(unk.customer.phone)).toMatch(/•/);
  });
  it('T40/T41 the center is not AI-package gated: manual tasks stay readable and workable (the controller carries no @RequiresAiPackage)', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./ai-follow-up-center.controller.ts', import.meta.url), 'utf8'));
    expect(src).not.toMatch(/@RequiresAiPackage/);
    expect((await fc.list(desk, { status: 'all', source: 'manual' })).totalItems).toBeGreaterThan(0);
  });
  it('T42/T43/T44 health: distinct read-only states (Retell signing key absent → NOT_CONFIGURED), recorded, rate-limited; nothing billable', async () => {
    const before = sent.length;
    const h = await fc.health(own);
    const by = Object.fromEntries(h.checks.map((c: any) => [c.domain, c.status]));
    expect(by.voice_events).toBe('NOT_CONFIGURED');
    expect(by.handoff_detection).toBe('READY');
    expect(by.staff_assignment).toMatch(/ATTENTION|FAILED/);
    expect(by.outreach_booking).toBe('NOT_CONFIGURED');
    expect(h.overall).not.toBe('READY');
    expect((await fc.health(own)).cached).toBe(true);
    expect(sent.length).toBe(before);
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_health_runs where tenant_id = ${TA}`)).n)).toBe(1);
  });
  it('assistant: recommendations only, with evidence; Dismiss/Accept are audited and change nothing else', async () => {
    const pr = await fc.priorities(own);
    expect(pr.items.length).toBeGreaterThan(0); expect(pr.items[0].evidence.length).toBeGreaterThan(0);
    expect(Math.abs(Date.parse(pr.asOf) - Date.now())).toBeLessThan(60_000);   // the as-of time the evidence was computed at
    const before = await q1(sql`select status, priority, assigned_user_id, version from ai_receptionist_follow_ups where id = ${pr.items[0].taskId}`);
    await fc.decide(desk, { taskId: pr.items[0].taskId, signal: pr.items[0].signal, decision: 'dismiss', note: 'handled at desk' });
    expect(await q1(sql`select status, priority, assigned_user_id, version from ai_receptionist_follow_ups where id = ${pr.items[0].taskId}`)).toEqual(before);
    expect((await q1(sql`select event_type from ai_follow_up_activity where follow_up_id = ${pr.items[0].taskId} order by created_at desc limit 1`)).event_type).toBe('assistant_dismiss');
  });
  it('T45/T46 another salon sees none of it; another branch’s staff cannot be assigned; a viewer cannot work tasks', async () => {
    expect((await fc.list(ownB, { status: 'all' })).totalItems).toBe(0);
    expect((await fc.list(ownB, { status: 'all', q: 'Ava' })).totalItems).toBe(0);
    const any = (await fc.list(own, { status: 'all' })).items[0].id;
    expect(await code(fc.detail(ownB, any))).toBe('NOT_FOUND');
    expect(await code(fc.assign(ownB, any, { assignedUserId: OWNER }))).toBe('NOT_FOUND');
    expect(await code(fc.create(viewer, { reason: 'OTHER', description: 'nope', customerId: C1, idempotencyKey: 'create-key-view' }))).toBe('PERMISSION_DENIED');
    expect(await code(fc.kpis({ ...viewer, permissions: [] }))).toBe('PERMISSION_DENIED');
    const k = await fc.kpis(own);
    expect(k.cards.total).toBe((await fc.list(own, { status: 'all' })).totalItems);
  });
  it('activity is append-only', async () => {
    await expect(sql`update ai_follow_up_activity set note = 'x'`.execute(db)).rejects.toThrow(/append-only/);
  });
});

describe('A13 Nov 6 — missed-call / Copilot sources, recommended assignee, notify assignee, hold expiry, health history', () => {
  it('missed calls (short hang-up or flagged) and failed / unknown Copilot actions become follow-ups once; a source filter finds them', async () => {
    await sql`insert into voice_call_outcomes (tenant_id, branch_id, provider, provider_call_id, started_at, duration_seconds, abandoned, caller_number)
      values (${TA}, ${BA}, 'retell', 'nov6_missed_1', now() - interval '1 hour', 4, true, '+16095557001'), (${TA}, ${BA}, 'retell', 'nov6_long_hangup', now() - interval '1 hour', 300, true, null)`.execute(db);
    await sql`insert into reception_copilot_action_ledger (tenant_id, branch_id, idempotency_key, action_type, state, error_code) values
      (${TA}, ${BA}, 'nov6-cp-1', 'cancel_appointment', 'failed', 'BOOKING_FAILED'), (${TA}, ${BA}, 'nov6-cp-2', 'send_message', 'unknown', null), (${TA}, ${BA}, 'nov6-cp-3', 'send_message', 'succeeded', null)`.execute(db);
    const r = await fc.importSources(own);
    expect(r).toEqual({ createdFromMissedCalls: 1, createdFromCopilot: 2 });
    expect(await fc.importSources(own)).toEqual({ createdFromMissedCalls: 0, createdFromCopilot: 0 });          // idempotent
    const m = await fc.list(own, { status: 'all', source: 'missed_call' });
    expect(m.items.map((x: any) => x.reason)).toEqual(['CALLBACK']);
    const cp = (await fc.list(own, { status: 'all', source: 'copilot' })).items as any[];
    expect(cp.map((x) => x.priority).sort()).toEqual(['high', 'normal']);                                       // unknown outcome = high
    expect((await fc.importSources(ownB))).toEqual({ createdFromMissedCalls: 0, createdFromCopilot: 0 });       // another salon gets none
  });
  it('the recommended assignee is the staff member with the fewest open tasks; assigning notifies them (not when you take it yourself)', async () => {
    const rec = await fc.recommendAssignee(own);
    expect(rec).toBeTruthy(); expect(rec!.reason).toMatch(/Fewest open follow-ups/);
    const t = await fc.create(desk, { reason: 'OTHER', description: 'Nov 6 notify test', callerPhone: '+16095550199', idempotencyKey: 'nov6-notify-0001' });
    await fc.assign(own, t.id, { assignedUserId: FD, version: 1 });
    const a = await q1(sql`select title, metadata from owner_alerts where tenant_id = ${TA} and category = 'ai_follow_up_assigned' and metadata->>'followUpId' = ${t.id}`);
    expect(a.title).toMatch(/assigned to/); expect(a.metadata.assignedUserId).toBe(FD);
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_activity where follow_up_id = ${t.id} and event_type = 'assignee_notified'`)).n)).toBe(1);
    const t2 = await fc.create(desk, { reason: 'OTHER', description: 'Nov 6 self assign', callerPhone: '+16095550199', idempotencyKey: 'nov6-notify-0002' });
    await fc.assign(desk, t2.id, { assignedUserId: FD, version: 1 });
    expect(await q1(sql`select id from owner_alerts where category = 'ai_follow_up_assigned' and metadata->>'followUpId' = ${t2.id}`)).toBeUndefined();
  });
  it('a waiting task whose time has passed goes back to the queue (hold expiry), with an activity row', async () => {
    const t = await fc.create(desk, { reason: 'OTHER', description: 'Nov 6 hold test', callerPhone: '+16095550199', idempotencyKey: 'nov6-hold-0001' });
    await sql`update ai_receptionist_follow_ups set status = 'waiting', waiting_until = now() - interval '1 minute' where id = ${t.id}`.execute(db);
    expect((await expireFollowUpHolds(db, TA)).returned).toBeGreaterThanOrEqual(1);
    expect((await q1(sql`select status, waiting_until from ai_receptionist_follow_ups where id = ${t.id}`))).toMatchObject({ status: 'in_progress', waiting_until: null });
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_activity where follow_up_id = ${t.id} and event_type = 'hold_expired'`)).n)).toBe(1);
  });
  it('health history lists every recorded run, newest first', async () => {
    await fc.health(own);
    const h = await fc.healthHistory(own, {});
    expect(h.totalItems).toBeGreaterThanOrEqual(1);
    expect(h.items[0].overall).toBeTruthy();
    expect((await fc.healthHistory(ownB, {})).totalItems).toBe(0);
  });
});

describe('AI Follow Ups 05 — duplicate contact guard (warning only)', () => {
  it('a customer reached in the last 7 days by another follow-up task or an end-of-day technician follow-up is listed; older contacts and other customers are not', async () => {
    const C9 = id('c9');
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${C9}, ${TA}, ${BA}, 'Dee', 'Vu', 'Dee Vu', '+16095550199', 'active')`.execute(db);
    const a = (await fc.create(desk, { reason: 'BOOKING_HELP', description: 'First ask', priority: 'normal', customerId: C9, idempotencyKey: 'dup-guard-0001' })).id;
    const b = (await fc.create(desk, { reason: 'CALLBACK', description: 'Second ask', priority: 'normal', customerId: C9, idempotencyKey: 'dup-guard-0002' })).id;
    expect((await fc.detail(own, b)).recentContacts).toEqual([]);
    await fc.recordAttempt(desk, a, { channel: 'phone_call', outcome: 'reached', idempotencyKey: 'dup-guard-att-1' });
    await sql`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, technician_name_snapshot, status, sent_at)
      values (${TA}, ${BA}, '2026-11-01', ${C9}, ${id('f1')}, ${id('f2')}, ${id('f3')}, 'Lan Tran', 'sent', now() - interval '1 day'),
             (${TA}, ${BA}, '2026-10-01', ${C9}, ${id('f1')}, ${id('f4')}, ${id('f5')}, 'Lan Tran', 'sent', now() - interval '20 days'),
             (${TA}, ${BA}, '2026-11-01', ${C1}, ${id('f1')}, ${id('f6')}, ${id('f7')}, 'Lan Tran', 'sent', now() - interval '1 day')`.execute(db);
    const before = N((await q1(sql`select count(*)::int n from ai_follow_up_contact_attempts where follow_up_id = ${b}`)).n);
    const d = await fc.detail(own, b);
    expect(d.recentContacts.map((x: any) => [x.source, x.channel, x.by])).toEqual([['ai_follow_up', 'phone_call', 'Fiona Desk'], ['end_of_day', 'customer_app', 'Lan Tran']]);
    expect(d.recentContacts[0].ref).toBe(a);
    // the task's own attempts are not "another" contact; nothing was written by reading
    expect((await fc.detail(own, a)).recentContacts.map((x: any) => x.source)).toEqual(['end_of_day']);
    expect(N((await q1(sql`select count(*)::int n from ai_follow_up_contact_attempts where follow_up_id = ${b}`)).n)).toBe(before);
  });
});

describe('data-quality signals (AI Follow Ups Human Handoff extras #14)', () => {
  it('flags missing branch, ambiguous customer, a due time before creation, no due time, an unlinked AI call and a non-E.164 caller', async () => {
    const { fuDataQuality } = await import('./ai-follow-up-center');
    const base = { branch_id: BA, customer_match: 'linked', status: 'open', due_at: '2026-11-03T15:00:00Z', created_at: '2026-11-03T14:00:00Z', source: 'manual', provider_call_id: null, caller_phone: '+16095550142' };
    expect(fuDataQuality(base)).toEqual([]);
    expect(fuDataQuality({ ...base, branch_id: null })).toEqual(['missing_branch']);
    expect(fuDataQuality({ ...base, customer_match: 'ambiguous' })).toEqual(['ambiguous_customer']);
    expect(fuDataQuality({ ...base, due_at: '2026-11-03T13:00:00Z' })).toEqual(['invalid_due']);
    expect(fuDataQuality({ ...base, due_at: null })).toEqual(['no_due']);
    expect(fuDataQuality({ ...base, due_at: null, status: 'resolved' })).toEqual([]);
    expect(fuDataQuality({ ...base, source: 'ai_receptionist', provider_call_id: 'call_x', call_started_at: null })).toEqual(['unlinked_call']);
    expect(fuDataQuality({ ...base, source: 'ai_receptionist', provider_call_id: 'call_x', call_started_at: '2026-11-03T13:59:00Z' })).toEqual([]);
    expect(fuDataQuality({ ...base, source: 'ai_receptionist', provider_call_id: 'call_x' })).toEqual([]);   // no join on this row → not judged
    expect(fuDataQuality({ ...base, caller_phone: '6095550142' })).toEqual(['caller_not_e164']);
  });
  it('the list returns the signals on each row', async () => {
    const r = await fc.list(own, { status: 'all', page: 1, pageSize: 50 });
    expect(r.items.length).toBeGreaterThan(0);
    for (const it of r.items) expect(Array.isArray(it.dataQuality)).toBe(true);
    const ai = r.items.find((x: any) => x.source === 'ai_receptionist' && x.providerCallId);
    expect(ai).toBeTruthy();
    expect(ai!.dataQuality.includes('unlinked_call')).toBe(!ai!.callStartedAt);
  });
});

describe('stale event reconciler (AI Follow Ups Human Handoff extras #07)', () => {
  it('Check lists each handoff that required a callback but has no follow-up; creating its follow-up (by a person) links it; nothing is created silently', async () => {
    await sql`insert into voice_call_outcomes (tenant_id, branch_id, provider_call_id) values (${TA}, ${BA}, 'call_orphan')`.execute(db);
    await sql`insert into ai_handoff_events (tenant_id, branch_id, provider_call_id, source, source_key, kind, callback_required, reason) values (${TA}, ${BA}, 'call_orphan', 'retell_webhook', 'orph-1', 'callback_requested', true, 'caller asked for a person')`.execute(db);
    const before = N((await q1(sql`select count(*) n from ai_receptionist_follow_ups where provider_call_id = 'call_orphan'`)).n);
    await sql`delete from ai_follow_up_health_runs where tenant_id = ${TA}`.execute(db);
    const h = await fc.health(own);
    type HRow = { domain: string; status: string; items?: { providerCallId: string; kind: string; reason: string | null }[] };
    const row = (h.checks as HRow[]).find((c) => c.domain === 'handoff_detection')!;
    expect(row.status).toBe('FAILED');
    expect((row.items ?? []).map((i) => i.providerCallId)).toContain('call_orphan');
    expect((row.items ?? []).find((i) => i.providerCallId === 'call_orphan')).toMatchObject({ kind: 'callback_requested', reason: 'caller asked for a person' });
    expect(N((await q1(sql`select count(*) n from ai_receptionist_follow_ups where provider_call_id = 'call_orphan'`)).n)).toBe(before);   // the check created nothing
    const r = await fc.create(own, { reason: 'CALLBACK', description: 'Call the guest back', callerPhone: '+16095550199', providerCallId: 'call_orphan', idempotencyKey: 'reconcile-orphan-1' });
    expect(r.linkedHandoffEvents).toBe(1);
    expect((await q1(sql`select follow_up_id from ai_handoff_events where source_key = 'orph-1'`)).follow_up_id).toBe(r.id);
    await sql`delete from ai_follow_up_health_runs where tenant_id = ${TA}`.execute(db);
    const h2 = await fc.health(own);
    const row2 = (h2.checks as HRow[]).find((c) => c.domain === 'handoff_detection')!;
    expect((row2.items ?? []).map((i) => i.providerCallId)).not.toContain('call_orphan');
  });
});
