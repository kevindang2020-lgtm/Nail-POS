// owner-portfolio.repository.ts — the ONLY query in the Owner App that deliberately crosses tenants.
//
// Every other owner query is hard-scoped to the session's single `tenantId` — 93 of them — and that is correct:
// once a salon is selected, data must not leak across salons. This one is different by design, because it answers
// the question "which salons is this person allowed into at all?", which cannot be answered from inside one salon.
//
// The safety of the whole feature rests on the WHERE clause here:
//
//     where uba.user_id = <the id from the verified session>
//
// The user id comes from the signed session cookie, never from the request body. So this query can only ever
// return salons that this person actually holds a membership at — there is no input an attacker could bend to
// widen it.
import { runAcrossTenants } from '@aipowersalon/database';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { OwnerPortfolio, PortfolioSalon, RevenuePoint, SalonAccessLevel, SalonTotals } from './owner-portfolio-core';
import { ACCESS_LEVELS } from './owner-portfolio-core';

export interface OwnerPortfolioRepo {
  loadPortfolio(ownerUserId: string): Promise<OwnerPortfolio>;
  /** Totals for the given salons. Only ever called with tenant ids the portfolio already approved. */
  loadTotals(tenantIds: string[]): Promise<SalonTotals[]>;
  /** Hourly revenue across the given salons for TODAY (each salon's own day and hours) — the Revenue Overview chart. Integer cents, refund-netted. */
  loadRevenueSeries(tenantIds: string[]): Promise<RevenuePoint[]>;
  recordSwitch(ownerUserId: string, tenantId: string, branchId: string | null, ip: string | null): Promise<void>;
}

/** An unrecognised access level is treated as the LEAST privileged, never the most. */
function toAccessLevel(v: unknown): SalonAccessLevel {
  const s = String(v ?? '').toLowerCase();
  return (ACCESS_LEVELS as string[]).includes(s) ? (s as SalonAccessLevel) : 'report_only';
}

export class KyselyOwnerPortfolioRepo implements OwnerPortfolioRepo {
  constructor(private readonly db: AppDatabase) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  async loadPortfolio(ownerUserId: string): Promise<OwnerPortfolio> {
    // Reads ACROSS salons by design (an owner sees every salon they own) — run with no tenant on the database session so Postgres row-level
    // security (DB_TENANT_RLS) does not empty it. The only sanctioned way to cross salons inside a tenant request.
    return runAcrossTenants("an owner sees every salon they own", () => this.__loadPortfolioUnscoped(ownerUserId));
  }
  private async __loadPortfolioUnscoped(ownerUserId: string): Promise<OwnerPortfolio> {
    if (!this.db || !ownerUserId) return { ownerUserId, salons: [] };

    // One row per (salon, branch) the owner is granted. `user_branch_access` already carries tenant_id, so this
    // spans salons without any new table.
    const res: any = await sql`
      select
        uba.tenant_id,
        uba.branch_id,
        uba.access_level,
        uba.is_primary_owner,
        t.display_name  as salon_name,
        t.tenant_code   as store_code,
        t.status        as tenant_status,
        b.name          as branch_name,
        b.city          as branch_city,
        b.state         as branch_state,
        b.status        as branch_status
      from user_branch_access uba
      join tenants  t on t.id = uba.tenant_id
      join branches b on b.id = uba.branch_id
      where uba.user_id = ${ownerUserId}
      order by t.display_name asc, b.name asc`.execute(this.db);

    const bySalon = new Map<string, PortfolioSalon>();

    for (const r of (res?.rows ?? [])) {
      const tenantId = String(r.tenant_id);
      let salon = bySalon.get(tenantId);

      if (!salon) {
        salon = {
          tenantId,
          salonName: String(r.salon_name ?? 'Salon'),
          storeCode: String(r.store_code ?? ''),
          tenantStatus: String(r.tenant_status ?? 'active'),
          accessLevel: toAccessLevel(r.access_level),
          isPrimaryOwner: !!r.is_primary_owner,
          branches: [],
        };
        bySalon.set(tenantId, salon);
      } else {
        // The grant is per branch, so one salon can appear with several rows. If they disagree, keep the HIGHEST
        // level *within that salon* — the owner was clearly given it there. This never leaks across salons.
        const rank = (l: SalonAccessLevel) => ACCESS_LEVELS.indexOf(l);
        const incoming = toAccessLevel(r.access_level);
        if (rank(incoming) < rank(salon.accessLevel)) salon.accessLevel = incoming;
        if (r.is_primary_owner) salon.isPrimaryOwner = true;
      }

      salon.branches.push({
        branchId: String(r.branch_id),
        name: String(r.branch_name ?? 'Location'),
        city: r.branch_city ?? null,
        state: r.branch_state ?? null,
        isActive: String(r.branch_status ?? '').toLowerCase() === 'active',
      });
    }

    return { ownerUserId, salons: [...bySalon.values()] };
  }

  /**
   * Per-salon figures for the portfolio view. Money in INTEGER CENTS.
   *
   * `tenantIds` always comes from the already-resolved portfolio, so this cannot be pointed at someone else's
   * salon — but the `= any(...)` bind keeps it a parameter rather than string-built SQL regardless.
   */
  async loadTotals(tenantIds: string[]): Promise<SalonTotals[]> {
    // Reads ACROSS salons by design (the owner portfolio's per-salon totals) — run with no tenant on the database session so Postgres row-level
    // security (DB_TENANT_RLS) does not empty it. The only sanctioned way to cross salons inside a tenant request.
    return runAcrossTenants("the owner portfolio's per-salon totals", () => this.__loadTotalsUnscoped(tenantIds));
  }
  private async __loadTotalsUnscoped(tenantIds: string[]): Promise<SalonTotals[]> {
    if (!this.db || !tenantIds.length) return [];

    // ── What was wrong here ───────────────────────────────────────────────────────────────────────────────
    // 1. `customers_waiting` selected from **queue_entries**, a table that DOES NOT EXIST (the real one is
    //    `pos_queue_items`, migration 026). Postgres therefore threw on the whole statement, loadTotals()
    //    rejected, and GET /owner/portfolio/summary returned a 500 — the entire All Salons dashboard was dead.
    //    Nothing caught it, so it failed loudly in production and silently in review.
    // 2. SalonTotals requires checkedIn / servicesInProgress / readyForCheckout / newClientsToday /
    //    aiReceptionistLive. NONE of them were selected or mapped, so summarize() was adding `undefined` and
    //    five of the twelve KPI cards would have been NaN even if the query had run.
    // 3. Revenue summed `payments` and never subtracted `payment_refunds` (a separate table), so every owner
    //    figure was OVERSTATED by every refund ever issued. Money must net.
    //
    // Money stays in integer cents throughout; refunds are subtracted, never "adjusted away".
    const res: any = await sql`
      select
        t.id as tenant_id,

        -- pos_tech_appointments, NOT appointments. The legacy appointments table was DROPPED in migration
        -- 041 ("superseded by pos_tech_appointments... a full-repo audit confirmed ZERO remaining readers").
        -- That audit was wrong, or a reader was added after it: this query was still reading the dropped table,
        -- so the whole statement threw and GET /owner/portfolio/summary 500'd. Fixing queue_entries earlier was
        -- not enough — the SAME query had a second dead table in it, and only a real Postgres could say so.
        --
        -- Note the column shape differs too: pos_tech_appointments stores appt_date DATE + start_time TEXT,
        -- not a starts_at timestamp. A blind table rename would have compiled and still failed.
        (select count(*)::int from pos_tech_appointments a
          where a.tenant_id = t.id and a.appt_date = (clk.n at time zone tz.z)::date
            and coalesce(a.status,'') not in ('cancelled','no_show'))                        as appointments_today,

        -- The canonical POS workflow, read from the LIVE queue (pos_queue_items) - not derived from
        -- appointments, which would double-count a walk-in who never had one.
        (select count(*)::int from pos_queue_items q
          where q.tenant_id = t.id and (q.checked_in_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date
            and coalesce(q.status,'') not in ('cancelled','removed'))                        as checked_in,
        (select count(*)::int from pos_queue_items q
          where q.tenant_id = t.id and coalesce(q.status,'') = 'waiting')                    as customers_waiting,
        (select count(*)::int from pos_queue_items q
          where q.tenant_id = t.id and coalesce(q.status,'') = 'in_service')                 as services_in_progress,

        -- Ready for checkout = an open ticket that has not been paid. paid_at IS NULL is the canonical
        -- unpaid signal on the tickets table.
        (select count(*)::int from tickets k
          where k.tenant_id = t.id and k.paid_at is null
            and coalesce(k.status,'') <> 'cancelled')                                        as ready_for_checkout,

        (select count(distinct u.id)::int from users u
          where u.tenant_id = t.id and u.role = 'TECHNICIAN' and u.status = 'active')        as technicians_working,

        (select count(*)::int from customers c
          where c.tenant_id = t.id and (c.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date)                    as new_clients_today,

        -- REVENUE NETS REFUNDS. payment_refunds is a separate table; summing payments alone overstates
        -- every figure on this dashboard by the value of every refund the salon has issued.
        coalesce((select sum(p.amount_cents)::bigint from payments p
          where p.tenant_id = t.id and (p.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date
            and coalesce(p.status,'') in ('captured','settled')), 0)
        - coalesce((select sum(r.amount_cents)::bigint from payment_refunds r
          where r.tenant_id = t.id and (r.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date
            and coalesce(r.status,'') = 'refunded'), 0)                                      as revenue_today_cents,

        coalesce((select sum(p.amount_cents)::bigint from payments p
          where p.tenant_id = t.id and date_trunc('month', p.created_at at time zone tz.z) = date_trunc('month', clk.n at time zone tz.z)
            and coalesce(p.status,'') in ('captured','settled')), 0)
        - coalesce((select sum(r.amount_cents)::bigint from payment_refunds r
          where r.tenant_id = t.id and date_trunc('month', r.created_at at time zone tz.z) = date_trunc('month', clk.n at time zone tz.z)
            and coalesce(r.status,'') = 'refunded'), 0)                                      as revenue_month_cents,

        coalesce((select sum(p.tip_cents)::bigint from payments p
          where p.tenant_id = t.id and (p.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date
            and coalesce(p.status,'') in ('captured','settled')), 0)                         as tips_today_cents,

        -- YESTERDAY, same salon, same refund-netting. These exist so the dashboard's change percentages can be
        -- COMPUTED. Aggregating them over the same salon set as the current figures is the whole point: a total
        -- built from four salons compared against one built from three would manufacture a change nobody made.
        coalesce((select sum(p.amount_cents)::bigint from payments p
          where p.tenant_id = t.id and (p.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date - 1
            and coalesce(p.status,'') in ('captured','settled')), 0)
        - coalesce((select sum(r.amount_cents)::bigint from payment_refunds r
          where r.tenant_id = t.id and (r.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date - 1
            and coalesce(r.status,'') = 'refunded'), 0)                                      as revenue_yesterday_cents,
        coalesce((select sum(p.tip_cents)::bigint from payments p
          where p.tenant_id = t.id and (p.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date - 1
            and coalesce(p.status,'') in ('captured','settled')), 0)                         as tips_yesterday_cents,
        (select count(*)::int from pos_tech_appointments a
          where a.tenant_id = t.id and a.appt_date = (clk.n at time zone tz.z)::date - 1
            and coalesce(a.status,'') not in ('cancelled','no_show'))                        as appointments_yesterday,
        (select count(*)::int from pos_queue_items q
          where q.tenant_id = t.id and (q.checked_in_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date - 1
            and coalesce(q.status,'') not in ('cancelled','removed'))                        as checked_in_yesterday,
        (select count(*)::int from customers c
          where c.tenant_id = t.id and (c.created_at at time zone tz.z)::date = (clk.n at time zone tz.z)::date - 1)                as new_clients_yesterday,

        -- NULL when the salon has no agent at all. That is NOT the same as "offline", which would imply
        -- something is broken rather than that it was never set up — summarize() relies on the distinction.
        (select case when count(*) = 0 then null else bool_or(g.status = 'live') end
           from ai_receptionist_agents g where g.tenant_id = t.id)                            as ai_receptionist_live

      from tenants t
      -- the clock, once (tests set it) — every "today", "yesterday" and "this month" below is read from it
      cross join (select ${new Date(this.now())}::timestamptz as n) clk
      -- each salon's day (Oct 3 2026 — was the database's UTC date): its first branch with a VALID zone, else New York.
      -- This month too (Oct 6 2026 — was the UTC month, so a New York salon's month turned over at 8 pm on the last day).
      cross join lateral (select coalesce((select b.timezone from branches b where b.tenant_id = t.id and b.timezone in (select name from pg_timezone_names) order by b.created_at limit 1), 'America/New_York') as z) tz
      where t.id = any(${tenantIds}::uuid[])`.execute(this.db);

    return (res?.rows ?? []).map((r: any) => ({
      tenantId: String(r.tenant_id),
      appointmentsToday: Number(r.appointments_today ?? 0),
      checkedIn: Number(r.checked_in ?? 0),
      customersWaiting: Number(r.customers_waiting ?? 0),
      servicesInProgress: Number(r.services_in_progress ?? 0),
      readyForCheckout: Number(r.ready_for_checkout ?? 0),
      techniciansWorking: Number(r.technicians_working ?? 0),
      newClientsToday: Number(r.new_clients_today ?? 0),
      // bigint arrives as a string; Number() is safe at these magnitudes and keeps them integers.
      revenueTodayCents: Number(r.revenue_today_cents ?? 0),
      revenueMonthCents: Number(r.revenue_month_cents ?? 0),
      tipsTodayCents: Number(r.tips_today_cents ?? 0),
      revenueYesterdayCents: Number(r.revenue_yesterday_cents ?? 0),
      tipsYesterdayCents: Number(r.tips_yesterday_cents ?? 0),
      appointmentsYesterday: Number(r.appointments_yesterday ?? 0),
      checkedInYesterday: Number(r.checked_in_yesterday ?? 0),
      newClientsYesterday: Number(r.new_clients_yesterday ?? 0),
      // Preserve NULL — do not coerce a salon with no agent into `false`.
      aiReceptionistLive: r.ai_receptionist_live == null ? null : Boolean(r.ai_receptionist_live),
    }));
  }

  /**
   * Hourly revenue for today, aggregated across the authorized salons — the Revenue Overview chart.
   *
   * `generate_series` produces every hour of the day, so a quiet hour renders as a real 0 rather than a gap the
   * chart would silently interpolate through. Refunds are subtracted in the same bucket they were issued in.
   * Money is integer cents; nothing here is rounded or averaged.
   */
  async loadRevenueSeries(tenantIds: string[]): Promise<RevenuePoint[]> {
    // Reads ACROSS salons by design (the owner portfolio's revenue across salons) — run with no tenant on the database session so Postgres row-level
    // security (DB_TENANT_RLS) does not empty it. The only sanctioned way to cross salons inside a tenant request.
    return runAcrossTenants("the owner portfolio's revenue across salons", () => this.__loadRevenueSeriesUnscoped(tenantIds));
  }
  private async __loadRevenueSeriesUnscoped(tenantIds: string[]): Promise<RevenuePoint[]> {
    if (!this.db || !tenantIds.length) return [];
    // Each salon's OWN day and hours (Oct 6 2026 — was the database's UTC day, so after 8 pm in New York the chart
    // showed tomorrow, empty, and a 9 am sale sat in the "13" bucket): a sale is counted in the hour of the day it
    // happened at that salon, so "9" means 9 am at every salon in the portfolio, whatever its zone.
    const res: any = await sql`
      with clk as (select ${new Date(this.now())}::timestamptz as n),
      zones as (
        select t.id, coalesce((select b.timezone from branches b where b.tenant_id = t.id and b.timezone in (select name from pg_timezone_names) order by b.created_at limit 1), 'America/New_York') as z
        from tenants t where t.id = any(${tenantIds}::uuid[])
      ),
      moves as (
        select extract(hour from p.created_at at time zone zn.z)::int as h, p.amount_cents::bigint as c
          from payments p join zones zn on zn.id = p.tenant_id cross join clk
          where coalesce(p.status,'') in ('captured','settled')
            and (p.created_at at time zone zn.z)::date = (clk.n at time zone zn.z)::date
        union all
        select extract(hour from r.created_at at time zone zn.z)::int as h, -r.amount_cents::bigint as c
          from payment_refunds r join zones zn on zn.id = r.tenant_id cross join clk
          where coalesce(r.status,'') = 'refunded'
            and (r.created_at at time zone zn.z)::date = (clk.n at time zone zn.z)::date
      )
      select hours.h as hour, coalesce((select sum(m.c) from moves m where m.h = hours.h), 0)::bigint as revenue_cents
      from generate_series(0, 23) as hours(h)
      order by hours.h`.execute(this.db);

    return (res?.rows ?? []).map((r: any) => ({
      hour: Number(r.hour ?? 0),
      revenueCents: Number(r.revenue_cents ?? 0),
    }));
  }

  /** Salon switches are security-relevant: they are how an owner moves between businesses. Append-only. */
  async recordSwitch(ownerUserId: string, tenantId: string, branchId: string | null, ip: string | null): Promise<void> {
    if (!this.db) return;
    try {
      await sql`
        insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, ip_address, metadata_json)
        values (${tenantId}, ${ownerUserId}, 'OWNER', 'owner.salon_switched', 'tenant', ${tenantId},
                ${ip}, ${JSON.stringify({ branchId })}::jsonb)`.execute(this.db);
    } catch {
      // Auditing must never block the switch itself.
    }
  }
}

/** In-memory repo for tests / no-DB dev. */
export class InMemoryOwnerPortfolioRepo implements OwnerPortfolioRepo {
  constructor(public portfolio: OwnerPortfolio, public totals: SalonTotals[] = [], public series: RevenuePoint[] = []) {}
  switches: Array<{ tenantId: string; branchId: string | null }> = [];

  async loadPortfolio(ownerUserId: string) {
    return this.portfolio.ownerUserId === ownerUserId ? this.portfolio : { ownerUserId, salons: [] };
  }
  async loadRevenueSeries(_tenantIds: string[]): Promise<RevenuePoint[]> { return this.series; }

  async loadTotals(tenantIds: string[]) {
    return this.totals.filter((t) => tenantIds.includes(t.tenantId));
  }
  async recordSwitch(_u: string, tenantId: string, branchId: string | null) {
    this.switches.push({ tenantId, branchId });
  }
}
