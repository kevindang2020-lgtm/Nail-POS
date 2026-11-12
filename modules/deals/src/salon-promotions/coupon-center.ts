// coupon-center.ts — Coupons & Promotions Management Center (guide of 30 Oct 2026). The MANAGEMENT layer of
// Marketing → Coupons over the ONE coupon engine (deals of kind 'coupon' + deal_coupon_codes + the deal_redemptions
// ledger). It adds what the guide asks for and the engine did not have; everything else is reused:
//   list / search / KPIs / redemption history / performance / details   → pos/discounts/* (discounts-screen.ts)
//   create / edit / publish / pause / resume / archive / codes           → pos/deals/* (DealsService; duplicate added there)
//   POST pos/coupons/:dealId/check      §12 read-only verdict — DealsCheckoutService.check (Checkout's own engine)
//   GET  pos/coupons/:dealId/campaigns  §11 Related Campaigns — campaigns linked through the coupon's code batches
//   GET  pos/coupons/health             §19 diagnostics — ledger vs counters, stuck holds, missed payment marks, expiry lag
//   POST pos/coupons/assistant/suggest  §16 a suggestion computed from THIS salon's data (rules-v1, no AI provider call)
//   POST pos/coupons/assistant/draft    §16 the owner's edited suggestion saved as a DRAFT coupon + audit row; never
//                                       activates, never sends — Publish (owner/manager) is the separate approval step
// Tenant pinned in every statement; a branch user sees salon-wide coupons and their branch's. Money is integer cents.
import { sql, type Kysely } from 'kysely';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { withCode, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { DATABASE, tenantTimeZone, ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { COUPON_ASSIST_BODY, COUPON_ASSIST_DRAFT_BODY, COUPON_CHECK_BODY } from '../request-schemas';
import { DealsService, DealConflictError, DealForbiddenError, DealValidationError } from '../deals/deals.service';
import { DealsCheckoutService, DealRefusedError } from '../engine/deals-checkout.service';
import type { DealContext } from '../deals/deals.dto';

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ASSIST_GOALS = ['slow_weekdays', 'promote_service', 'returning_visits', 'reconnect_inactive'] as const;
export type AssistGoal = (typeof ASSIST_GOALS)[number];
export const ASSIST_METHOD = 'rules-v1';

export interface CouponTerms {
  title: string; discountType: 'percent' | 'fixed'; discountPercent: number | null; discountCents: number | null; serviceIds: string[]; daysOfWeek: number[] | null;
  startsAt: string | null; endsAt: string | null; maxRedemptions: number | null; maxPerCustomer: number | null; minSpendCents: number | null; newCustomersOnly: boolean;
  rules: Record<string, unknown> | null;
}
export interface Suggestion {
  goal: AssistGoal; method: string; terms: CouponTerms; basis: Record<string, unknown>; explanation: string;
  /** what it might cost if the visits in the basis repeated — an exposure bound, NOT a forecast of conversion or profit */
  exposure: { visitsInBasis: number; avgEligibleTicketCents: number; maxDiscountIfRepeatedCents: number; note: string } | null;
  eligibleCustomers: number | null; uncertainty: string;
}
export type HealthStatus = 'ready' | 'attention' | 'failed' | 'unknown';
export interface HealthCheck { key: string; status: HealthStatus; count: number | null; detail: string; sample: string[] }

/** 'coupon' = Marketing → Coupons; 'all' = Marketing → Deals & Offers (every kind, salon and technician). Same engine, same rules. */
export type CenterScope = 'coupon' | 'all';

export class CouponCenter {
  constructor(private readonly db: Kysely<any>, private readonly deals: DealsService, private readonly checkout: DealsCheckoutService | null, private readonly scope: CenterScope = 'coupon') {}
  private branch(ctx: DealContext) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(d.branch_id = ${ctx.branchId} or d.branch_id is null)` : sql`true`; }
  private kindW() { return this.scope === 'coupon' ? sql`d.kind = 'coupon'` : sql`true`; }
  private get noun() { return this.scope === 'coupon' ? 'coupon' : 'offer'; }
  private async coupon(ctx: DealContext, dealId: string) {
    if (!UUID.test(String(dealId))) return null;
    return (await sql<any>`select d.id, d.title from deals d where d.tenant_id = ${ctx.tenantId} and d.id = ${dealId} and ${this.kindW()} and ${this.branch(ctx)}`.execute(this.db)).rows[0] ?? null;
  }
  private notFound() { return withCode(new HttpException({ code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' }, HttpStatus.NOT_FOUND), 'PROMOTION_NOT_FOUND'); }

  /** §12: Checkout's own verdict for this coupon (read-only). A coupon outside this branch's scope is "not found". */
  async check(ctx: DealContext, dealId: string, b: { ticketId?: string | null; ticketNumber?: string | null; customerId?: string | null; serviceIds?: string[] | null; spendCents?: unknown; codeEntered?: boolean | null }) {
    if (!(await this.coupon(ctx, dealId))) throw this.notFound();
    if (!b.ticketId && b.ticketNumber && String(b.ticketNumber).trim()) {   // the number the desk sees (#1042), this salon's only, newest first
      const num = String(b.ticketNumber).trim().replace(/^#/, '');
      const t = (await sql<any>`select id from tickets where tenant_id = ${ctx.tenantId} and ticket_number::text = ${num} and removed_at is null ${ctx.branchId && /^[0-9a-f-]{36}$/i.test(String(ctx.branchId)) ? sql`and branch_id = ${ctx.branchId}::uuid` : sql``} order by created_at desc, id desc limit 1`.execute(this.db)).rows[0];
      if (!t) throw withCode(new HttpException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' }, HttpStatus.NOT_FOUND), 'TICKET_NOT_FOUND');
      b = { ...b, ticketId: String(t.id) };
    }
    if (!this.checkout) throw withCode(new HttpException({ code: 'DEALS_NOT_AVAILABLE', message: 'Deals and coupons are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'DEALS_NOT_AVAILABLE');
    if (b.ticketId && !UUID.test(String(b.ticketId))) throw withCode(new HttpException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' }, HttpStatus.BAD_REQUEST), 'TICKET_NOT_FOUND');
    let customerId = b.customerId && UUID.test(String(b.customerId)) ? String(b.customerId) : null;
    if (customerId && !(await sql<any>`select 1 from customers where tenant_id = ${ctx.tenantId} and id = ${customerId}`.execute(this.db)).rows[0]) customerId = null;   // never judge another salon's customer
    return this.checkout.check(ctx, dealId, { ticketId: b.ticketId ?? null, customerId, serviceIds: (b.serviceIds ?? []).filter((s) => UUID.test(String(s))), spendCents: N(b.spendCents), codeEntered: !!b.codeEntered });
  }

  /** §11 Related Campaigns: the campaigns this coupon's code batches were generated for (the only stored link). */
  async campaigns(ctx: DealContext, dealId: string) {
    if (!(await this.coupon(ctx, dealId))) throw this.notFound();
    const rows = (await sql<any>`select c.id, c.name, c.channel, c.status, c.created_at, sum(b.quantity)::int as codes, min(b.created_at) as linked_at
      from deal_coupon_batches b join campaigns c on c.id = b.campaign_id and c.tenant_id = b.tenant_id
      where b.tenant_id = ${ctx.tenantId} and b.deal_id = ${dealId} group by c.id, c.name, c.channel, c.status, c.created_at order by min(b.created_at) desc, c.id desc limit 50`.execute(this.db)).rows;
    return { items: rows.map((r: any) => ({ campaignId: String(r.id), name: String(r.name), channel: String(r.channel), status: String(r.status), codes: N(r.codes), linkedAt: iso(r.linked_at) })),
      note: 'Linked through coupon code batches generated for a campaign. A campaign that only mentions the offer in its text is not linked.' };
  }

  /** §19 diagnostics from verified checks only; a check that cannot run is "unknown", never green. */
  async health(ctx: DealContext) {
    const T = ctx.tenantId; const checks: HealthCheck[] = [];
    const run = async (key: string, okText: string, badText: (n: number) => string, q: () => Promise<any[]>) => {
      try {
        const rows = await q();
        checks.push({ key, status: rows.length ? 'attention' : 'ready', count: rows.length, detail: rows.length ? badText(rows.length) : okText, sample: rows.slice(0, 5).map((r) => String(r.id)) });
      } catch { checks.push({ key, status: 'unknown', count: null, detail: 'This check could not run.', sample: [] }); }
    };
    await run('counters', 'Every coupon\'s use count matches its completed redemptions.', (n) => `${n} coupon(s) whose use count differs from the completed redemptions in the ledger.`,
      async () => (await sql<any>`select d.id from deals d where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)}
        and d.redemption_count <> (select count(*) from deal_redemptions r where r.tenant_id = d.tenant_id and r.deal_id = d.id and r.status in ('redeemed', 'partially_reversed')) limit 50`.execute(this.db)).rows);
    await run('paid_not_marked', 'No paid ticket still carries a coupon only as "applied".', (n) => `${n} coupon application(s) on PAID tickets were never marked redeemed (the payment step did not finish).`,
      async () => (await sql<any>`select r.id from deal_redemptions r join tickets t on t.id = r.ticket_id and t.tenant_id = r.tenant_id join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id
        where r.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and r.status = 'applied' and t.status in ('paid', 'closed') limit 50`.execute(this.db)).rows);
    await run('stuck_holds', 'No coupon is held on an abandoned ticket.', (n) => `${n} coupon application(s) held for over 24 hours on tickets that were voided, cancelled or never paid.`,
      async () => (await sql<any>`select r.id from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id left join tickets t on t.id = r.ticket_id and t.tenant_id = r.tenant_id
        where r.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and r.status = 'applied' and coalesce(r.applied_at, r.created_at) < now() - interval '24 hours'
          and coalesce(t.status, 'missing') not in ('paid', 'closed') limit 50`.execute(this.db)).rows);
    await run('confirmed_unpaid', 'Every completed redemption belongs to a paid (or refunded) ticket.', (n) => `${n} completed redemption(s) on tickets that are not paid.`,
      async () => (await sql<any>`select r.id from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id left join tickets t on t.id = r.ticket_id and t.tenant_id = r.tenant_id
        where r.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and r.status in ('redeemed', 'partially_reversed') and coalesce(t.status, 'missing') not in ('paid', 'closed', 'refunded', 'partially_refunded') limit 50`.execute(this.db)).rows);
    await run('expiry_lag', 'Ended coupons have been closed by the scheduled job.', (n) => `${n} coupon(s) past their end date are still marked active (the expiry job is behind; Checkout refuses them anyway by date).`,
      async () => (await sql<any>`select d.id from deals d where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and d.status = 'active' and d.ends_at is not null and d.ends_at < now() - interval '1 hour' limit 50`.execute(this.db)).rows);
    // Promotions backlog · 16 "No-Double-Use Monitor": a cap race that got through — more completed uses than the offer's total
    // cap, or one customer over the per-customer limit. Read from the ledger; the correction (reversal / refund) is a person's call.
    await run('cap_exceeded', 'No coupon has been used more often than its limits allow.', (n) => `${n} coupon(s) have more completed uses than their total or per-customer limit allows (two checkouts raced past the limit). Review the redemptions; nothing was changed.`,
      async () => (await sql<any>`select d.id from deals d where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and (
          (d.max_redemptions is not null and (select count(*) from deal_redemptions r where r.tenant_id = d.tenant_id and r.deal_id = d.id and r.status in ('redeemed', 'partially_reversed')) > d.max_redemptions)
          or (d.max_per_customer is not null and exists (select 1 from deal_redemptions r where r.tenant_id = d.tenant_id and r.deal_id = d.id and r.status in ('redeemed', 'partially_reversed') and r.customer_id is not null
                group by r.customer_id having count(*) > d.max_per_customer)))
        order by d.created_at, d.id limit 50`.execute(this.db)).rows);
    // Promotions backlog · 11 "Fraud/Abuse Signals" (repeat-account part): one phone number behind two or more customer
    // records that each completed the SAME offer — a way around a per-customer limit. A signal for a person to review; no
    // customer, redemption or offer is changed or penalised.
    await run('repeat_accounts', 'No offer was used by several customer records that share one phone number.', (n) => `${n} coupon(s) were used by two or more customer records with the same phone number (possible duplicate accounts getting around a per-customer limit). Review the redemptions; nothing was changed.`,
      async () => (await sql<any>`select d.id from deals d where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and exists (
          select 1 from deal_redemptions r join customers c on c.id = r.customer_id and c.tenant_id = r.tenant_id
          where r.tenant_id = d.tenant_id and r.deal_id = d.id and r.status in ('redeemed', 'partially_reversed') and c.normalized_phone is not null and c.normalized_phone <> ''
          group by c.normalized_phone having count(distinct r.customer_id) > 1)
        order by d.created_at, d.id limit 50`.execute(this.db)).rows);
    // Promotions backlog · 07 "Code Conflict Finder": codes themselves are unique per salon (uq_deal_coupon_code), so the real
    // conflict is two live / scheduled offers that are BOTH marked combinable, cover the same service (no service list = every
    // service), the same branch scope and overlapping dates — Checkout may stack them on one ticket. Flagged for a person to
    // review; nothing is paused or edited here. The sample is the earlier-created offer of each pair.
    await run('stacking_overlap', 'No two live offers can be combined on the same service by accident.', (n) => `${n} live or scheduled coupon(s) are marked combinable with another live coupon on the same service and dates — they can stack on one ticket. Review whether that is intended.`,
      async () => (await sql<any>`select distinct a.id, a.created_at from deals a join deals b on b.tenant_id = a.tenant_id and b.id <> a.id and (b.created_at, b.id) > (a.created_at, a.id)
        where a.tenant_id = ${T} and ${this.scope === 'coupon' ? sql`a.kind = 'coupon' and b.kind = 'coupon' and ` : sql``}a.status in ('active', 'scheduled') and b.status in ('active', 'scheduled')
          and a.stackable and b.stackable
          and (a.branch_id is null or b.branch_id is null or a.branch_id = b.branch_id)
          and ${ctx.branchId && UUID.test(ctx.branchId) ? sql`(a.branch_id = ${ctx.branchId} or a.branch_id is null)` : sql`true`}
          and coalesce(a.starts_at, '-infinity'::timestamptz) < coalesce(b.ends_at, 'infinity'::timestamptz)
          and coalesce(b.starts_at, '-infinity'::timestamptz) < coalesce(a.ends_at, 'infinity'::timestamptz)
          and (not exists (select 1 from deal_services s where s.tenant_id = a.tenant_id and s.deal_id = a.id)
            or not exists (select 1 from deal_services s where s.tenant_id = b.tenant_id and s.deal_id = b.id)
            or exists (select 1 from deal_services sa join deal_services sb on sb.service_id = sa.service_id and sb.tenant_id = sa.tenant_id
                       where sa.tenant_id = a.tenant_id and sa.deal_id = a.id and sb.deal_id = b.id))
        order by a.created_at, a.id limit 50`.execute(this.db)).rows);
    if (this.scope === 'all') {
      // Deals & Offers guide §17 "Check Deal System": the approval backlog and live technician deals measured against TODAY's rules
      await run('approval_backlog', 'No deal has been waiting for a manager for more than 3 days.', (n) => `${n} deal(s) have waited for a manager's decision for more than 3 days.`,
        async () => (await sql<any>`select d.id from deals d where d.tenant_id = ${T} and ${this.branch(ctx)} and d.status = 'pending_approval' and d.updated_at < now() - interval '3 days' limit 50`.execute(this.db)).rows);
      await run('tech_policy', 'Every live or pending technician deal is within the salon\'s technician-deal rules.', (n) => `${n} technician deal(s) are outside the salon's current technician-deal rules (the rules changed after they were made). Approving or resuming them is refused until they are fixed.`,
        async () => (await sql<any>`select d.id from deals d join deal_settings s on s.tenant_id = d.tenant_id where d.tenant_id = ${T} and ${this.branch(ctx)} and d.owner_type = 'technician'
          and d.status in ('pending_approval', 'approved', 'scheduled', 'active', 'paused')
          and (s.allow_technician_deals = 'off' or (d.discount_type = 'percent' and s.max_discount_percent is not null and d.discount_percent > s.max_discount_percent)
            or (d.discount_type = 'fixed' and s.max_fixed_discount_cents is not null and d.discount_cents > s.max_fixed_discount_cents)
            -- the other four rules Checkout and approval apply (validateTechDealAgainstSettings); the check used to test only the two caps
            or (s.min_service_price_cents is not null and coalesce(d.original_price_cents, 0) < s.min_service_price_cents)
            or (s.max_redemptions_cap is not null and d.max_redemptions is not null and d.max_redemptions > s.max_redemptions_cap)
            or (d.new_customers_only and not s.allowed_new_customer)
            or (s.max_campaign_duration_days is not null and d.starts_at is not null and d.ends_at is not null
                and extract(epoch from (d.ends_at - d.starts_at)) / 86400 > s.max_campaign_duration_days)) limit 50`.execute(this.db)).rows);
    }
    if (this.scope === 'all') for (const c of checks) c.detail = c.detail.replace(/\bcoupon(s?)\b/g, 'offer$1');
    const rank: Record<HealthStatus, number> = { ready: 0, unknown: 1, attention: 2, failed: 3 };
    const overall = checks.reduce<HealthStatus>((w, c) => (rank[c.status] > rank[w] ? c.status : w), 'ready');
    return { overall, checkedAt: new Date().toISOString(), checks };
  }

  /** audit B1–B4 (Nov 4 2026): a recorded run of the same read-only checks (who, when, what) — the history the screen shows */
  async runHealth(ctx: DealContext) {
    const r = await this.health(ctx);
    const area = this.scope === 'coupon' ? 'coupons' : 'deals';
    const row = (await sql<any>`insert into marketing_health_runs (tenant_id, branch_id, area, overall, checks, checked_by)
        values (${ctx.tenantId}, ${ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null}, ${area}, ${r.overall}, ${JSON.stringify(r.checks)}::jsonb, ${UUID.test(String(ctx.userId)) ? ctx.userId : null})
        returning id, created_at`.execute(this.db)).rows[0];
    return { ...r, runId: String(row.id), checkedAt: iso(row.created_at) };
  }
  async healthRuns(ctx: DealContext, f: { page?: unknown; pageSize?: unknown }) {
    const area = this.scope === 'coupon' ? 'coupons' : 'deals';
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10)); const page0 = Math.max(1, Math.trunc(Number(f.page)) || 1);
    const bw = ctx.branchId && UUID.test(ctx.branchId) ? sql`and (h.branch_id = ${ctx.branchId} or h.branch_id is null)` : sql``;
    const total = N((await sql<any>`select count(*)::int as n from marketing_health_runs h where h.tenant_id = ${ctx.tenantId} and h.area = ${area} ${bw}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const page = Math.min(page0, totalPages);
    const rows = (await sql<any>`select h.id, h.overall, h.checks, h.created_at, coalesce(nullif(u.full_name, ''), u.email) as by_name from marketing_health_runs h
        left join users u on u.id = h.checked_by and u.tenant_id = h.tenant_id
        where h.tenant_id = ${ctx.tenantId} and h.area = ${area} ${bw} order by h.created_at desc, h.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { items: rows.map((r: any) => { const checks = Array.isArray(r.checks) ? r.checks : [];
      return { id: String(r.id), overall: String(r.overall), at: iso(r.created_at), by: r.by_name ?? null, attention: checks.filter((c: any) => c?.status !== 'ready').map((c: any) => String(c.key)), checks }; }),
      page, pageSize, totalItems: total, totalPages };
  }

  // ── §16 assistant (rules-v1): suggestions from this salon's own records; it never writes ─────────────────────────
  async suggest(ctx: DealContext, goal0: string): Promise<Suggestion> {
    const goal = (ASSIST_GOALS as readonly string[]).includes(goal0) ? (goal0 as AssistGoal) : null;
    if (!goal) throw withCode(new HttpException({ code: 'VALIDATION_FAILED', message: 'Choose one of the listed goals.' }, HttpStatus.BAD_REQUEST), 'VALIDATION_FAILED');
    const T = ctx.tenantId; const tz = await tenantTimeZone(this.db, T);
    const today = String((await sql<any>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as d`.execute(this.db)).rows[0].d);
    // starts at the salon's next local midnight, runs 30 salon days
    const w = (await sql<any>`select (((${today}::date + 1))::timestamp at time zone ${tz}) as s, (((${today}::date + 31))::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    const startsAt = new Date(w.s).toISOString(); const endsAt = new Date(w.e).toISOString();
    const visits = sql`t.tenant_id = ${T} and t.removed_at is null and t.status in ('closed', 'paid') and coalesce(t.paid_at, t.created_at) >= now() - interval '90 days'`;   // removed tickets never count (Nov 3 audit)
    const base: CouponTerms = { title: '', discountType: 'percent', discountPercent: 15, discountCents: null, serviceIds: [], daysOfWeek: null, startsAt, endsAt, maxRedemptions: null, maxPerCustomer: 1, minSpendCents: null, newCustomersOnly: false, rules: null };
    const uncertainty = 'Computed from the last 90 days of this salon\'s paid tickets. It does not predict how many customers will respond or whether visits are added rather than moved.';
    if (goal === 'slow_weekdays') {
      const rows = (await sql<any>`select extract(dow from coalesce(t.paid_at, t.created_at) at time zone ${tz})::int as dow, count(*)::int as n, coalesce(avg(t.subtotal_cents), 0)::bigint as avg
        from tickets t where t.tenant_id = ${T} and ${visits} group by 1`.execute(this.db)).rows;
      const by = new Map<number, { n: number; avg: number }>(rows.map((r: any) => [N(r.dow), { n: N(r.n), avg: N(r.avg) }]));
      const open = [0, 1, 2, 3, 4, 5, 6].filter((d) => (by.get(d)?.n ?? 0) > 0);   // a day with no sales in 90 days is treated as closed
      const slow = [...open].sort((a, b) => (by.get(a)!.n - by.get(b)!.n) || a - b).slice(0, 2).sort((a, b) => a - b);
      const n = slow.reduce((s, d) => s + (by.get(d)?.n ?? 0), 0); const avg = n ? Math.round(slow.reduce((s, d) => s + (by.get(d)!.avg * by.get(d)!.n), 0) / n) : 0;
      return { goal, method: ASSIST_METHOD, terms: { ...base, title: slow.length ? `${slow.map((d) => DAY_NAMES[d]).join(' & ')} 15% off` : 'Weekday 15% off', daysOfWeek: slow.length ? slow : null },
        basis: { windowDays: 90, ticketsByDay: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [DAY_NAMES[d], by.get(d)?.n ?? 0])), slowDays: slow.map((d) => DAY_NAMES[d]) },
        explanation: slow.length ? `${slow.map((d) => DAY_NAMES[d]).join(' and ')} had the fewest paid tickets in the last 90 days (${n}).` : 'There are no paid tickets in the last 90 days to find slow days from.',
        exposure: n ? { visitsInBasis: n, avgEligibleTicketCents: avg, maxDiscountIfRepeatedCents: Math.floor((avg * 15) / 100) * n, note: 'If the same visits happened again with the coupon on every one.' } : null,
        eligibleCustomers: null, uncertainty };
    }
    if (goal === 'promote_service') {
      const s = (await sql<any>`select s.id, s.name, s.price_cents, (select count(*) from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = s.tenant_id and l.service_id = s.id and l.removed_at is null and ${visits})::int as n
        from services s where s.tenant_id = ${T} and s.archived_at is null and coalesce(s.status, 'active') = 'active' and coalesce(s.price_cents, 0) > 0 order by n asc, s.price_cents desc, s.id limit 1`.execute(this.db)).rows[0];
      if (!s) return { goal, method: ASSIST_METHOD, terms: { ...base, title: 'Service 15% off' }, basis: { windowDays: 90, services: 0 }, explanation: 'There are no priced services to promote.', exposure: null, eligibleCustomers: null, uncertainty };
      return { goal, method: ASSIST_METHOD, terms: { ...base, title: `${String(s.name)} 15% off`.slice(0, 120), serviceIds: [String(s.id)] },
        basis: { windowDays: 90, serviceId: String(s.id), serviceName: String(s.name), soldInWindow: N(s.n), priceCents: N(s.price_cents) },
        explanation: `${String(s.name)} sold the fewest times in the last 90 days (${N(s.n)}) among priced services.`,
        exposure: { visitsInBasis: N(s.n), avgEligibleTicketCents: N(s.price_cents), maxDiscountIfRepeatedCents: Math.floor((N(s.price_cents) * 15) / 100) * N(s.n), note: 'If the same number of these services sold again, each with the coupon.' },
        eligibleCustomers: null, uncertainty };
    }
    // returning_visits (one visit so far) / reconnect_inactive (≥1 visit, away past the salon's At Risk threshold)
    const risk = goal === 'reconnect_inactive' ? N((await sql<any>`select risk_days from tenant_retention_settings where tenant_id = ${T}`.execute(this.db)).rows[0]?.risk_days) || 60 : 0;
    const cnt = goal === 'returning_visits'
      ? (await sql<any>`select count(*)::int as n from (select t.customer_id from tickets t where t.tenant_id = ${T} and t.removed_at is null and t.status in ('closed', 'paid') and t.customer_id is not null group by t.customer_id having count(*) = 1) x`.execute(this.db)).rows[0]
      : (await sql<any>`select count(*)::int as n from (select t.customer_id from tickets t where t.tenant_id = ${T} and t.removed_at is null and t.status in ('closed', 'paid') and t.customer_id is not null group by t.customer_id
          having max(coalesce(t.paid_at, t.created_at)) < now() - make_interval(days => ${risk})) x`.execute(this.db)).rows[0];
    const rules = goal === 'returning_visits' ? { all: [{ type: 'min_visits', count: 1 }, { type: 'max_visits', count: 1 }] } : { all: [{ type: 'lapsed', days: risk }, { type: 'min_visits', count: 1 }] };
    return { goal, method: ASSIST_METHOD, terms: { ...base, discountPercent: goal === 'returning_visits' ? 10 : 15, title: goal === 'returning_visits' ? 'Second visit 10% off' : 'Welcome back 15% off', rules },
      basis: goal === 'returning_visits' ? { customersWithOneVisit: N(cnt?.n) } : { atRiskDays: risk, customersAwayPastThreshold: N(cnt?.n) },
      explanation: goal === 'returning_visits' ? `${N(cnt?.n)} customer(s) have exactly one completed visit; the coupon only works on their second.`
        : `${N(cnt?.n)} customer(s) with at least one completed visit have been away ${risk}+ days (your At Risk setting). Never-visited customers are not included.`,
      exposure: null, eligibleCustomers: N(cnt?.n), uncertainty: uncertainty + ' Sending it to anyone is a separate Campaign Center step with consent checks and its own approval.' };
  }

  /** §16: save the (owner-edited) suggestion as a DRAFT coupon. The suggestion is recomputed here — the client cannot claim
   *  what was "suggested". Status stays draft: Publish is the separate, permission-checked activation. */
  async draft(ctx: DealContext, b: Record<string, any>) {
    const sug = await this.suggest(ctx, String(b.goal ?? ''));
    const pick = <T>(k: string, f: (v: any) => T, dflt: T): T => (b[k] === undefined ? dflt : f(b[k]));
    const final: CouponTerms = {
      title: pick('title', (v) => String(v ?? '').trim().slice(0, 120), sug.terms.title) || sug.terms.title,
      discountType: pick('discountType', (v) => (v === 'fixed' ? 'fixed' : 'percent'), sug.terms.discountType),
      discountPercent: pick('discountPercent', (v) => (v == null || v === '' ? null : Number(v)), sug.terms.discountPercent),
      discountCents: pick('discountCents', (v) => (v == null || v === '' ? null : Math.trunc(Number(v))), sug.terms.discountCents),
      serviceIds: pick('serviceIds', (v) => (Array.isArray(v) ? v.map(String) : []), sug.terms.serviceIds),
      daysOfWeek: pick('daysOfWeek', (v) => (Array.isArray(v) && v.length ? v.map(Number) : null), sug.terms.daysOfWeek),
      startsAt: pick('startsAt', (v) => (v ? String(v) : null), sug.terms.startsAt), endsAt: pick('endsAt', (v) => (v ? String(v) : null), sug.terms.endsAt),
      maxRedemptions: pick('maxRedemptions', (v) => (v == null || v === '' ? null : Math.trunc(Number(v))), sug.terms.maxRedemptions),
      maxPerCustomer: pick('maxPerCustomer', (v) => (v == null || v === '' ? null : Math.trunc(Number(v))), sug.terms.maxPerCustomer),
      minSpendCents: pick('minSpendCents', (v) => (v == null || v === '' ? null : Math.trunc(Number(v))), sug.terms.minSpendCents),
      newCustomersOnly: pick('newCustomersOnly', (v) => !!v, sug.terms.newCustomersOnly), rules: sug.terms.rules,
    };
    if (final.discountType === 'percent') final.discountCents = null; else final.discountPercent = null;
    const edited = (Object.keys(final) as (keyof CouponTerms)[]).filter((k) => JSON.stringify(final[k]) !== JSON.stringify(sug.terms[k]));
    // Deals & Offers guide §15: from the Deals screen the draft is a salon DEAL (no code); from Coupons it stays a coupon
    const kind = this.scope === 'all' && b.kind !== 'coupon' ? 'deal' : 'coupon';
    const code = kind !== 'coupon' || b.code == null || String(b.code).trim() === '' ? null : String(b.code).trim();
    const view = await this.deals.createDeal(ctx, { ownerType: 'salon', kind, branchId: null, title: final.title, discountType: final.discountType, discountPercent: final.discountPercent,
      discountCents: final.discountCents, serviceIds: final.serviceIds, daysOfWeek: final.daysOfWeek, startsAt: final.startsAt, endsAt: final.endsAt, maxRedemptions: final.maxRedemptions,
      maxPerCustomer: final.maxPerCustomer, minSpendCents: final.minSpendCents, newCustomersOnly: final.newCustomersOnly, rules: final.rules, stackable: false, code,
      terms: `Created as a draft from the ${kind === 'coupon' ? 'coupon' : 'deals'} assistant (${sug.method}, goal: ${sug.goal}).` });
    // the draft and its provenance row belong together: DealsService.createDeal commits on its own (no transaction hook), so
    // when the provenance row cannot be written the just-created DRAFT is taken back (it is not live, has no redemptions and
    // nobody has seen it) — never a coupon without the record of where it came from (audit B2, Nov 3)
    try {
      await sql`insert into coupon_assistant_drafts (tenant_id, deal_id, goal, method, basis_json, suggested_json, final_json, edited_fields, created_by_user_id)
        values (${ctx.tenantId}, ${view.id}, ${sug.goal}, ${sug.method}, ${JSON.stringify(sug.basis)}::jsonb, ${JSON.stringify(sug.terms)}::jsonb, ${JSON.stringify(final)}::jsonb, ${edited}::text[], ${ctx.userId})`.execute(this.db);
    } catch (e) {
      await this.db.transaction().execute(async (trx) => {
        const still = (await sql<any>`select id from deals where tenant_id = ${ctx.tenantId} and id = ${view.id} and status = 'draft' and redemption_count = 0 for update`.execute(trx)).rows[0];
        if (!still) return;
        await sql`delete from deal_coupon_codes where tenant_id = ${ctx.tenantId} and deal_id = ${view.id}`.execute(trx);
        await sql`delete from deal_services where tenant_id = ${ctx.tenantId} and deal_id = ${view.id}`.execute(trx);
        await sql`delete from deal_coupon_batches where tenant_id = ${ctx.tenantId} and deal_id = ${view.id}`.execute(trx);
        await sql`delete from deal_versions where tenant_id = ${ctx.tenantId} and deal_id = ${view.id}`.execute(trx);
        await sql`delete from deals where tenant_id = ${ctx.tenantId} and id = ${view.id} and status = 'draft'`.execute(trx);
      }).catch((undo: unknown) => { console.error(`assistant draft ${view.id} could not be taken back: ${(undo as Error)?.message ?? undo}`); });
      throw e;
    }
    return { deal: view, status: view.status, editedFields: edited, suggestion: sug, note: 'Saved as a draft. Nothing is live and nothing was sent; an owner or manager activates it with Publish.' };
  }
}

export const COUPON_CENTER = 'COUPON_CENTER';
function ctxOf(req: any): DealContext {
  const c = req?.ctx || {};
  return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [], technicianId: c.technicianId ?? null };
}
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof DealRefusedError) throw withCode(new HttpException({ code: e.code, message: e.message, reasons: e.reasons }, e.status), e.code as ApiErrorCode);
    if (e instanceof DealForbiddenError) throw new HttpException(e.message, HttpStatus.FORBIDDEN);
    if (e instanceof DealValidationError) throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
    if (e instanceof DealConflictError) throw new HttpException(e.message, HttpStatus.CONFLICT);
    throw e;
  }
}

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/coupons')
export class CouponCenterController {
  constructor(@Optional() @Inject(COUPON_CENTER) private readonly center: CouponCenter | null) {}
  private c(): CouponCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'DEALS_NOT_AVAILABLE', message: 'Deals and coupons are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'DEALS_NOT_AVAILABLE');
    return this.center;
  }
  @Get('health') @RequirePermission('pos.marketing.view')
  health(@Req() r: any) { return this.c().health(ctxOf(r)); }
  /** a recorded run (read-only checks) and the run history */
  @Post('health/run') @RequirePermission('pos.marketing.view')
  runHealth(@Req() r: any) { return run(() => this.c().runHealth(ctxOf(r))); }
  @Get('health/runs') @RequirePermission('pos.marketing.view') @ListQuery({ maxLimit: 50, defaultLimit: 10, params: ['page'] })
  healthRuns(@Req() r: any, @Query() q: any) { return run(() => this.c().healthRuns(ctxOf(r), { page: q?.page, pageSize: q?.pageSize })); }

  @Post('assistant/suggest') @RequirePermission('pos.marketing.manage')
  suggest(@Req() r: any, @Body(ValidatedBody(COUPON_ASSIST_BODY, { strict: true })) b: any) { return run(() => this.c().suggest(ctxOf(r), String(b?.goal ?? ''))); }

  @Post('assistant/draft') @RequirePermission('pos.marketing.manage')
  draft(@Req() r: any, @Body(ValidatedBody(COUPON_ASSIST_DRAFT_BODY, { strict: true })) b: any) { return run(() => this.c().draft(ctxOf(r), b || {})); }

  @Post(':dealId/check') @RequirePermission('pos.marketing.view')
  check(@Req() r: any, @Param('dealId') id: string, @Body(ValidatedBody(COUPON_CHECK_BODY, { strict: true })) b: any) { return run(() => this.c().check(ctxOf(r), id, b || {})); }

  @Get(':dealId/campaigns') @RequirePermission('pos.marketing.view')
  campaigns(@Req() r: any, @Param('dealId') id: string) { return run(() => this.c().campaigns(ctxOf(r), id)); }
}
