// branch-day.postgres-race.vitest.spec.ts — Oct 3 2026: salon-facing "today" is the BRANCH's day, not the database's UTC
// date. Three places checked on real Postgres: the time clock files a shift under the branch's day; the customer app
// lets a customer check in at 8:30 pm New Jersey time for tonight's appointment; the owner portfolio's "revenue today"
// starts at the salon's midnight. Opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyTimeClockRepository, TimeClockService } from '@aipowersalon/workforce';
import { KyselyOwnerPortfolioRepo } from '@aipowersalon/tenants';
import { KyselyCustomerRepository } from '../customer/customer.kysely.repository';

const url = process.env.PG_RACE_URL;
const T = 'a7500000-0000-4000-8000-0000000000a1', B = 'b7500000-0000-4000-8000-0000000000b1', TECH = 'c7500000-0000-4000-8000-0000000000c1', C = 'e7500000-0000-4000-8000-0000000000e1';
const T2 = 'a7510000-0000-4000-8000-0000000000a2', B2 = 'b7510000-0000-4000-8000-0000000000b2';
let db: Kysely<any>; let pool: pg.Pool;

describe.skipIf(!url)('salon-facing today is the branch day', () => {
  beforeAll(async () => {
    clearBranchTimeZoneCache();
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    for (const [t, b, tz, slug] of [[T, B, 'America/New_York', 'bd-nj'], [T2, B2, 'Pacific/Kiritimati', 'bd-kiri-2']]) {
      await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active') on conflict (id) do nothing`.execute(db);
      await sql`insert into branches (id, tenant_id, name, timezone) values (${b}, ${t}, ${slug}, ${tz}) on conflict (id) do update set timezone = excluded.timezone`.execute(db);
    }
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Mia', 'Tran', 'Mia Tran') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee') on conflict (id) do nothing`.execute(db);
    for (const t of [T, T2]) for (const tb of ['technician_shifts', 'pos_queue_items', 'pos_tech_appointments', 'payments']) await sql`delete from ${sql.table(tb)} where tenant_id = ${t}`.execute(db).catch(() => undefined);
  });
  afterAll(async () => { vi.useRealTimers(); clearBranchTimeZoneCache(); for (const t of [T, T2]) for (const tb of ['technician_shifts', 'pos_queue_items', 'pos_tech_appointments', 'payments', 'tickets']) await sql`delete from ${sql.table(tb)} where tenant_id = ${t}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('the time clock files an 8:30 pm New Jersey clock-in under that day (shift_date), not tomorrow', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T00:30:00Z'));
    try {
      await new TimeClockService(new KyselyTimeClockRepository(db as any)).clockIn({ tenantId: T, branchId: B, userId: 'u', role: 'MANAGER', permissions: ['timeclock.manage'] } as any, TECH);
      const r: any = (await sql`select shift_date::text d from technician_shifts where tenant_id = ${T} and technician_id = ${TECH}`.execute(db)).rows[0];
      expect(r.d).toBe('2026-10-01');
    } finally { vi.useRealTimers(); }
  });

  it("the customer app accepts check-in at 8:30 pm New Jersey time for tonight's appointment, and refuses tomorrow's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T00:30:00Z'));
    try {
      const ins = async (d: string) => String(((await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
        values (${T}, ${B}, ${TECH}, ${C}, 'Ana Lee', 'customer_app', '[]'::jsonb, ${d}, '21:00', '21:30', 30, 'booked', 'not_required') returning id`.execute(db)).rows[0] as any).id);
      const tonight = await ins('2026-10-01'), tomorrow = await ins('2026-10-02');
      const repo = new KyselyCustomerRepository(db as any);
      const ctx: any = { tenantId: T, userId: 'cust-user', role: 'CUSTOMER' };
      const a: any = await repo.checkInAppointment(ctx, C, tonight).catch((e: any) => ({ ok: false, message: String(e?.message) }));
      expect(a.message ?? '').not.toMatch(/day of your appointment/);
      const b: any = await repo.checkInAppointment(ctx, C, tomorrow);
      expect(b).toMatchObject({ ok: false, message: 'You can check in on the day of your appointment.' });
    } finally { vi.useRealTimers(); }
  });

  it("the owner portfolio's revenue today starts at the SALON's midnight (UTC+14 salon: a minute before its midnight is yesterday)", async () => {
    const C2 = 'e7510000-0000-4000-8000-0000000000e2';
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C2}, ${T2}, ${B2}, 'Kai', 'Lo', 'Kai Lo') on conflict (id) do nothing`.execute(db);
    const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T2}, ${B2}, ${C2}, 'paid', 3333, 0, 0, 3333) returning id`.execute(db)).rows[0];
    await sql`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values
      (gen_random_uuid(), ${T2}, ${B2}, ${tk.id}, 'card', 1111, 0, 'captured', (date_trunc('day', now() at time zone 'Pacific/Kiritimati') + interval '1 minute') at time zone 'Pacific/Kiritimati'),
      (gen_random_uuid(), ${T2}, ${B2}, ${tk.id}, 'card', 2222, 0, 'captured', (date_trunc('day', now() at time zone 'Pacific/Kiritimati') - interval '1 minute') at time zone 'Pacific/Kiritimati')`.execute(db);
    const [row] = await new KyselyOwnerPortfolioRepo(db as any).loadTotals([T2]);
    expect(row.revenueTodayCents).toBe(1111);
  });
});
