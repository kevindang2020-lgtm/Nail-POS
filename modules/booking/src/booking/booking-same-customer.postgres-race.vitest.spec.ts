// booking-same-customer.postgres-race.vitest.spec.ts — 200-technician mandate §87 (Oct 26 2026): booking concurrency
// for the SAME CUSTOMER and for the shared resource the schema actually models.
//
// The rule, made explicit here: a customer is double-booked only when one TECHNICIAN would serve them twice at once —
// that is refused (one booking, the rest BookingConflictRace), whether the starts are identical or merely overlap.
// The same customer with two DIFFERENT technicians at the same time is a parallel multi-technician visit (manicure +
// pedicure together — a product feature, contract §7), so both are kept; each technician is still guarded on her own.
// Shared resources: appointments carry no room / chair / station (service_template_resources is a catalog label, not a
// bookable inventory), so the shared resource under contention is the technician's time — exercised here by 20 desks
// booking 20 DIFFERENT customers onto one technician's slot. Real Postgres only (PGlite is one session): PG_RACE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingConflictRace, type PBServiceLine } from './booking.dto';

const url = process.env.PG_RACE_URL;
const T = 'a1000000-0000-4000-8000-0000000087aa';
const B = 'b1000000-0000-4000-8000-0000000087bb';
const MIA = 'c1000000-0000-4000-8000-0000000087c1';
const LEO = 'c1000000-0000-4000-8000-0000000087c2';
const CUST = 'd1000000-0000-4000-8000-0000000087d1';
const DATE = '2999-08-07';
const ctx = { tenantId: T, branchId: B, userId: 'u_race_87', role: 'FRONT_DESK', permissions: [] } as any;
const line: PBServiceLine = { serviceId: 'svc_gel', name: 'Gel Manicure', durationMinutes: 60, priceCents: 4500 } as any;
const item = (tech: string, startTime: string, endTime: string, customerId: string | undefined = CUST, name = 'Grace Kim') => ({
  appointmentId: '', technicianId: tech, customerId, customerName: name, customerPhone: '+16095550187', isVip: false, services: [line], source: 'manual', date: DATE,
  startTime, endTime, status: 'booked', depositStatus: 'not_required', depositCents: 0, notes: '', createdAt: '', updatedAt: '',
}) as any;

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyBookingRepository;
const settle = async <T>(ps: Promise<T>[]) => {
  const r = await Promise.allSettled(ps);
  return {
    ok: r.filter((x) => x.status === 'fulfilled').length,
    conflicts: r.filter((x) => x.status === 'rejected' && (x as PromiseRejectedResult).reason instanceof BookingConflictRace).length,
    other: r.filter((x) => x.status === 'rejected' && !((x as PromiseRejectedResult).reason instanceof BookingConflictRace)).map((x) => String((x as PromiseRejectedResult).reason)),
  };
};
const live = async (where: { tech?: string; customer?: string } = {}) => Number((await sql`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DATE}
  and status not in ('cancelled','no_show','completed') ${where.tech ? sql`and technician_id = ${where.tech}` : sql``} ${where.customer ? sql`and customer_id = ${where.customer}` : sql``}`.execute(db)).rows[0].n);

describe.skipIf(!url)('§87 same-customer and shared-resource booking races (real Postgres)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyBookingRepository(db as any);
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon 87', 'Race Salon 87', 'race-salon-87', 'RACE87', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    for (const [id, f, l] of [[MIA, 'Mia', 'Chen'], [LEO, 'Leo', 'Tran']] as const) {
      await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${id}, ${T}, ${B}, ${f}, ${l}, ${f + ' ' + l}, true) on conflict (id) do nothing`.execute(db);
    }
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${B}, 'Grace', 'Kim', 'Grace Kim') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('ten desks book the SAME customer with the SAME technician at the same minute → one booking, nine conflicts', async () => {
    const r = await settle(Array.from({ length: 10 }, () => repo.create(ctx, item(MIA, '10:00', '11:00'), { bufferMinutes: 0 })));
    expect(r.other).toEqual([]);
    expect(r.ok).toBe(1); expect(r.conflicts).toBe(9);
    expect(await live({ tech: MIA, customer: CUST })).toBe(1);
  });

  it('the same customer on one technician at OVERLAPPING (not identical) starts, fired together → exactly one wins', async () => {
    const starts: Array<[string, string]> = [['12:00', '13:00'], ['12:15', '13:15'], ['12:20', '13:20'], ['12:10', '13:10'], ['11:30', '12:30']];   // pairwise overlapping
    const r = await settle(starts.flatMap(([s, e]) => [repo.create(ctx, item(MIA, s, e), { bufferMinutes: 0 }), repo.create(ctx, item(MIA, s, e), { bufferMinutes: 0 })]));
    expect(r.other).toEqual([]);
    expect(r.ok).toBe(1); expect(r.conflicts).toBe(9);
    const rows = (await sql<{ s: string; e: string }>`select start_time as s, end_time as e from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DATE} and technician_id = ${MIA} and status = 'booked' order by start_time`.execute(db)).rows;
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].e <= rows[i].s).toBe(true);   // Mia never holds two overlapping visits
  });

  it('explicit rule: the same customer with two DIFFERENT technicians at once is a parallel visit — both kept, five rounds, each technician still guarded', async () => {
    for (let round = 0; round < 5; round++) {
      const h = String(14 + round).padStart(2, '0');
      // each round: 6 desks — 3 book Grace with Mia, 3 book Grace with Leo, same minute
      const r = await settle([MIA, MIA, MIA, LEO, LEO, LEO].map((tech) => repo.create(ctx, item(tech, `${h}:00`, `${h}:59`), { bufferMinutes: 0 })));
      expect(r.other).toEqual([]);
      expect(r.ok).toBe(2); expect(r.conflicts).toBe(4);   // one per technician — never two on one technician
      const at = (await sql<{ t: string }>`select technician_id as t from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DATE} and customer_id = ${CUST} and start_time = ${`${h}:00`} and status = 'booked'`.execute(db)).rows.map((x) => x.t).sort();
      expect(at).toEqual([MIA, LEO].sort());
    }
  });

  it('shared resource: 20 desks book 20 DIFFERENT customers onto Leo\'s 20:00 slot → one booking, 19 conflicts; the database holds exactly one', async () => {
    const r = await settle(Array.from({ length: 20 }, (_, i) => repo.create(ctx, item(LEO, '20:00', '21:00', undefined, `Walk-in ${i}`), { bufferMinutes: 0 })));
    expect(r.other).toEqual([]);
    expect(r.ok).toBe(1); expect(r.conflicts).toBe(19);
    const n = Number((await sql`select count(*)::int as n from pos_tech_appointments where tenant_id = ${T} and appt_date = ${DATE} and technician_id = ${LEO} and start_time = '20:00' and status = 'booked'`.execute(db)).rows[0].n);
    expect(n).toBe(1);
  });
});
