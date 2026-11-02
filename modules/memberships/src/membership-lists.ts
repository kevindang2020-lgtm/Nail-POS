// membership-lists.ts — Membership Overview mandate (Oct 29 2026): the reads behind "View All Members", "View All
// Activity", the KPI click-throughs, "Plan Performance" and "Manage Discounts" — each was a dead "isn't available yet"
// notice. Raw, parameterised SQL over the existing tables (customer_memberships, membership_plans / versions / benefits,
// membership_payments, membership_redemptions, membership_activity); the tenant is the session's, literal in every
// statement; month boundaries are the salon's (tenantTimeZone), the same as the overview. Newest first, unique-id
// tie-break, server pages; a page past the end is clamped.
import { withCode } from '@aipowersalon/api-contracts';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { tenantTimeZone, ListQuery } from '@aipowersalon/database';
import { Controller, Get, Param, Query, Req, UseGuards, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, RequireFeature } from '@aipowersalon/permissions/guards';

export interface ListCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }
const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maskPhone = (p: string | null) => { if (!p) return null; const d = p.replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
function paging(page: unknown, pageSize: unknown, def = 10) { return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: Math.max(1, Math.min(50, Math.trunc(Number(pageSize)) || def)) }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }

/** The member-list populations (each the SAME rule as the KPI card that opens it; `any` = every membership, any status — the search default). */
export const MEMBER_FILTERS = ['all', 'active', 'expiring', 'canceled_this_month', 'paused', 'past_due', 'trial', 'canceled', 'expired', 'any'] as const;
/** Membership list date fields (Membership Overview, Oct 29 2026): which date the period filters. */
export const MEMBER_DATE_FIELDS = ['enrolled', 'created', 'renewal', 'expiration', 'canceled'] as const;
export const PAYMENT_STATUSES = ['succeeded', 'failed', 'refunded', 'voided', 'pending'];
export interface MoPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];
/** Statuses the overview counts as a CURRENT membership (Total Members). */
export const CURRENT_STATUSES = ['active', 'trial', 'grace', 'past_due', 'paused', 'canceling', 'pending', 'comped', 'suspended'];

export class MembershipListsRepository {
  constructor(private readonly db: Kysely<any>) {}
  private async month(ctx: ListCtx) {
    const tz = await tenantTimeZone(this.db, ctx.tenantId).catch(() => 'America/New_York');
    const r = (await sql<any>`select (date_trunc('month', now() at time zone ${tz}) at time zone ${tz}) as m, ((date_trunc('month', now() at time zone ${tz}) - interval '1 month') at time zone ${tz}) as p`.execute(this.db)).rows[0];
    return { tz, start: new Date(r.m), prev: new Date(r.p) };
  }

  /** Today / week / month / year / custom / all as salon-local dates (the POS period bar's { preset, from, to, tz, today }). */
  async period(ctx: ListCtx, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'all'): Promise<MoPeriod> {
    const tz = await tenantTimeZone(this.db, ctx.tenantId);   // never throws: the salon default when unset
    const r = (await sql<any>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today, to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', now() at time zone ${tz})::date, 'YYYY-MM-DD') as mo, to_char(date_trunc('year', now() at time zone ${tz})::date, 'YYYY-MM-DD') as yr`.execute(this.db)).rows[0];
    const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset ?? '')) ? String(q.preset) : def;
    if (preset === 'all') return { preset, from: null, to: null, tz, today: r.today };
    if (preset === 'custom') {
      const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
      if (!from || !to || to < from) throw withCode(new HttpException({ code: 'DATE_RANGE_INVALID', message: 'The start date must be on or before the end date.' }, HttpStatus.BAD_REQUEST), 'DATE_RANGE_INVALID');
      return { preset, from, to, tz, today: r.today };
    }
    return { preset, from: preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr, to: r.today, tz, today: r.today };
  }
  /** `col` inside the period: salon-local days, the end day included (DST-safe: each bound converted on its own date). */
  private inP(col: RawBuilder<unknown>, p: MoPeriod): RawBuilder<unknown> {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }
  /** The one phone-first search box: phone in any format, name, email, customer / membership id, member number, plan. */
  private memberSearch(raw0: string): { where: RawBuilder<unknown>; rank: RawBuilder<unknown> } {
    const raw = raw0.trim().slice(0, 100);
    if (!raw) return { where: sql`true`, rank: sql`null::int` };
    const l = '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%'; let digits = raw.replace(/\D/g, ''); if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    const phoneish = digits.length >= 4 && !/[a-z]/i.test(raw);
    const isId = UUID.test(raw);
    return {
      where: sql`(c.full_name ilike ${l} or coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') ilike ${l} or coalesce(c.email, '') ilike ${l} or coalesce(cm.member_number, '') ilike ${l}
        or coalesce(p.name, '') ilike ${l} or (${phoneish} and regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'})
        or (${isId} and (cm.id::text = ${raw.toLowerCase()} or c.id::text = ${raw.toLowerCase()})))`,
      rank: sql`case when ${isId} and (cm.id::text = ${raw.toLowerCase()} or c.id::text = ${raw.toLowerCase()}) then 0 when lower(coalesce(cm.member_number, '')) = ${raw.toLowerCase()} then 0
        when ${phoneish} and right(regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g'), 10) = ${digits.slice(-10)} then 1 when lower(coalesce(c.email, '')) = ${raw.toLowerCase()} then 2 else 3 end`,
    };
  }

  async members(ctx: ListCtx, f: { filter?: string; planId?: string; q?: string; page?: unknown; pageSize?: unknown; expiringWindowDays?: unknown; preset?: unknown; from?: unknown; to?: unknown; dateField?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const filter = ((MEMBER_FILTERS as readonly string[]).includes(String(f.filter)) ? f.filter : 'all') as MemberFilter;
    const win = Math.max(1, Math.min(90, Math.trunc(Number(f.expiringWindowDays)) || 7));
    const { start } = await this.month(ctx);
    const per = await this.period(ctx, f);
    const dateField = (MEMBER_DATE_FIELDS as readonly string[]).includes(String(f.dateField)) ? String(f.dateField) : 'enrolled';
    const conds = [sql`cm.tenant_id = ${T}`];
    if (filter === 'all') conds.push(sql`cm.status not in ('canceled', 'cancelled', 'expired')`);
    if (filter === 'active') conds.push(sql`cm.status = 'active'`);
    if (filter === 'paused') conds.push(sql`cm.status = 'paused'`);
    if (filter === 'past_due') conds.push(sql`cm.status = 'past_due'`);
    if (filter === 'trial') conds.push(sql`cm.status = 'trial'`);
    if (filter === 'canceled') conds.push(sql`cm.status in ('canceled', 'cancelled')`);
    if (filter === 'expired') conds.push(sql`cm.status = 'expired'`);
    if (filter === 'canceled_this_month') conds.push(sql`cm.canceled_at >= ${start}`);
    if (filter === 'expiring') conds.push(sql`cm.status not in ('canceled', 'cancelled', 'expired') and (
      (cm.term_end_at is not null and cm.term_end_at >= now() and cm.term_end_at < now() + make_interval(days => ${win}))
      or (cm.cancel_at_period_end = true and cm.current_period_end is not null and cm.current_period_end >= now() and cm.current_period_end < now() + make_interval(days => ${win})))`);
    if (f.planId && UUID.test(f.planId)) conds.push(sql`cm.plan_id = ${f.planId}`);
    const col = dateField === 'created' ? sql`cm.created_at` : dateField === 'renewal' ? sql`cm.next_billing_at` : dateField === 'canceled' ? sql`cm.canceled_at`
      : dateField === 'expiration' ? sql`coalesce(cm.term_end_at, case when cm.cancel_at_period_end then cm.current_period_end end)` : sql`cm.started_at`;
    conds.push(this.inP(col, per));
    const search = this.memberSearch(String(f.q ?? ''));
    conds.push(search.where);
    const where = sql.join(conds, sql` and `);
    const from = sql`from customer_memberships cm join customers c on c.id = cm.customer_id and c.tenant_id = cm.tenant_id left join membership_plans p on p.id = cm.plan_id and p.tenant_id = cm.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${where}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select cm.id, cm.customer_id, c.full_name, c.avatar_url, c.phone_display, c.normalized_phone, p.name as plan_name, cm.plan_id, cm.status, cm.member_number, cm.started_at, cm.next_billing_at,
        cm.term_end_at, cm.current_period_end, cm.cancel_at_period_end, cm.canceled_at, cm.paused_at, cm.auto_renew, cm.created_at,
        (select count(*) from membership_redemptions r where r.tenant_id = cm.tenant_id and r.customer_membership_id = cm.id)::int as redemptions,
        (select coalesce(sum(mp.amount_cents), 0) from membership_payments mp where mp.tenant_id = cm.tenant_id and mp.customer_membership_id = cm.id and mp.status = 'succeeded')::bigint as lifetime_paid,
        (select mp.status from membership_payments mp where mp.tenant_id = cm.tenant_id and mp.customer_membership_id = cm.id order by mp.created_at desc, mp.id desc limit 1) as last_payment_status
      ${from} where ${where} order by ${search.rank}, cm.started_at desc nulls last, cm.created_at desc, cm.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { filter, period: per, dateField, items: rows.map((r: any) => {
      // the date that matters, with its honest label: an auto-renewing membership renews, a term / canceling one ends
      const ends = r.cancel_at_period_end ? r.current_period_end : r.term_end_at;
      return { membershipId: String(r.id), customerId: String(r.customer_id), customerName: String(r.full_name || ''), avatarUrl: r.avatar_url ?? null, maskedPhone: maskPhone(r.phone_display ?? r.normalized_phone),
        planId: r.plan_id ? String(r.plan_id) : null, planName: String(r.plan_name || ''), status: String(r.status), memberNumber: r.member_number ?? null, startedAt: iso(r.started_at),
        nextDate: ends ? iso(ends) : iso(r.next_billing_at), nextDateKind: ends ? 'ends' : r.next_billing_at ? 'renews' : null, canceledAt: iso(r.canceled_at), autoRenew: !!r.auto_renew,
        redemptions: N(r.redemptions), lifetimePaidCents: N(r.lifetime_paid), lastPaymentStatus: r.last_payment_status ?? null, createdAt: iso(r.created_at) };
    }), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  async activity(ctx: ListCtx, f: { type?: string; page?: unknown; pageSize?: unknown; q?: string; preset?: unknown; from?: unknown; to?: unknown; membershipId?: string }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const type = typeof f.type === 'string' && /^[a-z_]{2,40}$/.test(f.type) ? f.type : null;
    const per = await this.period(ctx, f);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const mid = f.membershipId && UUID.test(f.membershipId) ? f.membershipId : null;
    const w = sql`${type ? sql`a.activity_type = ${type}` : sql`true`} and ${this.inP(sql`a.occurred_at`, per)} and (${mid}::uuid is null or a.customer_membership_id = ${mid})
      and (${raw} = '' or coalesce(a.customer_name_snapshot, '') ilike ${l} or coalesce(a.plan_name_snapshot, '') ilike ${l} or a.activity_type ilike ${l} or a.customer_membership_id::text = ${raw.toLowerCase()})`;
    const total = N((await sql<any>`select count(*)::int as n from membership_activity a where a.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select a.id, a.activity_type, a.customer_id, a.customer_membership_id, a.customer_name_snapshot, a.plan_name_snapshot, a.occurred_at, a.amount_cents, a.meta
      from membership_activity a where a.tenant_id = ${T} and ${w} order by a.occurred_at desc, a.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const types = (await sql<any>`select activity_type, count(*)::int as n from membership_activity where tenant_id = ${T} group by activity_type order by n desc`.execute(this.db)).rows;
    return { period: per, types: types.map((t: any) => ({ type: String(t.activity_type), count: N(t.n) })), items: rows.map((a: any) => ({ id: String(a.id), activityType: String(a.activity_type), customerId: a.customer_id ? String(a.customer_id) : null,
      membershipId: a.customer_membership_id ? String(a.customer_membership_id) : null, customerName: a.customer_name_snapshot ?? null, planName: a.plan_name_snapshot ?? null, occurredAt: iso(a.occurred_at),
      amountCents: a.amount_cents == null ? null : N(a.amount_cents), status: (a.meta && typeof a.meta === 'object' && typeof a.meta.status === 'string') ? a.meta.status : null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Plan Performance: member mix, revenue this / last month, renewals, benefit utilisation — only what is tracked. */
  async planPerformance(ctx: ListCtx) {
    const T = ctx.tenantId; const { start, prev, tz } = await this.month(ctx);
    const rows = (await sql<any>`select p.id, p.name, p.status, v.billing_interval, v.price_cents, v.is_custom_pricing,
        (select json_object_agg(s.status, s.n) from (select cm.status, count(*)::int as n from customer_memberships cm where cm.tenant_id = p.tenant_id and cm.plan_id = p.id group by cm.status) s) as mix,
        (select count(*) from customer_memberships cm where cm.tenant_id = p.tenant_id and cm.plan_id = p.id and cm.started_at >= ${start})::int as joined_month,
        (select count(*) from customer_memberships cm where cm.tenant_id = p.tenant_id and cm.plan_id = p.id and cm.canceled_at >= ${start})::int as canceled_month,
        (select coalesce(sum(mp.amount_cents), 0) from membership_payments mp join customer_memberships cm on cm.id = mp.customer_membership_id where mp.tenant_id = p.tenant_id and cm.plan_id = p.id and mp.status = 'succeeded' and mp.settled_at >= ${start})::bigint as rev_month,
        (select coalesce(sum(mp.amount_cents), 0) from membership_payments mp join customer_memberships cm on cm.id = mp.customer_membership_id where mp.tenant_id = p.tenant_id and cm.plan_id = p.id and mp.status = 'succeeded' and mp.settled_at >= ${prev} and mp.settled_at < ${start})::bigint as rev_prev,
        (select count(*) from membership_payments mp join customer_memberships cm on cm.id = mp.customer_membership_id where mp.tenant_id = p.tenant_id and cm.plan_id = p.id and mp.status = 'succeeded' and mp.kind = 'renewal' and mp.settled_at >= ${start})::int as renewals_month,
        (select count(*) from membership_payments mp join customer_memberships cm on cm.id = mp.customer_membership_id where mp.tenant_id = p.tenant_id and cm.plan_id = p.id and mp.status = 'failed' and mp.created_at >= ${start})::int as failed_month,
        (select count(*) from membership_redemptions r join customer_memberships cm on cm.id = r.customer_membership_id where r.tenant_id = p.tenant_id and cm.plan_id = p.id and r.created_at >= ${start})::int as redemptions_month,
        (select coalesce(sum(r.allocated_value_cents), 0) from membership_redemptions r join customer_memberships cm on cm.id = r.customer_membership_id where r.tenant_id = p.tenant_id and cm.plan_id = p.id and r.created_at >= ${start})::bigint as redeemed_value_month
      from membership_plans p left join membership_plan_versions v on v.id = p.current_version_id
      where p.tenant_id = ${T} and p.status <> 'archived' order by p.created_at desc, p.id desc limit 100`.execute(this.db)).rows;
    return { period: { label: 'this_month', start: start.toISOString(), timeZone: tz }, notTracked: ['retention_cohorts', 'lifetime_value_by_plan'],
      plans: rows.map((r: any) => { const mix = (typeof r.mix === 'string' ? JSON.parse(r.mix) : r.mix) || {}; return { planId: String(r.id), name: String(r.name), status: String(r.status),
        billingInterval: r.billing_interval ?? null, priceCents: N(r.price_cents), isCustomPricing: !!r.is_custom_pricing, mix: Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, N(v)])),
        joinedThisMonth: N(r.joined_month), canceledThisMonth: N(r.canceled_month), revenueThisMonthCents: N(r.rev_month), revenueLastMonthCents: N(r.rev_prev),
        renewalsThisMonth: N(r.renewals_month), failedPaymentsThisMonth: N(r.failed_month), redemptionsThisMonth: N(r.redemptions_month), redeemedValueThisMonthCents: N(r.redeemed_value_month) }; }) };
  }

  /** Manage Discounts: every discount / percent benefit on each plan's CURRENT version (changing one publishes a new
   *  version through the plan builder — members on the old version keep their terms). */
  async discounts(ctx: ListCtx) {
    const rows = (await sql<any>`select p.id as plan_id, p.name as plan_name, p.status as plan_status, v.version_number, b.id, b.benefit_type, b.label, b.percent, b.value_cents, b.credits_per_cycle, b.max_per_cycle, b.service_id, s.name as service_name
      from membership_plans p join membership_plan_versions v on v.id = p.current_version_id join membership_benefits b on b.plan_version_id = v.id and b.tenant_id = p.tenant_id
      left join services s on s.id = b.service_id
      where p.tenant_id = ${ctx.tenantId} and p.status <> 'archived' order by p.name, b.sort_order, b.id`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ planId: String(r.plan_id), planName: String(r.plan_name), planStatus: String(r.plan_status), versionNumber: N(r.version_number), benefitId: String(r.id), benefitType: String(r.benefit_type),
      label: r.label ?? null, percent: r.percent == null ? null : N(r.percent), valueCents: r.value_cents == null ? null : N(r.value_cents), creditsPerCycle: r.credits_per_cycle == null ? null : N(r.credits_per_cycle),
      maxPerCycle: r.max_per_cycle == null ? null : N(r.max_per_cycle), serviceName: r.service_name ?? null })) };
  }

  /** Membership payments, newest first: every status or one; a period on when it was paid (settled) or created. The Revenue
   *  card's click-through is this month's succeeded payments (the card's own rule) — the default when nothing is chosen. */
  async payments(ctx: ListCtx, f: { page?: unknown; pageSize?: unknown; status?: string; q?: string; preset?: unknown; from?: unknown; to?: unknown; dateField?: unknown; membershipId?: string }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const st = f.status === 'all' ? null : f.status && PAYMENT_STATUSES.includes(f.status) ? f.status : 'succeeded';
    const per = await this.period(ctx, f, 'month');
    const col = f.dateField === 'created' ? sql`mp.created_at` : sql`coalesce(mp.settled_at, mp.created_at)`;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    let digits = raw.replace(/\D/g, ''); if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1); const phoneish = digits.length >= 4 && !/[a-z]/i.test(raw);
    const mid = f.membershipId && UUID.test(f.membershipId) ? f.membershipId : null;
    const payW = sql`(${st}::text is null or mp.status = ${st}) and ${this.inP(col, per)} and (${mid}::uuid is null or mp.customer_membership_id = ${mid})
      and (${raw} = '' or coalesce(c.full_name, '') ilike ${l} or coalesce(p.name, '') ilike ${l} or coalesce(mp.processor_ref, '') ilike ${l} or mp.id::text = ${raw.toLowerCase()}
        or (${phoneish} and regexp_replace(coalesce(c.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}))`;
    const from = sql`from membership_payments mp left join customers c on c.id = mp.customer_id and c.tenant_id = mp.tenant_id left join customer_memberships cm on cm.id = mp.customer_membership_id and cm.tenant_id = mp.tenant_id left join membership_plans p on p.id = cm.plan_id and p.tenant_id = mp.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where mp.tenant_id = ${T} and ${payW}`.execute(this.db)).rows[0]?.n);
    const sums = (await sql<any>`select coalesce(sum(mp.amount_cents) filter (where mp.status = 'succeeded'), 0)::bigint as ok, coalesce(sum(mp.amount_cents) filter (where mp.status = 'refunded'), 0)::bigint as refunded,
        count(*) filter (where mp.status = 'failed')::int as failed ${from} where mp.tenant_id = ${T} and ${payW}`.execute(this.db)).rows[0];
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select mp.id, mp.customer_id, mp.customer_membership_id, c.full_name, p.name as plan_name, mp.kind, mp.amount_cents, mp.tax_cents, mp.status, mp.processor, mp.processor_ref, mp.failure_reason, mp.created_at, mp.settled_at
      ${from} where mp.tenant_id = ${T} and ${payW} order by ${col} desc, mp.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { status: st ?? 'all', period: per, dateField: f.dateField === 'created' ? 'created' : 'paid',
      totals: { collectedCents: N(sums?.ok), refundedCents: N(sums?.refunded), netCents: N(sums?.ok) - N(sums?.refunded), failed: N(sums?.failed) },
      items: rows.map((r: any) => ({ id: String(r.id), customerId: String(r.customer_id), membershipId: r.customer_membership_id ? String(r.customer_membership_id) : null, customerName: String(r.full_name || ''), planName: r.plan_name ?? null, kind: String(r.kind),
        amountCents: N(r.amount_cents), taxCents: N(r.tax_cents), status: String(r.status), processor: String(r.processor ?? ''), reference: r.processor_ref ? '••' + String(r.processor_ref).slice(-6) : null,
        failure: r.status === 'failed' ? (r.failure_reason ? String(r.failure_reason).slice(0, 120) : null) : null, createdAt: iso(r.created_at), settledAt: iso(r.settled_at) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Benefit redemptions (the ledger Top Membership Services and Export Redemptions read), newest first. */
  async redemptions(ctx: ListCtx, f: { page?: unknown; pageSize?: unknown; q?: string; preset?: unknown; from?: unknown; to?: unknown; membershipId?: string }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const mid = f.membershipId && UUID.test(f.membershipId) ? f.membershipId : null;
    const from = sql`from membership_redemptions r join customer_memberships cm on cm.id = r.customer_membership_id and cm.tenant_id = r.tenant_id join customers c on c.id = cm.customer_id and c.tenant_id = cm.tenant_id
      left join membership_plans p on p.id = cm.plan_id and p.tenant_id = cm.tenant_id left join services s on s.id = r.service_id and s.tenant_id = r.tenant_id
      left join membership_benefits b on b.id = r.benefit_id and b.tenant_id = r.tenant_id left join technicians t on t.id = r.technician_id and t.tenant_id = r.tenant_id left join tickets tk on tk.id = r.ticket_id and tk.tenant_id = r.tenant_id`;
    const w = sql`r.tenant_id = ${T} and ${this.inP(sql`r.created_at`, per)} and (${mid}::uuid is null or r.customer_membership_id = ${mid})
      and (${raw} = '' or c.full_name ilike ${l} or coalesce(s.name, '') ilike ${l} or coalesce(p.name, '') ilike ${l} or coalesce(b.label, '') ilike ${l} or coalesce(tk.ticket_number::text, '') = ${raw} or r.id::text = ${raw.toLowerCase()})`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select r.id, r.created_at, r.customer_membership_id, c.full_name, p.name as plan_name, s.name as service_name, b.label as benefit_label, r.standard_value_cents, r.allocated_value_cents, r.upgrade_charge_cents,
        coalesce(nullif(t.full_name, ''), trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, ''))) as technician, tk.ticket_number
      ${from} where ${w} order by r.created_at desc, r.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, items: rows.map((r: any) => ({ id: String(r.id), at: iso(r.created_at), membershipId: String(r.customer_membership_id), customerName: String(r.full_name || ''), planName: r.plan_name ?? null,
      service: r.service_name ?? null, benefit: r.benefit_label ?? null, standardValueCents: N(r.standard_value_cents), allocatedValueCents: N(r.allocated_value_cents), upgradeChargeCents: N(r.upgrade_charge_cents),
      technician: r.technician || null, ticketNumber: r.ticket_number == null ? null : String(r.ticket_number) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Plans, server-paged (newest first): price / interval from the CURRENT version, active and total members, this month's revenue. */
  async planList(ctx: ListCtx, f: { page?: unknown; pageSize?: unknown; q?: string; status?: string }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const { start } = await this.month(ctx);
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const st = f.status && ['active', 'draft', 'archived', 'paused'].includes(f.status) ? f.status : null;
    const w = sql`(${st}::text is null or p.status = ${st}) and (${st}::text is not null or p.status <> 'archived')
      and (${raw} = '' or p.name ilike ${l} or coalesce(p.plan_code, '') ilike ${l} or coalesce(p.description, '') ilike ${l})`;
    const total = N((await sql<any>`select count(*)::int as n from membership_plans p where p.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select p.id, p.name, p.plan_code, p.description, p.status, p.is_popular, p.badge, p.created_at, v.version_number, v.billing_interval, v.interval_count, v.price_cents, v.is_custom_pricing, v.trial_days,
        (select count(*) from customer_memberships cm where cm.tenant_id = p.tenant_id and cm.plan_id = p.id and cm.status = 'active')::int as active,
        (select count(*) from customer_memberships cm where cm.tenant_id = p.tenant_id and cm.plan_id = p.id and cm.status not in ('canceled', 'cancelled', 'expired'))::int as current,
        (select count(*) from membership_benefits b where b.tenant_id = p.tenant_id and b.plan_version_id = v.id)::int as benefits,
        (select coalesce(sum(mp.amount_cents), 0) from membership_payments mp join customer_memberships cm on cm.id = mp.customer_membership_id and cm.tenant_id = mp.tenant_id where mp.tenant_id = p.tenant_id and cm.plan_id = p.id and mp.status = 'succeeded' and mp.settled_at >= ${start})::bigint as rev_month
      from membership_plans p left join membership_plan_versions v on v.id = p.current_version_id and v.tenant_id = p.tenant_id
      where p.tenant_id = ${T} and ${w} order by p.created_at desc, p.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ planId: String(r.id), name: String(r.name), code: r.plan_code ?? null, description: r.description ?? null, status: String(r.status), isPopular: !!r.is_popular, badge: r.badge ?? null,
      versionNumber: r.version_number == null ? null : N(r.version_number), billingInterval: r.billing_interval ?? null, intervalCount: N(r.interval_count) || 1, priceCents: N(r.price_cents), isCustomPricing: !!r.is_custom_pricing,
      trialDays: r.trial_days == null ? null : N(r.trial_days), activeMembers: N(r.active), currentMembers: N(r.current), benefits: N(r.benefits), revenueThisMonthCents: N(r.rev_month), createdAt: iso(r.created_at) })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Member Details: identity, lifecycle, billing summary, benefits (entitled / used / remaining this cycle), recent payments,
   *  redemptions, activity and the management audit — one membership (a customer's other memberships are listed apart). */
  async memberDetail(ctx: ListCtx, membershipId: string) {
    const T = ctx.tenantId;
    if (!UUID.test(String(membershipId))) throw withCode(new HttpException({ code: 'MEMBERSHIP_NOT_FOUND', message: 'That membership could not be found.' }, HttpStatus.NOT_FOUND), 'MEMBERSHIP_NOT_FOUND');
    const m = (await sql<any>`select cm.id, cm.customer_id, cm.plan_id, cm.plan_version_id, cm.status, cm.member_number, cm.started_at, cm.current_period_start, cm.current_period_end, cm.next_billing_at, cm.term_end_at, cm.cycles_billed, cm.auto_renew, cm.auto_renew_consent_at, cm.enrolled_channel, cm.cancel_at_period_end, cm.canceled_at, cm.cancel_reason, cm.paused_at, cm.pause_resumes_at, cm.pauses_used, cm.comped, cm.created_at, c.full_name, c.phone_display, c.normalized_phone, c.email, c.avatar_url, p.name as plan_name, p.status as plan_status, v.version_number, v.billing_interval, v.interval_count, v.price_cents, v.is_custom_pricing,
        v.trial_days, v.pause_max_per_year, v.cancellation_policy, b.name as branch_name
      from customer_memberships cm join customers c on c.id = cm.customer_id and c.tenant_id = cm.tenant_id left join membership_plans p on p.id = cm.plan_id and p.tenant_id = cm.tenant_id
      left join membership_plan_versions v on v.id = cm.plan_version_id and v.tenant_id = cm.tenant_id left join branches b on b.id = cm.branch_id and b.tenant_id = cm.tenant_id
      where cm.tenant_id = ${T} and cm.id = ${membershipId}`.execute(this.db)).rows[0];
    if (!m) throw withCode(new HttpException({ code: 'MEMBERSHIP_NOT_FOUND', message: 'That membership could not be found.' }, HttpStatus.NOT_FOUND), 'MEMBERSHIP_NOT_FOUND');
    const cycleStart = m.current_period_start ?? m.started_at;
    const benefits = (await sql<any>`select b.id, b.benefit_type, b.label, b.credits_per_cycle, b.max_per_cycle, b.percent, b.value_cents, s.name as service_name,
        (select count(*) from membership_redemptions r where r.tenant_id = b.tenant_id and r.customer_membership_id = ${membershipId} and r.benefit_id = b.id and (${cycleStart}::timestamptz is null or r.created_at >= ${cycleStart}))::int as used_cycle,
        (select count(*) from membership_redemptions r where r.tenant_id = b.tenant_id and r.customer_membership_id = ${membershipId} and r.benefit_id = b.id)::int as used_total,
        (select coalesce(sum(l.quantity), 0) from membership_credit_ledger l where l.tenant_id = b.tenant_id and l.customer_membership_id = ${membershipId} and l.benefit_id = b.id)::int as ledger_balance,
        (select min(l.expires_at) from membership_credit_ledger l where l.tenant_id = b.tenant_id and l.customer_membership_id = ${membershipId} and l.benefit_id = b.id and l.expires_at > now()) as next_expiry
      from membership_benefits b left join services s on s.id = b.service_id and s.tenant_id = b.tenant_id
      where b.tenant_id = ${T} and b.plan_version_id = ${m.plan_version_id} order by b.sort_order, b.id`.execute(this.db)).rows;
    const billing = (await sql<any>`select coalesce(sum(amount_cents) filter (where status = 'succeeded'), 0)::bigint as paid, coalesce(sum(amount_cents) filter (where status = 'refunded'), 0)::bigint as refunded,
        max(settled_at) filter (where status = 'succeeded') as last_paid, count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status = 'pending')::int as pending
      from membership_payments where tenant_id = ${T} and customer_membership_id = ${membershipId}`.execute(this.db)).rows[0];
    const audit = (await sql<any>`select a.id, a.action, a.prev_state, a.new_state, a.reason, a.result, a.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor
      from membership_audit a left join users u on u.id = a.actor_user_id where a.tenant_id = ${T} and a.customer_membership_id = ${membershipId} order by a.created_at desc, a.id desc limit 15`.execute(this.db)).rows;
    const others = (await sql<any>`select cm.id, cm.status, cm.started_at, p.name as plan_name from customer_memberships cm left join membership_plans p on p.id = cm.plan_id and p.tenant_id = cm.tenant_id
      where cm.tenant_id = ${T} and cm.customer_id = ${m.customer_id} and cm.id <> ${membershipId} order by cm.started_at desc nulls last, cm.id desc limit 10`.execute(this.db)).rows;
    const ends = m.cancel_at_period_end ? m.current_period_end : m.term_end_at;
    return {
      member: { membershipId: String(m.id), customerId: String(m.customer_id), customerName: String(m.full_name || ''), maskedPhone: maskPhone(m.phone_display ?? m.normalized_phone), hasEmail: !!m.email, avatarUrl: m.avatar_url ?? null,
        memberNumber: m.member_number ?? null, status: String(m.status), planId: m.plan_id ? String(m.plan_id) : null, planName: String(m.plan_name || ''), planStatus: m.plan_status ?? null, versionNumber: m.version_number == null ? null : N(m.version_number),
        priceCents: N(m.price_cents), billingInterval: m.billing_interval ?? null, intervalCount: N(m.interval_count) || 1, isCustomPricing: !!m.is_custom_pricing, comped: !!m.comped, branch: m.branch_name ?? null,
        enrolledChannel: m.enrolled_channel ?? null, autoRenew: !!m.auto_renew, autoRenewConsentAt: iso(m.auto_renew_consent_at) },
      lifecycle: { startedAt: iso(m.started_at), createdAt: iso(m.created_at), periodStart: iso(m.current_period_start), periodEnd: iso(m.current_period_end), nextBillingAt: iso(m.next_billing_at), endsAt: iso(ends),
        termEndAt: iso(m.term_end_at), pausedAt: iso(m.paused_at), pauseResumesAt: iso(m.pause_resumes_at), pausesUsed: N(m.pauses_used), pauseLimitPerYear: m.pause_max_per_year == null ? null : N(m.pause_max_per_year),
        cancelAtPeriodEnd: !!m.cancel_at_period_end, canceledAt: iso(m.canceled_at), cancelReason: m.cancel_reason ?? null, cyclesBilled: N(m.cycles_billed), cancellationPolicy: m.cancellation_policy ?? null },
      billing: { paidCents: N(billing?.paid), refundedCents: N(billing?.refunded), netCents: N(billing?.paid) - N(billing?.refunded), lastPaidAt: iso(billing?.last_paid), failedPayments: N(billing?.failed), pendingPayments: N(billing?.pending) },
      benefits: benefits.map((b: any) => {
        const allowance = b.credits_per_cycle != null ? N(b.credits_per_cycle) : b.max_per_cycle != null ? N(b.max_per_cycle) : null;
        return { benefitId: String(b.id), type: String(b.benefit_type), label: b.label ?? null, service: b.service_name ?? null, percent: b.percent == null ? null : Number(b.percent), valueCents: b.value_cents == null ? null : N(b.value_cents),
          perCycle: allowance, usedThisCycle: N(b.used_cycle), usedTotal: N(b.used_total), remaining: allowance == null ? null : Math.max(0, allowance - N(b.used_cycle)), nextExpiry: iso(b.next_expiry) };
      }),
      audit: audit.map((a: any) => ({ id: String(a.id), action: String(a.action), from: a.prev_state ?? null, to: a.new_state ?? null, reason: a.reason ?? null, result: a.result ?? null, at: iso(a.created_at), actor: a.actor ?? null })),
      otherMemberships: others.map((o: any) => ({ membershipId: String(o.id), status: String(o.status), planName: o.plan_name ?? null, startedAt: iso(o.started_at) })),
    };
  }
}

export const MEMBERSHIP_LISTS = 'MembershipListsRepository';
function ctxFrom(req: any): ListCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const per = (q: any) => ({ preset: s(q?.preset), from: s(q?.from), to: s(q?.to) });
const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const MEMBERS_LIST = { filters: { filter: { type: 'enum', values: MEMBER_FILTERS }, planId: { type: 'uuid' }, expiringWindowDays: { type: 'int', min: 1, max: 90 }, preset: PRESET, dateField: { type: 'enum', values: MEMBER_DATE_FIELDS } },
  search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const ACTIVITY_LIST = { filters: { type: { type: 'text', maxLength: 40 }, membershipId: { type: 'uuid' }, preset: PRESET }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PAYMENTS_LIST = { filters: { status: { type: 'enum', values: [...PAYMENT_STATUSES, 'all'] }, membershipId: { type: 'uuid' }, preset: PRESET, dateField: { type: 'enum', values: ['paid', 'created'] } },
  search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const REDEMPTIONS_LIST = { filters: { membershipId: { type: 'uuid' }, preset: PRESET }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PLANS_LIST = { filters: { status: { type: 'enum', values: ['active', 'draft', 'archived', 'paused'] } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@RequireFeature('memberships')
@Controller('pos/memberships')
export class MembershipListsController {
  constructor(@Inject(MEMBERSHIP_LISTS) private readonly repo: MembershipListsRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Memberships need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private auth(req: any) { const c = ctxFrom(req); if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); return c; }

  @Get('members') @RequirePermission('pos.memberships.view') @ListQuery(MEMBERS_LIST)
  members(@Req() req: any, @Query() q: any) { return this.r().members(this.auth(req), { filter: s(q?.filter), planId: s(q?.planId), q: s(q?.q), page: q?.page, pageSize: q?.pageSize, expiringWindowDays: q?.expiringWindowDays, ...per(q), dateField: s(q?.dateField) }); }

  @Get('members/:membershipId/detail') @RequirePermission('pos.memberships.view')
  memberDetail(@Req() req: any, @Param('membershipId') id: string) { return this.r().memberDetail(this.auth(req), id); }

  @Get('activity') @RequirePermission('pos.memberships.view') @ListQuery(ACTIVITY_LIST)
  activity(@Req() req: any, @Query() q: any) { return this.r().activity(this.auth(req), { type: s(q?.type), q: s(q?.q), membershipId: s(q?.membershipId), page: q?.page, pageSize: q?.pageSize, ...per(q) }); }

  @Get('payments') @RequirePermission('pos.memberships.view') @ListQuery(PAYMENTS_LIST)
  payments(@Req() req: any, @Query() q: any) { return this.r().payments(this.auth(req), { status: s(q?.status), q: s(q?.q), membershipId: s(q?.membershipId), dateField: s(q?.dateField), page: q?.page, pageSize: q?.pageSize, ...per(q) }); }

  @Get('redemptions') @RequirePermission('pos.memberships.view') @ListQuery(REDEMPTIONS_LIST)
  redemptions(@Req() req: any, @Query() q: any) { return this.r().redemptions(this.auth(req), { q: s(q?.q), membershipId: s(q?.membershipId), page: q?.page, pageSize: q?.pageSize, ...per(q) }); }

  @Get('plans-list') @RequirePermission('pos.memberships.view') @ListQuery(PLANS_LIST)
  planList(@Req() req: any, @Query() q: any) { return this.r().planList(this.auth(req), { q: s(q?.q), status: s(q?.status), page: q?.page, pageSize: q?.pageSize }); }

  @Get('plan-performance') @RequirePermission('pos.memberships.view')
  planPerformance(@Req() req: any) { return this.r().planPerformance(this.auth(req)); }

  @Get('discounts') @RequirePermission('pos.memberships.view')
  discounts(@Req() req: any) { return this.r().discounts(this.auth(req)); }
}
