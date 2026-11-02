// customer-booking-race.pgtest.vitest.spec.ts — the testable core of the double-booking guarantee (mobile spec §14),
// on the REAL schema via the REAL insertBookingAtomic. Why sequential is the right test here: insertBookingAtomic
// takes pg_advisory_xact_lock(`${tenant}|${technician}|${date}`) and re-checks COMMITTED rows inside the same
// transaction — so any true concurrent race serializes into exactly this sequence: winner commits, loser re-checks
// against the winner's committed row and gets {ok:false, conflictingAppointmentId}. Single-session PGlite cannot
// stage two overlapping transactions (recorded limitation, same as the recon lock); multi-instance contention on
// production Postgres remains NOT VERIFIED in-sandbox — the lock + committed-row re-check is what reduces it to this.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { KyselyCustomerBookingRepository } from './customer-booking.kysely.repository';
import { applyMigrationToPglite } from '@aipowersalon/testing';   // Phase 10: 537 is a no-transaction (CONCURRENTLY) migration

const T = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000001';
const TECH = 'c0000000-0000-4000-8000-000000000001';
const CUST_A = 'd0000000-0000-4000-8000-00000000000a';
const CUST_B = 'e0000000-0000-4000-8000-00000000000b';

let db: Kysely<any>;
let repo: KyselyCustomerBookingRepository;

function baseInput(customerId: string, customerName: string, startTime: string, endTime: string) {
  return {
    tenantId: T, branchId: B, technicianId: TECH, customerId, customerName,
    serviceId: 'f0000000-0000-4000-8000-000000000001', serviceName: 'Gel Manicure', durationMinutes: 60, priceCents: 4500,
    date: '2999-03-14', startTime, endTime, bufferMinutes: 0,
  } as any;
}

beforeAll(async () => {
  const lite = await PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist } });   // full-migration boots need all three (mig 107 = trgm)
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await applyMigrationToPglite(lite, readFileSync(join(dir, f), 'utf8'));
  }
  db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => {}, acquireConnection: async () => ({
          executeQuery: async (q: any) => { const r = await lite.query(q.sql, q.parameters as any[]); return { rows: r.rows as any[], numAffectedRows: BigInt(r.affectedRows ?? 0) }; },
          streamQuery: () => { throw new Error('no stream'); },
        }),
        beginTransaction: async (c: any) => { await c.executeQuery({ sql: 'begin', parameters: [] }); },
        commitTransaction: async (c: any) => { await c.executeQuery({ sql: 'commit', parameters: [] }); },
        rollbackTransaction: async (c: any) => { await c.executeQuery({ sql: 'rollback', parameters: [] }); },
        releaseConnection: async () => {}, destroy: async () => {},
      }),
      createIntrospector: (x) => new PostgresIntrospector(x),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon', 'Race Salon', 'race-salon', 'RACE', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Mia', 'Chen', 'Mia Chen', true)`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST_A}, ${T}, ${B}, 'Ava', 'One', 'Ava One')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST_B}, ${T}, ${B}, 'Bo', 'Two', 'Bo Two')`.execute(db);
  repo = new KyselyCustomerBookingRepository(db as any);
}, 120_000);

describe('double-booking prevention on the REAL schema (spec §14 core)', () => {
  it('first booking wins; the identical slot then conflicts, names the winner, and inserts nothing', async () => {
    const a = await repo.insertBookingAtomic(baseInput(CUST_A, 'Ava One', '10:00', '11:00'));
    expect(a.ok).toBe(true);
    const winnerId = (a as any).id;

    const b = await repo.insertBookingAtomic(baseInput(CUST_B, 'Bo Two', '10:00', '11:00'));
    expect(b.ok).toBe(false);
    expect((b as any).conflictingAppointmentId).toBe(winnerId);   // the loser learns WHICH booking holds the slot

    const rows = await sql<any>`select id, customer_id from pos_tech_appointments where tenant_id = ${T} and appt_date = '2999-03-14'`.execute(db);
    expect(rows.rows.length).toBe(1);                              // exactly one appointment exists
    expect(rows.rows[0].customer_id).toBe(CUST_A);

    const notes = await sql<any>`select customer_id from customer_notifications where tenant_id = ${T} and type = 'appointment'`.execute(db);
    expect(notes.rows.every((n: any) => n.customer_id === CUST_A)).toBe(true);   // the loser got no "booked" notification
  });

  it('a merely OVERLAPPING attempt also conflicts; a back-to-back slot succeeds', async () => {
    const overlap = await repo.insertBookingAtomic(baseInput(CUST_B, 'Bo Two', '10:30', '11:30'));
    expect(overlap.ok).toBe(false);

    const next = await repo.insertBookingAtomic(baseInput(CUST_B, 'Bo Two', '11:00', '12:00'));
    expect(next.ok).toBe(true);

    const rows = await sql<any>`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and appt_date = '2999-03-14'`.execute(db);
    expect(rows.rows[0].n).toBe(2);
  });

  it('DATABASE GUARD (migration 426): a raw overlapping insert that bypasses lock AND pre-check is rejected by the exclusion constraint', async () => {
    // WHY THIS SHAPE: a literal Promise.all race is not hostable on single-session PGlite — interleaved BEGINs merge
    // into one transaction (demonstrated empirically: without the constraint, two simultaneous inserts for one slot
    // BOTH succeeded). That merged-session pathology is exactly the pooling failure mode migration 422 recorded for
    // the recon lock, and migration 426 answers it the same way: the DATABASE is the last line of defense. So this
    // test attacks the table directly — no advisory lock, no pre-check — and the constraint itself must refuse.
    const a = await repo.insertBookingAtomic(baseInput(CUST_A, 'Ava One', '16:00', '17:00'));
    expect(a.ok).toBe(true);

    let code: string | null = null;
    try {
      await sql`insert into pos_tech_appointments
        (tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
        values (${T}, ${B}, ${TECH}, ${CUST_B}, 'Bo Two', '[]'::jsonb, '2999-03-14', '16:30', '17:30', 60, 'booked', 'customer_app')`.execute(db);
    } catch (e: any) { code = e?.code ?? null; }
    expect(code).toBe('23P01');   // exclusion_violation — the database refused the double-booking

    // Half-open '[)': back-to-back 17:00-18:00 is NOT a conflict.
    await sql`insert into pos_tech_appointments
      (tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
      values (${T}, ${B}, ${TECH}, ${CUST_B}, 'Bo Two', '[]'::jsonb, '2999-03-14', '17:00', '18:00', 60, 'booked', 'customer_app')`.execute(db);

    // A cancelled row never blocks the slot: the predicate exempts it, and a real booking lands there.
    await sql`insert into pos_tech_appointments
      (tenant_id, branch_id, technician_id, customer_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
      values (${T}, ${B}, ${TECH}, ${CUST_B}, 'Bo Two', '[]'::jsonb, '2999-03-14', '19:00', '20:00', 60, 'cancelled', 'customer_app')`.execute(db);
    const c = await repo.insertBookingAtomic(baseInput(CUST_A, 'Ava One', '19:00', '20:00'));
    expect(c.ok).toBe(true);
  });
});
