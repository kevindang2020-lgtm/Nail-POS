// memberships.kysely.repository.ts — production adapter over Postgres. The overview is computed with parameterized raw
// SQL (FILTER aggregates + per-plan subqueries) for clarity; every query is tenant-scoped and optionally branch-scoped,
// and all of it returns empty/zero on empty tables (no fabricated numbers). Plan publish writes an immutable version +
// its benefits + an audit row inside one transaction.
import { Kysely, sql } from 'kysely';
import { branchTimeZone, tenantTimeZone, transitionStatus, type DB } from '@aipowersalon/database';
import { MEMBERSHIP_PLAN } from './membership-machine';
import type { MembershipsRepositoryPort, MembershipsContext } from './memberships.repository';
import type {
  MembershipOverview, OverviewFilters, PlanRow, PlanDetail, CreatePlanRequest, PublishVersionRequest, MemberRow, ActivityRow,
  MemberExportRow, PaymentExportRow, RedemptionExportRow,
} from './memberships.dto';

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());
function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 4 ? `••• ${digits.slice(-4)}` : '•••';
}
function deltaPct(curr: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export class KyselyMembershipsRepository implements MembershipsRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  async overview(ctx: MembershipsContext, f: OverviewFilters): Promise<MembershipOverview> {
    const T = ctx.tenantId;
    const bId = f.branchId || null;
    const expWindow = f.expiringWindowDays ?? 7;
    const rangeDays = f.rangeDays ?? 30;
    const cmBranch = bId ? sql`and branch_id = ${bId}` : sql``;
    const mpBranch = bId ? sql`and branch_id = ${bId}` : sql``;
    const planBranch = bId ? sql`and (p.branch_id is null or p.branch_id = ${bId})` : sql``;
    // "This month" and its days are the SALON's (the branch's zone, or the salon's main location's) — Oct 6 2026. They were
    // the database's UTC month: at 8 pm on the last evening of a month in New York the dashboard started the next one.
    const tz = bId ? await branchTimeZone(this.db, T, bId) : await tenantTimeZone(this.db, T);
    const nowAt = new Date(this.now());
    const bounds = (await sql<{ m: Date; p: Date }>`select (date_trunc('month', ${nowAt}::timestamptz at time zone ${tz}) at time zone ${tz}) as m,
      ((date_trunc('month', ${nowAt}::timestamptz at time zone ${tz}) - interval '1 month') at time zone ${tz}) as p`.execute(this.db)).rows[0]!;
    const monthStart = bounds.m, prevMonthStart = bounds.p;

    const countsP = sql<{ total: number; active: number; new_month: number; canceled_month: number; canceled_prev: number; expiring: number }>`
      select
        count(*) filter (where status not in ('canceled','cancelled','expired'))::int as total,
        count(*) filter (where status = 'active')::int as active,
        count(*) filter (where started_at >= ${monthStart})::int as new_month,
        count(*) filter (where canceled_at >= ${monthStart})::int as canceled_month,
        count(*) filter (where canceled_at >= ${prevMonthStart} and canceled_at < ${monthStart})::int as canceled_prev,
        count(*) filter (where status not in ('canceled','cancelled','expired') and (
            (term_end_at is not null and term_end_at >= now() and term_end_at < now() + make_interval(days => ${expWindow}))
            or (cancel_at_period_end = true and current_period_end is not null and current_period_end >= now() and current_period_end < now() + make_interval(days => ${expWindow}))
        ))::int as expiring
      from customer_memberships where tenant_id = ${T} ${cmBranch}
    `.execute(this.db);

    const revP = sql<{ this_month: string; last_month: string; payments_month: number }>`
      select
        coalesce(sum(amount_cents) filter (where settled_at >= ${monthStart}),0)::bigint as this_month,
        coalesce(sum(amount_cents) filter (where settled_at >= ${prevMonthStart} and settled_at < ${monthStart}),0)::bigint as last_month,
        count(*) filter (where settled_at >= ${monthStart})::int as payments_month
      from membership_payments where tenant_id = ${T} and status = 'succeeded' ${mpBranch}
    `.execute(this.db);

    const seriesP = sql<{ d: string; cents: string }>`
      select to_char(x.day, 'Mon DD') as d, coalesce(sum(x.amount_cents),0)::bigint as cents
      from (select date_trunc('day', settled_at at time zone ${tz}) as day, amount_cents from membership_payments
            where tenant_id = ${T} and status = 'succeeded' and settled_at >= ${monthStart} ${mpBranch}) x
      group by x.day order by x.day
    `.execute(this.db);

    const plansP = sql<{
      plan_id: string; name: string; description: string | null; product_type: string; status: string; is_popular: boolean; badge: string | null;
      billing_interval: string; interval_count: number; price_cents: string; is_custom_pricing: boolean; member_count: number; revenue_cents: string;
    }>`
      select p.id as plan_id, p.name, p.description, p.product_type, p.status, p.is_popular, p.badge,
             coalesce(v.billing_interval, 'month') as billing_interval, coalesce(v.interval_count, 1)::int as interval_count,
             coalesce(v.price_cents, 0)::bigint as price_cents, coalesce(v.is_custom_pricing, false) as is_custom_pricing,
             (select count(*) from customer_memberships cm where cm.plan_id = p.id and cm.status not in ('canceled','cancelled','expired'))::int as member_count,
             (select coalesce(sum(mp.amount_cents),0) from membership_payments mp join customer_memberships cm2 on cm2.id = mp.customer_membership_id
                where cm2.plan_id = p.id and mp.status = 'succeeded' and mp.settled_at >= ${monthStart})::bigint as revenue_cents
      from membership_plans p
      left join membership_plan_versions v on v.id = p.current_version_id
      where p.tenant_id = ${T} and p.status <> 'archived' ${planBranch}
      order by p.is_popular desc, p.created_at asc
      limit 50
    `.execute(this.db);

    const membersP = sql<{
      membership_id: string; customer_id: string; full_name: string; phone_display: string | null; avatar_url: string | null;
      plan_name: string; started_at: any; next_billing_at: any; status: string;
    }>`
      select cm.id as membership_id, cm.customer_id, c.full_name, c.phone_display, c.avatar_url,
             p.name as plan_name, cm.started_at, cm.next_billing_at, cm.status
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      join membership_plans p on p.id = cm.plan_id
      where cm.tenant_id = ${T} and cm.status in ('active','trial','grace','past_due','paused','canceling') ${bId ? sql`and cm.branch_id = ${bId}` : sql``}
      order by cm.started_at desc nulls last
      limit 8
    `.execute(this.db);

    const activityP = sql<{ id: string; activity_type: string; customer_name_snapshot: string | null; plan_name_snapshot: string | null; occurred_at: any; amount_cents: string | null }>`
      select id, activity_type, customer_name_snapshot, plan_name_snapshot, occurred_at, amount_cents
      from membership_activity where tenant_id = ${T} ${bId ? sql`and branch_id = ${bId}` : sql``}
      order by occurred_at desc limit 8
    `.execute(this.db);

    const statusP = sql<{ status: string; c: number }>`
      select status, count(*)::int as c from customer_memberships
      where tenant_id = ${T} ${cmBranch} group by status   -- Membership Overview mandate §10: every lifecycle status, one population (all memberships), mutually exclusive
    `.execute(this.db);

    const distP = sql<{ plan_name: string; c: number; revenue_cents: string }>`
      select p.name as plan_name, count(cm.id)::int as c,
             coalesce((select sum(mp.amount_cents) from membership_payments mp join customer_memberships cm3 on cm3.id = mp.customer_membership_id
                where cm3.plan_id = p.id and mp.status = 'succeeded' and mp.settled_at >= ${monthStart}),0)::bigint as revenue_cents
      from membership_plans p
      left join customer_memberships cm on cm.plan_id = p.id and cm.status not in ('canceled','cancelled','expired')
      where p.tenant_id = ${T} and p.status <> 'archived' ${planBranch}
      group by p.id, p.name order by c desc limit 8
    `.execute(this.db);

    const topP = sql<{ name: string; redemptions: number; value_cents: string }>`
      select coalesce(s.name, 'Service') as name, count(*)::int as redemptions, coalesce(sum(r.allocated_value_cents),0)::bigint as value_cents
      from membership_redemptions r
      left join services s on s.id = r.service_id
      where r.tenant_id = ${T} and r.created_at >= ${monthStart} ${bId ? sql`and r.branch_id = ${bId}` : sql``}   -- §10: ranked for the period (this month)
      group by s.name order by redemptions desc, s.name limit 5
    `.execute(this.db);

    const [counts, rev, series, plans, members, activity, statusRows, dist, top] = await Promise.all([
      countsP, revP, seriesP, plansP, membersP, activityP, statusP, distP, topP,
    ]);

    const c = counts.rows[0] ?? { total: 0, active: 0, new_month: 0, canceled_month: 0, canceled_prev: 0, expiring: 0 };
    const r = rev.rows[0] ?? { this_month: '0', last_month: '0', payments_month: 0 };
    const total = n(c.total);
    const active = n(c.active);
    const thisMonthRev = n(r.this_month);
    const lastMonthRev = n(r.last_month);

    const statusTotal = statusRows.rows.reduce((s, x) => s + n(x.c), 0) || 1;
    const distTotal = dist.rows.reduce((s, x) => s + n(x.c), 0) || 1;

    const memberRows: MemberRow[] = members.rows.map((m) => ({
      membershipId: m.membership_id, customerId: m.customer_id, customerName: m.full_name, avatarUrl: m.avatar_url,
      maskedPhone: maskPhone(m.phone_display), planName: m.plan_name, joinDate: iso(m.started_at), nextBillingAt: iso(m.next_billing_at), status: m.status,
    }));
    const activityRows: ActivityRow[] = activity.rows.map((a) => ({
      id: a.id, activityType: a.activity_type, customerName: a.customer_name_snapshot, planName: a.plan_name_snapshot,
      occurredAt: iso(a.occurred_at) ?? new Date().toISOString(), amountCents: a.amount_cents == null ? null : n(a.amount_cents),
    }));

    return {
      kpis: {
        totalMembers: total,
        newMembersThisMonth: n(c.new_month),
        activeMembers: active,
        activePctOfTotal: total > 0 ? Math.round((active / total) * 100) : 0,
        membershipRevenueCents: thisMonthRev,
        membershipPaymentsThisMonth: n(r.payments_month),
        revenueDeltaPct: deltaPct(thisMonthRev, lastMonthRev),
        expiringSoon: n(c.expiring),
        expiringWindowDays: expWindow,
        canceledThisMonth: n(c.canceled_month),
        canceledDeltaPct: deltaPct(n(c.canceled_month), n(c.canceled_prev)),
      },
      plans: plans.rows.map((p): PlanRow => ({
        planId: p.plan_id, name: p.name, description: p.description, productType: p.product_type,
        billingInterval: p.billing_interval, intervalCount: n(p.interval_count), priceCents: n(p.price_cents),
        isCustomPricing: !!p.is_custom_pricing, status: p.status, isPopular: !!p.is_popular, badge: p.badge,
        memberCount: n(p.member_count), revenueCents: n(p.revenue_cents),
      })),
      members: memberRows,
      activity: activityRows,
      revenueSeries: series.rows.map((s) => ({ label: s.d, cents: n(s.cents) })),
      statusBreakdown: statusRows.rows.map((s) => ({ status: s.status, count: n(s.c), pct: Math.round((n(s.c) / statusTotal) * 100) })),
      planDistribution: dist.rows.map((d) => ({ planName: d.plan_name, count: n(d.c), pct: Math.round((n(d.c) / distTotal) * 100), revenueCents: n(d.revenue_cents) })),
      topServices: top.rows.map((t) => ({ name: t.name, redemptions: n(t.redemptions), valueCents: n(t.value_cents) })),
      rangeDays,
      // Membership Overview mandate (Oct 29 2026): the denominators the charts use, stated (spec §10 "explicit denominator")
      populations: { statusBreakdown: 'all_memberships', planDistribution: 'current_memberships', topServices: 'this_month', revenue: 'succeeded_payments_settled_this_month' },
      distributionTotal: dist.rows.reduce((s2, x) => s2 + n(x.c), 0),
      statusTotal: statusRows.rows.reduce((s2, x) => s2 + n(x.c), 0),
    };
  }

  async listPlans(ctx: MembershipsContext, branchId?: string): Promise<PlanRow[]> {
    const bId = branchId || null;
    const res = await sql<{
      plan_id: string; name: string; description: string | null; product_type: string; status: string; is_popular: boolean; badge: string | null;
      billing_interval: string; interval_count: number; price_cents: string; is_custom_pricing: boolean; member_count: number;
    }>`
      select p.id as plan_id, p.name, p.description, p.product_type, p.status, p.is_popular, p.badge,
             coalesce(v.billing_interval, 'month') as billing_interval, coalesce(v.interval_count, 1)::int as interval_count,
             coalesce(v.price_cents, 0)::bigint as price_cents, coalesce(v.is_custom_pricing, false) as is_custom_pricing,
             (select count(*) from customer_memberships cm where cm.plan_id = p.id and cm.status not in ('canceled','cancelled','expired'))::int as member_count
      from membership_plans p
      left join membership_plan_versions v on v.id = p.current_version_id
      where p.tenant_id = ${ctx.tenantId} and p.status <> 'archived' ${bId ? sql`and (p.branch_id is null or p.branch_id = ${bId})` : sql``}
      order by p.is_popular desc, p.created_at asc limit 100
    `.execute(this.db);
    return res.rows.map((p): PlanRow => ({
      planId: p.plan_id, name: p.name, description: p.description, productType: p.product_type,
      billingInterval: p.billing_interval, intervalCount: n(p.interval_count), priceCents: n(p.price_cents),
      isCustomPricing: !!p.is_custom_pricing, status: p.status, isPopular: !!p.is_popular, badge: p.badge,
      memberCount: n(p.member_count), revenueCents: 0,
    }));
  }

  async getPlan(ctx: MembershipsContext, planId: string): Promise<PlanDetail | null> {
    const head = await sql<{
      plan_id: string; name: string; description: string | null; product_type: string; status: string; is_popular: boolean; badge: string | null;
      branch_id: string | null; current_version_id: string | null;
      version_number: number | null; billing_interval: string | null; interval_count: number | null; price_cents: string | null; is_custom_pricing: boolean | null;
      auto_renew: boolean | null; term_type: string | null; term_days: number | null; tech_split_pct: string | null; owner_split_pct: string | null;
      allocation_timing: string | null; cancellation_policy: string | null; is_published: boolean | null;
    }>`
      select p.id as plan_id, p.name, p.description, p.product_type, p.status, p.is_popular, p.badge, p.branch_id, p.current_version_id,
             v.version_number, v.billing_interval, v.interval_count, v.price_cents, v.is_custom_pricing, v.auto_renew, v.term_type, v.term_days,
             v.tech_split_pct, v.owner_split_pct, v.allocation_timing, v.cancellation_policy, v.is_published
      from membership_plans p
      left join membership_plan_versions v on v.id = p.current_version_id
      where p.tenant_id = ${ctx.tenantId} and p.id = ${planId} limit 1
    `.execute(this.db);
    const h = head.rows[0];
    if (!h) return null;

    let benefits: Array<{ benefitType: string; label: string; creditsPerCycle: number; valueCents: number; percent: number; allocatedValueCents: number }> = [];
    if (h.current_version_id) {
      const bres = await sql<{ benefit_type: string; label: string; credits_per_cycle: number; value_cents: string; percent: string; allocated_value_cents: string }>`
        select benefit_type, label, credits_per_cycle, value_cents, percent, allocated_value_cents
        from membership_benefits where plan_version_id = ${h.current_version_id} and tenant_id = ${ctx.tenantId} order by sort_order asc
      `.execute(this.db);
      benefits = bres.rows.map((b) => ({ benefitType: b.benefit_type, label: b.label, creditsPerCycle: n(b.credits_per_cycle), valueCents: n(b.value_cents), percent: n(b.percent), allocatedValueCents: n(b.allocated_value_cents) }));
    }

    return {
      planId: h.plan_id, name: h.name, description: h.description, productType: h.product_type,
      billingInterval: h.billing_interval ?? 'month', intervalCount: n(h.interval_count), priceCents: n(h.price_cents),
      isCustomPricing: !!h.is_custom_pricing, status: h.status, isPopular: !!h.is_popular, badge: h.badge, memberCount: 0, revenueCents: 0,
      branchId: h.branch_id, currentVersionId: h.current_version_id,
      version: h.current_version_id ? {
        versionNumber: n(h.version_number), billingInterval: h.billing_interval ?? 'month', intervalCount: n(h.interval_count),
        priceCents: n(h.price_cents), isCustomPricing: !!h.is_custom_pricing, autoRenew: !!h.auto_renew, termType: h.term_type ?? 'none',
        termDays: h.term_days == null ? null : n(h.term_days), techSplitPct: n(h.tech_split_pct), ownerSplitPct: n(h.owner_split_pct),
        allocationTiming: h.allocation_timing ?? 'on_redemption', cancellationPolicy: h.cancellation_policy ?? 'period_end', isPublished: !!h.is_published, benefits,
      } : null,
    };
  }

  async createPlan(ctx: MembershipsContext, input: CreatePlanRequest): Promise<{ planId: string }> {
    const res = await sql<{ id: string }>`
      insert into membership_plans (tenant_id, branch_id, name, plan_code, product_type, description, badge, is_popular, is_featured, member_visible, status, created_by_user_id)
      values (${ctx.tenantId}, ${input.branchId ?? null}, ${input.name}, ${input.planCode ?? null}, ${input.productType ?? 'recurring'}, ${input.description ?? null}, ${input.badge ?? null},
              ${!!input.isPopular}, ${!!input.isFeatured}, ${input.memberVisible ?? true}, 'draft', ${ctx.userId ?? null})
      returning id
    `.execute(this.db);
    const planId = res.rows[0].id;
    await sql`
      insert into membership_audit (tenant_id, branch_id, plan_id, actor_user_id, actor_role, action, new_state, result)
      values (${ctx.tenantId}, ${input.branchId ?? null}, ${planId}, ${ctx.userId ?? null}, ${ctx.role ?? null}, 'plan_created', 'draft', 'ok')
    `.execute(this.db);
    return { planId };
  }

  async publishVersion(ctx: MembershipsContext, planId: string, input: PublishVersionRequest): Promise<{ versionId: string; versionNumber: number }> {
    return this.db.transaction().execute(async (trx) => {
      const plan = await sql<{ id: string; branch_id: string | null }>`
        select id, branch_id from membership_plans where id = ${planId} and tenant_id = ${ctx.tenantId} limit 1
      `.execute(trx);
      if (!plan.rows[0]) throw new Error('plan not found');
      const branchId = plan.rows[0].branch_id;

      const next = await sql<{ v: number }>`
        select coalesce(max(version_number), 0) + 1 as v from membership_plan_versions where plan_id = ${planId}
      `.execute(trx);
      const versionNumber = n(next.rows[0]?.v) || 1;

      const ins = await sql<{ id: string }>`
        insert into membership_plan_versions (
          plan_id, tenant_id, version_number, billing_interval, interval_count, price_cents, is_custom_pricing,
          enrollment_fee_cents, setup_fee_cents, trial_days, auto_renew, billing_cycles, term_type, term_days,
          rollover_allowed, rollover_max_cycles, credit_expiry_days, tech_commission_basis, tech_split_pct, owner_split_pct,
          tech_fixed_cents, allocation_timing, cancellation_policy, min_commitment_cycles, pause_max_per_year, pause_max_days,
          terms_version, auto_renew_disclosure, est_margin_cents, is_published, effective_at, published_by_user_id
        ) values (
          ${planId}, ${ctx.tenantId}, ${versionNumber}, ${input.billingInterval ?? 'month'}, ${input.intervalCount ?? 1}, ${input.priceCents ?? 0}, ${!!input.isCustomPricing},
          ${input.enrollmentFeeCents ?? 0}, ${input.setupFeeCents ?? 0}, ${input.trialDays ?? 0}, ${input.autoRenew ?? true}, ${input.billingCycles ?? null}, ${input.termType ?? 'none'}, ${input.termDays ?? null},
          ${input.rolloverAllowed ?? false}, ${input.rolloverMaxCycles ?? 0}, ${input.creditExpiryDays ?? null}, ${input.techCommissionBasis ?? 'allocated'}, ${input.techSplitPct ?? 60}, ${input.ownerSplitPct ?? 40},
          ${input.techFixedCents ?? null}, ${input.allocationTiming ?? 'on_redemption'}, ${input.cancellationPolicy ?? 'period_end'}, ${input.minCommitmentCycles ?? 0}, ${input.pauseMaxPerYear ?? 0}, ${input.pauseMaxDays ?? 0},
          ${input.termsVersion ?? null}, ${input.autoRenewDisclosure ?? null}, ${input.estMarginCents ?? 0}, true, now(), ${ctx.userId ?? null}
        ) returning id
      `.execute(trx);
      const versionId = ins.rows[0].id;

      for (const [i, b] of (input.benefits ?? []).entries()) {
        await sql`
          insert into membership_benefits (plan_version_id, tenant_id, benefit_type, label, service_id, category_snapshot, credits_per_cycle, value_cents, percent, allocated_value_cents, min_days_between, max_per_cycle, rollover_allowed, sort_order)
          values (${versionId}, ${ctx.tenantId}, ${b.benefitType}, ${b.label}, ${b.serviceId ?? null}, ${b.categorySnapshot ?? null}, ${b.creditsPerCycle ?? 0}, ${b.valueCents ?? 0}, ${b.percent ?? 0}, ${b.allocatedValueCents ?? 0}, ${b.minDaysBetween ?? 0}, ${b.maxPerCycle ?? null}, ${b.rolloverAllowed ?? false}, ${b.sortOrder ?? i})
        `.execute(trx);
      }

      // Phase 12 (#27): publishing moves the plan to active through MEMBERSHIP_PLAN — an archived plan is refused (409, the
      // new version rolls back with it)
      await transitionStatus(trx as any, MEMBERSHIP_PLAN, { where: { id: planId, tenant_id: ctx.tenantId }, to: 'active', set: { current_version_id: versionId, updated_at: sql`now()` } });
      await sql`
        insert into membership_audit (tenant_id, branch_id, plan_id, plan_version_id, actor_user_id, actor_role, action, new_state, result)
        values (${ctx.tenantId}, ${branchId}, ${planId}, ${versionId}, ${ctx.userId ?? null}, ${ctx.role ?? null}, 'plan_version_published', 'active', 'ok')
      `.execute(trx);

      return { versionId, versionNumber };
    });
  }

  async exportMembers(ctx: MembershipsContext, branchId?: string): Promise<MemberExportRow[]> {
    const bId = branchId || null;
    const bScope = bId ? sql`and cm.branch_id = ${bId}` : sql``;
    const r = await sql<{ customer_name: string; plan_name: string | null; status: string; member_number: string | null; started_at: unknown; next_billing_at: unknown; auto_renew: boolean; lifetime_paid_cents: string }>`
      select c.full_name as customer_name, p.name as plan_name, cm.status, cm.member_number, cm.started_at, cm.next_billing_at, cm.auto_renew,
        coalesce((select sum(mp.amount_cents) from membership_payments mp where mp.customer_membership_id = cm.id and mp.status = 'succeeded'), 0) as lifetime_paid_cents
      from customer_memberships cm
      join customers c on c.id = cm.customer_id
      left join membership_plans p on p.id = cm.plan_id
      where cm.tenant_id = ${ctx.tenantId} ${bScope}
      order by cm.started_at desc nulls last`.execute(this.db);
    return r.rows.map((x) => ({ customerName: x.customer_name, planName: x.plan_name, status: x.status, memberNumber: x.member_number, joinDate: iso(x.started_at), nextBillingAt: iso(x.next_billing_at), autoRenew: !!x.auto_renew, lifetimePaidCents: n(x.lifetime_paid_cents) }));
  }

  async exportPayments(ctx: MembershipsContext, branchId?: string): Promise<PaymentExportRow[]> {
    const bId = branchId || null;
    const bScope = bId ? sql`and mp.branch_id = ${bId}` : sql``;
    const r = await sql<{ customer_name: string | null; plan_name: string | null; kind: string; amount_cents: string; tax_cents: string; status: string; processor: string | null; created_at: unknown; settled_at: unknown }>`
      select c.full_name as customer_name, p.name as plan_name, mp.kind, mp.amount_cents, mp.tax_cents, mp.status, mp.processor, mp.created_at, mp.settled_at
      from membership_payments mp
      left join customers c on c.id = mp.customer_id
      left join customer_memberships cm on cm.id = mp.customer_membership_id
      left join membership_plans p on p.id = cm.plan_id
      where mp.tenant_id = ${ctx.tenantId} ${bScope}
      order by mp.created_at desc`.execute(this.db);
    return r.rows.map((x) => ({ customerName: x.customer_name ?? '', planName: x.plan_name, kind: x.kind, amountCents: n(x.amount_cents), taxCents: n(x.tax_cents), status: x.status, processor: x.processor, createdAt: iso(x.created_at), settledAt: iso(x.settled_at) }));
  }

  async exportRedemptions(ctx: MembershipsContext, branchId?: string): Promise<RedemptionExportRow[]> {
    const bId = branchId || null;
    const bScope = bId ? sql`and rd.branch_id = ${bId}` : sql``;
    const r = await sql<{ customer_name: string | null; service_name: string | null; standard_value_cents: string; allocated_value_cents: string; upgrade_charge_cents: string; technician_name: string | null; created_at: unknown }>`
      select c.full_name as customer_name,
        coalesce(tsl.service_name_snapshot, s.name) as service_name,
        rd.standard_value_cents, rd.allocated_value_cents, rd.upgrade_charge_cents,
        t.full_name as technician_name, rd.created_at
      from membership_redemptions rd
      left join customer_memberships cm on cm.id = rd.customer_membership_id
      left join customers c on c.id = cm.customer_id
      left join ticket_service_lines tsl on tsl.id = rd.service_line_id
      left join services s on s.id = rd.service_id
      left join technicians t on t.id = rd.technician_id
      where rd.tenant_id = ${ctx.tenantId} ${bScope}
      order by rd.created_at desc`.execute(this.db);
    return r.rows.map((x) => ({ customerName: x.customer_name ?? '', serviceName: x.service_name, standardValueCents: n(x.standard_value_cents), allocatedValueCents: n(x.allocated_value_cents), upgradeChargeCents: n(x.upgrade_charge_cents), technicianName: x.technician_name, createdAt: iso(x.created_at) }));
  }
}
