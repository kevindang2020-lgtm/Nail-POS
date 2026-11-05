// booking-arrived-late.postgres-race.vitest.spec.ts — Functional Decision 38 on real Postgres (migration 488): the table
// accepts 'arrived' and stamps arrived_at, an arrived appointment still blocks a double booking (exclusion constraint),
// the board computes LATE from the salon clock (and filters/counts it), and 'late' can never be stored.
// Opt-in: PG_RACE_URL=postgres://… (a migrated database).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingConflictRace, type PBServiceLine } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a3800000-0000-4000-8000-0000000000aa';
const B = 'b3800000-0000-4000-8000-0000000000bb';
const TECH = 'c3800000-0000-4000-8000-0000000000cc';
const DATE = '2026-10-01';
const NOW = new Date('2026-10-01T14:30:00.000Z');   // 10:30 am in New Jersey (EDT)
const ctx = { tenantId: T, branchId: B, userId: 'u_d38', role: 'FRONT_DESK', permissions: [] } as any;
const line: PBServiceLine = { serviceId: 'svc_gel', serviceName: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 } as any;
const item = (name: string, startTime: string, endTime: string, status = 'booked') => ({
  appointmentId: '', technicianId: TECH, customerName: name, isVip: false, services: [line], source: 'manual', date: DATE,
  startTime, endTime, status, depositStatus: 'not_required', depositCents: 0, notes: '', createdAt: '', updatedAt: '',
}) as any;

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyBookingRepository;

describe.skipIf(!url)('real-Postgres ARRIVED / LATE (Decision 38)', () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    pool = new pg.Pool({ connectionString: url, max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyBookingRepository(db as any);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'D38 Salon', 'D38 Salon', 'd38-salon', 'D38S', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Mia', 'Chen', 'Mia Chen', true) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { vi.useRealTimers(); await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('the board shows a 10:00 booking as LATE at 10:30 New Jersey time, filters and counts it; an 11:00 booking is not late', async () => {
    expect(repo.today()).toBe(DATE);
    const late = await repo.create(ctx, item('Ava Late', '10:00', '11:00'), { bufferMinutes: 0 });
    await repo.create(ctx, item('Bea Later', '11:00', '12:00', 'confirmed'), { bufferMinutes: 0 });
    const st = await repo.query(ctx, { date: DATE } as any);
    const row = st.bookings.items.find((a) => a.appointmentId === late.appointmentId)!;
    expect(row).toMatchObject({ status: 'booked', displayStatus: 'late', lateMinutes: 30, lateness: 'late_beyond_grace', date: DATE });
    expect(st.bookings.items.find((a) => a.customerName === 'Bea Later')!.displayStatus).toBe('confirmed');
    expect(st.kpis.lateBookings).toBe(1);
    const filtered = await repo.query(ctx, { date: DATE, status: 'late' } as any);
    expect(filtered.bookings.items.map((a) => a.customerName)).toEqual(['Ava Late']);
  });

  it('Mark Arrived is stored with arrived_at; the customer is no longer late; the chair stays blocked', async () => {
    const id = (await repo.query(ctx, { date: DATE } as any)).bookings.items.find((a) => a.customerName === 'Ava Late')!.appointmentId;
    expect(await repo.setStatus(ctx, id, 'arrived')).toBe(true);
    const r = (await sql`select status, arrived_at from pos_tech_appointments where id = ${id}`.execute(db)).rows[0] as any;
    expect(r.status).toBe('arrived');
    expect(r.arrived_at).not.toBeNull();
    const d = (await repo.detail(ctx, id))!;
    expect(d).toMatchObject({ status: 'arrived', displayStatus: 'arrived', lateness: null });
    expect(d.arrivedAt).toBeTruthy();
    expect((await repo.query(ctx, { date: DATE } as any)).kpis).toMatchObject({ arrivedBookings: 1, lateBookings: 0 });
    // the database's own no-overlap guard still treats the arrived appointment as occupying Mia's chair
    await expect(repo.create(ctx, item('Cara Clash', '10:15', '10:45'), { bufferMinutes: 0 })).rejects.toBeInstanceOf(BookingConflictRace);
  });

  it("'late' cannot be stored — it is computed, never a row value", async () => {
    const id = (await repo.query(ctx, { date: DATE } as any)).bookings.items.find((a) => a.customerName === 'Bea Later')!.appointmentId;
    await expect(sql`update pos_tech_appointments set status = 'late' where id = ${id}`.execute(db)).rejects.toThrow(/status_check/);
  });
});
