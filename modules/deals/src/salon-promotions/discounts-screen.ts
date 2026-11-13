// discounts-screen.ts — Services → Discounts rebuild (Oct 29 2026, "Discounts Management — complete build guide"): the
// front-desk VISIBILITY, lookup and performance layer over the ONE coupon engine (deals of kind 'coupon' + deal_coupon_codes +
// the deal_redemptions ledger). Marketing → Promotions stays the rule editor; nothing here creates, edits or redeems a coupon.
//   GET pos/discounts/kpis                 the five cards (+ the scheduled / paused / expired / exhausted split behind them)
//   GET pos/discounts                      Live & Scheduled Discounts: search · lifecycle · type · date field + period · newest first
//   GET pos/discounts/redemptions          confirmed Redemption History (the ledger; pending / released / reversed on request)
//   GET pos/discounts/performance          per coupon over a redemption-date period
//   GET pos/discounts/export(/redemptions) CSV of every matching row (codes masked, phones masked)
//   GET pos/discounts/:dealId              details: overview, eligibility, validity & limits, applicable services, usage, audit
// Codes are stored hashed; only the last four characters (code_hint) exist to show. An exact code typed in the search is
// hashed with the tenant (engine/coupons) and matched — the code itself is never returned. Tenant pinned in every statement;
// a branch user sees salon-wide coupons and their branch's. Money is integer cents; days are the salon's (tenantTimeZone).
import { readEstimateSnapshot, comparePreviewToPaid } from '../engine/preview-vs-paid';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { Controller, Get, Header, HttpException, HttpStatus, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { withCode } from '@aipowersalon/api-contracts';
import { tenantTimeZone, ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, AsyncExport } from '@aipowersalon/permissions/guards';
import { hashCode, normalizeCode } from '../engine/coupons';
import { ruleDiscount } from '../engine/pricing';
import { refundOutcome } from '../engine/refund-outcome';
import type { DiscountRefundImpact } from '@aipowersalon/api-contracts/tenant';

export interface DiscountsCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }
export interface DPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const maskPhone = (p: string | null | undefined) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
function paging(page: unknown, pageSize: unknown, def = 10) { return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: Math.max(1, Math.min(100, Math.trunc(Number(pageSize)) || def)) }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }
const csvCell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const dollars = (c: number) => (c / 100).toFixed(2);

/** The lifecycle a coupon is in RIGHT NOW (Promotions' deal status + its dates + its cap). */
export const LIFECYCLES = ['active', 'scheduled', 'paused', 'draft', 'expired', 'exhausted', 'archived'] as const;
/** The Live & Scheduled list (the screenshot's table): usable now, starting later, paused or not yet published. */
export const LIVE = ['active', 'scheduled', 'paused', 'draft'];
export const DISCOUNT_DATE_FIELDS = ['created', 'starts', 'ends', 'updated', 'active'] as const;
/** Deals & Offers guide §6: the explicit date bases (they are not interchangeable). */
export const DEAL_DATE_FIELDS = ['created', 'updated', 'starts', 'ends', 'approved', 'redeemed', 'active'] as const;
export const REDEMPTION_STATES = ['confirmed', 'pending', 'released', 'reversed', 'all'] as const;
/** Expiring Soon's window (the same 7 days the Promotions summary always used). */
export const EXPIRING_DAYS = 7;
const SAMPLE_CENTS = 10000;

const LIFE = sql`(case when d.suspended_at is not null then 'paused'
  when d.status in ('archived', 'rejected', 'canceled') then 'archived'
  when d.status = 'sold_out' or (d.max_redemptions is not null and d.redemption_count >= d.max_redemptions) then 'exhausted'
  when d.status = 'expired' or (d.ends_at is not null and d.ends_at <= now()) then 'expired'
  when d.status = 'paused' then 'paused'
  when d.status in ('draft', 'pending_approval', 'approved') then 'draft'
  when d.status = 'scheduled' or (d.starts_at is not null and d.starts_at > now()) then 'scheduled'
  when d.status = 'active' then 'active' else 'archived' end)`;
/** Confirmed = the ticket was paid (redeemed), kept when only part of it was refunded (partially_reversed). */
/** The coupon columns the screen reads (never a whole row). */
const DCOLS = sql`d.id, d.tenant_id, d.branch_id, d.title, d.short_description, d.terms, d.discount_type, d.discount_percent, d.discount_cents, d.min_spend_cents, d.starts_at, d.ends_at, d.days_of_week, d.valid_from_minute, d.valid_to_minute, d.new_customers_only, d.member_only, d.max_redemptions, d.max_per_customer, d.stackable, d.status, d.created_by_user_id, d.redemption_count, d.created_at, d.updated_at, d.kind, d.rules, d.priority, d.stack_group, d.max_discount_cents, d.budget_cents, d.channels, d.requires_code, d.suspended_reason, d.suspended_at, d.published_at, d.expired_at, d.owner_type, d.technician_id, d.original_price_cents, d.final_price_cents, d.approved_by_user_id`;
const CONFIRMED = sql`r.status in ('redeemed', 'partially_reversed')`;

/** Which records a screen reads: 'coupon' (Services → Discounts, Marketing → Coupons) or 'all' (Marketing → Deals & Offers:
 *  deals, coupons, automatic promotions and announcements — salon and technician). The SAME queries either way. */
export type DiscountsScope = 'coupon' | 'all';
export const DEAL_KINDS_ALL = ['deal', 'coupon', 'automatic', 'announcement'] as const;

export class DiscountsScreenRepository {
  constructor(private readonly db: Kysely<any>, private readonly scope: DiscountsScope = 'coupon') {}
  private kindW() { return this.scope === 'coupon' ? sql`d.kind = 'coupon'` : sql`true`; }
  private branch(ctx: DiscountsCtx) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(d.branch_id = ${ctx.branchId} or d.branch_id is null)` : sql`true`; }

  async period(ctx: DiscountsCtx, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'all'): Promise<DPeriod> {
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
  /** `col` within the period: salon-local days, the end day included, each bound converted on its own date (DST-safe). */
  private inP(col: RawBuilder<unknown>, p: DPeriod): RawBuilder<unknown> {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }
  private digits(raw: string) { let d = raw.replace(/\D/g, ''); if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return { d, phoneish: d.length >= 4 && !/[a-z]/i.test(raw) }; }

  /** The five cards. Current-state (a period never changes them) except Redemptions, which is all-time and confirmed only —
   *  counted from the redemption ledger (D7, Nov 3 2026: it read the deals' use counters, which disagreed with the ledger
   *  shown under it; the counters stay what caps a coupon). */
  async kpis(ctx: DiscountsCtx, opts: { expiringDays?: unknown } = {}) {
    const T = ctx.tenantId;
    // Coupons guide (Nov 4 2026): the "expiring soon" window is the viewer's choice (1–90 days, default 7)
    const ed = Math.trunc(Number(opts.expiringDays)); const EXP = Number.isFinite(ed) && ed >= 1 && ed <= 90 ? ed : EXPIRING_DAYS;
    const k = (await sql<any>`select count(*) filter (where life = 'active')::int as active, count(*) filter (where life = 'scheduled')::int as scheduled,
        count(*) filter (where life = 'paused')::int as paused, count(*) filter (where life = 'draft')::int as draft, count(*) filter (where life = 'expired')::int as expired,
        count(*) filter (where life = 'exhausted')::int as exhausted, count(*) filter (where life = 'archived')::int as archived, count(*)::int as total,
        count(*) filter (where life in ('active', 'scheduled', 'paused', 'draft') and discount_type = 'percent')::int as percent,
        count(*) filter (where life in ('active', 'scheduled', 'paused', 'draft') and discount_type <> 'percent')::int as fixed,
        count(*) filter (where life in ('active', 'scheduled') and ends_at is not null and ends_at > now() and ends_at <= now() + make_interval(days => ${EXP}))::int as expiring,
        coalesce(sum(redemption_count), 0)::int as used
      from (select ${DCOLS}, ${LIFE} as life from deals d where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)}) d`.execute(this.db)).rows[0];
    const r = (await sql<any>`select count(*) filter (where ${CONFIRMED} or r.status = 'applied')::int as events, count(distinct r.customer_id) filter (where ${CONFIRMED})::int as customers, coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)) filter (where ${CONFIRMED}), 0)::bigint as saved,
        count(*) filter (where r.status = 'applied')::int as pending,
        coalesce(sum(r.amount_discounted_cents) filter (where ${CONFIRMED} or r.status = 'reversed'), 0)::bigint as gross, coalesce(sum(coalesce(r.reversed_cents, 0)) filter (where ${CONFIRMED} or r.status = 'reversed'), 0)::bigint as reversed
      from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id
      where r.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and (${CONFIRMED} or r.status in ('applied', 'reversed'))`.execute(this.db)).rows[0];
    const today = (await this.period(ctx, {})).today;
    return { today, activeDiscounts: N(k?.active), percentOff: N(k?.percent), fixedAmount: N(k?.fixed), redemptions: N(r?.events) - N(r?.pending), expiringSoon: N(k?.expiring), expiringWindowDays: EXP,
      split: { scheduled: N(k?.scheduled), paused: N(k?.paused), draft: N(k?.draft), expired: N(k?.expired), exhausted: N(k?.exhausted), archived: N(k?.archived) },
      // Coupons & Promotions guide §06: Total = every coupon record in scope (archived included, shown separately);
      // discount value = completed redemptions, gross and reversed shown apart, net = gross − reversed
      total: N(k?.total),
      ledger: { confirmedEvents: N(r?.events) - N(r?.pending), uniqueCustomers: N(r?.customers), savingsCents: N(r?.saved), pendingAtCheckout: N(r?.pending), grossDiscountCents: N(r?.gross), reversedCents: N(r?.reversed) } };
  }

  /** The one search box over the coupon list: exact code (hashed), the code's last four, name / description, id, an
   *  applicable service (deal_services only), a customer who redeemed it or holds a wallet code (name or phone). */
  private couponSearch(ctx: DiscountsCtx, raw0: string) {
    const raw = raw0.trim().slice(0, 100);
    if (!raw) return { where: sql`true`, via: sql`null::text`, rank: sql`null::int` };
    const T = ctx.tenantId; const l = like(raw); const code = normalizeCode(raw); const h = code.length >= 3 ? hashCode(T, raw) : '';
    const { d, phoneish } = this.digits(raw); const isId = UUID.test(raw);
    const byCode = sql`exists (select 1 from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id and (c.code_hash = ${h} or (${code.length >= 2} and c.code_hint ilike ${'%' + code + '%'})))`;
    const byService = sql`exists (select 1 from deal_services ds join services s on s.id = ds.service_id and s.tenant_id = ds.tenant_id where ds.tenant_id = d.tenant_id and ds.deal_id = d.id and s.name ilike ${l})`;
    const custMatch = sql`(cu.full_name ilike ${l} or (${phoneish} and regexp_replace(coalesce(cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'}))`;
    const byCustomer = sql`(exists (select 1 from deal_redemptions r join customers cu on cu.id = r.customer_id and cu.tenant_id = r.tenant_id where r.tenant_id = d.tenant_id and r.deal_id = d.id and ${custMatch})
      or exists (select 1 from deal_coupon_codes c join customers cu on cu.id = c.customer_id and cu.tenant_id = c.tenant_id where c.tenant_id = d.tenant_id and c.deal_id = d.id and ${custMatch}))`;
    const byText = sql`(d.title ilike ${l} or coalesce(d.short_description, '') ilike ${l} or coalesce(d.terms, '') ilike ${l} or (${isId} and d.id::text = ${raw.toLowerCase()}))`;
    // Deals & Offers guide §5: the technician a deal belongs to (technician deals only — a salon deal has none)
    const byTech = sql`exists (select 1 from technicians te where te.id = d.technician_id and te.tenant_id = d.tenant_id
      and (coalesce(te.full_name, '') ilike ${l} or trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, '')) ilike ${l} or (${isId} and te.id::text = ${raw.toLowerCase()})))`;
    return {
      where: sql`(${byCode} or ${byText} or ${byService} or ${byTech} or ${byCustomer})`,
      via: sql`case when exists (select 1 from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id and c.code_hash = ${h}) then 'code_exact' when ${byCode} then 'code'
        when ${byText} then 'name' when ${byService} then 'service' when ${byTech} then 'technician' when ${byCustomer} then 'customer' end`,
      rank: sql`case when exists (select 1 from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id and c.code_hash = ${h}) or (${isId} and d.id::text = ${raw.toLowerCase()}) then 0
        when ${byCode} then 1 when d.title ilike ${raw} then 2 else 3 end`,
    };
  }

  /** 'active' = valid at any moment of the range: started before its end (or no start) and not ended before its start */
  private activeIn(p: DPeriod): RawBuilder<unknown> {
    if (!p.from || !p.to) return sql`true`;
    return sql`(coalesce(d.starts_at, '-infinity'::timestamptz) < ((${p.to}::date + 1))::timestamp at time zone ${p.tz} and coalesce(d.ends_at, 'infinity'::timestamptz) >= (${p.from}::date)::timestamp at time zone ${p.tz})`;
  }

  async list(ctx: DiscountsCtx, f: { q?: string; status?: string; type?: string; dateField?: string; serviceId?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown;
    ownerType?: string; kind?: string; technicianId?: string; branchId?: string }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    // 'pending' (waiting for a manager) is a Deals & Offers status: its lifecycle reads 'draft', so it is matched on the deal status itself
    const all = this.scope === 'all';
    const status = f.status === 'all' || (LIFECYCLES as readonly string[]).includes(String(f.status)) || (all && f.status === 'pending') ? String(f.status) : 'live';
    const type = f.type === 'percent' || f.type === 'fixed' ? f.type : null;
    const fields: readonly string[] = all ? DEAL_DATE_FIELDS : DISCOUNT_DATE_FIELDS;
    const dateField = fields.includes(String(f.dateField)) ? String(f.dateField) : 'created';
    const col = dateField === 'starts' ? sql`d.starts_at` : dateField === 'ends' ? sql`d.ends_at` : dateField === 'updated' ? sql`d.updated_at` : sql`d.created_at`;
    const dateW = dateField === 'active' ? this.activeIn(per)
      // Approved: a manager approved it within the range (the immutable decision log, not the deal's own timestamps)
      : dateField === 'approved' ? (per.from ? sql`exists (select 1 from deal_approvals a where a.tenant_id = d.tenant_id and a.deal_id = d.id and a.decision = 'approved' and ${this.inP(sql`a.created_at`, per)})` : sql`true`)
      // Redeemed: at least one completed redemption (a paid ticket) within the range — previews and unpaid tickets never count
      : dateField === 'redeemed' ? (per.from ? sql`exists (select 1 from deal_redemptions r where r.tenant_id = d.tenant_id and r.deal_id = d.id and ${CONFIRMED} and ${this.inP(sql`coalesce(r.redeemed_at, r.applied_at, r.created_at)`, per)})` : sql`true`)
      : this.inP(col, per);
    const s = this.couponSearch(ctx, String(f.q ?? ''));
    const lifeW = status === 'all' ? sql`true` : status === 'pending' ? sql`x.status = 'pending_approval'` : status === 'live' ? sql`x.life in ('active', 'scheduled', 'paused', 'draft')` : sql`x.life = ${status}`;
    const serviceId = f.serviceId && UUID.test(String(f.serviceId)) ? String(f.serviceId) : null;
    const byService = serviceId ? sql`exists (select 1 from deal_services ds where ds.tenant_id = d.tenant_id and ds.deal_id = d.id and ds.service_id = ${serviceId})` : sql`true`;
    const ownerType = f.ownerType === 'salon' || f.ownerType === 'technician' ? f.ownerType : null;
    const kind = (DEAL_KINDS_ALL as readonly string[]).includes(String(f.kind)) ? String(f.kind) : null;
    const technicianId = f.technicianId && UUID.test(String(f.technicianId)) ? String(f.technicianId) : null;
    const branchId = f.branchId && UUID.test(String(f.branchId)) ? String(f.branchId) : null;
    // Promotions guide §05 "branch" filter: a promotion made for that branch (salon-wide ones are not "of" a branch)
    const extra = all ? sql`and (${ownerType}::text is null or d.owner_type = ${ownerType}) and (${kind}::text is null or d.kind = ${kind})
      and (${technicianId}::uuid is null or d.technician_id = ${technicianId}) and (${branchId}::uuid is null or d.branch_id = ${branchId})` : sql`and (${branchId}::uuid is null or d.branch_id = ${branchId})`;
    const inner = sql`select ${DCOLS}, ${LIFE} as life, ${s.via} as matched_via, ${s.rank} as rank from deals d
      where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and ${s.where} and ${dateW} and ${byService} and (${type}::text is null or (case when d.discount_type = 'percent' then 'percent' else 'fixed' end) = ${type}) ${extra}`;
    const total = N((await sql<any>`select count(*)::int as n from (${inner}) x where ${lifeW}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.*, (select c.code_hint from deal_coupon_codes c where c.tenant_id = x.tenant_id and c.deal_id = x.id order by c.created_at, c.id limit 1) as code_hint,
        (select count(*) from deal_coupon_codes c where c.tenant_id = x.tenant_id and c.deal_id = x.id)::int as codes,
        (select coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) from technicians te where te.id = x.technician_id and te.tenant_id = x.tenant_id) as technician_name,
        (select b.name from branches b where b.id = x.branch_id and b.tenant_id = x.tenant_id) as branch_name
      from (${inner}) x where ${lifeW} order by x.rank nulls last, x.created_at desc, x.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { status, type: type ?? 'all', dateField, serviceId, branchId, ...(all ? { ownerType: ownerType ?? 'all', kind: kind ?? 'all', technicianId } : {}), period: per,
      items: rows.map((r: any) => this.row(r)), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  private row(r: any) {
    const percent = String(r.discount_type) === 'percent';
    const min = N(r.min_spend_cents);
    // the $100 ticket figure is ILLUSTRATIVE: the rule's own math on an eligible $100 subtotal, its cap applied, zero when $100 misses the minimum
    const sample = min > SAMPLE_CENTS ? 0 : ruleDiscount({ type: percent ? 'percent' : 'fixed', percent: r.discount_percent == null ? null : N(r.discount_percent), cents: r.discount_cents == null ? null : N(r.discount_cents), maxCents: r.max_discount_cents == null ? null : N(r.max_discount_cents) }, SAMPLE_CENTS);
    return { id: String(r.id), code: r.code_hint ? '••••' + String(r.code_hint) : null, codes: N(r.codes), name: String(r.title), description: r.short_description ?? null,
      discountType: percent ? 'percent' : 'fixed', discountPercent: r.discount_percent == null ? null : N(r.discount_percent), discountCents: r.discount_cents == null ? null : N(r.discount_cents),
      maxDiscountCents: r.max_discount_cents == null ? null : N(r.max_discount_cents), sampleSavingsCents: sample, minPurchaseCents: min,
      startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), maxRedemptions: r.max_redemptions == null ? null : N(r.max_redemptions), used: N(r.redemption_count),
      remaining: r.max_redemptions == null ? null : Math.max(0, N(r.max_redemptions) - N(r.redemption_count)), lifecycle: String(r.life), dealStatus: String(r.status),
      matchedVia: r.matched_via ?? null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      // Deals & Offers: who owns it and the stored price pair ($10.00 → $9.50) — the server's numbers, never the screen's
      kind: String(r.kind ?? 'deal'), ownerType: String(r.owner_type ?? 'salon'), technicianId: r.technician_id ? String(r.technician_id) : null, technicianName: r.technician_name ?? null,
      branchName: r.branch_name ?? null, originalPriceCents: r.original_price_cents == null ? null : N(r.original_price_cents), finalPriceCents: r.final_price_cents == null ? null : N(r.final_price_cents) };
  }

  /** Redemption History — the ledger, newest redemption first. Confirmed by default (paid tickets); pending = applied to
   *  an unpaid ticket (never counted), released = given back before payment, reversed = voided / refunded later. */
  async redemptions(ctx: DiscountsCtx, f: { q?: string; state?: string; dealId?: string; branchId?: string; dateField?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const state = (REDEMPTION_STATES as readonly string[]).includes(String(f.state)) ? String(f.state) : 'confirmed';
    const stW = state === 'confirmed' ? CONFIRMED : state === 'pending' ? sql`r.status = 'applied'` : state === 'released' ? sql`r.status = 'released'` : state === 'reversed' ? sql`r.status in ('reversed', 'partially_reversed')` : sql`true`;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = this.digits(raw); const code = normalizeCode(raw); const h = code.length >= 3 ? hashCode(T, raw) : '';
    const dealId = f.dealId && UUID.test(f.dealId) ? f.dealId : null;
    const rBranch = f.branchId && UUID.test(f.branchId) ? f.branchId : null;
    // Coupons guide (Nov 4 2026) date basis: 'applied' = when the code went on the ticket; 'finalized' = when the ticket was paid
    // (a pending redemption has no finalized date and is outside a finalized range); default = the redemption's own time
    const at = f.dateField === 'applied' ? sql`coalesce(r.applied_at, r.created_at)` : f.dateField === 'finalized' ? sql`r.redeemed_at` : sql`coalesce(r.redeemed_at, r.applied_at, r.created_at)`;
    const from = sql`from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id left join customers cu on cu.id = r.customer_id and cu.tenant_id = r.tenant_id
      left join tickets tk on tk.id = r.ticket_id and tk.tenant_id = r.tenant_id left join deal_coupon_codes cc on cc.id = r.coupon_code_id and cc.tenant_id = r.tenant_id
      left join technicians te on te.id = r.technician_id and te.tenant_id = r.tenant_id left join users au on au.id = r.applied_by_user_id and au.tenant_id = r.tenant_id left join branches br on br.id = r.branch_id and br.tenant_id = r.tenant_id`;
    // a redemption belongs to the branch where it was USED (a salon-wide deal used at branch B showed on branch A's screen)
    const rb = ctx.branchId && UUID.test(ctx.branchId) ? sql`(r.branch_id = ${ctx.branchId} or r.branch_id is null)` : sql`true`;
    const w = sql`r.tenant_id = ${T} and ${this.kindW()} and ${rb} and ${stW} and ${this.inP(at, per)} and (${dealId}::uuid is null or r.deal_id = ${dealId}) and (${rBranch}::uuid is null or r.branch_id = ${rBranch})
      and (${raw} = '' or coalesce(cu.full_name, '') ilike ${l} or d.title ilike ${l} or (${phoneish} and regexp_replace(coalesce(cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'})
        or coalesce(tk.ticket_number::text, '') = ${raw.replace(/^#/, '')} or r.id::text = ${raw.toLowerCase()} or coalesce(r.ticket_id::text, '') = ${raw.toLowerCase()}
        or (${UUID.test(raw)} and exists (select 1 from pos_queue_items qi where qi.tenant_id = r.tenant_id and qi.ticket_id = r.ticket_id and qi.appointment_id::text = ${raw.toLowerCase()}))
        or (${raw.includes('@')} and coalesce(cu.email, '') ilike ${l}) or coalesce(r.customer_id::text, '') = ${raw.toLowerCase()} or r.deal_id::text = ${raw.toLowerCase()}
        or coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) ilike ${l}
        or (${code.length >= 2} and (coalesce(cc.code_hint, '') ilike ${'%' + code + '%'} or exists (select 1 from deal_coupon_codes c2 where c2.tenant_id = r.tenant_id and c2.deal_id = r.deal_id and c2.code_hash = ${h}))))`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sums = (await sql<any>`select coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)) filter (where ${CONFIRMED}), 0)::bigint as saved, count(distinct r.customer_id) filter (where ${CONFIRMED})::int as customers ${from} where ${w}`.execute(this.db)).rows[0];
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select r.id, r.status, ${at} as at, r.applied_at, r.redeemed_at, r.reversed_at, r.reversal_reason, r.amount_discounted_cents, r.reversed_cents, r.deal_id, d.title, cc.code_hint,
        r.estimate_snapshot, r.line_allocations,
        (select c3.code_hint from deal_coupon_codes c3 where c3.tenant_id = r.tenant_id and c3.deal_id = r.deal_id order by c3.created_at, c3.id limit 1) as deal_hint,
        r.customer_id, cu.full_name, cu.phone_display, cu.normalized_phone, r.ticket_id, tk.ticket_number, tk.subtotal_cents, tk.total_cents, tk.status as ticket_status,
        coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as technician, coalesce(nullif(au.full_name, ''), au.email) as applied_by, br.name as branch_name
      ${from} where ${w} order by ${at} desc, r.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    // Deals & Offers 08: the ticket's lines now, for the preview-vs-paid explanation (only rows that kept an estimate)
    const tIds = [...new Set(rows.filter((r: any) => r.estimate_snapshot && r.ticket_id).map((r: any) => String(r.ticket_id)))];
    const tLines = tIds.length ? (await sql<{ ticket_id: string; id: string; line_total_cents: number }>`select tsl.ticket_id, tsl.id, tsl.line_total_cents from ticket_service_lines tsl
        where tsl.tenant_id = ${T} and tsl.ticket_id in (${sql.join(tIds)}) and tsl.removed_at is null`.execute(this.db)).rows : [];
    const linesOf = (tid: string) => tLines.filter((l) => String(l.ticket_id) === tid).map((l) => ({ lineId: String(l.id), priceCents: N(l.line_total_cents) }));
    const pvp = (r: any) => {
      const snap = readEstimateSnapshot(r.estimate_snapshot);
      if (!snap || !r.ticket_id) return null;
      const alloc = Array.isArray(r.line_allocations) ? r.line_allocations.map((a: any) => ({ lineId: String(a?.lineId), cents: N(a?.cents) })) : [];
      return comparePreviewToPaid(snap, { discountCents: N(r.amount_discounted_cents), allocations: alloc, lines: linesOf(String(r.ticket_id)) });
    };
    return { state, period: per, totals: { savingsCents: N(sums?.saved), uniqueCustomers: N(sums?.customers) },
      items: rows.map((r: any) => ({ id: String(r.id), status: String(r.status), previewVsPaid: pvp(r), at: iso(r.at), appliedAt: iso(r.applied_at), redeemedAt: iso(r.redeemed_at), reversedAt: iso(r.reversed_at), reversalReason: r.reversal_reason ?? null,
        dealId: String(r.deal_id), dealName: String(r.title), code: (r.code_hint ?? r.deal_hint) ? '••••' + String(r.code_hint ?? r.deal_hint) : null,
        customerId: r.customer_id ? String(r.customer_id) : null, customerName: r.full_name ?? null, maskedPhone: maskPhone(r.phone_display ?? r.normalized_phone),
        ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number == null ? null : String(r.ticket_number), ticketStatus: r.ticket_status ?? null,
        eligibleSubtotalCents: r.subtotal_cents == null ? null : N(r.subtotal_cents), discountCents: N(r.amount_discounted_cents), reversedCents: N(r.reversed_cents), finalCents: r.total_cents == null ? null : N(r.total_cents),
        technician: r.technician || null, appliedBy: r.applied_by ?? null, branch: r.branch_name ?? null })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Performance per coupon over a redemption-date period. "Ticket sales" is what the paid tickets carrying the coupon came
   *  to — linked, NOT incremental (no experiment backs causation). Uses left only where a cap exists. */
  async performance(ctx: DiscountsCtx, f: { q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f, 'month');
    const s = this.couponSearch(ctx, String(f.q ?? ''));
    const at = sql`coalesce(r.redeemed_at, r.applied_at, r.created_at)`;
    const base = sql`from deals d where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and ${s.where}`;
    const total = N((await sql<any>`select count(*)::int as n ${base}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const agg = sql`(select count(*) filter (where ${CONFIRMED})::int as n, count(distinct r.customer_id) filter (where ${CONFIRMED})::int as customers,
        coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)) filter (where ${CONFIRMED}), 0)::bigint as saved,
        count(*) filter (where r.status in ('reversed', 'partially_reversed'))::int as reversed, coalesce(sum(tk.total_cents) filter (where ${CONFIRMED}), 0)::bigint as sales
      from deal_redemptions r left join tickets tk on tk.id = r.ticket_id and tk.tenant_id = r.tenant_id where r.tenant_id = d.tenant_id and r.deal_id = d.id and ${this.inP(at, per)})`;
    const rows = (await sql<any>`select ${DCOLS}, ${LIFE} as life, a.n, a.customers, a.saved, a.reversed, a.sales,
        (select c.code_hint from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id order by c.created_at, c.id limit 1) as code_hint
      from deals d cross join lateral ${agg} a where d.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and ${s.where}
      order by a.n desc, d.created_at desc, d.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const tot = (await sql<any>`select count(*) filter (where ${CONFIRMED})::int as n, count(distinct r.customer_id) filter (where ${CONFIRMED})::int as customers,
        coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)) filter (where ${CONFIRMED}), 0)::bigint as saved
      from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id where r.tenant_id = ${T} and ${this.kindW()} and ${this.branch(ctx)} and ${this.inP(at, per)}`.execute(this.db)).rows[0];
    return { period: per, totals: { redemptions: N(tot?.n), uniqueCustomers: N(tot?.customers), savingsCents: N(tot?.saved) },
      items: rows.map((r: any) => ({ ...this.row(r), periodRedemptions: N(r.n), periodCustomers: N(r.customers), periodSavingsCents: N(r.saved), periodReversed: N(r.reversed), linkedTicketSalesCents: N(r.sales),
        avgDiscountCents: N(r.n) ? Math.round(N(r.saved) / N(r.n)) : null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Details: overview, eligibility, validity & limits, applicable services, usage and the version (audit) history. */
  async detail(ctx: DiscountsCtx, dealId: string) {
    const T = ctx.tenantId;
    const nf = () => withCode(new HttpException({ code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' }, HttpStatus.NOT_FOUND), 'PROMOTION_NOT_FOUND');
    if (!UUID.test(String(dealId))) throw nf();
    const r = (await sql<any>`select ${DCOLS}, ${LIFE} as life, b.name as branch_name, coalesce(nullif(u.full_name, ''), u.email) as created_by,
        (select c.code_hint from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id order by c.created_at, c.id limit 1) as code_hint,
        (select count(*) from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id)::int as codes,
        (select count(*) from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id and c.status = 'active' and c.revoked_at is null)::int as active_codes,
        (select count(*) from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id and c.customer_id is not null)::int as wallet_codes
      from deals d left join branches b on b.id = d.branch_id and b.tenant_id = d.tenant_id left join users u on u.id = d.created_by_user_id and u.tenant_id = d.tenant_id
      where d.tenant_id = ${T} and d.id = ${dealId} and ${this.kindW()} and ${this.branch(ctx)}`.execute(this.db)).rows[0];
    if (!r) throw nf();
    const services = (await sql<any>`select s.id, s.name from deal_services ds join services s on s.id = ds.service_id and s.tenant_id = ds.tenant_id where ds.tenant_id = ${T} and ds.deal_id = ${dealId} order by s.name, s.id`.execute(this.db)).rows;
    const usage = (await sql<any>`select count(*) filter (where ${CONFIRMED})::int as confirmed, count(*) filter (where r.status = 'applied')::int as pending, count(*) filter (where r.status = 'released')::int as released,
        count(*) filter (where r.status in ('reversed', 'partially_reversed'))::int as reversed, count(distinct r.customer_id) filter (where ${CONFIRMED})::int as customers,
        coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)) filter (where ${CONFIRMED}), 0)::bigint as saved, max(r.redeemed_at) as last_at
      from deal_redemptions r where r.tenant_id = ${T} and r.deal_id = ${dealId}`.execute(this.db)).rows[0];
    const versions = (await sql<any>`select v.id, v.version, v.terms, v.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor from deal_versions v left join users u on u.id = v.changed_by_user_id and u.tenant_id = v.tenant_id
      where v.tenant_id = ${T} and v.deal_id = ${dealId} order by v.version desc, v.created_at desc limit 20`.execute(this.db)).rows;
    const roi = await this.roiExplained(ctx, dealId);
    const related = await this.relatedOffers(ctx, dealId);
    const rules = r.rules && typeof r.rules === 'object' ? r.rules : null;
    const ruleCount = rules ? JSON.stringify(rules).split('"type"').length - 1 : 0;
    return {
      ...this.row(r),
      overview: { terms: r.terms ?? null, branch: r.branch_name ?? null, salonWide: !r.branch_id, createdBy: r.created_by ?? null, publishedAt: iso(r.published_at), expiredAt: iso(r.expired_at), suspendedReason: r.suspended_reason ?? null, priority: N(r.priority) },
      eligibility: { newCustomersOnly: !!r.new_customers_only, memberOnly: !!r.member_only, daysOfWeek: Array.isArray(r.days_of_week) ? r.days_of_week.map(Number) : null,
        validFromMinute: r.valid_from_minute == null ? null : N(r.valid_from_minute), validToMinute: r.valid_to_minute == null ? null : N(r.valid_to_minute), channels: Array.isArray(r.channels) ? r.channels : null,
        stackable: !!r.stackable, stackGroup: r.stack_group ?? null, requiresCode: !!r.requires_code, advancedRules: ruleCount },
      limits: { maxRedemptions: r.max_redemptions == null ? null : N(r.max_redemptions), maxPerCustomer: r.max_per_customer == null ? null : N(r.max_per_customer), maxDiscountCents: r.max_discount_cents == null ? null : N(r.max_discount_cents),
        budgetCents: r.budget_cents == null ? null : N(r.budget_cents), codes: N(r.codes), activeCodes: N(r.active_codes), walletCodes: N(r.wallet_codes) },
      services: services.map((s: any) => ({ id: String(s.id), name: String(s.name) })),
      usage: { confirmed: N(usage?.confirmed), pendingAtCheckout: N(usage?.pending), released: N(usage?.released), reversed: N(usage?.reversed), uniqueCustomers: N(usage?.customers), savingsCents: N(usage?.saved), lastRedeemedAt: iso(usage?.last_at) },
      history: versions.map((v: any) => ({ id: String(v.id), version: N(v.version), at: iso(v.created_at), actor: v.actor ?? null, terms: summarizeTerms(v.terms) })),
      roi: roi.roi, byBranch: roi.byBranch, related,
    };
  }

  /** Extras (Coupons & Promotions 02 "Unified Offers Relationship Viewer"), read-only: what else refers to this offer and which
   *  OTHER offers — coupons, promotions (automatic) and deals alike, whatever screen owns them — give the SAME benefit:
   *  the same discount type and value, a branch scope that meets (salon-wide meets every branch), services that meet (no
   *  service list = every service) and dates that overlap. Archived / cancelled / rejected / ended offers are not listed.
   *  Same-benefit is a fact for a person to review (they may be intentional), never a change. A branch user sees only offers
   *  of their branch or salon-wide. */
  private async relatedOffers(ctx: DiscountsCtx, dealId: string) {
    const T = ctx.tenantId;
    const ob = ctx.branchId && UUID.test(ctx.branchId) ? sql`(o.branch_id = ${ctx.branchId} or o.branch_id is null)` : sql`true`;
    type SameRow = { id: string; title: string; kind: string | null; life: string; branch_name: string | null; stackable: boolean; salon_wide: boolean; shared: number | null; code_hint: string | null };
    const same = (await sql<SameRow>`with me as (select d.id, d.discount_type, d.discount_percent, d.discount_cents, d.branch_id, d.starts_at, d.ends_at,
            exists (select 1 from deal_services s where s.tenant_id = d.tenant_id and s.deal_id = d.id) as has_svc
          from deals d where d.tenant_id = ${T} and d.id = ${dealId})
        select o.id, o.title, o.kind, o.stackable, ob.name as branch_name, (o.branch_id is null) as salon_wide,
          (case when o.suspended_at is not null then 'paused' when o.status = 'sold_out' or (o.max_redemptions is not null and o.redemption_count >= o.max_redemptions) then 'exhausted'
            when o.status = 'draft' then 'draft' when o.starts_at > now() then 'scheduled' else 'active' end) as life,
          (case when me.has_svc and exists (select 1 from deal_services s2 where s2.tenant_id = o.tenant_id and s2.deal_id = o.id)
            then (select count(*)::int from deal_services s1 join deal_services s2 on s2.service_id = s1.service_id and s2.tenant_id = s1.tenant_id
                  where s1.tenant_id = ${T} and s1.deal_id = me.id and s2.deal_id = o.id) else null end) as shared,
          (select c.code_hint from deal_coupon_codes c where c.tenant_id = o.tenant_id and c.deal_id = o.id order by c.created_at, c.id limit 1) as code_hint
        from me join deals o on o.tenant_id = ${T} and o.id <> me.id
          left join branches ob on ob.id = o.branch_id and ob.tenant_id = o.tenant_id
        where ${ob} and o.status not in ('archived', 'canceled', 'rejected', 'expired') and (o.ends_at is null or o.ends_at > now())
          and o.discount_type = me.discount_type
          and o.discount_percent is not distinct from (case when me.discount_type = 'percent' then me.discount_percent else o.discount_percent end)
          and (me.discount_type = 'percent' or o.discount_cents is not distinct from me.discount_cents)
          and (o.branch_id is null or me.branch_id is null or o.branch_id = me.branch_id)
          and coalesce(o.starts_at, '-infinity'::timestamptz) < coalesce(me.ends_at, 'infinity'::timestamptz)
          and coalesce(me.starts_at, '-infinity'::timestamptz) < coalesce(o.ends_at, 'infinity'::timestamptz)
          and (not me.has_svc or not exists (select 1 from deal_services s where s.tenant_id = o.tenant_id and s.deal_id = o.id)
            or exists (select 1 from deal_services s1 join deal_services s2 on s2.service_id = s1.service_id and s2.tenant_id = s1.tenant_id
                       where s1.tenant_id = ${T} and s1.deal_id = me.id and s2.deal_id = o.id))
        order by o.created_at desc, o.id limit 20`.execute(this.db)).rows;
    type RefRow = { campaigns: number };
    const refs = (await sql<RefRow>`select (select count(*)::int from campaigns c where c.tenant_id = ${T} and c.deal_id = ${dealId}) as campaigns`.execute(this.db)).rows[0];
    return {
      sameBenefit: same.map((o) => ({ id: String(o.id), name: String(o.title), kind: String(o.kind ?? 'deal'), lifecycle: String(o.life), branchName: o.branch_name ?? null,
        salonWide: !!o.salon_wide, stackable: !!o.stackable, sharedServices: o.shared == null ? null : N(o.shared), code: o.code_hint ? '••••' + String(o.code_hint) : null })),
      campaigns: N(refs?.campaigns),
    };
  }

  /** Extras (Coupons & Promotions 13 "Source-Based ROI Explanation" + 14 "Advanced Branch Scorecard"), all time, read-only:
   *    associated revenue   Σ total of the DISTINCT paid / closed tickets that carry a confirmed redemption of this offer — the
   *                         sales the offer was used on, NOT revenue it caused
   *    discount cost        Σ discount given on confirmed redemptions, net of reversals (the same figure as usage.savingsCents)
   *    campaign spend       provider cost of the messages sent by campaigns linked to this offer (campaigns.deal_id); null
   *                         ("not known") unless the provider reported the cost of EVERY sent message — never estimated
   *    incremental lift     always 'unverified': there is no control group, so no figure is claimed
   *  byBranch: the same counts per ticket location (a branch user sees only their location's tickets). */
  private async roiExplained(ctx: DiscountsCtx, dealId: string) {
    const T = ctx.tenantId;
    const tb = ctx.branchId && UUID.test(ctx.branchId) ? sql`tk.branch_id = ${ctx.branchId}` : sql`true`;
    type BrRow = { branch_id: string | null; branch_name: string | null; n: number; customers: number; saved: string | number; tickets: number; sales: string | number };
    const rows = (await sql<BrRow>`with red as (
          select r.id, r.customer_id, r.ticket_id, (r.amount_discounted_cents - coalesce(r.reversed_cents, 0)) as saved, tk.branch_id, tk.total_cents, tk.status as tk_status
          from deal_redemptions r left join tickets tk on tk.id = r.ticket_id and tk.tenant_id = r.tenant_id
          where r.tenant_id = ${T} and r.deal_id = ${dealId} and ${CONFIRMED} and ${tb})
        select red.branch_id, b.name as branch_name, count(*)::int as n, count(distinct red.customer_id)::int as customers, coalesce(sum(red.saved), 0)::bigint as saved,
          (select count(*)::int from (select distinct x.ticket_id from red x where x.branch_id is not distinct from red.branch_id and x.tk_status in ('paid', 'closed')) d) as tickets,
          (select coalesce(sum(y.total_cents), 0)::bigint from (select distinct on (x.ticket_id) x.ticket_id, x.total_cents from red x where x.branch_id is not distinct from red.branch_id and x.tk_status in ('paid', 'closed')) y) as sales
        from red left join branches b on b.id = red.branch_id and b.tenant_id = ${T}
        group by red.branch_id, b.name order by sales desc, b.name nulls last`.execute(this.db)).rows;
    type SpRow = { campaigns: number; submitted: number; costed: number; cost_micros: string | number };
    const sp = (await sql<SpRow>`select count(distinct c.id)::int as campaigns, count(s.id) filter (where s.status = 'sent')::int as submitted,
          count(s.id) filter (where s.status = 'sent' and n.provider_cost_micros is not null)::int as costed,
          coalesce(sum(n.provider_cost_micros) filter (where s.status = 'sent'), 0)::bigint as cost_micros
        from campaigns c left join ai_marketing_campaign_sends s on s.tenant_id = c.tenant_id and s.campaign_id = c.id
          left join notifications n on n.tenant_id = s.tenant_id and s.provider_id is not null and n.provider_id = s.provider_id
        where c.tenant_id = ${T} and c.deal_id = ${dealId}`.execute(this.db)).rows[0];
    const campaigns = N(sp?.campaigns), submitted = N(sp?.submitted), costed = N(sp?.costed);
    const spendCents = submitted > 0 && costed === submitted ? Math.round(N(sp?.cost_micros) / 10_000) : submitted === 0 && campaigns > 0 ? 0 : null;
    const sum = (k: 'saved' | 'sales' | 'tickets' | 'n') => rows.reduce((a, x) => a + N(x[k]), 0);
    return {
      roi: {
        associatedRevenueCents: sum('sales'), associatedTickets: sum('tickets'), discountCostCents: sum('saved'), redemptions: sum('n'),
        campaignSpend: { campaigns, messagesSent: submitted, messagesCosted: costed, spendCents,
          state: campaigns === 0 ? 'no_campaign' as const : spendCents == null ? 'cost_unknown' as const : 'known' as const },
        incrementalLift: 'unverified' as const,
      },
      byBranch: rows.map((x) => ({ branchId: x.branch_id ? String(x.branch_id) : null, branchName: x.branch_name ?? null, redemptions: N(x.n), uniqueCustomers: N(x.customers),
        discountCents: N(x.saved), associatedTickets: N(x.tickets), associatedRevenueCents: N(x.sales) })),
    };
  }

  /** Refund Impact Preview (Extras · Discounts 11): for a ticket (and optionally the service lines being refunded), each
   *  discount / coupon application with its line allocation and what the refund would do under the ONE refund rule
   *  (engine/refund-outcome.ts — the same function the ledger applies). Read-only: nothing is reversed here. */
  async refundImpact(ctx: DiscountsCtx, ticketId: string, lineIds: string[] | null): Promise<DiscountRefundImpact> {
    if (!UUID.test(ticketId)) throw withCode(new HttpException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found' }, HttpStatus.NOT_FOUND), 'TICKET_NOT_FOUND');
    const ids = lineIds && lineIds.length ? lineIds.filter((x) => UUID.test(x)) : null;
    const rows = (await sql<any>`select r.id, r.status, r.amount_discounted_cents, r.reversed_cents, r.line_allocations, d.title,
        (select c.code_hint from deal_coupon_codes c where c.tenant_id = r.tenant_id and c.id = r.coupon_code_id) as code_hint
      from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id
      where r.tenant_id = ${ctx.tenantId} and r.ticket_id = ${ticketId} and ${this.branch(ctx)} and r.status in ('applied', 'redeemed', 'partially_reversed') order by r.id`.execute(this.db)).rows;
    return { ticketId, wholeTicket: !ids, items: rows.map((r: any) => {
      const o = refundOutcome(r, ids);
      const alloc: { lineId: string; cents: number }[] = Array.isArray(r.line_allocations) ? r.line_allocations : (typeof r.line_allocations === 'string' ? JSON.parse(r.line_allocations) : []);
      return { redemptionId: String(r.id), dealName: String(r.title), code: r.code_hint ? '••••' + String(r.code_hint) : null, status: String(r.status), discountCents: N(r.amount_discounted_cents),
        alreadyReversedCents: N(r.reversed_cents), outcome: o.kind, reverseCents: o.shareCents, placeReturned: o.placeReturned,
        lines: alloc.map((a) => ({ lineId: String(a.lineId), cents: N(a.cents), refunded: !ids || ids.includes(String(a.lineId)) })) };
    }) };
  }

  async exportList(ctx: DiscountsCtx, f: Record<string, unknown>) {
    const r = await this.list(ctx, { ...f, page: 1, pageSize: 100 });
    const all = [...r.items];
    for (let p = 2; p <= r.totalPages; p++) all.push(...(await this.list(ctx, { ...f, page: p, pageSize: 100 })).items);
    return csv(['Code (masked)', 'Name', 'Discount', 'On a $100 ticket (illustrative)', 'Min purchase', 'Starts', 'Ends', 'Used', 'Limit', 'Status', 'Created'],
      all.map((x) => [x.code ?? '', x.name, x.discountType === 'percent' ? `${x.discountPercent}%` : dollars(x.discountCents ?? 0), dollars(x.sampleSavingsCents), dollars(x.minPurchaseCents), x.startsAt ?? '', x.endsAt ?? '', x.used, x.maxRedemptions ?? 'Unlimited', x.lifecycle, x.createdAt ?? '']));
  }
  async exportRedemptions(ctx: DiscountsCtx, f: Record<string, unknown>) {
    const r = await this.redemptions(ctx, { ...f, page: 1, pageSize: 100 });
    const all = [...r.items];
    for (let p = 2; p <= r.totalPages; p++) all.push(...(await this.redemptions(ctx, { ...f, page: p, pageSize: 100 })).items);
    return csv(['Date', 'Customer', 'Phone (masked)', 'Code (masked)', 'Promotion', 'Ticket', 'Eligible subtotal', 'Discount', 'Final amount', 'Status', 'Redemption ID'],
      all.map((x) => [x.at ?? '', x.customerName ?? '', x.maskedPhone ?? '', x.code ?? '', x.dealName, x.ticketNumber ?? '', x.eligibleSubtotalCents == null ? '' : dollars(x.eligibleSubtotalCents), dollars(x.discountCents),
        x.finalCents == null ? '' : dollars(x.finalCents), x.status, x.id]));
  }
}

/** A version's terms as the few fields a person reads (never the code: versions never held it). */
function summarizeTerms(t: unknown): Record<string, unknown> {
  const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;   // jsonb arrives parsed
  const keep = ['title', 'discountType', 'discountPercent', 'discountCents', 'minSpendCents', 'maxRedemptions', 'startsAt', 'endsAt', 'status'];
  return Object.fromEntries(Object.entries(o).filter(([k]) => keep.includes(k)));
}

// ── controller ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const DISCOUNTS_SCREEN = 'DiscountsScreenRepository';
function ctxFrom(req: any): DiscountsCtx { const c = req?.ctx || {}; return { tenantId: c.tenantId, branchId: c.branchId ?? '', userId: c.userId, role: c.role, permissions: c.permissions || [] }; }
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const per = (q: any) => ({ preset: s(q?.preset), from: s(q?.from), to: s(q?.to) });
const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const LIST_SPEC = { filters: { preset: PRESET, status: { type: 'enum', values: ['live', 'all', ...LIFECYCLES] }, type: { type: 'enum', values: ['percent', 'fixed', 'all'] }, dateField: { type: 'enum', values: DISCOUNT_DATE_FIELDS }, serviceId: { type: 'uuid' }, branchId: { type: 'uuid' } },
  search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const RED_SPEC = { filters: { preset: PRESET, state: { type: 'enum', values: REDEMPTION_STATES }, dealId: { type: 'uuid' }, branchId: { type: 'uuid' }, dateField: { type: 'enum', values: ['redeemed', 'applied', 'finalized'] } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const PERF_SPEC = { filters: { preset: PRESET }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/discounts')
export class DiscountsScreenController {
  constructor(@Inject(DISCOUNTS_SCREEN) private readonly repo: DiscountsScreenRepository | null) {}
  private r() { if (!this.repo) throw new HttpException({ code: 'SERVICE_UNAVAILABLE', message: 'Discounts need the database.' }, HttpStatus.SERVICE_UNAVAILABLE); return this.repo; }
  private auth(req: any) { const c = ctxFrom(req); if (!c.tenantId || !c.userId) throw withCode(new HttpException('Not authenticated', HttpStatus.UNAUTHORIZED), 'AUTH_REQUIRED'); return c; }

  @Get('kpis') @RequirePermission('pos.marketing.view') @ListQuery({ filters: { expiringDays: { type: 'int', min: 1, max: 90 } } })
  kpis(@Req() req: any, @Query('expiringDays') expiringDays?: string) { return this.r().kpis(this.auth(req), { expiringDays }); }

  @Get('') @RequirePermission('pos.marketing.view') @ListQuery(LIST_SPEC)
  list(@Req() req: any, @Query() q: any) { return this.r().list(this.auth(req), { q: s(q?.q), status: s(q?.status), type: s(q?.type), dateField: s(q?.dateField), serviceId: s(q?.serviceId), branchId: s(q?.branchId), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  // Refund Impact Preview (Extras · Discounts 11): refund staff see it before an authorized refund — read-only
  @Get('refund-impact/:ticketId') @RequirePermission('pos.checkout.refund') @ListQuery({ filters: { lineIds: { type: 'text', maxLength: 4000 } }, search: false })
  discountImpactOfRefund(@Req() req: any, @Param('ticketId') ticketId: string, @Query('lineIds') lineIds?: string): Promise<DiscountRefundImpact> {
    return this.r().refundImpact(this.auth(req), String(ticketId), lineIds ? String(lineIds).split(',').map((x) => x.trim()).filter(Boolean) : null);
  }

  @Get('redemptions') @RequirePermission('pos.marketing.view') @ListQuery(RED_SPEC)
  redemptions(@Req() req: any, @Query() q: any) { return this.r().redemptions(this.auth(req), { q: s(q?.q), state: s(q?.state), dealId: s(q?.dealId), branchId: s(q?.branchId), dateField: s(q?.dateField), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @Get('performance') @RequirePermission('pos.marketing.view') @ListQuery(PERF_SPEC)
  performance(@Req() req: any, @Query() q: any) { return this.r().performance(this.auth(req), { q: s(q?.q), ...per(q), page: q?.page, pageSize: q?.pageSize }); }

  @AsyncExport({ kind: 'discounts.export' }) @Get('export') @RequirePermission('pos.marketing.manage') @ListQuery({ ...LIST_SPEC, maxLimit: undefined, defaultLimit: undefined })
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="discounts.csv"')
  exportList(@Req() req: any, @Query() q: any) { return this.r().exportList(this.auth(req), { q: s(q?.q), status: s(q?.status), type: s(q?.type), dateField: s(q?.dateField), serviceId: s(q?.serviceId), branchId: s(q?.branchId), ...per(q) }); }

  @AsyncExport({ kind: 'discounts.redemptions.export' }) @Get('export/redemptions') @RequirePermission('pos.marketing.manage') @ListQuery({ ...RED_SPEC, maxLimit: undefined, defaultLimit: undefined })
  @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="discount-redemptions.csv"')
  exportRedemptions(@Req() req: any, @Query() q: any) { return this.r().exportRedemptions(this.auth(req), { q: s(q?.q), state: s(q?.state), dealId: s(q?.dealId), branchId: s(q?.branchId), dateField: s(q?.dateField), ...per(q) }); }

  @Get(':dealId') @RequirePermission('pos.marketing.view')
  detail(@Req() req: any, @Param('dealId') id: string) { return this.r().detail(this.auth(req), id); }
}
