// reception-copilot-center.pgtest — Reception Copilot Complete Build Guide acceptance (CP04–CP38 that can run without a
// live provider) on the REAL schema through migration 757. The action spine is the real ReceptionCopilotActionService with
// the real claim-before-run ledger; the booking / messaging domain services are in-process fakes that write the canonical
// rows exactly as the real ones would (the stand-in has no Kysely query builder for BookingService).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReceptionCopilotActionService, KyselyActionLedgerRepo } from './reception-copilot-action.service';
import { ReceptionCopilotCenter, CopilotCenterError, type CcCtx } from './reception-copilot-center';
import { ROLE_PERMISSIONS } from '@aipowersalon/permissions';

const T = randomUUID(), T2 = randomUUID(), B = randomUUID(), B2 = randomUUID(), CAT = randomUUID(), CAT2 = randomUUID();
const TECH = randomUUID(), TECH2 = randomUUID(), SVC = randomUUID(), OWNER = randomUUID(), CLERK = randomUUID();
const ALL = ['reception_copilot.use', 'reception_copilot.view_customer_context', 'reception_copilot.view_recommendations',
  'reception_copilot.create_appointment', 'reschedule_appointment', 'reception_copilot.reschedule_appointment', 'reception_copilot.cancel_appointment', 'reception_copilot.send_message',
  'pos.booking.create', 'pos.booking.reschedule', 'pos.booking.cancel', 'communications.send'];
const owner: CcCtx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ALL };
let db: any; let cc: ReceptionCopilotCenter; let calls: Record<string, number>; let settingsMode: 'on' | 'off' | 'throw' = 'on';
const q = async (s: any) => (await s.execute(db)).rows as any[];
const ON = { enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true };

async function appt(tenant: string, branch: string, o: { start: string; date?: string; status?: string; tech?: string; phone?: string; name?: string; customer?: string | null; dur?: number; overbook?: boolean }) {
  const id = randomUUID(); const dur = o.dur ?? 30;
  try { await q(sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, appt_date, start_time, end_time, duration_minutes, status, services, overbook_ok)
    values (${id}, ${tenant}, ${branch}, ${o.tech ?? TECH}, ${o.customer ?? null}, ${o.name ?? 'Ava Kim'}, ${o.phone ?? '+16095550142'}, ${o.date ?? '2026-11-20'}::date, ${o.start},
      to_char(${o.start}::time + make_interval(mins => ${dur}), 'HH24:MI'), ${dur}, ${o.status ?? 'booked'}, ${JSON.stringify([{ name: 'Gel manicure' }])}::jsonb, ${!!o.overbook})`); } catch (e) { throw new Error(`appt ${JSON.stringify(o)}: ${(e as Error).message}`); }
  return id;
}
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CopilotCenterError ? e.code : (e as Error).message; } }

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [t, b, cat, slug] of [[T, B, CAT, 'rcc-a'], [T2, B2, CAT2, 'rcc-b']] as const) {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${b}, ${t}, 'Main', 'UTC')`);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${cat}, ${t}, ${b}, 'Nails')`);
  }
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Olivia Owner', 'o@rcc.test', 'active', 'OWNER'), (${CLERK}, ${T}, 'Fran Desk', 'f@rcc.test', 'active', 'FRONT_DESK')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Lan', 'Tran', 'Lan Tran', 'active', true), (${TECH2}, ${T2}, ${B2}, 'Other', 'Tech', 'Other Tech', 'active', true)`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel manicure', 45, 4500, 'active')`);
  calls = { create: 0, reschedule: 0, cancel: 0, send: 0 };
  const booking = {
    create: async (c: any, p: any) => { calls.create++; const id = await appt(c.tenantId, c.branchId, { start: p.startTime, date: p.date, name: p.customerName }); return { appointmentId: id }; },
    reschedule: async (c: any, id: string, p: any) => {
      calls.reschedule++;
      const r = await q(sql`update pos_tech_appointments set start_time = ${p.startTime}, end_time = to_char(${p.startTime}::time + make_interval(mins => coalesce(duration_minutes, 30)), 'HH24:MI'), appt_date = coalesce(${p.date ?? null}::date, appt_date) where tenant_id = ${c.tenantId} and id = ${id} returning id`);
      if (!r.length) throw new Error('Appointment not found'); return { appointmentId: id };
    },
    cancel: async (c: any, id: string) => {
      calls.cancel++; await new Promise((r) => setTimeout(r, 30));   // a slow domain call widens any double-execution window
      const r = await q(sql`update pos_tech_appointments set status = 'cancelled' where tenant_id = ${c.tenantId} and id = ${id} returning id`);
      if (!r.length) throw new Error('Appointment not found'); return { appointmentId: id };
    },
  };
  const notifications = { send: async (c: any, m: any) => {
    calls.send++; const id = randomUUID(); const pid = 'SM-MOCK-' + id.slice(0, 8);
    await q(sql`insert into notifications (id, tenant_id, channel, to_address, body, status, provider_id) values (${id}, ${c.tenantId}, 'sms', ${m.to}, ${m.body}, 'sent', ${pid})`);
    return { sent: true, id, providerId: pid };
  } };
  const settings = { get: async () => { if (settingsMode === 'throw') throw new Error('settings store down'); return settingsMode === 'off' ? { ...ON, allowCancel: false } : ON; } };
  const spine = new ReceptionCopilotActionService(booking as any, { record: async () => undefined } as any, new KyselyActionLedgerRepo(db), notifications as any, settings as any);
  const queue = { queueSummary: async () => ({ available: true, waiting: 3, inService: 1, unassigned: 2, vipWaiting: 0, longestWaitMinutes: 14 }) };
  cc = new ReceptionCopilotCenter(db, spine, queue, settings as any, null, { AUTH_SESSION_SECRET: 'test-secret-rcc' } as any);
}, 240_000);

describe('prepare → confirm → verify (guide §06; CP19–CP23, CP32, CP38)', () => {
  it('PREPARE has no side effect and shows current vs proposed; a missing reason or a closed appointment is blocked', async () => {
    const id = await appt(T, B, { start: '10:00' });
    const p = await cc.prepare(owner, { type: 'cancel_appointment', appointmentId: id, reason: 'Customer called' } as any);
    expect(p.state).toBe('awaiting_confirmation'); expect(p.token).toBeTruthy();
    expect(p.current).toMatchObject({ status: 'booked', startTime: '10:00', technician: 'Lan Tran', phone: '•••0142' });
    expect(p.proposed).toMatchObject({ status: 'cancelled', reason: 'Customer called' });
    expect((await q(sql`select status from pos_tech_appointments where id = ${id}`))[0].status).toBe('booked');
    expect(calls.cancel).toBe(0);
    expect((await cc.prepare(owner, { type: 'cancel_appointment', appointmentId: id, reason: '' } as any)).state).toBe('blocked');
    const done = await appt(T, B, { start: '11:00', status: 'completed' });
    const b = await cc.prepare(owner, { type: 'cancel_appointment', appointmentId: done, reason: 'x reason' } as any);
    expect(b.state).toBe('blocked'); expect(b.token).toBeNull(); expect(b.blocked.join(' ')).toMatch(/already completed/);
  });
  it('CONFIRM runs once, the outcome is re-read from the record, and a repeated confirm replays without running again', async () => {
    const id = await appt(T, B, { start: '12:00' });
    const a = { type: 'cancel_appointment', appointmentId: id, reason: 'Customer called' } as any;
    const p = await cc.prepare(owner, a); const before = calls.cancel;
    const r = await cc.confirm(owner, a, p.token!);
    expect(r).toMatchObject({ ok: true, state: 'completed', duplicate: false }); expect((r.record as any).status).toBe('cancelled');
    const again = await cc.confirm(owner, a, p.token!);
    expect(again.duplicate).toBe(true); expect(calls.cancel).toBe(before + 1);
    const led = await q(sql`select state, actor_user_id, payload_hash, summary from reception_copilot_action_ledger where tenant_id = ${T} and idempotency_key = ${r.requestKey}`);
    expect(led).toHaveLength(1); expect(led[0]).toMatchObject({ state: 'succeeded', actor_user_id: OWNER }); expect(led[0].summary).toMatch(/^Cancel appointment /);
  });
  it('OWNER DECISION Oct 31 2026: Front Desk confirms a Copilot cancel with its DEFAULT role grants (no extra permission)', async () => {
    const fd: CcCtx = { tenantId: T, branchId: B, userId: CLERK, role: 'FRONT_DESK', permissions: [...(ROLE_PERMISSIONS as any).FRONT_DESK] };
    const id = await appt(T, B, { start: '12:30' });
    const a = { type: 'cancel_appointment', appointmentId: id, reason: 'Customer called to cancel' } as any;
    const p = await cc.prepare(fd, a);
    expect(p.state).not.toBe('blocked'); expect(p.blocked).toEqual([]);
    const r = await cc.confirm(fd, a, p.token!);
    expect(r).toMatchObject({ ok: true, state: 'completed' }); expect((r.record as any).status).toBe('cancelled');
    const led = await q(sql`select actor_user_id from reception_copilot_action_ledger where tenant_id = ${T} and idempotency_key = ${r.requestKey}`);
    expect(led[0].actor_user_id).toBe(CLERK);
  });
  it('the token is bound to the exact payload, the staff member and 5 minutes (CP32/CP36)', async () => {
    const id = await appt(T, B, { start: '13:00' }); const other = await appt(T, B, { start: '13:30' });
    const a = { type: 'cancel_appointment', appointmentId: id, reason: 'Customer called' } as any;
    const p = await cc.prepare(owner, a);
    expect(await code(cc.confirm(owner, { ...a, appointmentId: other }, p.token!))).toBe('COPILOT_PREPARE_MISMATCH');
    expect(await code(cc.confirm({ ...owner, userId: CLERK }, a, p.token!))).toBe('COPILOT_PREPARE_INVALID');
    expect(await code(cc.confirm(owner, a, p.token!.slice(0, -2) + 'xx'))).toBe('COPILOT_PREPARE_INVALID');
    const old = cc.sealPrepare(owner, (await import('./reception-copilot-action.service')).copilotPayloadHash(a), 'cc:old', Date.now() - 6 * 60_000);
    expect(await code(cc.confirm(owner, a, old.token))).toBe('COPILOT_PREPARE_EXPIRED');
    expect(await code(cc.confirm(owner, a, ''))).toBe('COPILOT_PREPARE_REQUIRED');
    expect((await q(sql`select status from pos_tech_appointments where id = ${id}`))[0].status).toBe('booked');
  });
  it('switches and roles gate prepare AND the spine; unreadable settings fail closed (CP27)', async () => {
    const id = await appt(T, B, { start: '14:00' });
    const a = { type: 'cancel_appointment', appointmentId: id, reason: 'Customer called' } as any;
    const noPerm = { ...owner, permissions: ALL.filter((x) => x !== 'reception_copilot.cancel_appointment') };
    expect((await cc.prepare(noPerm, a)).state).toBe('blocked');
    settingsMode = 'off'; expect((await cc.prepare(owner, a)).blocked.join(' ')).toMatch(/turned off/);
    const p = await (async () => { settingsMode = 'on'; return cc.prepare(owner, a); })();
    settingsMode = 'throw';
    const r = await cc.confirm(owner, a, p.token!);
    expect(r).toMatchObject({ ok: false, errorCode: 'ACTION_DISABLED', state: 'failed' });
    expect((await cc.prepare(owner, a)).state).toBe('blocked');
    settingsMode = 'on';
    expect((await q(sql`select status from pos_tech_appointments where id = ${id}`))[0].status).toBe('booked');
  });
  it('reschedule warns about overlaps, and the confirmed move is verified from the record (CP20)', async () => {
    const id = await appt(T, B, { start: '15:00', date: '2026-11-21' }); await appt(T, B, { start: '16:00', date: '2026-11-21' });
    const a = { type: 'reschedule_appointment', appointmentId: id, startTime: '16:15', date: '2026-11-21' } as any;
    const p = await cc.prepare(owner, a);
    expect(p.warnings.join(' ')).toMatch(/overlapping/);
    // the booking system refuses the real conflict at confirm (database exclusion) — the original stays untouched
    const r = await cc.confirm(owner, a, p.token!);
    expect(r).toMatchObject({ ok: false, errorCode: 'APPOINTMENT_CONFLICT', state: 'failed' });
    expect((await q(sql`select start_time from pos_tech_appointments where id = ${id}`))[0].start_time).toBe('15:00');
    const ok = { ...a, startTime: '17:00' };
    const r2 = await cc.confirm(owner, ok, (await cc.prepare(owner, ok)).token!);
    expect(r2).toMatchObject({ ok: true, state: 'completed' }); expect((r2.record as any).startTime).toBe('17:00');
  });
  it('book: real catalogue names, duration and price; unknown services are blocked (CP16)', async () => {
    const a = { type: 'create_appointment', customerName: 'New Guest', serviceIds: [SVC], date: '2026-11-22', startTime: '09:30', technicianId: TECH } as any;
    const p = await cc.prepare(owner, a);
    expect(p.proposed).toMatchObject({ technician: 'Lan Tran', totalMinutes: 45, totalPriceCents: 4500 });
    expect((await cc.prepare(owner, { ...a, serviceIds: [randomUUID()] })).state).toBe('blocked');
    const r = await cc.confirm(owner, a, p.token!);
    expect(r).toMatchObject({ ok: true, state: 'completed' }); expect((r.record as any).appointmentId).toBeTruthy();
  });
  it('text: needs +country, refuses opted-out numbers, warns on shared phones, and is never shown as delivered (CP24/CP25)', async () => {
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values
      (${randomUUID()}, ${T}, ${B}, 'Mai', 'Ng', 'Mai Ng', '+16095550199', 'active'), (${randomUUID()}, ${T}, ${B}, 'Bao', 'Ng', 'Bao Ng', '+16095550199', 'active')`);
    await q(sql`insert into notification_opt_outs (tenant_id, channel, address, reason) values (${T}, 'sms', '+16095550111', 'STOP')`);
    expect((await cc.prepare(owner, { type: 'send_message', to: '6095550199', body: 'Hi' } as any)).blocked.join(' ')).toMatch(/country code/);
    expect((await cc.prepare(owner, { type: 'send_message', to: '+16095550111', body: 'Hi' } as any)).blocked.join(' ')).toMatch(/opted out/);
    const a = { type: 'send_message', to: '+16095550199', body: 'Running 10 min late, sorry!' } as any;
    const p = await cc.prepare(owner, a);
    expect(p.state).toBe('awaiting_confirmation'); expect(p.warnings.join(' ')).toMatch(/2 customer profiles share this number/);
    expect(p.proposed).toMatchObject({ encoding: 'GSM-7', segments: 1, sender: 'Test sender' });
    const sendsBefore = calls.send;
    const r = await cc.confirm(owner, a, p.token!);
    expect(r).toMatchObject({ ok: true, state: 'submitted' }); expect((r.record as any).testSender).toBe(true);
    expect(calls.send).toBe(sendsBefore + 1);
    // the old screen keyed texts by phone + first 40 characters, so the same "running late" text next week was silently
    // swallowed as "already processed". A fresh review gets a fresh request key and really sends.
    const r2 = await cc.confirm(owner, a, (await cc.prepare(owner, a)).token!);
    expect(r2.ok).toBe(true); expect(r2.duplicate).toBe(false); expect(r2.requestKey).not.toBe(r.requestKey); expect(calls.send).toBe(sendsBefore + 2);
  });
});

describe('tenant isolation (CP06, CP35)', () => {
  it('another salon’s appointment, customer and search results are invisible', async () => {
    const foreign = await appt(T2, B2, { start: '10:00', tech: TECH2 });
    expect(await code(cc.prepare(owner, { type: 'cancel_appointment', appointmentId: foreign, reason: 'probe it' } as any))).toBe('COPILOT_NOT_FOUND');
    const fc = randomUUID();
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${fc}, ${T2}, ${B2}, 'Zed', 'Other', 'Zed Other', '+16095550777', 'active')`);
    expect((await cc.search(owner, { scope: 'customers', q: 'Zed' })).total).toBe(0);
    expect((await cc.search(owner, { scope: 'customers', q: fc })).total).toBe(0);
    expect(await code(cc.overlay(owner, fc))).toBe('COPILOT_NOT_FOUND');
  });
});

describe('search, activity history and calendar (CP04, CP07–CP11)', () => {
  it('customers by partial name, phone digits, email and ID — beyond page 1 — masked, shared phones flagged', async () => {
    for (let i = 0; i < 23; i++) await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status)
      values (${randomUUID()}, ${T}, ${B}, 'Pat', ${'Lee' + i}, ${'Pat Lee' + i}, ${'+1609777' + String(1000 + i)}, ${`pat${i}@ex.test`}, 'active')`);
    const p1 = await cc.search(owner, { scope: 'customers', q: 'pat lee', pageSize: 20 });
    expect(p1.total).toBe(23); expect(p1.items).toHaveLength(20);
    expect((await cc.search(owner, { scope: 'customers', q: 'pat lee', pageSize: 20, page: 2 })).items).toHaveLength(3);
    const ph = await cc.search(owner, { scope: 'customers', q: '7771005' }); expect(ph.total).toBe(1); expect((ph.items[0] as any).phone).toBe('•••1005');
    expect((await cc.search(owner, { scope: 'customers', q: 'pat7@ex' })).total).toBe(1);
    const id = (p1.items[0] as any).id; expect((await cc.search(owner, { scope: 'customers', q: id })).total).toBe(1);
    expect(((await cc.search(owner, { scope: 'customers', q: 'Ng' })).items as any[]).every((x) => x.sharedPhoneProfiles === 1)).toBe(true);
    expect((await cc.search(owner, { scope: 'customers', q: 'p' })).hint).toBeTruthy();
  });
  it('activity is newest first with stable paging, state filter and an inclusive salon-local window', async () => {
    const all = await cc.activity(owner, { period: 'year', pageSize: 10 });
    expect(all.total).toBeGreaterThanOrEqual(5);
    const ts = (all.items as any[]).map((x) => x.at); expect([...ts].sort().reverse()).toEqual(ts);
    expect(((await cc.activity(owner, { period: 'year', state: 'failed' })).items as any[]).every((x) => x.state === 'failed')).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    expect((await cc.activity(owner, { period: 'custom', from: today, to: today })).total).toBe(all.total);
    expect((await cc.activity(owner, { period: 'custom', from: '2025-12-31', to: '2026-01-01' })).total).toBe(0);
    expect(await code(cc.activity(owner, { period: 'custom', from: '2026-02-01', to: '2026-01-01' }))).toBe('COPILOT_INVALID_FILTER');
    const p2 = await cc.activity(owner, { period: 'year', pageSize: 10, page: 2 });
    expect((p2.items as any[]).some((x) => (all.items as any[]).some((y) => y.id === x.id))).toBe(false);
  });
});

describe('Check Copilot System, priorities and the customer overlay (CP29–CP33)', () => {
  it('health: per-area results, recorded, rate-limited — and it sends, books and changes nothing', async () => {
    const n0 = (await q(sql`select count(*)::int c from notifications where tenant_id = ${T}`))[0].c;
    const a0 = (await q(sql`select count(*)::int c from pos_tech_appointments where tenant_id = ${T}`))[0].c;
    const h = await cc.health(owner);
    expect(h.rateLimited).toBe(false);
    expect((h.checks as any[]).map((c) => c.id).sort()).toEqual(['background', 'booking', 'customers', 'entitlement', 'queue', 'roles', 'settings', 'twilio']);
    expect((h.checks as any[]).find((c) => c.id === 'twilio').state).toBe('NOT_CONFIGURED');
    expect((h.checks as any[]).find((c) => c.id === 'entitlement').state).toBe('UNKNOWN');
    const again = await cc.health(owner); expect(again).toMatchObject({ rateLimited: true, runId: h.runId });
    expect((await q(sql`select count(*)::int c from notifications where tenant_id = ${T}`))[0].c).toBe(n0);
    expect((await q(sql`select count(*)::int c from pos_tech_appointments where tenant_id = ${T}`))[0].c).toBe(a0);
    expect((await cc.overview(owner)).lastHealth?.overall).toBe(h.overall);
  });
  it('priorities come from verified sources with reason and evidence; proposals need approval and write nothing', async () => {
    await q(sql`insert into voice_call_outcomes (tenant_id, branch_id, provider_call_id, started_at, follow_up_required) values (${T}, ${B}, 'call_rcc_1', now() - interval '20 minutes', true)`);
    await appt(T, B, { start: '08:00', date: new Date().toISOString().slice(0, 10) }); await appt(T, B, { start: '08:15', date: new Date().toISOString().slice(0, 10), overbook: true });
    const failedKey = 'cc:' + randomUUID();
    await q(sql`insert into reception_copilot_action_ledger (tenant_id, branch_id, idempotency_key, action_type, ok, state, summary, error_code) values (${T}, ${B}, ${failedKey}, 'send_message', false, 'failed', 'Text message (12 characters)', 'MESSAGE_SEND_FAILED')`);
    const l0 = (await q(sql`select count(*)::int c from reception_copilot_action_ledger where tenant_id = ${T}`))[0].c;
    const p = await cc.priorities(owner);
    const kinds = (p.items as any[]).map((i) => i.kind);
    for (const k of ['queue', 'unanswered_call', 'conflict', 'failed_action']) expect(kinds).toContain(k);
    expect((p.items as any[]).every((i) => i.approvalRequired && i.reason && i.evidence)).toBe(true);
    expect((p.items as any[]).find((i) => i.kind === 'conflict').proposal.actionType).toBe('reschedule_appointment');
    const pr = (p.items as any[]).map((i) => i.priority); expect([...pr].sort((a, b) => a - b)).toEqual(pr);
    expect((await q(sql`select count(*)::int c from reception_copilot_action_ledger where tenant_id = ${T}`))[0].c).toBe(l0);
  });
  it('overlay: masked contact, appointments, messages, Copilot actions, consent — and the view itself is audited', async () => {
    const cid = randomUUID();
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values (${cid}, ${T}, ${B}, 'Ova', 'Lay', 'Ova Lay', '+16095550188', 'ova@ex.test', 'active')`);
    const id = await appt(T, B, { start: '17:00', customer: cid, date: '2027-01-05' });
    const a = { type: 'cancel_appointment', appointmentId: id, reason: 'Customer asked' } as any;
    await cc.confirm(owner, a, (await cc.prepare(owner, a)).token!);
    const o = await cc.overlay(owner, cid);
    expect(o.overview).toMatchObject({ name: 'Ova Lay', phone: '•••0188', email: 'o•••@ex.test' });
    expect(o.copilotActions).toHaveLength(1); expect(o.links.openBooking).toBe(`/booking/new?customerId=${cid}&from=copilot`);
    expect((await q(sql`select count(*)::int c from audit_events where tenant_id = ${T} and action = 'customer_overlay.viewed' and resource_id = ${cid}`))[0].c).toBe(1);
  });
});
