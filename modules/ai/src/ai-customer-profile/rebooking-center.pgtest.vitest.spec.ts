// rebooking-center.pgtest — Rebooking Opportunities guide (Nov 1 2026; migrations 763/765) on the REAL schema.
// RB = eligibility & states · RV = review workflow · HO = Booking Assistant handoff · LS = list · SC = security / no side
// effects · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerIntelligenceCenter } from './customer-intelligence-center';
import { RebookingCenter, RebookingError, rebookingState } from './rebooking-center';
import { DEFAULT_TUNABLES } from './ai-customer-profile-core';

const P = 'c7650000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20), MAI = id(21), CAT = id(30);
const SV = { gel: id(40), pedi: id(41), old: id(42) };
const C = { due: id(101), soon: id(102), booked: id(103), single: id(104), active: id(105), late: id(106), retired: id(107), other: id(130) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_customer_profile.view', 'pos.booking.create'], ...o }) as any;
let db: any; let enabled = true; let clock = Date.now();
let ci: CustomerIntelligenceCenter; let rb: RebookingCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof RebookingError ? e.code : (e as Error).message; } }
let tk = 0;
const visit = async (cust: string, daysAgo: number, service = SV.gel, tech = LAN, name = 'Gel Manicure') => {
  const tid = id(1000 + ++tk);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
    values (${tid}, ${T}, ${B}, ${cust}, ${tech}, 'paid', 4500, ${tk}, now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo} || ' days')::interval)`);
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, created_at)
    values (${T}, ${B}, ${tid}, ${service}, ${name}, 4500, 45, 4500, ${tech}, now() - (${daysAgo} || ' days')::interval)`);
};
const appt = (cust: string, dayOffset: number, status: string) => q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
  values (${T}, ${B}, ${LAN}, ${cust}, 'x', (now() at time zone 'America/New_York')::date + ${dayOffset}::int, '10:00', '11:00', ${status}, '[]')`);
const rescan = async () => { clock += 120_000; return ci.scan(ctx()); };
const listIds = async (f: any) => (await rb.list(ctx(), f, { fullContact: false })).items.map((i: any) => i.id).sort();

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  ci = new CustomerIntelligenceCenter(db, async () => ({ enabled, tunables: DEFAULT_TUNABLES }), () => clock);
  rb = new RebookingCenter(db, async () => ({ enabled, tunables: DEFAULT_TUNABLES }), () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'rb-765', 'RB765', 'active'), (${X}, 'X', 'Other', 'rb-765x', 'RB765X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@rb.test', 'active', 'OWNER')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn'), (${MAI}, ${T}, ${B}, 'Mai', 'Trần', 'Mai Trần')`);
  await q(sql`update technicians set is_active = false where id = ${MAI}`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, archived_at) values
    (${SV.gel}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 4500, 'active', null), (${SV.pedi}, ${T}, ${B}, ${CAT}, 'Pedicure', 40, 3500, 'active', null),
    (${SV.old}, ${T}, ${B}, ${CAT}, 'Retired Art', 30, 2000, 'inactive', now())`);
  for (const [cid, tenant, branch, name, phone] of [[C.due, T, B, 'Dee Due', '+14155550101'], [C.soon, T, B, 'Sun Soon', '+14155550102'], [C.booked, T, B, 'Bo Booked', null],
    [C.single, T, B, 'Sin Single', null], [C.active, T, B, 'Ace Active', null], [C.late, T, B, 'Lee Late', null], [C.retired, T, B, 'Rae Retired', null], [C.other, X, BX, 'Oth Other', null]] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, created_at)
      values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${phone}, 'active', now() - interval '400 days')`);
  for (const d of [100, 70, 40]) await visit(C.due, d);                 // 30-day rhythm, 40 days since → past the window
  for (const d of [88, 58, 28]) await visit(C.soon, d, SV.pedi, MAI, 'Pedicure');   // 28 days since → approaching
  for (const d of [100, 70, 40]) await visit(C.booked, d);
  await appt(C.booked, 6, 'booked');                                      // a future appointment suppresses the opportunity
  await visit(C.single, 20);                                              // one visit → Insufficient History
  for (const d of [60, 32, 4]) await visit(C.active, d);                  // within the rhythm → not due
  for (const d of [100, 70, 40]) await visit(C.late, d);
  for (const d of [100, 70, 40]) await visit(C.retired, d, SV.old, LAN, 'Retired Art');
  await q(sql`set session_replication_role = origin`);
});

describe('Rebooking — eligibility from the shared evaluation', () => {
  it('RB-00 with no evaluation the page says Data Unavailable — never "no opportunities"', async () => {
    expect(await rb.summary(ctx())).toMatchObject({ metrics: null, unavailable: true, freshness: { state: 'never' } });
    expect((await rb.list(ctx(), {}, { fullContact: false }))).toMatchObject({ unavailable: true, total: 0 });
    expect(rebookingState({ status: null })).toBe('data_unavailable');
  });
  it('RB-01 the shared scan applies the existing rule; states, window and the cards reconcile with Customer Intelligence', async () => {
    const s0: any = await ci.scan(ctx());
    const st = Object.fromEntries((await q(sql`select customer_id, status, rebooking, rebooking_due_on::text as due, rebooking_since from customer_intelligence_snapshots where tenant_id = ${T}`))
      .map((r) => [r.customer_id, r]));
    expect(st[C.due]).toMatchObject({ rebooking: true });
    expect(st[C.soon]).toMatchObject({ status: 'rebooking_soon', rebooking: true });
    expect(st[C.booked]).toMatchObject({ rebooking: false });
    expect(st[C.single]).toMatchObject({ status: 'insufficient_history', rebooking: false });
    expect(st[C.active]).toMatchObject({ status: 'active', rebooking: false });
    expect(st[C.due].rebooking_since).not.toBeNull();
    expect(st[C.active].rebooking_since).toBeNull();
    // last visit 40 days ago + 30-day rhythm = due 10 days ago
    const d = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    expect([d, new Date(Date.now() - 11 * 86_400_000).toISOString().slice(0, 10), new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10)]).toContain(st[C.due].due);
    const s: any = await rb.summary(ctx());
    expect(s.metrics).toEqual({ evaluated: 7, opportunities: 4, dueForReview: 3, comingDue: 1, reviewed: 0, alreadyBooked: 1, bookedSinceEvaluation: 0, insufficientHistory: 1 });
    expect(s.metrics.opportunities).toBe(s0.scan.counts.rebooking);            // the same number Customer Intelligence shows
  });
  it('RB-02 "opportunity created" is the first scan that saw it, kept across rescans', async () => {
    const before = (await q(sql`select rebooking_since from customer_intelligence_snapshots where customer_id = ${C.due}`))[0].rebooking_since;
    await rescan();
    const after = (await q(sql`select rebooking_since from customer_intelligence_snapshots where customer_id = ${C.due}`))[0].rebooking_since;
    expect(new Date(after).toISOString()).toBe(new Date(before).toISOString());
  });
  it('RB-03 the 360° overlay shows real evidence: last service with current price, technician preference, bookings, caveats', async () => {
    const o: any = await rb.customer(ctx(), C.due, { fullContact: false }, audit);
    expect(o.recommendation).toMatchObject({ state: 'due', completedVisits: 3, typicalIntervalDays: 30 });
    expect(o.recommendation.note).toMatch(/not a booking/);
    expect(o.suggestedService).toMatchObject({ id: SV.gel, name: 'Gel Manicure', active: true, priceCents: 4500, durationMinutes: 45 });
    expect(o.technician).toMatchObject({ id: LAN, visits: 3, of: 3, preferred: true, active: true });
    expect(o.completedServices).toHaveLength(3);
    expect(o.completedServices[0].lines[0]).toMatchObject({ service: 'Gel Manicure', technician: 'Lan Nguyễn' });
    expect(o.identity.phone).toBe('(•••) •••-0101');                         // masked: last four only
    const r: any = await rb.customer(ctx(), C.retired, { fullContact: false }, audit);
    expect(r.suggestedService).toMatchObject({ active: false, priceCents: null });
    expect(r.caveats).toContain('service_inactive');
    const soon: any = await rb.customer(ctx(), C.soon, { fullContact: false }, audit);
    expect(soon.technician).toMatchObject({ id: MAI, preferred: true, active: false });
    expect(soon.caveats).toContain('preferred_technician_inactive');
  });
});

describe('Rebooking — the review workflow', () => {
  it('RV-01 Mark reviewed moves an opportunity to Reviewed and records history (append-only); no customer or booking changes', async () => {
    const cust = await q(sql`select id, updated_at, archived_at from customers where tenant_id = ${T} order by id`);
    const appts = await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`);
    await rb.review(ctx(), C.due, { action: 'reviewed', note: 'left a voicemail' }, audit);
    expect(await listIds({ tab: 'reviewed' })).toEqual([C.due]);
    expect(await listIds({ tab: 'due_for_review' })).toEqual([C.late, C.retired].sort());
    expect(await listIds({ tab: 'coming_due' })).toEqual([C.soon]);
    expect((await rb.summary(ctx()) as any).metrics).toMatchObject({ dueForReview: 2, reviewed: 1 });
    expect(await q(sql`select id, updated_at, archived_at from customers where tenant_id = ${T} order by id`)).toEqual(cust);
    expect(await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`)).toEqual(appts);
    expect(await code(q(sql`update rebooking_review_events set note = 'x'`))).toMatch(/append-only/);
  });
  it('RV-02 a NEW opportunity returns to Due for Review; a passed deferral returns too', async () => {
    await q(sql`update customer_intelligence_snapshots set rebooking_since = now() + interval '1 day' where customer_id = ${C.due}`);
    expect(await listIds({ tab: 'due_for_review' })).toContain(C.due);
    await rb.review(ctx(), C.late, { action: 'deferred', dueOn: '2020-01-01' }, audit);
    expect(await listIds({ tab: 'due_for_review' })).toContain(C.late);
    await rb.review(ctx(), C.late, { action: 'deferred', dueOn: '2099-01-01' }, audit);
    expect(await listIds({ tab: 'reviewed' })).toContain(C.late);
  });
  it('RV-03 refusals: nothing to review, stale version, a note without text, a disabled assistant', async () => {
    expect(await code(rb.review(ctx(), C.active, { action: 'reviewed' }, audit))).toBe('REBOOKING_NOT_CURRENT');
    expect(await code(rb.review(ctx(), C.late, { action: 'reviewed', expectedVersion: 9 }, audit))).toBe('REBOOKING_STALE_VERSION');
    expect(await code(rb.review(ctx(), C.late, { action: 'note' }, audit))).toBe('REBOOKING_NOTE_REQUIRED');
    enabled = false;
    expect(await code(rb.list(ctx(), {}, { fullContact: false }))).toBe('AI_CUSTOMER_PROFILE_DISABLED');
    enabled = true;
  });
});

describe('Rebooking — Booking Assistant handoff (prefill only)', () => {
  it('HO-01 returns the permitted context and writes ONE booking_started event — never an appointment', async () => {
    const before = await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`);
    const h: any = await rb.handoff(ctx(), C.due, { serviceId: SV.gel, technicianId: LAN }, { fullContact: true }, audit);
    expect(h).toMatchObject({ customerId: C.due, customerName: 'Dee Due', customerPhone: '+14155550101', serviceId: SV.gel, serviceName: 'Gel Manicure', technicianId: LAN });
    expect(h.date >= new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)).toBe(true);   // never a past day
    expect(await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`)).toEqual(before);
    const ev = await q(sql`select event_type, service_id, technician_id from rebooking_review_events where customer_id = ${C.due} and event_type = 'booking_started'`);
    expect(ev).toEqual([{ event_type: 'booking_started', service_id: SV.gel, technician_id: LAN }]);
    // without contact access the phone is not sent (the assistant asks staff to enter it)
    expect((await rb.handoff(ctx(), C.due, {}, { fullContact: false }, audit) as any).customerPhone).toBeNull();
  });
  it('HO-02 re-checks the LIVE calendar: a booking made since the evaluation blocks a second booking and shows as Already Booked', async () => {
    await appt(C.late, 4, 'confirmed');
    const e: any = await rb.handoff(ctx(), C.late, {}, { fullContact: false }, audit).catch((x) => x);
    expect(e).toBeInstanceOf(RebookingError);
    expect(e.code).toBe('REBOOKING_ALREADY_BOOKED');
    expect(e.details.nextAppointmentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await listIds({ tab: 'booked' })).toEqual([C.booked, C.late].sort());
    const row = (await rb.list(ctx(), { tab: 'booked', q: 'lee' }, { fullContact: false })).items[0] as any;
    expect(row).toMatchObject({ state: 'booked', booking: { upcoming: true, bookedSinceEvaluation: true } });
    expect((await rb.summary(ctx()) as any).metrics).toMatchObject({ bookedSinceEvaluation: 1 });
  });
  it('HO-03 refusals: no current opportunity, inactive service, inactive technician, another salon', async () => {
    expect(await code(rb.handoff(ctx(), C.active, {}, { fullContact: false }, audit))).toBe('REBOOKING_NOT_CURRENT');
    expect(await code(rb.handoff(ctx(), C.retired, { serviceId: SV.old }, { fullContact: false }, audit))).toBe('REBOOKING_SERVICE_INACTIVE');
    expect(await code(rb.handoff(ctx(), C.soon, { technicianId: MAI }, { fullContact: false }, audit))).toBe('REBOOKING_TECHNICIAN_INACTIVE');
    expect(await code(rb.handoff(ctx(), C.other, {}, { fullContact: false }, audit))).toBe('CUSTOMER_NOT_FOUND');
  });
});

describe('Rebooking — list, security, health', () => {
  it('LS-01 search, service / technician filters, date dimensions, newest-first with stable pages', async () => {
    expect(await listIds({ tab: 'all', q: 'sun' })).toEqual([C.soon]);
    expect(await listIds({ tab: 'all', serviceId: SV.pedi })).toEqual([C.soon]);
    expect(await listIds({ tab: 'all', technicianId: MAI })).toEqual([C.soon]);
    expect((await rb.list(ctx(), { tab: 'all', preset: 'custom', from: '2020-01-01', to: '2020-12-31' }, { fullContact: false })).total).toBe(0);
    expect(await listIds({ tab: 'insufficient' })).toEqual([C.single]);
    expect(await code(rb.list(ctx(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, { fullContact: false }))).toBe('REBOOKING_INVALID_PERIOD');
    expect(await code(rb.list(ctx(), { serviceId: 'nope' }, { fullContact: false }))).toBe('REBOOKING_INVALID_FILTER');
    const p1 = await rb.list(ctx(), { tab: 'all', pageSize: 10 }, { fullContact: false });
    const since = p1.items.map((i: any) => i.opportunitySince ?? '');
    expect([...since].sort().reverse()).toEqual(since);                    // newest opportunity first
    expect(p1.items[0].id).toBe(C.due);                                    // the newest (re-created in RV-02)
    const row = p1.items.find((i: any) => i.id === C.soon) as any;
    expect(row).toMatchObject({ state: 'coming_due', lastService: 'Pedicure', lastTechnician: 'Mai Trần', suggestedService: { id: SV.pedi, active: true } });
  });
  it('SC-01 another salon\'s customer is not found (read or review); the overlay open is audited', async () => {
    expect(await code(rb.customer(ctx(), C.other, { fullContact: false }, audit))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(rb.review(ctx(), C.other, { action: 'note', note: 'x' }, audit))).toBe('CUSTOMER_NOT_FOUND');
    audits.length = 0;
    await rb.customer(ctx(), C.soon, { fullContact: false }, audit);
    expect(audits).toEqual([{ customerId: C.soon, state: 'coming_due' }]);
  });
  it('RV-04 history is newest first and includes the handoffs', async () => {
    const h = await rb.history(ctx(), {});
    const at = h.items.map((e: any) => e.at);
    expect([...at].sort().reverse()).toEqual(at);
    expect((await rb.history(ctx(), { type: 'booking_started' })).total).toBe(2);
  });
  it('HL-01 the check reconciles with Customer Intelligence, flags bookings since the evaluation, and changes nothing', async () => {
    const before = await q(sql`select (select count(*) from rebooking_reviews)::int a, (select count(*) from rebooking_review_events)::int b, (select count(*) from pos_tech_appointments)::int c`);
    const r: any = await rb.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.intelligence_agreement.state).toBe('PASSED');
    expect(by.bookings_since_evaluation).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.services_catalog).toMatchObject({ state: 'PASSED', count: 2 });
    expect(by.technicians_active).toMatchObject({ state: 'PASSED', count: 1 });
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.opportunity_dates.state).toBe('PASSED');
    expect(await q(sql`select (select count(*) from rebooking_reviews)::int a, (select count(*) from rebooking_review_events)::int b, (select count(*) from pos_tech_appointments)::int c`)).toEqual(before);
    expect((await rb.check(ctx()) as any).reused).toBe(true);
  });
});
