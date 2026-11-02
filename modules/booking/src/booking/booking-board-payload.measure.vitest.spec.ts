// booking-board-payload.measure.vitest.spec.ts — Smooth Refresh spec §100/§101/§123: MEASURED numbers for the final
// report, on real Postgres, for a realistic board: 12 technicians, 60 appointments on one day. Prints a JSON line
// (MEASURE {...}) and asserts only the shape that the spec requires (a quiet 15 s tick is far smaller than a reload).
// Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService } from './booking.service';

const url = process.env.PG_RACE_URL;
const T = 'a5000000-0000-4000-8000-0000000000aa';
const B = 'b5000000-0000-4000-8000-0000000000bb';
const DATE = '2999-05-03';
const tech = (i: number) => `c5000000-0000-4000-8000-0000000000${(0x10 + i).toString(16)}`;
const ctx = { tenantId: T, branchId: B, userId: 'e5000000-0000-4000-8000-0000000000ee', role: 'OWNER', permissions: ['pos.booking.view'] } as any;
let db: Kysely<any>; let pool: pg.Pool;

const timeIt = async <X>(fn: () => Promise<X>, n = 15): Promise<{ result: X; p50: number; p95: number }> => {
  const ts: number[] = []; let result!: X;
  for (let i = 0; i < n; i++) { const t0 = performance.now(); result = await fn(); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  return { result, p50: +ts[Math.floor(n * 0.5)].toFixed(1), p95: +ts[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(1) };
};

describe.skipIf(!url)('Booking board payload + timing (measured, spec §123)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Measure Salon', 'Measure Salon', 'measure-salon', 'MEASR', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    for (let i = 0; i < 12; i++) {
      await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${tech(i)}, ${T}, ${B}, ${'Tech' + i}, 'M', ${'Tech ' + i}, true) on conflict (id) do nothing`.execute(db);
      for (let k = 0; k < 5; k++) {
        const h = 9 + k * 2; const st = `${String(h).padStart(2, '0')}:00`; const en = `${String(h + 1).padStart(2, '0')}:00`;
        await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, source, appt_date, start_time, end_time, duration_minutes, status, deposit_status, is_vip, updated_at)
          values (${T}, ${B}, ${tech(i)}, ${'Guest ' + i + '-' + k}, ${JSON.stringify([{ serviceId: 'svc', name: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 }])}::jsonb, 'manual', ${DATE}, ${st}, ${en}, 60, 'booked', 'not_required', false, now() - interval '5 minutes')`.execute(db);   // steady state: written before the feed's look-back
      }
    }
  });
  afterAll(async () => { await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('a quiet 15 s tick (change feed) vs a full board reload', async () => {
    const svc = new BookingService(new KyselyBookingRepository(db as any));
    const state = await timeIt(() => svc.getState(ctx, { date: DATE }));
    const grid = await timeIt(() => svc.dayGrid(ctx, DATE));
    const base = await svc.changes(ctx);
    const quiet = await timeIt(() => svc.changes(ctx, base.cursor));
    const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
    const m = {
      technicians: 12, appointments: 60,
      fullReloadBytes: bytes(state.result) + bytes(grid.result), stateBytes: bytes(state.result), dayGridBytes: bytes(grid.result),
      quietTickBytes: bytes(quiet.result),
      stateMs: { p50: state.p50, p95: state.p95 }, dayGridMs: { p50: grid.p50, p95: grid.p95 }, quietTickMs: { p50: quiet.p50, p95: quiet.p95 },
      requestsPerQuietTick: 1, requestsPerFullReload: 3,
    };
    console.log('MEASURE ' + JSON.stringify(m));
    expect(m.quietTickBytes * 20).toBeLessThan(m.fullReloadBytes);   // spec §24/§89: the tick is a small fraction of a reload
  });
});
