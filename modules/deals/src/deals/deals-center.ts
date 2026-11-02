// deals-center.ts — Marketing → Deals & Offers (/tenant/marketing/deals), the Deals & Offers guide of 30 Oct 2026. The
// MANAGEMENT layer over the ONE deals engine (the `deals` table for deals, coupons, automatic promotions and announcements;
// deal_redemptions is the ledger; DealsService owns create / edit / lifecycle / approvals). Nothing here prices, redeems or
// sends; it reuses, with scope 'all' (every kind, salon and technician):
//   GET  pos/deals-offers/kpis            §4-B  Total · Active · Pending approval · Redemptions · Expiring soon · Discount value used
//   GET  pos/deals-offers/library         §5–§7 one search box, status / kind / owner / technician / branch / service / type,
//                                               an explicit date basis (created, updated, starts, ends, approved, redeemed, active)
//                                               on salon-local days, numbered pages 10/20/50, newest created first
//   GET  pos/deals-offers/approvals       §9    the approval inbox — oldest waiting first by default (NOT the library's order),
//                                               each request compared with the salon's CURRENT technician-deal rules
//   GET  pos/deals-offers/redemptions     §14   Redemption History (customer / phone / email / ID / deal / ticket / technician)
//   GET  pos/deals-offers/:id             §10   details: overview, eligibility, limits, redemptions, performance, approvals & audit
//   POST pos/deals-offers/:id/check       §11   Smart Deal Eligibility Checker — Checkout's own engine, read-only
//   GET  pos/deals-offers/health          §17   Check Deal System — verified checks only, never green by default
//   POST pos/deals-offers/assistant/*     §15   suggestion from this salon's data → a DRAFT deal (never live, never sent)
// Tenant pinned in every statement; a branch user sees salon-wide deals and their branch's. Money is integer cents.
import { sql, type Kysely } from 'kysely';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { withCode, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { COUPON_ASSIST_BODY, COUPON_ASSIST_DRAFT_BODY, COUPON_CHECK_BODY } from '../request-schemas';
import { DealsService, DealConflictError, DealForbiddenError, DealValidationError } from './deals.service';
import { DealRefusedError } from '../engine/deals-checkout.service';
import { validateTechDealAgainstSettings, savingsCents } from './deals.core';
import type { DealContext } from './deals.dto';
import type { DiscountType } from './deals.core';
import type { DiscountsScreenRepository } from '../salon-promotions/discounts-screen';
import { DEAL_DATE_FIELDS, DEAL_KINDS_ALL, LIFECYCLES, REDEMPTION_STATES } from '../salon-promotions/discounts-screen';
import type { CouponCenter } from '../salon-promotions/coupon-center';

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
export const APPROVAL_ORDERS = ['oldest', 'start', 'newest'] as const;

export class DealsCenter {
  constructor(private readonly db: Kysely<any>, private readonly screen: DiscountsScreenRepository, private readonly center: CouponCenter, private readonly deals: DealsService) {}
  private branch(ctx: DealContext) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(d.branch_id = ${ctx.branchId} or d.branch_id is null)` : sql`true`; }
  private sctx(ctx: DealContext) { return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }; }

  /** §4-B: the six cards, each from source records (Pending approval = live workflow rows, not historical decisions). */
  async kpis(ctx: DealContext) {
    const k = await this.screen.kpis(this.sctx(ctx));
    const p = (await sql<any>`select count(*)::int as n, count(*) filter (where d.owner_type = 'technician')::int as tech from deals d
      where d.tenant_id = ${ctx.tenantId} and ${this.branch(ctx)} and d.status = 'pending_approval'`.execute(this.db)).rows[0];
    const s = await this.deals.getSettings(ctx);
    return { ...k, pendingApproval: N(p?.n), pendingTechnician: N(p?.tech),
      techPolicy: { allowTechnicianDeals: s.allowTechnicianDeals, maxDiscountPercent: s.maxDiscountPercent ?? null, maxFixedDiscountCents: s.maxFixedDiscountCents ?? null,
        approvalRequired: s.allowTechnicianDeals === 'on_with_approval' } };
  }

  library(ctx: DealContext, f: Record<string, any>) { return this.screen.list(this.sctx(ctx), f); }
  redemptions(ctx: DealContext, f: Record<string, any>) { return this.screen.redemptions(this.sctx(ctx), f); }

  /** §9 approval inbox: pending requests, each with the policy comparison a manager decides on. Oldest waiting first by
   *  default (fairness); "start" = the soonest planned start first; "newest" only when asked. */
  async approvals(ctx: DealContext, f: { q?: string; order?: string; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId;
    const page = Math.max(1, Math.trunc(Number(f.page)) || 1); const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10));
    const order = (APPROVAL_ORDERS as readonly string[]).includes(String(f.order)) ? String(f.order) : 'oldest';
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw);
    // "requested" = when it entered pending_approval: its newest version row (submit bumps the version), else its last update
    const reqAt = sql`coalesce((select max(v.created_at) from deal_versions v where v.tenant_id = d.tenant_id and v.deal_id = d.id), d.updated_at)`;
    const techName = sql`(select coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) from technicians te where te.id = d.technician_id and te.tenant_id = d.tenant_id)`;
    const w = sql`d.tenant_id = ${T} and ${this.branch(ctx)} and d.status = 'pending_approval'
      and (${raw} = '' or d.title ilike ${l} or coalesce(${techName}, '') ilike ${l} or d.id::text = ${raw.toLowerCase()} or coalesce(d.technician_id::text, '') = ${raw.toLowerCase()})`;
    const total = N((await sql<any>`select count(*)::int as n from deals d where d.tenant_id = ${T} and ${w}`.execute(this.db)).rows[0]?.n);
    const totalPages = Math.max(1, Math.ceil(total / pageSize)); const pg = Math.min(page, totalPages);
    const ord = order === 'start' ? sql`d.starts_at asc nulls last, req_at asc, d.id asc` : order === 'newest' ? sql`req_at desc, d.id desc` : sql`req_at asc, d.id asc`;
    const rows = (await sql<any>`select d.id, d.title, d.kind, d.owner_type, d.technician_id, d.branch_id, d.discount_type, d.discount_percent, d.discount_cents, d.original_price_cents, d.final_price_cents,
        d.starts_at, d.ends_at, d.new_customers_only, d.member_only, d.max_redemptions, d.max_per_customer, d.min_spend_cents, d.version, d.created_at, d.created_by_user_id,
        ${reqAt} as req_at, ${techName} as technician_name, (select b.name from branches b where b.id = d.branch_id and b.tenant_id = d.tenant_id) as branch_name,
        (select coalesce(nullif(u.full_name, ''), u.email) from users u where u.id = d.created_by_user_id) as created_by,
        (select array_agg(s.name order by s.name) from deal_services ds join services s on s.id = ds.service_id and s.tenant_id = ds.tenant_id where ds.tenant_id = d.tenant_id and ds.deal_id = d.id) as services
      from deals d where d.tenant_id = ${T} and ${w} order by ${ord} limit ${pageSize} offset ${(pg - 1) * pageSize}`.execute(this.db)).rows;
    const s = await this.deals.getSettings(ctx);
    const items = rows.map((r: any) => {
      const dt = String(r.discount_type) as DiscountType;
      const tech = String(r.owner_type) === 'technician';
      const violations = tech ? validateTechDealAgainstSettings({ discountType: dt, discountPercent: r.discount_percent == null ? null : N(r.discount_percent), discountCents: r.discount_cents == null ? null : N(r.discount_cents),
        originalPriceCents: r.original_price_cents == null ? null : N(r.original_price_cents), startsAt: iso(r.starts_at), endsAt: iso(r.ends_at),
        maxRedemptions: r.max_redemptions == null ? null : N(r.max_redemptions), newCustomersOnly: !!r.new_customers_only, activeDealCountForTech: 0 }, s) : [];
      const perUse = r.original_price_cents == null ? null : savingsCents(N(r.original_price_cents), dt, r.discount_percent == null ? null : N(r.discount_percent), r.discount_cents == null ? null : N(r.discount_cents));
      return {
        id: String(r.id), title: String(r.title), kind: String(r.kind ?? 'deal'), ownerType: String(r.owner_type), technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.technician_name ?? null,
        branchName: r.branch_name ?? null, salonWide: !r.branch_id, requestedAt: iso(r.req_at), createdAt: iso(r.created_at), createdBy: r.created_by ?? null,
        services: Array.isArray(r.services) ? r.services.map(String) : [], discountType: dt, discountPercent: r.discount_percent == null ? null : N(r.discount_percent), discountCents: r.discount_cents == null ? null : N(r.discount_cents),
        originalPriceCents: r.original_price_cents == null ? null : N(r.original_price_cents), finalPriceCents: r.final_price_cents == null ? null : N(r.final_price_cents),
        startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), newCustomersOnly: !!r.new_customers_only, memberOnly: !!r.member_only, minSpendCents: r.min_spend_cents == null ? null : N(r.min_spend_cents),
        maxRedemptions: r.max_redemptions == null ? null : N(r.max_redemptions), maxPerCustomer: r.max_per_customer == null ? null : N(r.max_per_customer), version: N(r.version),
        // the decision basis: today's rules (a salon deal is never judged by the technician cap) and the most it could cost
        policy: tech ? { maxDiscountPercent: s.maxDiscountPercent ?? null, maxFixedDiscountCents: s.maxFixedDiscountCents ?? null, allowTechnicianDeals: s.allowTechnicianDeals, withinPolicy: violations.length === 0, violations } : null,
        exposure: perUse == null ? null : { perUseCents: perUse, maxUses: r.max_redemptions == null ? null : N(r.max_redemptions), maxTotalCents: r.max_redemptions == null ? null : perUse * N(r.max_redemptions),
          note: 'The discount on the deal\'s listed service price; the most it could cost only when a usage limit is set.' },
        ownProposal: tech && !!r.created_by_user_id && String(r.created_by_user_id) === ctx.userId,
      };
    });
    return { order, items, page: pg, pageSize, totalItems: total, totalPages };
  }

  /** §10 one detail record: the screen's overview / eligibility / limits / services / usage / version history, plus who owns
   *  it, the approval decisions (immutable deal_approvals), the technician policy comparison and performance. */
  async detail(ctx: DealContext, id: string) {
    const base: any = await this.screen.detail(this.sctx(ctx), id);   // 404 PROMOTION_NOT_FOUND outside the salon / branch scope
    const T = ctx.tenantId;
    const d = (await sql<any>`select d.owner_type, d.technician_id, d.kind, d.status, d.version, d.approved_by_user_id, d.discount_type, d.discount_percent, d.discount_cents, d.original_price_cents, d.final_price_cents,
        d.starts_at, d.ends_at, d.max_redemptions, d.new_customers_only,
        (select coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) from technicians te where te.id = d.technician_id and te.tenant_id = d.tenant_id) as technician_name,
        (select coalesce(nullif(u.full_name, ''), u.email) from users u where u.id = d.approved_by_user_id) as approved_by
      from deals d where d.tenant_id = ${T} and d.id = ${id}`.execute(this.db)).rows[0];
    const approvals = (await sql<any>`select a.id, a.decision, a.reason, a.deal_version, a.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor
      from deal_approvals a left join users u on u.id = a.approver_user_id where a.tenant_id = ${T} and a.deal_id = ${id} order by a.created_at desc, a.id desc limit 50`.execute(this.db)).rows;
    const perf = (await sql<any>`select count(*) filter (where r.status in ('redeemed', 'partially_reversed'))::int as n,
        coalesce(sum(r.amount_discounted_cents) filter (where r.status in ('redeemed', 'partially_reversed', 'reversed')), 0)::bigint as gross,
        coalesce(sum(coalesce(r.reversed_cents, 0)) filter (where r.status in ('redeemed', 'partially_reversed', 'reversed')), 0)::bigint as reversed,
        coalesce(sum(t.total_cents) filter (where r.status in ('redeemed', 'partially_reversed')), 0)::bigint as sales
      from deal_redemptions r left join tickets t on t.id = r.ticket_id and t.tenant_id = r.tenant_id where r.tenant_id = ${T} and r.deal_id = ${id}`.execute(this.db)).rows[0];
    let policy: any = null;
    if (String(d?.owner_type) === 'technician') {
      const s = await this.deals.getSettings(ctx);
      const v = validateTechDealAgainstSettings({ discountType: d.discount_type, discountPercent: d.discount_percent == null ? null : N(d.discount_percent), discountCents: d.discount_cents == null ? null : N(d.discount_cents),
        originalPriceCents: d.original_price_cents == null ? null : N(d.original_price_cents), startsAt: iso(d.starts_at), endsAt: iso(d.ends_at), maxRedemptions: d.max_redemptions == null ? null : N(d.max_redemptions),
        newCustomersOnly: !!d.new_customers_only, activeDealCountForTech: 0 }, s);
      policy = { allowTechnicianDeals: s.allowTechnicianDeals, maxDiscountPercent: s.maxDiscountPercent ?? null, maxFixedDiscountCents: s.maxFixedDiscountCents ?? null, withinPolicy: v.length === 0, violations: v };
    }
    return { ...base, owner: { ownerType: String(d?.owner_type ?? 'salon'), technicianId: d?.technician_id ? String(d.technician_id) : null, technicianName: d?.technician_name ?? null, approvedBy: d?.approved_by ?? null, version: N(d?.version) },
      dealStatus: String(d?.status ?? base.dealStatus), policy,
      approvals: approvals.map((a: any) => ({ id: String(a.id), decision: String(a.decision), reason: a.reason ?? null, version: N(a.deal_version), at: iso(a.created_at), actor: a.actor ?? null })),
      performance: { completed: N(perf?.n), grossDiscountCents: N(perf?.gross), reversedCents: N(perf?.reversed), netDiscountCents: N(perf?.gross) - N(perf?.reversed), linkedServiceRevenueCents: N(perf?.sales),
        note: 'Sales on paid tickets that carried the deal — linked, not proven extra business.' } };
  }

  check(ctx: DealContext, id: string, b: Record<string, any>) { return this.center.check(ctx, id, b); }
  health(ctx: DealContext) { return this.center.health(ctx); }
  suggest(ctx: DealContext, goal: string) { return this.center.suggest(ctx, goal); }
  draft(ctx: DealContext, b: Record<string, any>) { return this.center.draft(ctx, { ...b, kind: 'deal' }); }
}

// ── controller ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const DEALS_CENTER = 'DEALS_CENTER';
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
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const per = (q: any) => ({ preset: s(q?.preset), from: s(q?.from), to: s(q?.to) });
const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const LIB_SPEC = { filters: { preset: PRESET, status: { type: 'enum', values: ['live', 'all', 'pending', ...LIFECYCLES] }, type: { type: 'enum', values: ['percent', 'fixed', 'all'] },
  dateField: { type: 'enum', values: DEAL_DATE_FIELDS }, serviceId: { type: 'uuid' }, ownerType: { type: 'enum', values: ['salon', 'technician', 'all'] }, kind: { type: 'enum', values: ['all', ...DEAL_KINDS_ALL] },
  technicianId: { type: 'uuid' }, branchId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const RED_SPEC = { filters: { preset: PRESET, state: { type: 'enum', values: REDEMPTION_STATES }, dealId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const APR_SPEC = { filters: { order: { type: 'enum', values: APPROVAL_ORDERS } }, search: { maxLength: 100 }, maxLimit: 50, defaultLimit: 10, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/deals-offers')
export class DealsCenterController {
  constructor(@Optional() @Inject(DEALS_CENTER) private readonly center: DealsCenter | null) {}
  private c(): DealsCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'DEALS_NOT_AVAILABLE', message: 'Deals and coupons are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'DEALS_NOT_AVAILABLE');
    return this.center;
  }
  @Get('kpis') @RequirePermission('pos.marketing.view')
  kpis(@Req() r: any) { return run(() => this.c().kpis(ctxOf(r))); }

  @Get('library') @RequirePermission('pos.marketing.view') @ListQuery(LIB_SPEC)
  library(@Req() r: any, @Query() q: any) {
    return run(() => this.c().library(ctxOf(r), { q: s(q?.q), status: s(q?.status), type: s(q?.type), dateField: s(q?.dateField), serviceId: s(q?.serviceId), ownerType: s(q?.ownerType), kind: s(q?.kind),
      technicianId: s(q?.technicianId), branchId: s(q?.branchId), ...per(q), page: q?.page, pageSize: q?.pageSize }));
  }

  @Get('approvals') @RequirePermission('pos.marketing.view') @ListQuery(APR_SPEC)
  approvals(@Req() r: any, @Query() q: any) { return run(() => this.c().approvals(ctxOf(r), { q: s(q?.q), order: s(q?.order), page: q?.page, pageSize: q?.pageSize })); }

  @Get('redemptions') @RequirePermission('pos.marketing.view') @ListQuery(RED_SPEC)
  redemptions(@Req() r: any, @Query() q: any) { return run(() => this.c().redemptions(ctxOf(r), { q: s(q?.q), state: s(q?.state), dealId: s(q?.dealId), ...per(q), page: q?.page, pageSize: q?.pageSize })); }

  @Get('health') @RequirePermission('pos.marketing.view')
  health(@Req() r: any) { return run(() => this.c().health(ctxOf(r))); }

  @Post('assistant/suggest') @RequirePermission('pos.marketing.manage')
  suggest(@Req() r: any, @Body(ValidatedBody(COUPON_ASSIST_BODY, { strict: true })) b: any) { return run(() => this.c().suggest(ctxOf(r), String(b?.goal ?? ''))); }

  @Post('assistant/draft') @RequirePermission('pos.marketing.manage')
  draft(@Req() r: any, @Body(ValidatedBody(COUPON_ASSIST_DRAFT_BODY, { strict: true })) b: any) { return run(() => this.c().draft(ctxOf(r), b || {})); }

  @Post(':id/check') @RequirePermission('pos.marketing.view')
  check(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(COUPON_CHECK_BODY, { strict: true })) b: any) { return run(() => this.c().check(ctxOf(r), id, b || {})); }

  @Get(':id') @RequirePermission('pos.marketing.view')
  detail(@Req() r: any, @Param('id') id: string) { return run(() => this.c().detail(ctxOf(r), id)); }
}
