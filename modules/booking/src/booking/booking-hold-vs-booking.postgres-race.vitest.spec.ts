// booking-hold-vs-booking.postgres-race — Round 3 H2 (Oct 12 2026): a hold (the AI receptionist's / the Reception
// Copilot's SlotHoldService.place) and a booking (the staff engine's create / reschedule) of the SAME slot, in two
// sessions at the same instant → exactly ONE wins. Before this the hold pre-check ran outside the booking's lock and
// hold placement never looked at appointments, so both could "win" (a live hold sitting on a booked slot, or a booking
// on a slot somebody was promised). Both sides now take the branch-day hold lock (bookingHoldLockKey) and re-read the
// other side's rows under it. TRUE concurrency needs real Postgres (PGlite is single-session).
// Opt-in: PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService, ConflictError } from './booking.service';
import { SlotHoldService } from '../customer-booking/booking-slot-hold';
import { HoldSlotTakenError } from '../customer-booking/booking-hold.kysely';

const url = process.env.PG_RACE_URL;
const T = 'a6740000-0000-4000-8000-000000000001';
const B = 'a6740000-0000-4000-8000-000000000002';
const CAT = 'a6740000-0000-4000-8000-0000000000c1';
const SVC = 'a6740000-0000-4000-8000-000000000051';
const TECH = 'a6740000-0000-4000-8000-0000000000a1';
const DAY = '2999-05-07';
const TIMES = ['09:00', '10:30', '12:00', '13:30', '15:00', '16:30'];
const ctx = { tenantId: T, branchId: B, userId: 'u-race-desk', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.reschedule'] } as any;

let db: Kysely<any>; let pool: pg.Pool; let svc: BookingService; let holds: SlotHoldService;

describe.skipIf(!url)('real-Postgres race: a hold and a booking of the same slot', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    holds = new SlotHoldService(db as any);
    svc = new BookingService(new KyselyBookingRepository(db as any), undefined, undefined, undefined, undefined, holds);
    await sql`delete from booking_holds where tenant_id = ${T}`.execute(db);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Hold Race Salon', 'Hold Race Salon', 'hold-race-salon', 'HOLDRACE', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicures') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 60, 4500, 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${TECH}, ${T}, ${B}, 'Solo', 'R', 'Solo R', 'active', true) on conflict (id) do nothing`.execute(db);
    await sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${T}, ${B}, ${TECH}, ${SVC}) on conflict do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from booking_holds where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  const placeHold = (startTime: string) => holds.place({ tenantId: T, branchId: B, date: DAY, startTime, serviceIds: [SVC], technicianId: TECH, bookingSessionId: randomUUID(), channel: 'ai_receptionist' });
  const state = async (startTime: string) => {
    const appts = Number((await sql<{ n: number }>`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DAY} and start_time = ${startTime} and status <> 'cancelled'`.execute(db)).rows[0].n);
    const live = Number((await sql<{ n: number }>`select count(*)::int as n from booking_holds where tenant_id = ${T} and released_at is null and converted_appointment_id is null
      and start_time = (${DAY + ' ' + startTime}::timestamp at time zone 'America/New_York')`.execute(db)).rows[0].n);
    return { appts, live };
  };

  // The hold side is staggered 0…120 ms behind the booking so both orders are exercised: the early slots are a true
  // photo-finish, the late ones have the booking committing first (the hold must then see it under the lock).
  const STAGGER = [0, 0, 5, 20, 60, 120];
  const later = <X>(ms: number, f: () => Promise<X>) => new Promise<X>((ok, ko) => setTimeout(() => f().then(ok, ko), ms));
  it(`create vs hold, ${TIMES.length} slots, both fired together → exactly one wins each time`, async () => {
    for (const [i, t] of TIMES.entries()) {
      const [b, h] = await Promise.allSettled([
        svc.create(ctx, { customerName: 'Walk-up ' + t, serviceIds: [SVC], technicianId: TECH, date: DAY, startTime: t } as any),
        later(STAGGER[i], () => placeHold(t)),
      ]);
      const wins = [b, h].filter((r) => r.status === 'fulfilled').length;
      expect({ t, wins }).toEqual({ t, wins: 1 });
      if (b.status === 'rejected') expect(b.reason).toBeInstanceOf(ConflictError);
      if (h.status === 'rejected') expect(h.reason).toBeInstanceOf(HoldSlotTakenError);
      const s = await state(t);
      expect({ t, total: s.appts + s.live }).toEqual({ t, total: 1 });
    }
  });

  it('reschedule vs hold of the target slot → exactly one wins', async () => {
    const DAY2 = '2999-05-08';
    for (const [i, t] of ['10:00', '14:00'].entries()) {
      const appt = await svc.create(ctx, { customerName: 'Mover ' + i, serviceIds: [SVC], technicianId: TECH, date: DAY2, startTime: i ? '17:00' : '09:00' } as any);
      const [m, h] = await Promise.allSettled([
        svc.reschedule(ctx, appt.appointmentId, { startTime: t, notifyCustomer: false } as any),
        holds.place({ tenantId: T, branchId: B, date: DAY2, startTime: t, serviceIds: [SVC], technicianId: TECH, bookingSessionId: randomUUID(), channel: 'reception_copilot' }),
      ]);
      expect({ t, wins: [m, h].filter((r) => r.status === 'fulfilled').length }).toEqual({ t, wins: 1 });
      if (m.status === 'rejected') expect(m.reason).toBeInstanceOf(ConflictError);
      if (h.status === 'rejected') expect(h.reason).toBeInstanceOf(HoldSlotTakenError);
    }
  });
});
