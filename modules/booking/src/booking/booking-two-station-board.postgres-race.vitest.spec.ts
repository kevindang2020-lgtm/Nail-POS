// booking-two-station-board.postgres-race.vitest.spec.ts — two front-desk stations on the new Booking Schedule Board
// (Booking Standalone spec; Kevin, Nov 13 2026: "a real two-station booking race on live Postgres"). The board's
// ProductionBookingDataAdapter writes through POST /pos/booking/appointments (create) and …/reschedule (drag, carrying
// expectedVersion); both land in KyselyBookingRepository. Each station gets its OWN pg pool, so the two writes are two
// real sessions racing inside PostgreSQL, not one connection taking turns. Every scenario runs for many rounds.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingConflictRace, BookingVersionConflict, type PBServiceLine } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a1990000-0000-4000-8000-0000000000aa';
const B = 'b1990000-0000-4000-8000-0000000000bb';
const TECH = 'c1990000-0000-4000-8000-0000000000cc';
const ROUNDS = 25;
const line: PBServiceLine = { serviceId: 'svc_gel', name: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 } as any;
const ctxA = { tenantId: T, branchId: B, userId: 'u_station_a', role: 'FRONT_DESK', permissions: [] } as any;
const ctxB = { tenantId: T, branchId: B, userId: 'u_station_b', role: 'FRONT_DESK', permissions: [] } as any;
const dateOf = (round: number) => `2999-06-${String(1 + (round % 28)).padStart(2, '0')}`;
const item = (date: string, name: string, startTime: string, endTime: string) => ({
  appointmentId: '', technicianId: TECH, customerName: name, isVip: false, services: [line], source: 'manual', date,
  startTime, endTime, status: 'booked', depositStatus: 'not_required', depositCents: 0, notes: '', createdAt: '', updatedAt: '',
}) as any;

let poolA: pg.Pool; let poolB: pg.Pool; let dbA: Kysely<any>; let dbB: Kysely<any>;
let stationA: KyselyBookingRepository; let stationB: KyselyBookingRepository;
const isConflict = (e: unknown) => e instanceof BookingConflictRace || e instanceof BookingVersionConflict;

describe.skipIf(!url)('two stations on the Booking Schedule Board, real Postgres', () => {
  beforeAll(async () => {
    poolA = new pg.Pool({ connectionString: url, max: 4 }); poolB = new pg.Pool({ connectionString: url, max: 4 });
    dbA = new Kysely<any>({ dialect: new PostgresDialect({ pool: poolA }) }); dbB = new Kysely<any>({ dialect: new PostgresDialect({ pool: poolB }) });
    stationA = new KyselyBookingRepository(dbA as any); stationB = new KyselyBookingRepository(dbB as any);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(dbA);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Two Station Salon', 'Two Station Salon', 'two-station', 'TWOST', 'active') on conflict (id) do nothing`.execute(dbA);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(dbA);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Linh', 'Tran', 'Linh Tran', true) on conflict (id) do nothing`.execute(dbA);
  });
  afterAll(async () => {
    await sql`delete from appointment_change_log where tenant_id = ${T}`.execute(dbA).catch(() => undefined);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(dbA).catch(() => undefined);
    await dbA?.destroy(); await dbB?.destroy();
  });

  const liveAt = async (date: string, start: string) => Number((await sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${date}
    and status not in ('cancelled','no_show','completed') and start_time::time < ${start}::time + interval '60 minutes' and end_time::time > ${start}::time`.execute(dbA)).rows[0].n);

  it('both stations book the same technician at the same time — every round: one booked, one refused, never two', async () => {
    for (let r = 0; r < ROUNDS; r++) {
      const date = dateOf(r), slot = `${String(8 + (r % 10)).padStart(2, '0')}:00`, end = `${String(9 + (r % 10)).padStart(2, '0')}:00`;
      await sql`delete from pos_tech_appointments where tenant_id = ${T} and appt_date = ${date}`.execute(dbA);
      const out = await Promise.allSettled([
        stationA.create(ctxA, item(date, `A ${r}`, slot, end), { bufferMinutes: 0 }),
        stationB.create(ctxB, item(date, `B ${r}`, slot, end), { bufferMinutes: 0 }),
      ]);
      const ok = out.filter((x) => x.status === 'fulfilled').length;
      const refused = out.filter((x) => x.status === 'rejected' && isConflict((x as PromiseRejectedResult).reason));
      expect(out.filter((x) => x.status === 'rejected' && !isConflict((x as PromiseRejectedResult).reason)).map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
      expect([ok, refused.length]).toEqual([1, 1]);
      expect(await liveAt(date, slot)).toBe(1);
    }
  });

  it('station A books a free slot while station B drags another card onto it — every round exactly one of them lands there', async () => {
    let createWins = 0, dragWins = 0;
    for (let r = 0; r < ROUNDS; r++) {
      const date = dateOf(r);
      await sql`delete from pos_tech_appointments where tenant_id = ${T} and appt_date = ${date}`.execute(dbA);
      const card = await stationB.create(ctxB, item(date, `Card ${r}`, '18:00', '19:00'), { bufferMinutes: 0 });
      const out = await Promise.allSettled([
        stationA.create(ctxA, item(date, `New ${r}`, '15:00', '16:00'), { bufferMinutes: 0 }),
        stationB.reschedule(ctxB, card.appointmentId, undefined, '15:00', undefined, { expectedVersion: 1, bufferMinutes: 0 }),
      ]);
      expect(out.filter((x) => x.status === 'rejected' && !isConflict((x as PromiseRejectedResult).reason)).map((x) => String((x as PromiseRejectedResult).reason))).toEqual([]);
      expect(out.filter((x) => x.status === 'fulfilled').length).toBe(1);
      expect(await liveAt(date, '15:00')).toBe(1);
      if (out[0].status === 'fulfilled') createWins++; else dragWins++;
      // the loser left nothing half-done: a refused drag keeps the card where it was, a refused create writes no row
      const cardNow = (await sql`select start_time from pos_tech_appointments where id = ${card.appointmentId}`.execute(dbA)).rows[0] as any;
      expect(cardNow.start_time).toBe(out[1].status === 'fulfilled' ? '15:00' : '18:00');
      expect(Number((await sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${date}`.execute(dbA)).rows[0].n)).toBe(out[0].status === 'fulfilled' ? 2 : 1);
    }
    expect(createWins + dragWins).toBe(ROUNDS);
  });

  it('both stations drag the SAME card from the same version to different slots — every round one move sticks, the other gets VERSION_CONFLICT', async () => {
    for (let r = 0; r < ROUNDS; r++) {
      const date = dateOf(r);
      await sql`delete from pos_tech_appointments where tenant_id = ${T} and appt_date = ${date}`.execute(dbA);
      const card = await stationA.create(ctxA, item(date, `Shared ${r}`, '09:00', '10:00'), { bufferMinutes: 0 });
      const out = await Promise.allSettled([
        stationA.reschedule(ctxA, card.appointmentId, undefined, '11:00', undefined, { expectedVersion: 1, bufferMinutes: 0 }),
        stationB.reschedule(ctxB, card.appointmentId, undefined, '13:00', undefined, { expectedVersion: 1, bufferMinutes: 0 }),
      ]);
      const won = out.findIndex((x) => x.status === 'fulfilled');
      expect(out.filter((x) => x.status === 'fulfilled').length).toBe(1);
      const lost = out[1 - won] as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(BookingVersionConflict);
      expect((lost.reason as BookingVersionConflict).currentVersion).toBe(2);
      const now = (await sql`select start_time, version from pos_tech_appointments where id = ${card.appointmentId}`.execute(dbA)).rows[0] as any;
      expect(now.start_time).toBe(won === 0 ? '11:00' : '13:00');
      expect(Number(now.version)).toBe(2);
    }
  });
});
