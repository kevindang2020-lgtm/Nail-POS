// booking-first-available.postgres-race — Round 2 H (Oct 12 2026), the "first available" race (Phase 15 G): N callers
// book "anyone is fine" at the SAME time at the SAME instant. Every one of them is assigned the first free technician
// by name — the same one — before the locked re-check; before this fix N-1 of them got a 409 although N technicians
// were free. Now a lost race retries with the next qualifying technician (each attempt under the same technician+day
// lock), so: N callers, N free technicians → N bookings on N distinct technicians; N+1 callers → exactly ONE honest
// conflict. TRUE concurrency needs real Postgres (PGlite is single-session). Opt-in: PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService, ConflictError } from './booking.service';

const url = process.env.PG_RACE_URL;
const T = 'a6720000-0000-4000-8000-000000000001';
const B = 'a6720000-0000-4000-8000-000000000002';
const CAT = 'a6720000-0000-4000-8000-0000000000c1';
const SVC = 'a6720000-0000-4000-8000-000000000051';
const TECHS = ['a6720000-0000-4000-8000-0000000000a1', 'a6720000-0000-4000-8000-0000000000a2', 'a6720000-0000-4000-8000-0000000000a3', 'a6720000-0000-4000-8000-0000000000a4'];
const N = TECHS.length;
const DAY = '2999-05-06';
const ctx = { tenantId: T, branchId: B, userId: 'u-race-desk', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create'] } as any;

let db: Kysely<any>; let pool: pg.Pool; let svc: BookingService;
const book = (i: number, startTime: string) => svc.create(ctx, { customerName: `Caller ${i}`, serviceIds: [SVC], date: DAY, startTime, source: 'ai' } as any);

describe.skipIf(!url)('real-Postgres "first available" race', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    svc = new BookingService(new KyselyBookingRepository(db as any));
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'FA Race Salon', 'FA Race Salon', 'fa-race-salon', 'FARACE', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicures') on conflict (id) do nothing`.execute(db);
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 60, 4500, 'active') on conflict (id) do nothing`.execute(db);
    for (const [i, id] of TECHS.entries()) {
      await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values (${id}, ${T}, ${B}, ${'Tech' + i}, 'R', ${'Tech' + i + ' R'}, 'active', true) on conflict (id) do nothing`.execute(db);
      await sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${T}, ${B}, ${id}, ${SVC}) on conflict do nothing`.execute(db);
    }
  });
  afterAll(async () => { await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  const techsAt = async (startTime: string) => (await sql<{ technician_id: string }>`select technician_id from pos_tech_appointments
    where tenant_id = ${T} and appt_date = ${DAY} and start_time = ${startTime} and status <> 'cancelled'`.execute(db)).rows.map((r) => r.technician_id);

  it(`${N} simultaneous first-available bookings with ${N} free technicians → all ${N} succeed, on ${N} distinct technicians`, async () => {
    const results = await Promise.allSettled(Array.from({ length: N }, (_, i) => book(i, '10:00')));
    expect(results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const techs = await techsAt('10:00');
    expect(techs.length).toBe(N);
    expect(new Set(techs).size).toBe(N);
  });

  it(`${N + 1} simultaneous first-available bookings → ${N} succeed, exactly ONE honest conflict (409 "nobody is free")`, async () => {
    const results = await Promise.allSettled(Array.from({ length: N + 1 }, (_, i) => book(i, '14:00')));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.filter((r) => !(r.reason instanceof ConflictError)).map((r) => String(r.reason))).toEqual([]);
    expect(ok).toBe(N);
    expect(rejected.length).toBe(1);
    expect((rejected[0].reason as ConflictError).code).toBe('APPOINTMENT_CONFLICT');
    expect(new Set(await techsAt('14:00')).size).toBe(N);
  });
});
