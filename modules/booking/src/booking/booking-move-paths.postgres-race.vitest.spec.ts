// booking-move-paths.postgres-race.vitest.spec.ts — Wave 3 (Oct 13 2026), Smooth Refresh / Booking Concurrency spec §7, §9,
// §69, §75, §104 and Kevin's instruction: "Booking conflicts must be blocked immediately by the backend/database at the
// exact moment a booking is created OR MOVED." booking-cross-surface covers creates + reschedules + reassigns from
// three surfaces on one slot. This file covers the MOVE paths it does not:
//   • §69 a DURATION change (add-on / extra service) that lengthens a visit into the next booking — POS Booking board
//     update AND Technician Appointments update — raced against a create of the minutes it needs;
//   • the Booking board's technician change (assign) raced against a create on the new technician;
//   • the CUSTOMER APP's reschedule raced against a POS create and a Technician Appointments reschedule of the same slot;
//   • a POS reschedule raced against a customer-app create of the target slot;
//   • ten devices lengthening ten back-to-back visits into the same 30-minute gap at once → at most ONE may win per gap.
// Every loser gets a typed conflict (never a 500, never a silent success) and the table never holds two chair-holding
// rows that overlap. Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { KyselyTechApptRepository, AppointmentSlotConflict, AppointmentVersionConflict } from '@aipowersalon/appointments';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { KyselyCustomerBookingRepository } from '../customer-booking/customer-booking.kysely.repository';
import { BookingConflictRace, BookingVersionConflict } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a3b40000-0000-4000-8000-0000000000aa';
const B = 'b3b40000-0000-4000-8000-0000000000bb';
const TECH = 'c3b40000-0000-4000-8000-0000000000cc';
const TECH2 = 'c3b40000-0000-4000-8000-0000000000cd';
const CUST = 'd3b40000-0000-4000-8000-0000000000dd';
let db: Kysely<any>; let pool: pg.Pool;
const ctx = { tenantId: T, branchId: B, userId: 'u_move', role: 'MANAGER', permissions: [] } as any;
const svc = (minutes: number) => ({ serviceId: 'svc_' + minutes, serviceName: `Svc ${minutes}`, name: `Svc ${minutes}`, durationMinutes: minutes, priceCents: 4500 }) as any;
const item = (date: string, startTime: string, endTime: string, minutes: number, tech = TECH) => ({
  appointmentId: 'x', technicianId: tech, customerName: 'Walk In', isVip: false, services: [svc(minutes)], source: 'manual', date, startTime, endTime,
  status: 'booked', depositStatus: 'not_required', depositCents: 0, notes: '', createdAt: '', updatedAt: '',
}) as any;
const isTyped = (e: unknown) => e instanceof AppointmentSlotConflict || e instanceof BookingConflictRace || e instanceof BookingVersionConflict || e instanceof AppointmentVersionConflict
  || ['AppointmentSlotConflict', 'BookingConflictRace', 'BookingVersionConflict', 'AppointmentVersionConflict'].includes((e as any)?.name);
const custInsert = (date: string, startTime: string, endTime: string) => async () => {
  const r = await new KyselyCustomerBookingRepository(db as any).insertBookingAtomic({ tenantId: T, branchId: B, technicianId: TECH, customerId: CUST, customerName: 'Cu St', serviceId: randomUUID(), serviceName: 'Gel', durationMinutes: 60, priceCents: 4500, date, startTime, endTime, bufferMinutes: 0 } as any);
  if (!r.ok) throw new BookingConflictRace((r as any).conflictingAppointmentId);
  return r;
};
const custMove = (id: string, date: string, startTime: string, endTime: string) => async () => {
  const r = await new KyselyCustomerBookingRepository(db as any).rescheduleAtomic({ tenantId: T, customerId: CUST, appointmentId: id, technicianId: TECH, date, startTime, endTime, bufferMinutes: 0 });
  if (!r.ok) throw new BookingConflictRace((r as any).conflictingAppointmentId);
  return r;
};
/** chair-holding rows of this technician overlapping [from, to) on the date */
const inWindow = async (date: string, from: string, to: string, tech = TECH) => Number((await sql<{ n: number }>`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and technician_id = ${tech} and appt_date = ${date}
  and status not in ('cancelled','no_show','completed') and start_time < ${to} and end_time > ${from}`.execute(db)).rows[0].n);
const settle = async (writers: Array<() => Promise<unknown>>) => {
  const results = await Promise.allSettled(writers.map((w) => w()));
  const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  expect(lost.filter((l) => !isTyped(l.reason)).map((l) => String(l.reason?.stack || l.reason))).toEqual([]);   // never a 500 / raw 23P01
  return { won: results.filter((r) => r.status === 'fulfilled').length, lost: lost.length };
};

describe.skipIf(!url)('MOVE paths are blocked at the database the moment they happen (real PG)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Move Salon', 'Move Salon', 'move-salon', 'MOVEX', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Mia', 'Move', 'Mia Move', true), (${TECH2}, ${T}, ${B}, 'Leo', 'Move', 'Leo Move', true) on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${B}, 'Cu', 'St', 'Cu St') on conflict (id) do nothing`.execute(db);
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    for (const t of ['customer_notifications', 'appointment_change_log', 'pos_tech_appointments']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  it('§69 POS board: an add-on lengthening 10:00–11:00 to 11:30, raced against a create of 11:00–12:00 → exactly one wins', async () => {
    const date = '2999-08-01';
    const posRepo = new KyselyBookingRepository(db as any);
    const a = (await posRepo.create(ctx, item(date, '10:00', '11:00', 60), { bufferMinutes: 0 })).appointmentId;
    for (let round = 0; round < 3; round++) {
      // re-arm: shrink back to 60 min and clear 11:00 so each round races again
      await sql`update pos_tech_appointments set end_time = '11:00', duration_minutes = 60 where id = ${a}`.execute(db);
      await sql`delete from pos_tech_appointments where tenant_id = ${T} and appt_date = ${date} and id <> ${a}`.execute(db);
      const r = await settle([
        () => new KyselyBookingRepository(db as any).update(ctx, a, { services: [svc(90)] } as any, { bufferMinutes: 0 }),
        () => new KyselyBookingRepository(db as any).create(ctx, item(date, '11:00', '12:00', 60), { bufferMinutes: 0 }),
        () => new KyselyTechApptRepository(db as any).create(ctx, item(date, '11:15', '12:15', 60), { bufferMinutes: 0 }),
      ]);
      expect(r.won).toBe(1);
      expect(await inWindow(date, '11:00', '11:30')).toBe(1);
    }
  }, 60_000);

  it('§69 Technician Appointments screen: the same duration change through its own writer → exactly one wins', async () => {
    const date = '2999-08-02';
    const ta = new KyselyTechApptRepository(db as any);
    const a = (await ta.create(ctx, item(date, '10:00', '11:00', 60), { bufferMinutes: 0 })).appointmentId;
    const r = await settle([
      () => new KyselyTechApptRepository(db as any).update(ctx, a, { services: [svc(90)] } as any, { bufferMinutes: 0 }),
      () => new KyselyBookingRepository(db as any).create(ctx, item(date, '11:00', '12:00', 60), { bufferMinutes: 0 }),
      custInsert(date, '11:15', '12:15'),
    ]);
    expect(r.won).toBe(1);
    expect(await inWindow(date, '11:00', '11:30')).toBe(1);
  }, 60_000);

  it('technician change on the board (assign) raced against a create on the NEW technician → exactly one wins; the loser stays put', async () => {
    const date = '2999-08-03';
    const posRepo = new KyselyBookingRepository(db as any);
    const leos = (await posRepo.create(ctx, item(date, '10:00', '11:00', 60, TECH2), { bufferMinutes: 0 })).appointmentId;
    const r = await settle([
      () => new KyselyBookingRepository(db as any).assign(ctx, leos, TECH, { bufferMinutes: 0 }),
      () => new KyselyBookingRepository(db as any).create(ctx, item(date, '10:00', '11:00', 60), { bufferMinutes: 0 }),
      custInsert(date, '10:30', '11:30'),
    ]);
    expect(r.won).toBe(1);
    expect(await inWindow(date, '10:00', '11:00')).toBe(1);
    const row: any = (await sql`select technician_id from pos_tech_appointments where id = ${leos}`.execute(db)).rows[0];
    // either Leo's visit moved to Mia (and nobody else booked her) or it is still Leo's
    expect([TECH, TECH2]).toContain(row.technician_id);
    if (row.technician_id === TECH2) expect(await inWindow(date, '10:00', '11:00', TECH2)).toBe(1);
  }, 60_000);

  it('customer-app reschedule vs POS create vs Technician Appointments reschedule of one slot → exactly one wins', async () => {
    const date = '2999-08-04';
    const posRepo = new KyselyBookingRepository(db as any); const ta = new KyselyTechApptRepository(db as any);
    const mine = await custInsert(date, '08:00', '09:00')();                       // the customer's own visit, to be moved to 14:00
    const taMover = (await ta.create(ctx, item(date, '16:00', '17:00', 60), { bufferMinutes: 0 })).appointmentId;
    const r = await settle([
      custMove((mine as any).id, date, '14:00', '15:00'),
      () => new KyselyBookingRepository(db as any).create(ctx, item(date, '14:00', '15:00', 60), { bufferMinutes: 0 }),
      () => new KyselyTechApptRepository(db as any).reschedule(ctx, taMover, undefined, '14:30', undefined, { bufferMinutes: 0 }),
      () => posRepo.create(ctx, item(date, '14:15', '15:15', 60), { bufferMinutes: 0 }),
    ]);
    expect(r.won).toBe(1);
    expect(await inWindow(date, '14:00', '15:00')).toBe(1);
    expect(await inWindow(date, '08:00', '09:00') + await inWindow(date, '16:00', '17:00')).toBeGreaterThanOrEqual(1);   // losers did not vanish
  }, 60_000);

  it('POS reschedule of a visit onto 12:00 vs a customer-app create of 12:00 → exactly one wins', async () => {
    const date = '2999-08-05';
    const posRepo = new KyselyBookingRepository(db as any);
    const a = (await posRepo.create(ctx, item(date, '09:00', '10:00', 60), { bufferMinutes: 0 })).appointmentId;
    const r = await settle([
      () => new KyselyBookingRepository(db as any).reschedule(ctx, a, undefined, '12:00', undefined, { bufferMinutes: 0 }),
      custInsert(date, '12:00', '13:00'),
      custInsert(date, '12:30', '13:30'),
    ]);
    expect(r.won).toBe(1);
    expect(await inWindow(date, '12:00', '13:00')).toBe(1);
  }, 60_000);

  it('§104 ×10 as MOVES: ten back-to-back 30-minute visits each lengthened to 60 at once → no two overlapping rows survive', async () => {
    const date = '2999-08-06';
    const posRepo = new KyselyBookingRepository(db as any);
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const s = 9 * 60 + i * 30; const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      ids.push((await posRepo.create(ctx, item(date, hh(s), hh(s + 30), 30), { bufferMinutes: 0 })).appointmentId);
    }
    const r = await settle(ids.map((id, i) => (i % 2 === 0
      ? () => new KyselyBookingRepository(db as any).update(ctx, id, { services: [svc(60)] } as any, { bufferMinutes: 0 })
      : () => new KyselyTechApptRepository(db as any).update(ctx, id, { services: [svc(60)] } as any, { bufferMinutes: 0 }))));
    // only the LAST visit (13:30) has free minutes after it; every other lengthening collides with its neighbour
    expect(r.won).toBe(1);
    const rows: any[] = (await sql`select start_time, end_time from pos_tech_appointments where tenant_id = ${T} and technician_id = ${TECH} and appt_date = ${date} and status not in ('cancelled','no_show','completed') order by start_time`.execute(db)).rows as any[];
    expect(rows.length).toBe(10);
    for (let i = 1; i < rows.length; i++) expect(rows[i].start_time >= rows[i - 1].end_time).toBe(true);
  }, 60_000);
});
