// customer-booking-holds-schedule.postgres-race — Wave 3 (Oct 13 2026), Smooth Refresh / Booking Concurrency spec §13, §73:
// "Temporary booking holds also count as unavailable slots". The staff engine (booking.kysely.repository create /
// reschedule) re-reads live holds INSIDE its locked transaction since Round 3 H2; the CUSTOMER APP's own writers
// (insertBookingAtomic / rescheduleAtomic) did not — their only hold check was the verification flow's pre-check, run
// before the transaction (and not at all when no phone verification is configured). So a slot the AI receptionist or the
// Reception Copilot was holding for a caller could be booked from the customer app.
//
// Proven here on REAL Postgres (PGlite is one session and cannot race):
//   1. a live hold of ANOTHER session refuses the customer-app insert and the customer-app reschedule onto that slot;
//   2. the customer's OWN booking session's hold does not block its own booking;
//   3. insert vs hold fired together, several slots → exactly one wins each time, never both.
// Opt-in: PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCustomerBookingRepository } from './customer-booking.kysely.repository';
import { SlotHoldService } from './booking-slot-hold';
import { HoldSlotTakenError } from './booking-hold.kysely';

const url = process.env.PG_RACE_URL;
const T = 'a6750000-0000-4000-8000-000000000001';
const B = 'a6750000-0000-4000-8000-000000000002';
const CAT = 'a6750000-0000-4000-8000-0000000000c1';
const SVC = 'a6750000-0000-4000-8000-000000000051';
const TECH = 'a6750000-0000-4000-8000-0000000000a1';
const CUST = 'a6750000-0000-4000-8000-0000000000d1';
const DAY = '2999-06-07';

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCustomerBookingRepository; let holds: SlotHoldService;
const plus60 = (t: string) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + 60; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const ins = (date: string, startTime: string, bookingSessionId: string | null = null) => repo.insertBookingAtomic({
  tenantId: T, branchId: B, technicianId: TECH, customerId: CUST, customerName: 'Cu St', serviceId: SVC, serviceName: 'Gel Manicure',
  durationMinutes: 60, priceCents: 4500, date, startTime, endTime: plus60(startTime), bufferMinutes: 0, bookingSessionId,
});
const hold = (date: string, startTime: string, bookingSessionId = randomUUID()) => holds.place({ tenantId: T, branchId: B, date, startTime, serviceIds: [SVC], technicianId: TECH, bookingSessionId, channel: 'ai_receptionist' });

describe.skipIf(!url)('customer-app writers honour live holds inside their locked transaction (real PG)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCustomerBookingRepository(db as any);
    holds = new SlotHoldService(db as any);
    for (const t of ['booking_holds', 'customer_notifications', 'appointment_change_log', 'pos_tech_appointments']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Cust Hold Salon', 'Cust Hold Salon', 'cust-hold-salon', 'CUSTHOLD', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicures') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 60, 4500, 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Sarah', 'H', 'Sarah H', 'active', true) on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${B}, 'Cu', 'St', 'Cu St') on conflict (id) do nothing`.execute(db);
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    for (const t of ['booking_holds', 'customer_notifications', 'appointment_change_log', 'pos_tech_appointments']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db.destroy();
  });

  it("§73: another session's live hold refuses the customer-app booking of that slot; the slot next to it books", async () => {
    await hold(DAY, '10:00');
    const r = await ins(DAY, '10:30');                       // overlaps the held 10:00–11:00
    expect(r.ok).toBe(false);
    const ok = await ins(DAY, '11:00');                      // touches, does not overlap
    expect(ok.ok).toBe(true);
    const n = Number((await sql<{ n: number }>`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DAY}`.execute(db)).rows[0].n);
    expect(n).toBe(1);
  });

  it("the customer's OWN booking session's hold does not block its own booking", async () => {
    const mine = randomUUID();
    await hold(DAY, '14:00', mine);
    expect((await ins(DAY, '14:00', mine)).ok).toBe(true);
  });

  it('§73/§75: a customer-app reschedule onto a slot another session holds is refused; the appointment stays where it was', async () => {
    const D2 = '2999-06-08';
    const a = await ins(D2, '09:00'); expect(a.ok).toBe(true);
    await hold(D2, '15:00');
    const r = await repo.rescheduleAtomic({ tenantId: T, customerId: CUST, appointmentId: (a as any).id, technicianId: TECH, date: D2, startTime: '15:00', endTime: '16:00', bufferMinutes: 0 });
    expect(r.ok).toBe(false);
    const row: any = (await sql`select start_time from pos_tech_appointments where id = ${(a as any).id}`.execute(db)).rows[0];
    expect(row.start_time).toBe('09:00');
  });

  it("§71/§72: the customer app reads the technician's REAL windows — schedule 09:00–17:00, lunch 13:00–13:30, a blocked 15:00–16:00 (2999-06-10 is a Monday)", async () => {
    const D4 = '2999-06-10';   // Monday → day_of_week 1
    await sql`delete from technician_schedules where tenant_id = ${T} and technician_id = ${TECH}`.execute(db);
    await sql`delete from technician_blocked_times where tenant_id = ${T} and technician_id = ${TECH}`.execute(db);
    await sql`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values (${T}, ${B}, ${TECH}, 1, '09:00', '17:00', '13:00', '13:30', true)`.execute(db);
    await sql`insert into technician_blocked_times (tenant_id, branch_id, technician_id, block_date, start_time, end_time, reason) values (${T}, ${B}, ${TECH}, ${D4}, '15:00', '16:00', 'training')`.execute(db);
    const w = await repo.technicianWindows({ tenantId: T, branchId: B, userId: 'cust' }, TECH, D4);
    expect(w).toEqual([{ start: 9 * 60, end: 13 * 60 }, { start: 13 * 60 + 30, end: 15 * 60 }, { start: 16 * 60, end: 17 * 60 }]);
    // a technician with no schedule row follows store hours (the staff engine's legacy rule) — never "no windows"
    const w2 = await repo.technicianWindows({ tenantId: T, branchId: B, userId: 'cust' }, 'a6750000-0000-4000-8000-0000000000a2', D4);
    expect(w2).toEqual([{ start: 9 * 60, end: 19 * 60 }]);
    await sql`delete from technician_schedules where tenant_id = ${T} and technician_id = ${TECH}`.execute(db);
    await sql`delete from technician_blocked_times where tenant_id = ${T} and technician_id = ${TECH}`.execute(db);
  });

  it('insert vs hold of the same slot fired together, 6 slots → exactly one wins each time', async () => {
    const D3 = '2999-06-09';
    const STAGGER = [0, 0, 5, 20, 60, 120];
    const later = <X>(ms: number, f: () => Promise<X>) => new Promise<X>((ok, ko) => setTimeout(() => f().then(ok, ko), ms));
    for (const [i, t] of ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'].entries()) {
      // the hold first, the insert staggered behind it: the insert must see a committed hold under the lock
      const [h, b] = await Promise.allSettled([hold(D3, t), later(STAGGER[i], () => ins(D3, t))]);
      const bookingWon = b.status === 'fulfilled' && (b.value as any).ok === true;
      const holdWon = h.status === 'fulfilled';
      if (h.status === 'rejected') expect(h.reason).toBeInstanceOf(HoldSlotTakenError);
      expect({ t, wins: Number(bookingWon) + Number(holdWon) }).toEqual({ t, wins: 1 });
    }
  });
});
