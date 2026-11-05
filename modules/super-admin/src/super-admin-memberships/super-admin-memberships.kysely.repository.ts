// super-admin-memberships.kysely.repository.ts — READ-ONLY, platform-wide (cross-tenant) membership aggregation for the
// Super Admin Membership Overview. It reads the SAME canonical tables the tenant membership engine writes
// (customer_memberships, membership_plans/_versions, membership_payments, membership_activity, membership_redemptions) —
// it does NOT re-implement any membership logic, billing, or revenue split. Every figure is computed in SQL across all
// tenants. Money is integer cents. With no DB configured it returns an honest empty/zero overview (no fabricated data).
import { type DB, andTenant, tenantPred } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type { PlatformMembershipOverview, PlatformOverviewFilters, PlatformPlanDetail, PlatformMemberDetail, RevenueRange } from './super-admin-memberships.service';

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const iso = (v: unknown): string | null => { if (!v) return null; const d = new Date(v as any); return isNaN(+d) ? null : d.toISOString(); };
const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

// Resolve a revenue range into SQL boundary fragments + a series bucket. Daily buckets for week/month windows,
// monthly buckets for quarter/year. Boundaries use DB now()/date_trunc to stay consistent with the rest of the overview.
function revenueRangeSql(range: RevenueRange): { start: ReturnType<typeof sql>; end: ReturnType<typeof sql>; priorStart: ReturnType<typeof sql>; priorEnd: ReturnType<typeof sql>; bucket: ReturnType<typeof sql>; fmt: string; label: string } {
  switch (range) {
    case 'this_week':
      return { start: sql`date_trunc('week', now())`, end: sql`now()`, priorStart: sql`date_trunc('week', now()) - interval '7 days'`, priorEnd: sql`date_trunc('week', now())`, bucket: sql`date_trunc('day', settled_at)`, fmt: 'Dy DD', label: 'This Week' };
    case 'last_month':
      return { start: sql`date_trunc('month', now()) - interval '1 month'`, end: sql`date_trunc('month', now())`, priorStart: sql`date_trunc('month', now()) - interval '2 months'`, priorEnd: sql`date_trunc('month', now()) - interval '1 month'`, bucket: sql`date_trunc('day', settled_at)`, fmt: 'Mon DD', label: 'Last Month' };
    case 'this_quarter':
      return { start: sql`date_trunc('quarter', now())`, end: sql`now()`, priorStart: sql`date_trunc('quarter', now()) - interval '3 months'`, priorEnd: sql`date_trunc('quarter', now())`, bucket: sql`date_trunc('month', settled_at)`, fmt: 'Mon', label: 'This Quarter' };
    case 'this_year':
      return { start: sql`date_trunc('year', now())`, end: sql`now()`, priorStart: sql`date_trunc('year', now()) - interval '1 year'`, priorEnd: sql`date_trunc('year', now())`, bucket: sql`date_trunc('month', settled_at)`, fmt: 'Mon', label: 'This Year' };
    case 'this_month':
    default:
      return { start: sql`date_trunc('month', now())`, end: sql`now()`, priorStart: sql`date_trunc('month', now()) - interval '1 month'`, priorEnd: sql`date_trunc('month', now())`, bucket: sql`date_trunc('day', settled_at)`, fmt: 'Mon DD', label: 'This Month' };
  }
}

const EMPTY: PlatformMembershipOverview = {
  kpis: { totalMembers: 0, activeMembers: 0, activePctOfTotal: 0, newMembersThisMonth: 0, membershipRevenueCents: 0, revenueDeltaPct: null, expiringSoon: 0, expiringWindowDays: 7, canceledThisMonth: 0, canceledDeltaPct: null },
  plans: [], members: [], activity: [], revenueSeries: [], statusBreakdown: [], planDistribution: [], topServices: [], expiring: [], recentlyCreated: [],
  revenueRange: { range: 'this_month', label: 'This Month', totalCents: 0, deltaPct: null },
  summary: { totalMembers: 0, activeMembers: 0, totalRevenueCents: 0, avgRevenuePerMemberCents: 0, renewalRatePct: null, renewalRateDeltaPct: null, churnRatePct: null },
  tenantCount: 0, rangeDays: 30,
};

export class SuperAdminMembershipsKyselyRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async platformOverview(f: PlatformOverviewFilters): Promise<PlatformMembershipOverview> {
    if (!this.db) return EMPTY;
    const win = f.expiringWindowDays;        // KPI "expiring soon" window (default 7)
    const wideWin = Math.max(win, 60);       // "Expiring Memberships" table shows a wider upcoming horizon
    const scope = f.scope;

    const countsP = sql<{ total: number; active: number; new_month: number; canceled_month: number; canceled_prev: number; expiring: number; tenants: number }>`
      select
        count(*) filter (where status not in ('canceled','expired'))::int as total,
        count(*) filter (where status = 'active')::int as active,
        count(*) filter (where started_at >= date_trunc('month', now()))::int as new_month,
        count(*) filter (where canceled_at >= date_trunc('month', now()))::int as canceled_month,
        count(*) filter (where canceled_at >= date_trunc('month', now()) - interval '1 month' and canceled_at < date_trunc('month', now()))::int as canceled_prev,
        count(*) filter (where status not in ('canceled','expired') and current_period_end is not null and current_period_end <= now() + make_interval(days => ${win}))::int as expiring,
        count(distinct tenant_id)::int as tenants
      from customer_memberships where ${tenantPred(scope)}`.execute(this.db);

    const revP = sql<{ this_month: string; last_month: string; total: string }>`
      select
        coalesce(sum(amount_cents) filter (where settled_at >= date_trunc('month', now())),0)::bigint as this_month,
        coalesce(sum(amount_cents) filter (where settled_at >= date_trunc('month', now()) - interval '1 month' and settled_at < date_trunc('month', now())),0)::bigint as last_month,
        coalesce(sum(amount_cents),0)::bigint as total
      from membership_payments where status = 'succeeded' ${andTenant(scope)}`.execute(this.db);

    const RR = revenueRangeSql(f.revenueRange);
    const seriesP = sql<{ d: string; cents: string }>`
      select to_char(${RR.bucket}, ${RR.fmt}) as d, coalesce(sum(amount_cents),0)::bigint as cents
      from membership_payments
      where status = 'succeeded' and settled_at >= ${RR.start} and settled_at < ${RR.end} ${andTenant(scope)}
      group by 1, ${RR.bucket} order by ${RR.bucket}`.execute(this.db);

    const rangeTotalP = sql<{ total: string; prior: string }>`
      select
        coalesce(sum(amount_cents) filter (where settled_at >= ${RR.start} and settled_at < ${RR.end}),0)::bigint as total,
        coalesce(sum(amount_cents) filter (where settled_at >= ${RR.priorStart} and settled_at < ${RR.priorEnd}),0)::bigint as prior
      from membership_payments where status = 'succeeded' ${andTenant(scope)}`.execute(this.db);

    const renewalP = sql<{ attempts: number; succeeded: number; prior_attempts: number; prior_succeeded: number }>`
      select
        count(*) filter (where created_at >= date_trunc('month', now()))::int as attempts,
        count(*) filter (where status = 'succeeded' and created_at >= date_trunc('month', now()))::int as succeeded,
        count(*) filter (where created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now()))::int as prior_attempts,
        count(*) filter (where status = 'succeeded' and created_at >= date_trunc('month', now()) - interval '1 month' and created_at < date_trunc('month', now()))::int as prior_succeeded
      from membership_payments where kind = 'renewal' ${andTenant(scope)}`.execute(this.db);

    const plansP = sql<{ plan_id: string; name: string; description: string | null; product_type: string; status: string; is_popular: boolean; badge: string | null; billing_interval: string; interval_count: number; price_cents: string; is_custom_pricing: boolean; member_count: number; revenue_cents: string }>`
      select p.id as plan_id, p.name, p.description, p.product_type, p.status, p.is_popular, p.badge,
             coalesce(v.billing_interval, 'month') as billing_interval, coalesce(v.interval_count, 1)::int as interval_count,
             coalesce(v.price_cents, 0)::bigint as price_cents, coalesce(v.is_custom_pricing, false) as is_custom_pricing,
             (select count(*) from customer_memberships cm where cm.plan_id = p.id and cm.status not in ('canceled','expired'))::int as member_count,
             (select coalesce(sum(mp.amount_cents),0) from membership_payments mp join customer_memberships cm2 on cm2.id = mp.customer_membership_id
                where cm2.plan_id = p.id and mp.status = 'succeeded' and mp.settled_at >= date_trunc('month', now()))::bigint as revenue_cents
      from membership_plans p
      left join membership_plan_versions v on v.id = p.current_version_id
      where p.status <> 'archived' ${andTenant(scope, 'p.tenant_id')}
      order by member_count desc, p.created_at desc limit 8`.execute(this.db);

    const membersP = sql<{ membership_id: string; customer_id: string; full_name: string; phone_display: string | null; avatar_url: string | null; plan_name: string; join_date: unknown; next_billing_at: unknown; status: string }>`
      select cm.id as membership_id, cm.customer_id, c.full_name, c.phone_display, c.avatar_url,
             p.name as plan_name, cm.started_at as join_date, cm.next_billing_at, cm.status
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      join membership_plans p on p.id = cm.plan_id
      where cm.status not in ('canceled','expired') ${andTenant(scope, 'cm.tenant_id')}
      order by cm.started_at desc nulls last limit 8`.execute(this.db);

    const activityP = sql<{ id: string; activity_type: string; customer_name_snapshot: string | null; plan_name_snapshot: string | null; occurred_at: unknown; amount_cents: string | null }>`
      select id, activity_type, customer_name_snapshot, plan_name_snapshot, occurred_at, amount_cents
      from membership_activity where ${tenantPred(scope)} order by occurred_at desc limit 8`.execute(this.db);

    const statusP = sql<{ status: string; c: number }>`select status, count(*)::int as c from customer_memberships where ${tenantPred(scope)} group by status`.execute(this.db);

    const distP = sql<{ plan_name: string; c: number }>`
      select p.name as plan_name, count(cm.id)::int as c
      from membership_plans p
      left join customer_memberships cm on cm.plan_id = p.id and cm.status not in ('canceled','expired')
      where p.status <> 'archived' ${andTenant(scope, 'p.tenant_id')}
      group by p.id, p.name order by c desc limit 6`.execute(this.db);

    const topP = sql<{ name: string; redemptions: number }>`
      select coalesce(s.name, 'Service') as name, count(*)::int as redemptions
      from membership_redemptions r left join services s on s.id = r.service_id
      where ${tenantPred(scope, 'r.tenant_id')}
      group by 1 order by redemptions desc limit 5`.execute(this.db);

    const expiringP = sql<{ membership_id: string; full_name: string; avatar_url: string | null; plan_name: string; expires_on: unknown; days_left: number; status: string }>`
      select cm.id as membership_id, c.full_name, c.avatar_url, p.name as plan_name, cm.current_period_end as expires_on,
             greatest(0, floor(extract(epoch from (cm.current_period_end - now())) / 86400))::int as days_left, cm.status
      from customer_memberships cm join customers c on c.id = cm.customer_id join membership_plans p on p.id = cm.plan_id
      where cm.status not in ('canceled','expired') and cm.current_period_end is not null and cm.current_period_end <= now() + make_interval(days => ${wideWin})
      order by cm.current_period_end asc limit 8`.execute(this.db);

    const recentP = sql<{ membership_id: string; full_name: string; avatar_url: string | null; plan_name: string; join_date: unknown; amount_cents: string; status: string }>`
      select cm.id as membership_id, c.full_name, c.avatar_url, p.name as plan_name, cm.started_at as join_date, cm.status,
             coalesce(v.price_cents, 0)::bigint as amount_cents
      from customer_memberships cm join customers c on c.id = cm.customer_id join membership_plans p on p.id = cm.plan_id
      left join membership_plan_versions v on v.id = cm.plan_version_id
      order by cm.started_at desc nulls last limit 8`.execute(this.db);

    const [counts, rev, series, renewal, plans, members, activity, statusRows, dist, top, expiring, recent, rangeTotal] = await Promise.all([
      countsP, revP, seriesP, renewalP, plansP, membersP, activityP, statusP, distP, topP, expiringP, recentP, rangeTotalP,
    ]);

    const c = counts.rows[0] || ({} as any);
    const r0 = rev.rows[0] || ({} as any);
    const total = n(c.total), active = n(c.active);
    const thisMonth = n(r0.this_month), lastMonth = n(r0.last_month), totalRevenue = n(r0.total);
    const canceledMonth = n(c.canceled_month), canceledPrev = n(c.canceled_prev);
    const ren = renewal.rows[0] || ({} as any);

    return {
      kpis: {
        totalMembers: total,
        activeMembers: active,
        activePctOfTotal: total > 0 ? Math.round((active / total) * 100) : 0,
        newMembersThisMonth: n(c.new_month),
        membershipRevenueCents: thisMonth,
        revenueDeltaPct: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10 : null,
        expiringSoon: n(c.expiring),
        expiringWindowDays: win,
        canceledThisMonth: canceledMonth,
        canceledDeltaPct: canceledPrev > 0 ? Math.round(((canceledMonth - canceledPrev) / canceledPrev) * 1000) / 10 : null,
      },
      plans: plans.rows.map((p) => ({ planId: p.plan_id, name: p.name, description: p.description, productType: p.product_type, status: p.status, isPopular: !!p.is_popular, badge: p.badge, billingInterval: p.billing_interval, intervalCount: n(p.interval_count), priceCents: n(p.price_cents), isCustomPricing: !!p.is_custom_pricing, memberCount: n(p.member_count), revenueCents: n(p.revenue_cents) })),
      members: members.rows.map((m) => ({ membershipId: m.membership_id, customerId: m.customer_id, customerName: m.full_name, maskedPhone: maskPhone(m.phone_display), avatarUrl: m.avatar_url, planName: m.plan_name, joinDate: iso(m.join_date), nextBillingAt: iso(m.next_billing_at), status: m.status })),
      activity: activity.rows.map((a) => ({ id: a.id, activityType: a.activity_type, customerName: a.customer_name_snapshot, planName: a.plan_name_snapshot, occurredAt: iso(a.occurred_at), amountCents: a.amount_cents == null ? null : n(a.amount_cents) })),
      revenueSeries: series.rows.map((s) => ({ label: s.d, cents: n(s.cents) })),
      revenueRange: (() => { const rt = rangeTotal.rows[0] || ({} as any); const tot = n(rt.total), pr = n(rt.prior); return { range: f.revenueRange, label: RR.label, totalCents: tot, deltaPct: pr > 0 ? Math.round(((tot - pr) / pr) * 1000) / 10 : null }; })(),
      statusBreakdown: statusRows.rows.map((s) => ({ status: s.status, count: n(s.c) })),
      planDistribution: dist.rows.map((d) => ({ planName: d.plan_name, count: n(d.c) })),
      topServices: top.rows.map((t) => ({ name: t.name, redemptions: n(t.redemptions) })),
      expiring: expiring.rows.map((e) => ({ membershipId: e.membership_id, customerName: e.full_name, avatarUrl: e.avatar_url, planName: e.plan_name, expiresOn: iso(e.expires_on), daysLeft: n(e.days_left), status: e.status })),
      recentlyCreated: recent.rows.map((e) => ({ membershipId: e.membership_id, customerName: e.full_name, avatarUrl: e.avatar_url, planName: e.plan_name, joinDate: iso(e.join_date), amountCents: n(e.amount_cents), status: e.status })),
      summary: (() => {
        const thisRate = pct(n(ren.succeeded), n(ren.attempts));
        const priorRate = pct(n(ren.prior_succeeded), n(ren.prior_attempts));
        const renewalDelta = thisRate != null && priorRate != null && priorRate > 0 ? Math.round(((thisRate - priorRate) / priorRate) * 1000) / 10 : null;
        return {
          totalMembers: total,
          activeMembers: active,
          totalRevenueCents: totalRevenue,
          avgRevenuePerMemberCents: active > 0 ? Math.round(thisMonth / active) : 0,
          renewalRatePct: thisRate,
          renewalRateDeltaPct: renewalDelta,
          churnRatePct: pct(canceledMonth, total + canceledMonth),
        };
      })(),
      tenantCount: n(c.tenants),
      rangeDays: f.rangeDays,
    };
  }

  // Read-only platform plan detail (by id, cross-tenant). Reuses the tenant getPlan shape + adds platform context
  // (owning tenant/branch) and live member/revenue counts. Never writes.
  async planDetail(planId: string): Promise<PlatformPlanDetail | null> {
    if (!this.db) return null;
    const head = await sql<{ plan_id: string; tenant_id: string; tenant_name: string | null; name: string; description: string | null; product_type: string; status: string; is_popular: boolean; badge: string | null; branch_id: string | null; branch_name: string | null; current_version_id: string | null; version_number: number | null; billing_interval: string | null; interval_count: number | null; price_cents: string | null; is_custom_pricing: boolean | null; auto_renew: boolean | null; term_type: string | null; term_days: number | null; tech_split_pct: string | null; owner_split_pct: string | null; allocation_timing: string | null; cancellation_policy: string | null; is_published: boolean | null }>`
      select p.id as plan_id, p.tenant_id, t.display_name as tenant_name, p.name, p.description, p.product_type, p.status, p.is_popular, p.badge,
             p.branch_id, br.name as branch_name, p.current_version_id,
             v.version_number, v.billing_interval, v.interval_count, v.price_cents, v.is_custom_pricing, v.auto_renew, v.term_type, v.term_days,
             v.tech_split_pct, v.owner_split_pct, v.allocation_timing, v.cancellation_policy, v.is_published
      from membership_plans p
      left join membership_plan_versions v on v.id = p.current_version_id
      left join tenants t on t.id = p.tenant_id
      left join branches br on br.id = p.branch_id
      where p.id = ${planId} limit 1`.execute(this.db);
    const h = head.rows[0];
    if (!h) return null;

    const [bres, stats] = await Promise.all([
      h.current_version_id
        ? sql<{ benefit_type: string; label: string; credits_per_cycle: number; value_cents: string; percent: string }>`
            select benefit_type, label, credits_per_cycle, value_cents, percent from membership_benefits where plan_version_id = ${h.current_version_id} order by sort_order asc`.execute(this.db)
        : Promise.resolve({ rows: [] as any[] }),
      sql<{ member_count: number; revenue_cents: string }>`
        select (select count(*) from customer_memberships cm where cm.plan_id = ${planId} and cm.status not in ('canceled','expired'))::int as member_count,
               (select coalesce(sum(mp.amount_cents),0) from membership_payments mp join customer_memberships cm2 on cm2.id = mp.customer_membership_id
                  where cm2.plan_id = ${planId} and mp.status = 'succeeded' and mp.settled_at >= date_trunc('month', now()))::bigint as revenue_cents`.execute(this.db),
    ]);
    const s = stats.rows[0] || ({} as any);

    return {
      planId: h.plan_id, tenantId: h.tenant_id, tenantName: h.tenant_name, name: h.name, description: h.description,
      productType: h.product_type, status: h.status, isPopular: !!h.is_popular, badge: h.badge,
      branchId: h.branch_id, branchName: h.branch_name, memberCount: n(s.member_count), revenueCents: n(s.revenue_cents),
      version: h.current_version_id ? {
        versionNumber: n(h.version_number), billingInterval: h.billing_interval || 'month', intervalCount: n(h.interval_count) || 1,
        priceCents: n(h.price_cents), isCustomPricing: !!h.is_custom_pricing, autoRenew: !!h.auto_renew,
        termType: h.term_type || 'ongoing', termDays: h.term_days == null ? null : n(h.term_days),
        techSplitPct: n(h.tech_split_pct), ownerSplitPct: n(h.owner_split_pct),
        allocationTiming: h.allocation_timing || '', cancellationPolicy: h.cancellation_policy || '', isPublished: !!h.is_published,
        benefits: bres.rows.map((b) => ({ benefitType: b.benefit_type, label: b.label, creditsPerCycle: n(b.credits_per_cycle), valueCents: n(b.value_cents), percent: n(b.percent) })),
      } : null,
    };
  }

  // Read-only platform member profile (by membership id, cross-tenant). Pulls the membership, its customer, plan/version
  // split, assigned technician, branch, owning tenant, included benefits, and recent payments + activity. Never writes.
  async memberDetail(membershipId: string): Promise<PlatformMemberDetail | null> {
    if (!this.db) return null;
    const head = await sql<{ id: string; tenant_id: string; tenant_name: string | null; status: string; member_number: string | null; started_at: unknown; current_period_start: unknown; current_period_end: unknown; next_billing_at: unknown; term_end_at: unknown; auto_renew: boolean; cancel_at_period_end: boolean | null; canceled_at: unknown; cancel_reason: string | null; paused_at: unknown; pause_resumes_at: unknown; cycles_billed: number | null; customer_id: string; customer_name: string; phone_display: string | null; email: string | null; avatar_url: string | null; plan_id: string; plan_name: string; assigned_technician_id: string | null; technician_name: string | null; branch_id: string | null; branch_name: string | null; plan_version_id: string | null; version_number: number | null; billing_interval: string | null; interval_count: number | null; price_cents: string | null; tech_split_pct: string | null; owner_split_pct: string | null }>`
      select cm.id, cm.tenant_id, t.display_name as tenant_name, cm.status, cm.member_number, cm.started_at, cm.current_period_start, cm.current_period_end,
             cm.next_billing_at, cm.term_end_at, cm.auto_renew, cm.cancel_at_period_end, cm.canceled_at, cm.cancel_reason, cm.paused_at, cm.pause_resumes_at, cm.cycles_billed,
             cm.customer_id, c.full_name as customer_name, c.phone_display, c.email, c.avatar_url,
             cm.plan_id, p.name as plan_name, cm.assigned_technician_id, tech.full_name as technician_name,
             cm.branch_id, br.name as branch_name, cm.plan_version_id, v.version_number, v.billing_interval, v.interval_count, v.price_cents, v.tech_split_pct, v.owner_split_pct
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      join membership_plans p on p.id = cm.plan_id
      left join membership_plan_versions v on v.id = cm.plan_version_id
      left join tenants t on t.id = cm.tenant_id
      left join technicians tech on tech.id = cm.assigned_technician_id
      left join branches br on br.id = cm.branch_id
      where cm.id = ${membershipId} limit 1`.execute(this.db);
    const h = head.rows[0];
    if (!h) return null;

    const [bres, pays, acts] = await Promise.all([
      h.plan_version_id
        ? sql<{ benefit_type: string; label: string; credits_per_cycle: number; value_cents: string; percent: string }>`
            select benefit_type, label, credits_per_cycle, value_cents, percent from membership_benefits where plan_version_id = ${h.plan_version_id} order by sort_order asc`.execute(this.db)
        : Promise.resolve({ rows: [] as any[] }),
      sql<{ kind: string; amount_cents: string; tax_cents: string; status: string; processor: string | null; created_at: unknown; settled_at: unknown }>`
        select kind, amount_cents, tax_cents, status, processor, created_at, settled_at from membership_payments where customer_membership_id = ${membershipId} order by created_at desc limit 12`.execute(this.db),
      sql<{ activity_type: string; occurred_at: unknown; amount_cents: string | null }>`
        select activity_type, occurred_at, amount_cents from membership_activity where customer_membership_id = ${membershipId} order by occurred_at desc limit 12`.execute(this.db),
    ]);

    return {
      membershipId: h.id, tenantId: h.tenant_id, tenantName: h.tenant_name, status: h.status, memberNumber: h.member_number,
      startedAt: iso(h.started_at), currentPeriodStart: iso(h.current_period_start), currentPeriodEnd: iso(h.current_period_end),
      nextBillingAt: iso(h.next_billing_at), termEndAt: iso(h.term_end_at), autoRenew: !!h.auto_renew,
      cancelAtPeriodEnd: !!h.cancel_at_period_end, canceledAt: iso(h.canceled_at), cancelReason: h.cancel_reason,
      pausedAt: iso(h.paused_at), pauseResumesAt: iso(h.pause_resumes_at), cyclesBilled: n(h.cycles_billed),
      customer: { customerId: h.customer_id, name: h.customer_name, maskedPhone: maskPhone(h.phone_display), email: h.email, avatarUrl: h.avatar_url },
      planId: h.plan_id, planName: h.plan_name,
      technicianId: h.assigned_technician_id, technicianName: h.technician_name,
      branchId: h.branch_id, branchName: h.branch_name,
      versionNumber: n(h.version_number), billingInterval: h.billing_interval || 'month', intervalCount: n(h.interval_count) || 1,
      priceCents: n(h.price_cents), techSplitPct: n(h.tech_split_pct), ownerSplitPct: n(h.owner_split_pct),
      benefits: bres.rows.map((b) => ({ benefitType: b.benefit_type, label: b.label, creditsPerCycle: n(b.credits_per_cycle), valueCents: n(b.value_cents), percent: n(b.percent) })),
      payments: pays.rows.map((p) => ({ kind: p.kind, amountCents: n(p.amount_cents), taxCents: n(p.tax_cents), status: p.status, processor: p.processor, createdAt: iso(p.created_at), settledAt: iso(p.settled_at) })),
      activity: acts.rows.map((a) => ({ activityType: a.activity_type, occurredAt: iso(a.occurred_at), amountCents: a.amount_cents == null ? null : n(a.amount_cents) })),
    };
  }
}

function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  if (digits.length < 4) return p;
  return `(•••) •••-${digits.slice(-4)}`;
}
