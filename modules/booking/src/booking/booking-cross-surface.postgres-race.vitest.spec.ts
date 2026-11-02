// booking-cross-surface.postgres-race.vitest.spec.ts — merge Oct 12 2026 (other-chat booking concurrency, Smooth Refresh /
// Booking Concurrency spec §7/§65): "10 devices book the same slot at the same moment" from DIFFERENT surfaces, on REAL
// Postgres with a real connection pool (PGlite is single-connection and cannot stage true concurrency).
//
// Each round fires 10 simultaneous writes — POS Booking board creates, Technician Appointments screen creates, customer-app
// insertBookingAtomic, Booking board reschedules and Technician Appointments reassigns/reschedules of OTHER bookings — all
// aimed at one technician's 10:00–11:00. Exactly ONE may win; every loser must get a typed conflict (never a 500, never a
// silent success); the table must hold exactly one chair-holding row in that window. The three writers share the SAME
// technician-day advisory lock key, so they serialize against each other; the EXCLUDE constraint is the last line.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { KyselyTechApptRepository, AppointmentSlotConflict } from '@aipowersalon/appointments';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { KyselyCustomerBookingRepository } from '../customer-booking/customer-booking.kysely.repository';
import { BookingConflictRace } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a2000000-0000-4000-8000-0000000000aa';
const B = 'b2000000-0000-4000-8000-0000000000bb';
const TECH = 'c2000000-0000-4000-8000-0000000000cc';
const TECH2 = 'c2000000-0000-4000-8000-0000000000cd';
const CUST = 'd2000000-0000-4000-8000-0000000000dd';
let db: Kysely<any>; let pool: pg.Pool;
const ctx = { tenantId: T, branchId: B, userId: 'u_race', role: 'MANAGER', permissions: [] } as any;
const line = { serviceId: 'svc_gel', serviceName: 'Gel Manicure', name: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 } as any;
const item = (date: string, startTime: string, endTime: string, tech = TECH) => ({
  appointmentId: 'x', technicianId: tech, customerName: 'Walk In', isVip: false, services: [line], source: 'manual', date, startTime, endTime,
  status: 'booked', depositStatus: 'not_required', depositCents: 0, notes: '', createdAt: '', updatedAt: '',
}) as any;
const isTyped = (e: unknown) => e instanceof AppointmentSlotConflict || e instanceof BookingConflictRace || (e as any)?.name === 'AppointmentSlotConflict' || (e as any)?.name === 'BookingConflictRace';

describe.skipIf(!url)('10 mixed-surface writers on one technician slot (real PG)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon X', 'Race Salon X', 'race-salon-x', 'RACEX', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Mia', 'Race', 'Mia Race', true), (${TECH2}, ${T}, ${B}, 'Leo', 'Race', 'Leo Race', true) on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${B}, 'Cu', 'St', 'Cu St') on conflict (id) do nothing`.execute(db);
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    for (const t of ['customer_notifications', 'appointment_change_log', 'pos_tech_appointments']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  for (let round = 1; round <= 3; round++) {
    it(`round ${round}: exactly one of 10 mixed-surface writers wins 10:00–11:00; every loser gets a typed conflict`, async () => {
      const date = `2999-07-${String(round).padStart(2, '0')}`;
      const posRepo = new KyselyBookingRepository(db as any);
      const taRepo = new KyselyTechApptRepository(db as any);
      // pre-existing bookings elsewhere in the day that will be MOVED / REASSIGNED into the contested window
      const movers: string[] = [];
      for (const st of ['13:00', '14:30']) movers.push((await posRepo.create(ctx, item(date, st, st.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, '0'))), { bufferMinutes: 0 })).appointmentId);
      const taMover = (await taRepo.create(ctx, item(date, '16:00', '17:00'), { bufferMinutes: 0 })).appointmentId;
      const leoAt10 = (await taRepo.create(ctx, item(date, '10:00', '11:00', TECH2), { bufferMinutes: 0 })).appointmentId;   // Leo's 10:00 → reassigned to Mia

      const writers: Array<() => Promise<unknown>> = [
        () => new KyselyBookingRepository(db as any).create(ctx, item(date, '10:00', '11:00'), { bufferMinutes: 0 }),
        () => new KyselyBookingRepository(db as any).create(ctx, item(date, '10:00', '11:00'), { bufferMinutes: 0 }),
        () => new KyselyTechApptRepository(db as any).create(ctx, item(date, '10:00', '11:00'), { bufferMinutes: 0 }),
        () => new KyselyTechApptRepository(db as any).create(ctx, item(date, '10:30', '11:30'), { bufferMinutes: 0 }),
        async () => {
          const r = await new KyselyCustomerBookingRepository(db as any).insertBookingAtomic({ tenantId: T, branchId: B, technicianId: TECH, customerId: CUST, customerName: 'Cu St', serviceId: randomUUID(), serviceName: 'Gel', durationMinutes: 60, priceCents: 4500, date, startTime: '10:00', endTime: '11:00', bufferMinutes: 0 } as any);
          if (!r.ok) throw new BookingConflictRace((r as any).conflictingAppointmentId);
          return r;
        },
        async () => {
          const r = await new KyselyCustomerBookingRepository(db as any).insertBookingAtomic({ tenantId: T, branchId: B, technicianId: TECH, customerId: CUST, customerName: 'Cu St', serviceId: randomUUID(), serviceName: 'Gel', durationMinutes: 60, priceCents: 4500, date, startTime: '10:15', endTime: '11:15', bufferMinutes: 0 } as any);
          if (!r.ok) throw new BookingConflictRace((r as any).conflictingAppointmentId);
          return r;
        },
        () => new KyselyBookingRepository(db as any).reschedule(ctx, movers[0], undefined, '10:00', undefined, { bufferMinutes: 0 }),
        () => new KyselyBookingRepository(db as any).reschedule(ctx, movers[1], undefined, '10:30', undefined, { bufferMinutes: 0 }),
        () => new KyselyTechApptRepository(db as any).reschedule(ctx, taMover, undefined, '10:00', undefined, { bufferMinutes: 0 }),
        () => new KyselyTechApptRepository(db as any).assign(ctx, leoAt10, TECH, { bufferMinutes: 0 }),
      ];
      const results = await Promise.allSettled(writers.map((w) => w()));
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(results.length).toBe(10);
      expect(lost.filter((l) => !isTyped(l.reason)).map((l) => String(l.reason))).toEqual([]);   // never a 500 / raw 23P01
      expect(won.length).toBe(1);
      const inWindow = await sql<{ n: number }>`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and technician_id = ${TECH} and appt_date = ${date}
        and status not in ('cancelled','no_show','completed') and start_time < '11:00' and end_time > '10:00'`.execute(db);
      expect(inWindow.rows[0].n).toBe(1);
      // the losers that were MOVES left their rows exactly where they were
      const still: any[] = (await sql`select id, start_time, technician_id from pos_tech_appointments where id in (${movers[0]}, ${movers[1]}, ${taMover}, ${leoAt10})`.execute(db)).rows as any[];
      const moved = still.filter((r) => (r.technician_id === TECH && ['10:00', '10:30'].includes(r.start_time)));
      expect(moved.length).toBeLessThanOrEqual(1);
    }, 60_000);
  }
});
