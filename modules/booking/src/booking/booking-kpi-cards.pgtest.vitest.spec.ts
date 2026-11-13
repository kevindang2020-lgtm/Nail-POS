// booking-kpi-cards.pgtest — booking200 addendum §08 (round 12): the Booking page's six KPI cards (Appointments, Arriving
// soon, Walk-ins, Waitlist, Available now, Booked revenue) from their REAL sources on the real schema (PGlite, all
// migrations): pos_tech_appointments (one count per appointment, never per service line), the live Customer Queue
// (pos_queue_items), the technician roster + schedules. Another date → the "now" cards are 'not_today'; a source that
// cannot be read → that card is 'unavailable' (null), never 0. Fixed dates; the branch clock is pinned on the instance.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService } from './booking.service';

const u = (x: string) => `a9850000-0000-4000-8000-${x.padStart(12, '0')}`;
const T = u('1'), B = u('2'), B2 = u('3'), T2 = u('4');
const CAT = u('c1'), GEL = u('51'), PEDI = u('52');
const A = u('a1'), BT = u('b1'), C = u('c9'), D = u('d1');
const DAY = '2026-11-02';            // a Monday (day_of_week 1), America/New_York (EST)
const ctx = { tenantId: T, branchId: B, userId: 'u-front-desk', role: 'MANAGER', permissions: ['pos.booking.view'] };
let pg: any; let repo: KyselyBookingRepository; let svc: BookingService;
const appt: Record<string, string> = {};

async function addAppt(key: string, tech: string, start: string, end: string, status: string, source: string, lines: { name: string; cents: number; min: number }[]) {
  const services = JSON.stringify(lines.map((l, i) => ({ serviceId: i === 0 ? GEL : PEDI, serviceName: l.name, durationMinutes: l.min, priceCents: l.cents })));
  const dur = lines.reduce((a, l) => a + l.min, 0);
  const r = await pg.query(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, source, appt_date, start_time, end_time, duration_minutes, status, deposit_status, is_vip)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,'not_required',false) RETURNING id`, [T, B, tech, 'Guest ' + key, services, source, DAY, start, end, dur, status]);
  appt[key] = r.rows[0].id;
}

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'KPI Salon', 'KPI Salon', 'kpi-salon-985', 'KPI985', 'active'),
      ('${T2}', 'Other Salon', 'Other Salon', 'kpi-other-985', 'KPO985', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active'), ('${B2}', '${T}', 'Second', 'active'), ('${u('5')}', '${T2}', 'Other', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Nails');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES
      ('${GEL}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 45, 4500, 'active'), ('${PEDI}', '${T}', '${B}', '${CAT}', 'Spa Pedicure', 60, 5000, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${A}', '${T}', '${B}', 'Ann', 'A', 'Ann A', 'active', true),
      ('${BT}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active', true),
      ('${C}', '${T}', '${B}', 'Cy', 'C', 'Cy C', 'active', true),
      ('${D}', '${T}', '${B}', 'Dee', 'D', 'Dee D', 'inactive', false);
    INSERT INTO technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) VALUES
      ('${T}', '${B}', '${A}', 1, '09:00', '19:00', true), ('${T}', '${B}', '${BT}', 1, '09:00', '19:00', true), ('${T}', '${B}', '${C}', 1, '09:00', '19:00', false);
  `);
  await addAppt('inService', A, '09:30', '10:30', 'in_service', 'manual', [{ name: 'Gel Manicure', cents: 4500, min: 60 }]);   // Ann is busy at 10:00
  await addAppt('soonBooked', BT, '10:15', '11:00', 'booked', 'phone', [{ name: 'Gel Manicure', cents: 4500, min: 45 }]);
  await addAppt('soonConfirmed', BT, '11:00', '12:15', 'confirmed', 'online', [{ name: 'Spa Pedicure', cents: 5000, min: 60 }, { name: 'Gel add-on', cents: 1500, min: 15 }]);   // 2 lines, 1 appointment
  await addAppt('later', A, '11:30', '12:15', 'booked', 'manual', [{ name: 'Gel Manicure', cents: 4500, min: 45 }]);
  await addAppt('walkDone', A, '08:00', '08:45', 'completed', 'walk_in', [{ name: 'Gel Manicure', cents: 4500, min: 45 }]);
  await addAppt('walkCancelled', BT, '12:30', '13:15', 'cancelled', 'walk_in', [{ name: 'Gel Manicure', cents: 4500, min: 45 }]);
  await addAppt('noShow', A, '13:00', '14:00', 'no_show', 'phone', [{ name: 'Spa Pedicure', cents: 5000, min: 60 }]);
  await addAppt('arrived', BT, '09:00', '09:45', 'arrived', 'manual', [{ name: 'Gel Manicure', cents: 4500, min: 45 }]);
  await pg.query(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, source, status, appointment_id, checked_in_at) VALUES
    ($1,$2,'Q waiting 1','walk_in','waiting',NULL,'2026-11-02 09:50:00-05'),
    ($1,$2,'Q waiting 2','walk_in','waiting',NULL,'2026-11-02 09:55:00-05'),
    ($1,$2,'Q serving','walk_in','in_service',NULL,'2026-11-02 09:10:00-05'),
    ($1,$2,'Q cancelled','walk_in','cancelled',NULL,'2026-11-02 09:20:00-05'),
    ($1,$2,'Q appointment','appointment','called',$4,'2026-11-02 08:58:00-05'),
    ($1,$2,'Q yesterday','walk_in','completed',NULL,'2026-11-01 15:00:00-05'),
    ($1,$2,'Q late last night','walk_in','completed',NULL,'2026-11-02 04:30:00+00'),
    ($1,$3,'Q other branch','walk_in','waiting',NULL,'2026-11-02 09:50:00-05'),
    ($5,$6,'Q other salon','walk_in','waiting',NULL,'2026-11-02 09:50:00-05')`, [T, B, B2, appt.arrived, T2, u('5')]);
  repo = new KyselyBookingRepository(kyselyFor(pg) as never);
  // the branch's clock, pinned: Monday 10:00 in New York (the KPI rules read today / now from here)
  (repo as any).clock = async () => ({ today: DAY, nowMinute: 600, timeZone: 'America/New_York' });
  svc = new BookingService(repo);
}, 120000);

describe('GET /pos/booking/kpi-cards — six cards from real sources (booking200 §08)', () => {
  it('Appointments counts canonical appointments (not service lines), cancelled / no-show excluded, with its status split', async () => {
    const k = await svc.kpiCards(ctx as never, { date: DAY });
    expect(k).toMatchObject({ date: DAY, today: DAY, isToday: true, timeZone: 'America/New_York', arrivingWindowMinutes: 60 });
    expect(k.appointments).toEqual({ state: 'ok', value: 6, awaitingConfirmation: 2, confirmed: 1, inSalon: 2, completed: 1 });
  });
  it('Arriving soon = booked / confirmed starting within the window from now; the window is configurable and bounded', async () => {
    expect((await svc.kpiCards(ctx as never, { date: DAY })).arrivingSoon).toEqual({ state: 'ok', value: 2 });                       // 10:15, 11:00
    expect((await svc.kpiCards(ctx as never, { date: DAY, arrivingWindowMinutes: 90 })).arrivingSoon).toEqual({ state: 'ok', value: 3 });   // + 11:30
    expect((await svc.kpiCards(ctx as never, { date: DAY, arrivingWindowMinutes: 10 })).arrivingSoon).toEqual({ state: 'ok', value: 0 });   // a REAL zero
    expect((await svc.kpiCards(ctx as never, { date: DAY, arrivingWindowMinutes: 100000 })).arrivingWindowMinutes).toBe(240);
    expect((await svc.kpiCards(ctx as never, { date: DAY, arrivingWindowMinutes: 1 })).arrivingWindowMinutes).toBe(5);
    expect((await svc.kpiCards(ctx as never, { date: DAY, arrivingWindowMinutes: Number.NaN })).arrivingWindowMinutes).toBe(60);
  });
  it('Walk-ins = live walk-in appointments + the day\'s Customer Queue walk-in visits that are not an appointment\'s entry (branch + tenant scoped)', async () => {
    const k = await svc.kpiCards(ctx as never, { date: DAY });
    // appointments: the completed walk-in (the cancelled one does not count); queue: waiting ×2 + in service — not the
    // cancelled one, not the appointment's check-in, not yesterday's (incl. 04:30 UTC = 23:30 the day before in New York),
    // not another branch's, not another salon's
    expect(k.walkIns).toEqual({ state: 'ok', value: 4, fromAppointments: 1, fromQueue: 3 });
  });
  it('Waitlist = guests WAITING in this branch\'s live Customer Queue now (no page cap — it used to be the length of a 6-row page)', async () => {
    expect((await svc.kpiCards(ctx as never, { date: DAY })).waitlist).toEqual({ state: 'ok', value: 2 });
    for (let i = 0; i < 9; i++) await pg.query(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, source, status, checked_in_at) VALUES ($1,$2,$3,'walk_in','waiting','2026-11-02 09:59:00-05')`, [T, B, 'Extra ' + i]);
    expect((await svc.kpiCards(ctx as never, { date: DAY })).waitlist).toEqual({ state: 'ok', value: 11 });
    await pg.query(`DELETE FROM pos_queue_items WHERE tenant_id = $1 AND customer_name LIKE 'Extra %'`, [T]);
  });
  it('Available now = active, inside a working window, not in a chair-holding appointment at this minute; working count separate', async () => {
    const k = await svc.kpiCards(ctx as never, { date: DAY });
    // Ann is in service 09:30–10:30, Cy is off on Mondays, Dee is inactive → only Bea
    expect(k.availableNow).toEqual({ state: 'ok', value: 1, workingCount: 2 });
    // the SAME rule as the technician page's availableNowCount
    expect((await svc.technicianPage(ctx as never, { date: DAY })).availableNowCount).toBe(1);
  });
  it('Booked revenue = the booked service subtotal in integer cents (add-on line included; cancelled / no-show excluded), labelled booked', async () => {
    const k = await svc.kpiCards(ctx as never, { date: DAY });
    expect(k.bookedRevenue).toEqual({ state: 'ok', value: 4500 + 4500 + 6500 + 4500 + 4500 + 4500, basis: 'booked_service_subtotal' });
    expect(Number.isInteger(k.bookedRevenue.value)).toBe(true);
  });
  it('another date: the "now" cards are not_today (never a stale today number); the dated cards answer for that date', async () => {
    const k = await svc.kpiCards(ctx as never, { date: '2026-11-03' });
    expect(k.isToday).toBe(false);
    expect(k.arrivingSoon).toEqual({ state: 'not_today', value: null });
    expect(k.waitlist).toEqual({ state: 'not_today', value: null });
    expect(k.availableNow).toEqual({ state: 'not_today', value: null, workingCount: 3 });   // Tuesday: no schedule rows → store hours, 3 active
    expect(k.appointments.value).toBe(0); expect(k.appointments.state).toBe('ok');           // a real, empty day
    expect(k.bookedRevenue).toEqual({ state: 'ok', value: 0, basis: 'booked_service_subtotal' });
    expect(k.walkIns).toEqual({ state: 'ok', value: 0, fromAppointments: 0, fromQueue: 0 });
  });
  it('a source that cannot be read turns ONLY its cards unavailable (null) — never 0; the other cards still answer', async () => {
    const queueCounts = repo.queueCounts.bind(repo);
    (repo as any).queueCounts = async () => { throw new Error('queue read failed'); };
    try {
      const k = await svc.kpiCards(ctx as never, { date: DAY });
      expect(k.waitlist).toEqual({ state: 'unavailable', value: null });
      expect(k.walkIns).toEqual({ state: 'unavailable', value: null, fromAppointments: 1, fromQueue: null });
      expect(k.appointments.value).toBe(6);
    } finally { (repo as any).queueCounts = queueCounts; }
    const query = repo.query.bind(repo);
    (repo as any).query = async () => { throw new Error('appointments read failed'); };
    try {
      const k = await svc.kpiCards(ctx as never, { date: DAY });
      expect(k.appointments).toEqual({ state: 'unavailable', value: null, awaitingConfirmation: null, confirmed: null, inSalon: null, completed: null });
      expect(k.arrivingSoon).toEqual({ state: 'unavailable', value: null });
      expect(k.bookedRevenue).toEqual({ state: 'unavailable', value: null, basis: 'booked_service_subtotal' });
      expect(k.waitlist).toEqual({ state: 'ok', value: 2 });
      expect(k.availableNow.value).toBe(1);
    } finally { (repo as any).query = query; }
  });
  it('without a queue reader (the in-memory dev repository) the queue cards say unavailable, not 0', async () => {
    const queueCounts = repo.queueCounts;
    (repo as any).queueCounts = undefined;
    try { expect((await svc.kpiCards(ctx as never, { date: DAY })).waitlist.state).toBe('unavailable'); }
    finally { (repo as any).queueCounts = queueCounts; }
  });
  it('needs pos.booking.view; read-only (no appointment or queue row changes)', async () => {
    const count = async () => Number((await pg.query(`SELECT (SELECT count(*) FROM pos_tech_appointments WHERE tenant_id = $1) + (SELECT count(*) FROM pos_queue_items WHERE tenant_id = $1) AS n`, [T])).rows[0].n);
    const before = await count();
    await svc.kpiCards(ctx as never, { date: DAY });
    expect(await count()).toBe(before);
    await expect(svc.kpiCards({ ...ctx, permissions: [] } as never, { date: DAY })).rejects.toThrow();
  });
});
