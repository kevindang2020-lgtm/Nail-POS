// daily-summaries.pgtest — BUILD_PLAN Phase 10, audit bug 2, on the real schema: the daily summary tables the Super Admin
// Overview and the AI reports read are WRITTEN — from the real payments, refunds, appointments, tickets and customers,
// per branch and business day (the branch's own time zone), and a re-run replaces a day instead of adding to it.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { writeDailySummaries } from './daily-summaries.writer';
import { KyselyReportRunRepository } from '../super-admin-ai-reports/report-run.kysely.repository';

const T = 'd5d5d5d5-0000-4000-8000-0000000000a1', B = 'd5d5d5d5-0000-4000-8000-0000000000b1', B2 = 'd5d5d5d5-0000-4000-8000-0000000000b2';
const C1 = 'd5d5d5d5-0000-4000-8000-0000000000c1', C2 = 'd5d5d5d5-0000-4000-8000-0000000000c2';
const TK = (n: number) => `d5d5d5d5-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
const PY = (n: number) => `d5d5d5d5-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const TECH = 'd5d5d5d5-0000-4000-8000-0000000000e1';
const DAY = '2026-09-15';                                      // a past business day in Los Angeles
const LA = (hhmm: string, day = DAY) => `${day} ${hhmm} America/Los_Angeles`;
let pg: any; let db: any;
const rows = async (table: string, day = DAY) => (await sql<any>`select * from ${sql.table(table)} where tenant_id = ${T} and summary_date = ${day}::date order by branch_id`.execute(db)).rows;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','S','Summary Salon','summary-salon','SUMM01','active');
    INSERT INTO branches (id, tenant_id, name, timezone) VALUES ('${B}','${T}','West','America/Los_Angeles'), ('${B2}','${T}','East','not/a-zone');
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, created_at) VALUES
      ('${C1}','${T}','${B}','Old','Client','Old Client','active','${LA('10:00', '2026-09-01')}'),
      ('${C2}','${T}','${B}','New','Client','New Client','active','${LA('09:00')}');
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, paid_at) VALUES
      ('${TK(1)}','${T}','${B}','${C1}','paid','${LA('11:00', '2026-09-10')}'),   -- C1 visited before → returning on DAY
      ('${TK(2)}','${T}','${B}','${C1}','paid','${LA('12:00')}'),
      ('${TK(3)}','${T}','${B}','${C2}','paid','${LA('23:30')}'),                 -- 23:30 LA is the NEXT day in UTC — still DAY
      ('${TK(4)}','${T}','${B}','${C2}','paid','${LA('00:30', '2026-09-16')}');   -- the next local day: not DAY
    INSERT INTO payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, change_due_cents, created_at) VALUES
      ('${PY(1)}','${T}','${B}','${TK(2)}','card',5000,0,0,0,'approved',0,'${LA('12:00')}'),
      ('${PY(2)}','${T}','${B}','${TK(3)}','cash',3000,0,0,0,'approved',0,'${LA('23:30')}'),
      ('${PY(3)}','${T}','${B}','${TK(3)}','card',999,0,0,0,'declined',0,'${LA('23:00')}'),     -- not revenue
      ('${PY(4)}','${T}','${B}','${TK(4)}','card',7000,0,0,0,'approved',0,'${LA('00:30', '2026-09-16')}');
    INSERT INTO payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, created_at) VALUES
      ('${T}', NULL, '${PY(1)}', 1000, 'refunded', '${LA('15:00')}'),                    -- branch taken from its payment
      ('${T}', '${B}', '${PY(1)}', 500, 'reserved', '${LA('15:30')}');                   -- not refunded yet
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${TECH}','${T}','${B}','Tia','Ng','Tia Ng');
    INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source, deposit_status) VALUES
      ('${T}','${B}','${TECH}','A','[]','${DAY}','09:00','10:00',60,'completed','manual','not_required'),
      ('${T}','${B}','${TECH}','B','[]','${DAY}','10:00','11:00',60,'cancelled','manual','not_required'),
      ('${T}','${B}','${TECH}','C','[]','${DAY}','11:00','12:00',60,'no_show','manual','not_required'),
      ('${T}','${B}','${TECH}','D','[]','${DAY}','12:00','13:00',60,'booked','manual','not_required');`);
}, 120_000);

describe('summaries.daily writes the tables the Overview and AI reports read', () => {
  it('sales / bookings / customers for one business day, per branch, from the real tables', async () => {
    const r = await writeDailySummaries(db, { tenantId: T, from: DAY, to: DAY });
    expect(r.branches).toBe(2);
    const [s] = (await rows('tenant_daily_sales_summary')).filter((x: any) => x.branch_id === B);
    expect([Number(s.revenue_cents), Number(s.refunds_cents)]).toEqual([8000, 1000]);
    expect(new Date(s.created_at).toISOString()).toBe('2026-09-15T07:00:00.000Z');   // the business day's local midnight (PDT = UTC-7)
    const [b] = (await rows('tenant_daily_booking_summary')).filter((x: any) => x.branch_id === B);
    expect(b).toMatchObject({ bookings: 4, completed: 1, cancelled: 1, no_show: 1 });
    const [c] = (await rows('tenant_daily_customer_summary')).filter((x: any) => x.branch_id === B);
    expect(c).toMatchObject({ new_customers: 1, returning_customers: 1, active_customers: 2 });
    // the East branch (an invalid zone falls back to New York) had nothing: an honest zero row, not a missing one
    const [e] = (await rows('tenant_daily_sales_summary')).filter((x: any) => x.branch_id === B2);
    expect(Number(e.revenue_cents)).toBe(0);
  });

  it('a re-run REPLACES the day (upsert on tenant + branch + day) — late facts are picked up, nothing doubles', async () => {
    await pg.exec(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, change_due_cents, created_at)
      VALUES ('${T}','${B}','${TK(2)}','cash',2500,0,0,0,'approved',0,'${LA('18:00')}')`);
    await writeDailySummaries(db, { tenantId: T, from: DAY, to: DAY });
    await writeDailySummaries(db, { tenantId: T, from: DAY, to: DAY });
    const sales = (await rows('tenant_daily_sales_summary')).filter((x: any) => x.branch_id === B);
    expect(sales).toHaveLength(1);
    expect(Number(sales[0].revenue_cents)).toBe(10500);
    expect((await rows('tenant_daily_booking_summary'))).toHaveLength(2);
    await expect(sql`insert into tenant_daily_sales_summary (tenant_id, branch_id, summary_date) values (${T}, ${B}, ${DAY}::date)`.execute(db)).rejects.toThrow();
  });

  it('the hourly default writes each branch\'s local TODAY and YESTERDAY — a payment made now lands in today', async () => {
    await pg.exec(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, tax_cents, discount_cents, status, change_due_cents)
      VALUES ('${T}','${B}','${TK(2)}','card',1234,0,0,0,'approved',0)`);
    await writeDailySummaries(db, { tenantId: T });
    const today = (await sql<any>`select (now() at time zone 'America/Los_Angeles')::date::text d`.execute(db)).rows[0].d;
    const t = (await rows('tenant_daily_sales_summary', today)).filter((x: any) => x.branch_id === B);
    expect(Number(t[0].revenue_cents)).toBe(1234);
    const days = (await sql<any>`select count(distinct summary_date)::int n from tenant_daily_sales_summary where tenant_id = ${T} and branch_id = ${B} and summary_date <> ${DAY}::date`.execute(db)).rows[0].n;
    expect(days).toBe(2);
  });

  it('the AI report metrics now read real figures for the day', async () => {
    const m = await new KyselyReportRunRepository(db).snapshotMetrics({ tenantId: T, branchId: B } as any, DAY, DAY);
    expect(m).toMatchObject({ revenueCents: 10500, refundsCents: 1000, bookings: 4, completed: 1, cancelled: 1, noShow: 1, newCustomers: 1, returningCustomers: 1, hasData: true });
  });
});
