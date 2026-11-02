// daily-summaries.writer.ts — BUILD_PLAN Phase 10 (Constitution 1 §62–§63; audit bug 2): the writer the daily summary
// tables never had. Migration 007 created tenant_daily_sales_summary / _booking_summary / _customer_summary, the Super
// Admin Overview and the AI reports read them, and NOTHING wrote them — so card volume, the sales series and every AI
// report's metrics read zero.
//
// Grain: one row per tenant + branch + BUSINESS day (the branch's own time zone — a Los Angeles salon's Tuesday ends at
// 03:00 New York time). Facts come from the real tables:
//   sales     revenue_cents = revenue-bearing payments (REVENUE_BEARING_STATUSES) created that day; refunds_cents =
//             payment_refunds that reached 'refunded' that day (branch from the refund, else its payment);
//   bookings  pos_tech_appointments by appt_date (already a local date): all / completed / cancelled / no_show;
//   customers new = customers created that day; active = distinct customers with a paid ticket that day;
//             returning = those of the active ones who had a paid ticket at that branch before that day.
// Every write is an UPSERT on (tenant_id, branch_id, summary_date) (migration 540's unique index), so re-running a day
// replaces it — the hourly job rewrites TODAY and YESTERDAY (late payments, refunds after midnight), and the history
// backfill (scripts/db-backfill-summaries.mjs) can run as often as it likes. created_at is the business day's local
// midnight, so the Overview's month filter (it reads created_at) puts a row in the month it belongs to.
import { sql, type Kysely } from 'kysely';
import { REVENUE_BEARING_STATUSES } from '@aipowersalon/api-contracts';

export const DEFAULT_SUMMARY_TIME_ZONE = 'America/New_York';

function validTz(tz: unknown): string {
  if (typeof tz !== 'string' || !tz.trim()) return DEFAULT_SUMMARY_TIME_ZONE;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return DEFAULT_SUMMARY_TIME_ZONE; }
}

export interface SummaryWriteOptions {
  /** Only this tenant (default: every tenant with a branch). */
  tenantId?: string;
  /** Only these branches (the backfill walks branches in batches). */
  branchIds?: string[];
  /** Inclusive local-date range 'YYYY-MM-DD'. Default: each branch's local today and yesterday. */
  from?: string;
  to?: string;
}

export interface SummaryWriteResult { branches: number; salesRows: number; bookingRows: number; customerRows: number }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Write (upsert) the three daily summaries for the chosen branches and days. Idempotent. */
export async function writeDailySummaries(db: Kysely<any>, opts: SummaryWriteOptions = {}): Promise<SummaryWriteResult> {
  if ((opts.from && !DATE_RE.test(opts.from)) || (opts.to && !DATE_RE.test(opts.to))) throw new Error('summary dates are YYYY-MM-DD');
  let q = db.selectFrom('branches').select(['id', 'tenant_id', 'timezone']);
  if (opts.tenantId) q = q.where('tenant_id', '=', opts.tenantId);
  if (opts.branchIds) { if (!opts.branchIds.length) return { branches: 0, salesRows: 0, bookingRows: 0, customerRows: 0 }; q = q.where('id', 'in', opts.branchIds); }
  const branches: any[] = await q.execute();
  if (!branches.length) return { branches: 0, salesRows: 0, bookingRows: 0, customerRows: 0 };
  const bIds = branches.map((b) => String(b.id)); const tIds = branches.map((b) => String(b.tenant_id)); const tzs = branches.map((b) => validTz(b.timezone));
  const days = opts.from || opts.to
    ? sql`generate_series(${opts.from ?? opts.to}::date, ${opts.to ?? opts.from}::date, interval '1 day')`
    : sql`(values ((now() at time zone br.tz)::date), ((now() at time zone br.tz)::date - 1))`;
  // targets: one row per (branch, local day) with that day's UTC bounds
  const targets = sql`
      select br.tenant_id, br.branch_id, br.tz, dd.day,
             (dd.day::timestamp at time zone br.tz) as day_start,
             ((dd.day + 1)::timestamp at time zone br.tz) as day_end
        from unnest(${tIds}::uuid[], ${bIds}::uuid[], ${tzs}::text[]) as br(tenant_id, branch_id, tz)
        cross join lateral (select g.day::date as day from ${days} as g(day)) dd`;
  const revenue = [...REVENUE_BEARING_STATUSES];

  const sales = await sql`
    with targets as (${targets})
    insert into tenant_daily_sales_summary (tenant_id, branch_id, summary_date, revenue_cents, refunds_cents, created_at, updated_at)
    select t.tenant_id, t.branch_id, t.day,
           coalesce((select sum(p.amount_cents) from payments p
                      where p.tenant_id = t.tenant_id and p.branch_id = t.branch_id and p.status = any(${revenue}::text[])
                        and p.created_at >= t.day_start and p.created_at < t.day_end), 0),
           coalesce((select sum(r.amount_cents) from payment_refunds r left join payments p on p.id = r.payment_id and p.tenant_id = r.tenant_id
                      where r.tenant_id = t.tenant_id and coalesce(r.branch_id, p.branch_id) = t.branch_id and r.status = 'refunded'
                        and r.created_at >= t.day_start and r.created_at < t.day_end), 0),
           t.day_start, now()
      from targets t
    on conflict (tenant_id, branch_id, summary_date) do update
      set revenue_cents = excluded.revenue_cents, refunds_cents = excluded.refunds_cents, updated_at = now()`.execute(db);

  const bookings = await sql`
    with targets as (${targets})
    insert into tenant_daily_booking_summary (tenant_id, branch_id, summary_date, bookings, completed, cancelled, no_show, created_at, updated_at)
    select t.tenant_id, t.branch_id, t.day,
           count(a.id)::int,
           count(a.id) filter (where a.status = 'completed')::int,
           count(a.id) filter (where a.status = 'cancelled')::int,
           count(a.id) filter (where a.status = 'no_show')::int,
           t.day_start, now()
      from targets t
      left join pos_tech_appointments a on a.tenant_id = t.tenant_id and a.branch_id = t.branch_id and a.appt_date = t.day
     group by t.tenant_id, t.branch_id, t.day, t.day_start
    on conflict (tenant_id, branch_id, summary_date) do update
      set bookings = excluded.bookings, completed = excluded.completed, cancelled = excluded.cancelled, no_show = excluded.no_show, updated_at = now()`.execute(db);

  const customers = await sql`
    with targets as (${targets}),
    visits as (
      select t.tenant_id, t.branch_id, t.day, k.customer_id,
             exists (select 1 from tickets e where e.tenant_id = t.tenant_id and e.branch_id = t.branch_id and e.customer_id = k.customer_id
                       and e.paid_at is not null and e.paid_at < t.day_start) as returning
        from targets t
        join (select distinct tenant_id, branch_id, customer_id, paid_at from tickets where paid_at is not null) k
          on k.tenant_id = t.tenant_id and k.branch_id = t.branch_id and k.paid_at >= t.day_start and k.paid_at < t.day_end
    )
    insert into tenant_daily_customer_summary (tenant_id, branch_id, summary_date, new_customers, returning_customers, active_customers, created_at, updated_at)
    select t.tenant_id, t.branch_id, t.day,
           (select count(*) from customers c where c.tenant_id = t.tenant_id and c.branch_id = t.branch_id and c.created_at >= t.day_start and c.created_at < t.day_end)::int,
           (select count(distinct v.customer_id) from visits v where v.tenant_id = t.tenant_id and v.branch_id = t.branch_id and v.day = t.day and v.returning)::int,
           (select count(distinct v.customer_id) from visits v where v.tenant_id = t.tenant_id and v.branch_id = t.branch_id and v.day = t.day)::int,
           t.day_start, now()
      from targets t
    on conflict (tenant_id, branch_id, summary_date) do update
      set new_customers = excluded.new_customers, returning_customers = excluded.returning_customers, active_customers = excluded.active_customers, updated_at = now()`.execute(db);

  const n = (r: any) => Number(r?.numAffectedRows ?? r?.rowCount ?? 0);
  return { branches: branches.length, salesRows: n(sales), bookingRows: n(bookings), customerRows: n(customers) };
}
