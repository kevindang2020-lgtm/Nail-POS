// customer-timeline-center.pgtest — Customer Timeline guide (Nov 1 2026; migration 762) on the REAL schema.
// IDs follow the guide's acceptance table: CH chronology · GR grouping · AP appointment states · FN financial visibility ·
// SD search/dates · PG pages · SC security · HL health. Every row below is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerTimelineCenter, CustomerTimelineError, tlPresetRange } from './customer-timeline-center';

const P = 'c7620000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), FD = id(11);
const LAN = id(20), MAI = id(21);
const HANG = id(101), OTHER = id(102), MERGED = id(103), XC = id(130);
const APPT = id(301), APPT_NS = id(302), APPT_FUT = id(303), Q1 = id(401), TK1 = id(501), TK_OLD = id(502), TK_B2 = id(503), TK_X = id(504), TK_OPEN = id(505);
const PAY = id(601), GC = id(701), MEM = id(801);
const full = { money: true, messages: true, memberships: true }, plain = { money: false, messages: false, memberships: false };
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.customers.view'] }) as any;
const confinedB2 = () => ({ tenantId: T, branchId: B2, userId: FD, role: 'FRONT_DESK', permissions: ['pos.customers.view'], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
let db: any; let tl: CustomerTimelineCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_trx: any, meta: any) => { audits.push(meta); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CustomerTimelineError ? e.code : `${(e as Error).message}`; } }
const types = (r: any) => r.items.map((e: any) => e.type);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); tl = new CustomerTimelineCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot Nail Salon', 'tl-762', 'TL762', 'active'), (${X}, 'X', 'Other', 'tl-762x', 'TL762X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@tl.test', 'active', 'OWNER')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn'), (${MAI}, ${T}, ${B}, 'Mai', 'Ho', 'Mai Ho')`);
  await q(sql`set session_replication_role = replica`);   // fixtures only: skip FK / cross-salon triggers while seeding
  for (const [cid, tenant, branch, name] of [[HANG, T, B, 'Nguyễn Thị Hằng'], [OTHER, T, B, 'Other Person'], [MERGED, T, B, 'Hang Old'], [XC, X, BX, 'Xena']] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, created_at) values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, 'x', ${name}, 'active', '2025-01-05T15:00:00Z')`);
  // a completed visit today: appointment → check-in → served by two technicians → paid → receipt → points
  await q(sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services, created_at, updated_at)
    values (${APPT}, ${T}, ${B}, ${LAN}, ${HANG}, 'Hang', (now() at time zone 'America/New_York')::date, '10:00', '11:00', 'completed', '[{"name":"Gel Manicure"}]', now() - interval '3 days', now() - interval '2 hours')`);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, tip_cents, ticket_number, created_at, serving_started_at, service_done_at, paid_at)
    values (${TK1}, ${T}, ${B}, ${HANG}, ${LAN}, 'paid', 6500, 1000, 4101, now() - interval '3 hours', now() - interval '170 minutes', now() - interval '130 minutes', now() - interval '2 hours')`);
  await q(sql`insert into pos_queue_items (id, tenant_id, branch_id, customer_id, customer_name, appointment_id, ticket_id, status, checked_in_at, created_at, source)
    values (${Q1}, ${T}, ${B}, ${HANG}, 'Hang', ${APPT}, ${TK1}, 'done', now() - interval '3 hours', now() - interval '3 hours', 'appointment')`);
  await q(sql`insert into pos_queue_status_history (tenant_id, branch_id, queue_item_id, version, from_status, to_status, action, created_at) values (${T}, ${B}, ${Q1}, 2, 'waiting', 'serving', 'start', now() - interval '170 minutes')`);
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, created_at)
    values (${T}, ${B}, ${TK1}, ${id(901)}, 'Gel Manicure', 4500, 45, 4500, ${LAN}, now() - interval '170 minutes'), (${T}, ${B}, ${TK1}, ${id(902)}, 'Nail Art', 2000, 20, 2000, ${MAI}, now() - interval '150 minutes')`);
  await q(sql`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, card_brand, card_last4, approved_at, created_at)
    values (${PAY}, ${T}, ${B}, ${TK1}, 'card', 7500, 1000, 'approved', 'visa', '4242', now() - interval '2 hours', now() - interval '2 hours')`);
  await q(sql`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, created_at) values (${T}, ${B}, ${PAY}, 1000, 'refunded', now() - interval '1 hour')`);
  await q(sql`insert into receipts (tenant_id, branch_id, ticket_id, payment_id, receipt_number, emailed_to, total_cents, created_at) values (${T}, ${B}, ${TK1}, ${PAY}, 'R-4101', 'hang@example.com', 7500, now() - interval '119 minutes')`);
  await q(sql`insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, delta, balance_after, entry_type, source_table, source_id, created_at)
    values (${T}, ${B}, ${HANG}, 'earn', 65, 'checkout', 65, 65, 65, 'earn', 'tickets', ${TK1}, now() - interval '118 minutes')`);
  // a visit from two years ago, imported TODAY: sorts by when it happened
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
    values (${TK_OLD}, ${T}, ${B}, ${HANG}, ${MAI}, 'paid', 3000, 17, now() - interval '5 minutes', now() - interval '730 days')`);
  // a no-show, a future booking, a visit at branch 2, an open ticket, another salon's ticket
  await q(sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services, created_at, updated_at) values
    (${APPT_NS}, ${T}, ${B}, ${MAI}, ${HANG}, 'Hang', (now() at time zone 'America/New_York')::date - 40, '14:00', '15:00', 'no_show', '[{"name":"Pedicure"}]', now() - interval '45 days', now() - interval '40 days'),
    (${APPT_FUT}, ${T}, ${B}, ${LAN}, ${HANG}, 'Hang', (now() at time zone 'America/New_York')::date + 7, '09:00', '10:00', 'booked', '[{"name":"Gel Manicure"}]', now() - interval '1 day', now() - interval '1 day')`);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at) values
    (${TK_B2}, ${T}, ${B2}, ${HANG}, 'paid', 2000, 9001, now() - interval '10 days', now() - interval '10 days'),
    (${TK_OPEN}, ${T}, ${B}, ${OTHER}, 'open', 0, 9002, now(), null),
    (${TK_X}, ${X}, ${BX}, ${XC}, 'paid', 9900, 1, now() - interval '1 day', now() - interval '1 day')`);
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B2}, ${TK_B2}, ${id(903)}, 'Pedicure', 2000, 40, 2000)`);
  // benefits + messages + a merge
  await q(sql`insert into gift_cards (id, tenant_id, branch_id, code, balance_cents, status, customer_id, card_number_last4) values (${GC}, ${T}, ${B}, 'TL-GC', 2500, 'active', ${HANG}, '7788')`);
  await q(sql`insert into gift_card_transactions (tenant_id, branch_id, gift_card_id, type, amount_cents, balance_after_cents, created_at) values (${T}, ${B}, ${GC}, 'issue', 2500, 2500, now() - interval '20 days')`);
  await q(sql`insert into membership_activity (tenant_id, branch_id, customer_membership_id, customer_id, activity_type, plan_name_snapshot, amount_cents, occurred_at) values (${T}, ${B}, ${MEM}, ${HANG}, 'renewed', 'Gold', 4900, now() - interval '15 days')`);
  await q(sql`insert into customer_notifications (tenant_id, customer_id, type, title, body, created_at) values (${T}, ${HANG}, 'receipt', 'Your receipt', 'Thanks for visiting — total $75', now() - interval '119 minutes')`);
  await q(sql`insert into appointment_reminders_sent (tenant_id, branch_id, appointment_id, customer_id, state, channel, lead_minutes, reminded_at, created_at) values (${T}, ${B}, ${APPT}, ${HANG}, 'submitted', 'sms', 1440, now() - interval '1 day', now() - interval '1 day')`);
  await q(sql`insert into customer_merge_logs (tenant_id, branch_id, source_customer_id, target_customer_id, merge_summary_json, created_at) values (${T}, ${B}, ${MERGED}, ${HANG}, '{}', now() - interval '30 days')`);
  await q(sql`set session_replication_role = origin`);
});

describe('Customer Timeline — events from their own sources', () => {
  it('CH-01 newest real occurrence first; a visit imported today keeps its two-year-old date; "recently added" puts it first', async () => {
    const r = await tl.events(owner(), HANG, { pageSize: 100 }, full);
    const occ = r.items.map((e: any) => e.occurredAt);
    expect([...occ].sort().reverse()).toEqual(occ);
    expect(r.items[r.items.length - 1].id).toBe(`ticket:${TK_OLD}:completed`);   // the oldest real occurrence is last, though it was recorded today
    const old = r.items.findIndex((e: any) => e.id === `ticket:${TK_OLD}:completed`);
    expect(old).toBeGreaterThan(r.items.findIndex((e: any) => e.id === `ticket:${TK1}:completed`));
    const recent = await tl.events(owner(), HANG, { sort: 'recently_added', pageSize: 3 }, full);
    expect(recent.items[0].id).toBe(`ticket:${TK_OLD}:completed`);
  });
  it('GR-01 the appointment, check-in, queue, service, payment, receipt, refund and points of one visit share one visit reference', async () => {
    const r = await tl.events(owner(), HANG, { pageSize: 100 }, full);
    const visit = r.items.filter((e: any) => e.groupRef === `ticket:${TK1}`).map((e: any) => e.type).sort();
    expect(visit).toEqual(['appointment_booked', 'appointment_completed', 'checked_in', 'loyalty_earn', 'payment_approved', 'queue_serving', 'receipt_issued', 'refund_refunded', 'service_done', 'service_started', 'visit_completed'].sort());
    expect(new Set(r.items.map((e: any) => e.id)).size).toBe(r.items.length);   // every source record once — no replays
  });
  it('AP-01 a booking and its later status are separate events; a no-show and a future booking keep their own state', async () => {
    const r = await tl.events(owner(), HANG, { family: 'appointment', pageSize: 100 }, full);
    expect(types(r)).toEqual(expect.arrayContaining(['appointment_booked', 'appointment_no_show', 'appointment_completed']));
    expect(r.items.filter((e: any) => e.refId === APPT_FUT).map((e: any) => e.type)).toEqual(['appointment_booked']);
    expect(r.items.every((e: any) => e.family === 'appointment')).toBe(true);
  });
  it('FN-01 money, card details and message text are hidden without the role; nothing is recalculated', async () => {
    const plainR = await tl.events(owner(), HANG, { pageSize: 100 }, plain);
    const pay = plainR.items.find((e: any) => e.id === `pay:${PAY}`);
    expect(pay).toMatchObject({ amountCents: null, amountHidden: true });
    expect(pay.meta.cardLast4).toBeUndefined();
    expect(plainR.items.find((e: any) => e.family === 'communication' && e.type === 'notification_receipt').meta.body).toBeUndefined();
    expect(plainR.items.find((e: any) => e.type === 'receipt_issued').meta.emailTo).toMatch(/^h•••@example\.com$/);
    expect(plainR.items.find((e: any) => e.type === 'loyalty_earn').meta.points).toBe(65);          // points are not money
    const fullR = await tl.events(owner(), HANG, { pageSize: 100 }, full);
    expect(fullR.items.find((e: any) => e.id === `pay:${PAY}`)).toMatchObject({ amountCents: 7500, meta: { cardLast4: '4242' } });
    expect(fullR.items.find((e: any) => e.type === 'membership_renewed')).toMatchObject({ amountCents: 4900, meta: { plan: 'Gold' } });
  });
  it('GR-02 the event detail re-reads the source: both technicians and both services of the visit, audited', async () => {
    audits.length = 0;
    const d: any = await tl.event(owner(), HANG, `pay:${PAY}`, full, audit);
    expect(d.visit.services.map((s: any) => `${s.service}/${s.technician}`)).toEqual(['Gel Manicure/Lan Nguyễn', 'Nail Art/Mai Ho']);
    expect(d.visit.technicians).toEqual(['Lan Nguyễn', 'Mai Ho']);
    expect(d.visit.totals).toMatchObject({ totalCents: 6500 });
    expect(audits).toEqual([expect.objectContaining({ customerId: HANG, eventId: `pay:${PAY}` })]);
    expect((await tl.event(owner(), HANG, `pay:${PAY}`, plain, audit) as any).visit.totals).toBeNull();
  });
  it('PR-01 profile, merge, gift card and reminder events come from their owners', async () => {
    const r = await tl.events(owner(), HANG, { pageSize: 100 }, full);
    expect(r.items.find((e: any) => e.type === 'profile_merged_in').meta.otherCustomerId).toBe(MERGED);
    expect(r.items.find((e: any) => e.type === 'gift_card_issue').meta.last4).toBe('7788');
    expect(r.items.find((e: any) => e.type === 'reminder_submitted')).toMatchObject({ groupRef: `appt:${APPT}`, meta: { channel: 'sms' } });
  });
});

describe('Customer Timeline — search, dates, pages', () => {
  it('SD-01 search inside the history: ticket number, technician without accents, service name, appointment id', async () => {
    expect((await tl.events(owner(), HANG, { q: '4101' }, full)).items.every((e: any) => e.meta.ticketNumber === 4101 || e.meta.ticketNumber === '4101')).toBe(true);
    const byTech = await tl.events(owner(), HANG, { q: 'lan nguyen', pageSize: 100 }, full);
    expect(byTech.items.map((e: any) => e.id)).toContain(`ticket:${TK1}:completed`);
    expect(byTech.items.map((e: any) => e.id)).not.toContain(`ticket:${TK_OLD}:completed`);
    expect((await tl.events(owner(), HANG, { q: 'pedicure', pageSize: 100 }, full)).items.map((e: any) => e.refId)).toEqual(expect.arrayContaining([APPT_NS, TK_B2]));
    expect((await tl.events(owner(), HANG, { q: APPT_FUT }, full)).items.map((e: any) => e.type)).toEqual(['appointment_booked']);
    expect(await code(tl.events(owner(), HANG, { q: 'x' }, full))).toBe('TIMELINE_SEARCH_TOO_SHORT');
  });
  it('SD-02 date ranges in the salon\'s days; appointment-date dimension; reversed range refused', async () => {
    expect(tlPresetRange('last_90', '2026-11-02')).toEqual({ from: '2026-08-05', to: '2026-11-02' });
    const today = await tl.events(owner(), HANG, { preset: 'today', pageSize: 100 }, full);
    expect(today.items.map((e: any) => e.id)).not.toContain(`ticket:${TK_OLD}:completed`);
    expect(today.items.map((e: any) => e.id)).toContain(`ticket:${TK1}:completed`);
    const old = await tl.events(owner(), HANG, { preset: 'custom', from: '2020-01-01', to: '2025-12-31', pageSize: 100 }, full);
    expect(old.items.map((e: any) => e.id)).toContain(`ticket:${TK_OLD}:completed`);
    const future = await tl.events(owner(), HANG, { dateField: 'appointment', preset: 'custom', from: '2026-01-01', to: '2030-12-31', pageSize: 100 }, full);
    expect(future.items.every((e: any) => e.family === 'appointment')).toBe(true);
    expect(await code(tl.events(owner(), HANG, { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, full))).toBe('TIMELINE_INVALID_PERIOD');
  });
  it('PG-01 stable numbered pages with a real total', async () => {
    const p1 = await tl.events(owner(), HANG, { pageSize: 10 }, full);
    const p2 = await tl.events(owner(), HANG, { pageSize: 10, page: 2 }, full);
    expect(p1.total).toBeGreaterThan(10);
    expect(p1.totalPages).toBe(Math.ceil(p1.total / 10));
    expect(p2.items.filter((e: any) => p1.items.some((x: any) => x.id === e.id))).toEqual([]);
  });
});

describe('Customer Timeline — security and health', () => {
  it('SC-01 another salon\'s customer, an unknown id and another customer\'s event are all "not found"', async () => {
    expect(await code(tl.events(owner(), XC, {}, full))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(tl.events(owner(), 'nope', {}, full))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(tl.event(owner(), OTHER, `pay:${PAY}`, full, audit))).toBe('TIMELINE_EVENT_NOT_FOUND');
    expect(await code(tl.event(owner(), HANG, `pay:${PAY}' or 1=1 --`, full, audit))).toBe('TIMELINE_EVENT_NOT_FOUND');
  });
  it('SC-02 a branch-confined user sees only events of their branches (and the customer only via activity there)', async () => {
    const r = await tl.events(confinedB2(), HANG, { pageSize: 100 }, full);
    expect(r.items.filter((e: any) => e.branch).every((e: any) => e.branch.id === B2)).toBe(true);
    expect(r.items.map((e: any) => e.id)).toContain(`ticket:${TK_B2}:completed`);
    expect(r.items.map((e: any) => e.id)).not.toContain(`ticket:${TK1}:completed`);
    expect(await code(tl.events(confinedB2(), OTHER, {}, full))).toBe('CUSTOMER_NOT_FOUND');
  });
  it('HL-01 the health check reads every source, explains chronology, and changes nothing', async () => {
    const before = await q(sql`select (select count(*) from tickets) t, (select count(*) from pos_tech_appointments) a, (select count(*) from loyalty_ledger) l, (select count(*) from payments) p`);
    const r: any = await tl.check(owner());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.sources.state).toBe('PASSED');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.chronology.detail.backfilledKeepOwnDate).toBeGreaterThanOrEqual(1);
    expect(by.visits_without_services.state).toBe('PASSED');      // the old visit without service lines is outside the 90-day window
    expect(by.indexes.state).toBe('PASSED');
    expect(by.duplicates.state).toBe('INSUFFICIENT_DATA');         // Duplicate Review never scanned in this salon
    expect(await q(sql`select (select count(*) from tickets) t, (select count(*) from pos_tech_appointments) a, (select count(*) from loyalty_ledger) l, (select count(*) from payments) p`)).toEqual(before);
    expect((await tl.check(owner()) as any).reused).toBe(true);
  });
});
