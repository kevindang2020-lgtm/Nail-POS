// appointment-history-center.pgtest — Appointment History SUNMI guide (Nov 9 2026) on the REAL schema.
// AH = cards / list / scope / dates / health. Every appointment below is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AppointmentHistoryCenter, AppointmentHistoryError } from './appointment-history-center';

const P = 'c8440000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20), MAI = id(21), XT = id(22);
const C = { hang: id(101), bo: id(102), xena: id(103) };
let db: any; let ah: AppointmentHistoryCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.customers.view'] }) as any;
const confinedB2 = () => ({ tenantId: T, branchId: B2, userId: OWNER, role: 'FRONT_DESK', permissions: ['pos.customers.view'], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof AppointmentHistoryError ? e.code : (e as Error).message; } }
let n = 0;
async function appt(o: { cust?: string; tech?: string; days: number; status?: string; branch?: string; tenant?: string; createdDaysAgo?: number; service?: string }) {
  const aid = id(500 + ++n);
  await q(sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services, created_at)
    values (${aid}, ${o.tenant ?? T}, ${o.branch ?? B}, ${o.tech ?? LAN}, ${o.cust ?? C.hang}, 'x', (now() at time zone 'America/New_York')::date + ${o.days}::int, '10:00', '11:00', ${o.status ?? 'booked'},
      ${JSON.stringify([{ name: o.service ?? 'Gel Manicure' }])}::jsonb, now() - (${String(o.createdDaysAgo ?? 0)} || ' days')::interval)`);
  return aid;
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); ah = new AppointmentHistoryCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'ah-844', 'AH844', 'active'), (${X}, 'X', 'Other', 'ah-844x', 'AH844X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Tran', 'Lan Tran'), (${MAI}, ${T}, ${B2}, 'Mai', 'Ho', 'Mai Ho'), (${XT}, ${X}, ${BX}, 'Xavier', 'X', 'Xavier X')`);
  for (const [cid, name, tenant] of [[C.hang, 'Nguyễn Thị Hằng', T], [C.bo, 'Bo Tran', T], [C.xena, 'Xena Other', X]] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${cid}, ${tenant}, ${tenant === T ? B : BX}, 'a', 'b', ${name}, ${'+1609555' + cid.slice(-4)}, 'active')`);
  const a1 = await appt({ days: 3 });                                           // upcoming
  await appt({ days: -2, status: 'completed', createdDaysAgo: 10 });           // completed
  const a3 = await appt({ days: -1, status: 'cancelled', cust: C.bo, createdDaysAgo: 5 });
  await appt({ days: -4, status: 'no_show', cust: C.bo, createdDaysAgo: 8, service: 'Pedicure' });
  await appt({ days: -6, status: 'booked', createdDaysAgo: 9 });               // past but still booked: NOT a no-show, NOT upcoming
  await appt({ days: 1, branch: B2, tech: MAI, cust: C.bo });                   // the second branch
  await appt({ days: 2, tenant: X, branch: BX, tech: XT, cust: C.xena });       // another salon
  await q(sql`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value) values
    (${T}, ${B}, ${a1}, 'rescheduled', 'start_time', '09:00', '10:00'), (${T}, ${B}, ${a1}, 'rescheduled', 'appt_date', 'x', 'y'),
    (${T}, ${B}, ${a3}, 'status_changed', 'status', 'booked', 'cancelled')`);
}, 180_000);

describe('Appointment History workspace', () => {
  it('AH-01 the six cards: explicit statuses only; a past "booked" is neither upcoming nor a no-show; a move is rescheduled, not canceled', async () => {
    const s = await ah.summary(owner());
    expect(s.cards).toEqual({ appointments: 6, upcoming: 2, completed: 1, canceled: 1, noShows: 1, rescheduled: 1 });
  });
  it('AH-02 the table: newest created first, services named, technician named, reschedule count; another salon never appears', async () => {
    const r = await ah.list(owner(), {});
    expect(r.total).toBe(6);
    expect(r.items.map((i) => i.createdAt!).every((v, i, a) => i === 0 || a[i - 1] >= v)).toBe(true);
    const first = r.items.find((i) => i.rescheduled === 2)!;
    expect(first).toMatchObject({ services: 'Gel Manicure', technician: 'Lan Tran', status: 'booked', customer: 'Nguyễn Thị Hằng' });
    expect(r.items.every((i) => i.phone == null || i.phone.startsWith('(•••)'))).toBe(true);
  });
  it('AH-03 status / search / technician filters; upcoming sorts soonest first', async () => {
    expect((await ah.list(owner(), { status: 'no_show' })).items.map((i) => i.services)).toEqual(['Pedicure']);
    expect((await ah.list(owner(), { status: 'rescheduled' })).total).toBe(1);
    expect((await ah.list(owner(), { q: 'hang' })).total).toBe(3);                       // accent-insensitive (Hằng's three)
    expect((await ah.list(owner(), { q: 'pedicure' })).total).toBe(1);
    expect((await ah.list(owner(), { technician: MAI })).total).toBe(1);
    const up = await ah.list(owner(), { status: 'upcoming', sort: 'upcoming' });
    expect(up.items.map((i) => i.date)).toEqual([...up.items.map((i) => i.date)].sort());
    expect(await code(ah.list(owner(), { q: 'a' }))).toBe('APPOINTMENT_HISTORY_SEARCH_TOO_SHORT');
  });
  it('AH-04 which date: scheduled vs created vs canceled; the cards follow the same filters', async () => {
    expect((await ah.summary(owner(), { preset: 'today', dateField: 'created' })).cards.appointments).toBe(2);   // created today: the upcoming one + B2
    expect((await ah.list(owner(), { preset: 'today', dateField: 'canceled' })).items.map((i) => i.status)).toEqual(['cancelled']);
    expect(await code(ah.list(owner(), { preset: 'custom', from: '2026-11-09', to: '2026-11-01' }))).toBe('APPOINTMENT_HISTORY_INVALID_PERIOD');
  });
  it('AH-05 a branch-confined role sees only its branch', async () => {
    const s = await ah.summary(confinedB2());
    expect(s.cards.appointments).toBe(1);
    expect((await ah.list(confinedB2(), {})).items.map((i) => i.technician)).toEqual(['Mai Ho']);
  });
  it('AH-06 the health check is read-only and names a past appointment still open', async () => {
    const h = await ah.check(owner());
    expect(h.checks.find((c) => c.key === 'past_open_appointments')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(h.checks.map((c) => c.key)).toContain('no_side_effects');
    // extras arc (Nov 10 2026): an upcoming booking whose deposit failed is named; none in this fixture
    expect(h.checks.find((c) => c.key === 'deposit_failed_upcoming')).toMatchObject({ state: 'READY', count: 0 });
  });
});

describe('Appointment History 04 — change & source evidence on each row (read-only)', () => {
  it('each listed appointment carries its recorded changes, newest first, with who and which path; another salon\'s log never appears', async () => {
    const r0 = await ah.list(owner(), {});
    const moved = r0.items.find((i) => i.rescheduled === 2)!;
    await q(sql`insert into users (id, tenant_id, email, full_name, role, status) values (${id(11)}, ${T}, 'desk@ah.test', 'Dana Desk', 'FRONT_DESK', 'active')`);
    await q(sql`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, actor_type, actor_id, source, created_at) values
      (${T}, ${B}, ${moved.id}, 'assigned', 'technician_id', null, 'Lan Tran', 'user', ${id(11)}, 'pos_booking', now() + interval '1 minute'),
      (${X}, ${BX}, ${moved.id}, 'cancelled', 'status', 'booked', 'cancelled', 'user', null, 'other_salon', now() + interval '2 minutes')`);
    const before = (await q(sql`select count(*)::int as n from appointment_change_log where tenant_id = ${T}`))[0].n;
    const row = (await ah.list(owner(), {})).items.find((i) => i.id === moved.id)!;
    const ch = row.changes!.map((c) => [c.changeType, c.field, c.oldValue, c.newValue]);
    expect(ch[0]).toEqual(['assigned', 'technician_id', null, 'Lan Tran']);   // newest first (the two moves share one timestamp)
    expect(ch.slice(1).sort()).toEqual([['rescheduled', 'appt_date', 'x', 'y'], ['rescheduled', 'start_time', '09:00', '10:00']]);
    expect(row.changes![0]).toMatchObject({ actor: 'Dana Desk', actorType: 'user', source: 'pos_booking' });
    expect(row.changes!.some((c) => c.source === 'other_salon')).toBe(false);
    expect((await ah.list(owner(), {})).items.find((i) => i.rescheduled === 0 && i.status === 'completed')!.changes).toEqual([]);
    expect((await q(sql`select count(*)::int as n from appointment_change_log where tenant_id = ${T}`))[0].n).toBe(before);
  });
});

describe('Appointment History 02 — booking-to-history accuracy (read-only)', () => {
  it('names an upcoming booking with an archived technician and one whose status differs from its last logged status', async () => {
    const before = await ah.check(owner());
    expect(before.checks.find((c) => c.key === 'inactive_technician')).toMatchObject({ state: 'READY', count: 0 });
    expect(before.checks.find((c) => c.key === 'status_log_mismatch')).toMatchObject({ state: 'READY', count: 0 });   // a3: cancelled + logged cancelled
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, archived_at) values (${id(23)}, ${T}, ${B}, 'Old', 'Tech', 'Old Tech', false, now())`);
    await appt({ days: 5, tech: id(23) });                                        // upcoming, technician archived
    await appt({ days: -5, tech: id(23), status: 'completed', createdDaysAgo: 6 }); // past: history, not a problem
    const drifted = await appt({ days: -3, status: 'completed', createdDaysAgo: 4 });
    await q(sql`insert into appointment_change_log (tenant_id, branch_id, appointment_id, change_type, field, old_value, new_value, created_at) values
      (${T}, ${B}, ${drifted}, 'status_changed', 'status', 'booked', 'completed', now() - interval '2 hours'),
      (${T}, ${B}, ${drifted}, 'status_changed', 'status', 'completed', 'no_show', now() - interval '1 hour')`);   // last logged: no_show
    const rows = (await q(sql`select id, status from pos_tech_appointments where tenant_id = ${T} order by id`));
    const h = await ah.check(owner());
    expect(h.checks.find((c) => c.key === 'inactive_technician')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(h.checks.find((c) => c.key === 'status_log_mismatch')).toMatchObject({ state: 'WARNING', count: 1 });
    expect(h.overall).toBe('WARNING');
    expect(await q(sql`select id, status from pos_tech_appointments where tenant_id = ${T} order by id`)).toEqual(rows);   // read-only
    // a branch-confined role does not see the main branch's drift
    const c2 = await ah.check(confinedB2());
    expect(c2.checks.find((c) => c.key === 'status_log_mismatch')).toMatchObject({ count: 0 });
    expect(c2.checks.find((c) => c.key === 'inactive_technician')).toMatchObject({ count: 0 });
  });
  it('Service Done cross-check: a ticket done while its booking is still open, or a completed booking whose ticket never finished', async () => {
    expect((await ah.check(owner())).checks.find((c) => c.key === 'service_done_mismatch')).toMatchObject({ state: 'READY', count: 0 });
    const link = async (aid: string, done: boolean, removed = false) => {
      const tk = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, service_done_at, removed_at)
        values (${T}, ${B}, ${C.hang}, ${done ? 'SERVICE_DONE' : 'IN_SERVICE'}, 0, 0, 0, 0, ${done ? sql`now()` : null}, ${removed ? sql`now()` : null}) returning id`))[0].id;
      await q(sql`insert into pos_tech_queue_tickets (tenant_id, branch_id, ticket_id, customer_id, customer_name, is_vip, source, appointment_id, priority, status, assigned_technician_id, assigned_at)
        values (${T}, ${B}, ${tk}, ${C.hang}, 'Hang', false, 'appointment', ${aid}, 'normal', 'in_service', ${LAN}, now())`);
    };
    await link(await appt({ days: 0, status: 'in_service' }), true);           // ticket done, booking still open
    await link(await appt({ days: -10, status: 'completed' }), false);          // booking completed, ticket never done
    await link(await appt({ days: -11, status: 'completed' }), true);           // agrees
    await link(await appt({ days: 7, status: 'in_service' }), true, true);     // removed ticket: ignored
    const h = await ah.check(owner());
    expect(h.checks.find((c) => c.key === 'service_done_mismatch')).toMatchObject({ state: 'WARNING', count: 2 });
    expect((await ah.check(confinedB2())).checks.find((c) => c.key === 'service_done_mismatch')).toMatchObject({ count: 0 });
  });
});
