// check-in-concurrency.postgres-race.vitest.spec.ts — Check-In & Display spec §20, §106, §178–§179: a double-tapped
// CHECK IN, or the same customer on two kiosks at once, must produce ONE active check-in / queue entry. The service's
// duplicate guards are in-process Maps (apptCheckInIndex, walkInIdemIndex): each API instance — and each kiosk's
// session — has its own, so the race has to be proven against real Postgres with real concurrent connections.
// Deterministic gate, as in checkout-concurrency: a share lock on pos_queue_items lets every caller read ("not checked
// in yet") and blocks all inserts until the gate opens. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckInRepository } from './check-in.kysely.repository';
import { CheckInService } from './check-in.service';

const url = process.env.PG_RACE_URL;
const T = 'a7300000-0000-4000-8000-0000000000a1', B = 'b7300000-0000-4000-8000-0000000000b1', TECH = 'c7300000-0000-4000-8000-0000000000c1';
const CUST = 'd7300000-0000-4000-8000-0000000000d1', SVC = 'e7300000-0000-4000-8000-0000000000e1';
const ctx: any = { tenantId: T, branchId: B, userId: 'kiosk', role: 'FRONT_DESK', permissions: ['pos.check_in.walk_in', 'pos.check_in.appointment', 'pos.check_in.create_customer'] };
let db: Kysely<any>; let pool: pg.Pool;

const count = async (where: string, params: any[]) => Number((await sql.raw(`select count(*)::int as n from pos_queue_items where tenant_id = '${T}' and ${where}`).execute(db)).rows[0].n);
/** N callers each read, all block at the first insert, then all proceed when the gate opens. */
async function raceWithGate<T>(n: number, run: (i: number) => Promise<T>) {
  const gate = await pool.connect();
  await gate.query('begin'); await gate.query('lock table pos_queue_items in share mode');
  const pending = Promise.allSettled(Array.from({ length: n }, (_, i) => run(i)));
  await new Promise((r) => setTimeout(r, 500));
  await gate.query('commit'); gate.release();
  return pending;
}

describe.skipIf(!url)('real-Postgres check-in races', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 16 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'CI', 'CI', 'ci-race-salon', 'CIRS', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Race Branch', 'America/New_York') on conflict (id) do nothing`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Mia', 'Tran', 'Mia Tran') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values (${CUST}, ${T}, ${B}, 'Race', 'Guest', 'Race Guest', '+15550007300', '(555) 000-7300') on conflict (id) do nothing`.execute(db);
    const cat = (await sql`insert into service_categories (tenant_id, branch_id, name) values (${T}, ${B}, 'Race') returning id`.execute(db)).rows[0] as any;
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, price_cents, duration_minutes) values (${SVC}, ${T}, ${B}, ${cat.id}, 'Race Manicure', 3000, 30) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from pos_queue_items where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from services where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from service_categories where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('ten kiosks check the SAME appointment in at once — one check-in / queue entry', async () => {
    const appt = (await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
      values (${T}, ${B}, ${TECH}, ${CUST}, 'Race Guest', 'manual', '[]'::jsonb, current_date, '10:00', '10:30', 30, 'booked', 'not_required') returning id`.execute(db)).rows[0] as any;
    const results = await raceWithGate(10, () => new CheckInService(new KyselyCheckInRepository(db as any)).appointmentCheckIn(ctx, appt.id));
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message)).toEqual([]);
    expect(await count(`appointment_id = '${appt.id}'`, [])).toBe(1);
  });

  it('the same customer walks in on ten kiosks at once — one active queue entry', async () => {
    const body = { customerId: CUST, customerName: 'Race Guest', customerPhone: '+15550007300', serviceIds: [SVC] } as any;
    const results = await raceWithGate(10, () => new CheckInService(new KyselyCheckInRepository(db as any)).walkIn(ctx, body));
    const errors = results.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message);
    expect(await count(`customer_id = '${CUST}' and appointment_id is null and status not in ('cancelled','done','completed','no_show')`, [])).toBe(1);
    expect(errors.every((m) => /already checked in/i.test(m))).toBe(true);
  });

  // mandate §31 (Oct 20 2026): the walk-in's idempotency key used to live in a process Map; a retry that landed on ANOTHER
  // API replica (a new CheckInService here) got "already checked in" instead of its own entry. The key is on the row now.
  it('the same "Complete Check-In" tap retried on ten DIFFERENT replicas (same idempotency key) — one entry, every retry gets it back, nobody is told "already checked in"', async () => {
    const CUST2 = 'e0e0e0e0-0000-4000-8000-00000000c002';
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values (${CUST2}, ${T}, ${B}, 'Retry', 'Guest', 'Retry Guest', '+15550007301', '(555) 000-7301') on conflict (id) do nothing`.execute(db);
    const body = { customerId: CUST2, customerName: 'Retry Guest', customerPhone: '+15550007301', serviceIds: [SVC], idempotencyKey: 'wi-race-' + Date.now() } as any;
    const results = await raceWithGate(10, () => new CheckInService(new KyselyCheckInRepository(db as any)).walkIn(ctx, body));   // a NEW service per call = another replica
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message)).toEqual([]);   // before: nine × "already checked in"
    const ids = new Set(results.map((r: any) => r.value?.checkInId));
    expect(ids.size).toBe(1);
    expect(await count(`customer_id = '${CUST2}' and appointment_id is null and status not in ('cancelled','done','completed','no_show')`, [])).toBe(1);
    expect((await sql<{ k: string }>`select check_in_idempotency_key as k from pos_queue_items where customer_id = ${CUST2} and tenant_id = ${T}`.execute(db)).rows[0].k).toBe(body.idempotencyKey);
    // a later retry on yet another replica, after the dust settles, is the same entry
    const again = await new CheckInService(new KyselyCheckInRepository(db as any)).walkIn(ctx, body);
    expect(again.checkInId).toBe([...ids][0]);
  });

  // Oct 6 2026: a visit is checked in all or nothing, in one transaction. Six displays tapping "I'm Here" for the same
  // two-appointment visit at once: one transaction wins whole, the others roll back and read it — never an error for the
  // guest, never two entries for an appointment, never half a visit.
  it('six displays check the SAME two-appointment visit in at once — one entry per appointment, nobody refused', async () => {
    const mk = async (start: string, end: string) => ((await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
      values (${T}, ${B}, ${TECH}, ${CUST}, 'Race Guest', 'manual', '[]'::jsonb, current_date, ${start}, ${end}, 30, 'booked', 'not_required') returning id`.execute(db)).rows[0] as any).id;
    const a1 = await mk('12:00', '12:30'), a2 = await mk('12:30', '13:00');
    const results = await raceWithGate(6, () => new CheckInService(new KyselyCheckInRepository(db as any)).visitCheckIn(ctx, [a1, a2]));
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message)).toEqual([]);
    expect(await count(`appointment_id = '${a1}' and status not in ('cancelled','removed')`, [])).toBe(1);
    expect(await count(`appointment_id = '${a2}' and status not in ('cancelled','removed')`, [])).toBe(1);
    const ok = results.map((r: any) => r.value) as { duplicate: boolean; row: { checkInId: string } }[][];
    expect(ok.filter((v) => v.every((x) => !x.duplicate))).toHaveLength(1);                  // exactly one tap recorded the visit…
    expect(new Set(ok.map((v) => v.map((x) => x.row.checkInId).join('|'))).size).toBe(1);   // …and every tap answers with its entries
  });

  it('on real Postgres, a failure on the second appointment leaves nothing — not the first entry, not its status', async () => {
    const mk = async (start: string, end: string) => ((await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
      values (${T}, ${B}, ${TECH}, ${CUST}, 'Race Guest', 'manual', '[]'::jsonb, current_date, ${start}, ${end}, 30, 'booked', 'not_required') returning id`.execute(db)).rows[0] as any).id;
    const a1 = await mk('14:00', '14:30'), a2 = await mk('14:30', '15:00');
    const repo = new KyselyCheckInRepository(db as any);
    const real = (repo as any).insertQueueItem.bind(repo); let calls = 0;
    (repo as any).insertQueueItem = async (...args: any[]) => { if (++calls === 2) throw new Error('the server went away'); return real(...args); };
    await expect(new CheckInService(repo).visitCheckIn(ctx, [a1, a2])).rejects.toThrow(/went away/);
    expect(await count(`appointment_id in ('${a1}', '${a2}')`, [])).toBe(0);
    const st = (await sql`select status from pos_tech_appointments where id in (${a1}, ${a2})`.execute(db)).rows.map((r: any) => r.status);
    expect(st).toEqual(['booked', 'booked']);
  });
});
