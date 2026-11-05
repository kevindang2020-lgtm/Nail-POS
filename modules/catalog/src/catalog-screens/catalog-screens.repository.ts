// catalog-screens.repository.ts — the read model (and the few audited writes) behind four rebuilt POS screens (Oct 30 2026):
//   Services & Products (/services) · Service Categories (/tenant/services/categories) · Service Pricing
//   (/tenant/services/pricing) · Add-Ons (/tenant/services/add-ons).
// Raw, parameterised SQL over the canonical tables — services, service_categories, service_add_ons, technician_services,
// branches, inventory_products, tickets + ticket_service_lines (the realized-sales ledger) and catalog_change_log
// (migration 718). The tenant is the session's and literal in every statement; a branch user sees salon-wide rows and
// their branch's (services.branch_id is the real branch model: null = every branch). Money is integer cents; days are
// the salon's (tenantTimeZone). Lists are server-paged, newest created first with the id as the tie-break.
//
// Definitions (on the screens, in the tests):
//   catalog services   = services not archived (active + inactive); "active" = status 'active'
//   priced services    = active catalog services with price > 0 (Average / Lowest / Highest Price use these)
//   realized revenue   = ticket_service_lines.line_total_cents on PAID tickets, line not removed (before refunds — refunds
//                        are tender reversals, shown in Refunds & Voids); service lines exclude add-on and retail lines
//   add-on conversion  = paid tickets in the period with ≥ 1 add-on line ÷ paid tickets with ≥ 1 service line
//   legacy add-on      = a service_add_ons row (one OFFERING: an add-on key on one service); rows sharing an add_on_key are
//                        one DEFINITION. Add-ons-category services (packages/database add-on-authority) are listed apart.
import { sql, type Kysely, type RawBuilder } from 'kysely';
import { HttpException, HttpStatus } from '@nestjs/common';
import { withCode, isAddOnCategory, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { tenantTimeZone, transitionStatus } from '@aipowersalon/database';
import { SERVICE_PRICE_SCHEDULE } from '../catalog-lifecycles';
import { recordCatalogChanges, diffFields, type CatalogChange } from './catalog-change-log';
import * as crypto from 'crypto';

export interface CatCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }
export interface CPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const maskPhone = (p: string | null | undefined) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
export function paging(page: unknown, pageSize: unknown, def = 10) { return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: Math.max(1, Math.min(100, Math.trunc(Number(pageSize)) || def)) }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }
const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => withCode(new HttpException({ code, message, ...extra }, status), code as ApiErrorCode);
/** "$55", "55.00", "55" → 5500 cents when the text is a money amount; "45m", "45 min" → 45 minutes. */
function moneyOf(raw: string): number | null { const m = raw.trim().match(/^\$?\s*(\d{1,6})(?:\.(\d{1,2}))?$/); if (!m) return null; return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0); }
function minutesOf(raw: string): number | null { const m = raw.trim().toLowerCase().match(/^(\d{1,4})\s*(m|min|mins|minutes)$/); return m ? Number(m[1]) : null; }
function phoneDigits(raw: string) { let d = raw.replace(/\D/g, ''); if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return { d, phoneish: d.length >= 4 && !/[a-z]/i.test(raw) }; }

export const SERVICE_STATUSES = ['active', 'inactive', 'archived', 'all'] as const;
export const SERVICE_SORTS = ['newest', 'oldest', 'name', 'price_desc', 'price_asc', 'duration', 'updated', 'category'] as const;
export const CATEGORY_SORTS = ['newest', 'oldest', 'name', 'most', 'fewest', 'updated'] as const;
export const ADD_ON_SORTS = ['newest', 'name', 'price_desc', 'price_asc', 'updated', 'service'] as const;
export const HISTORY_FIELDS = ['price', 'duration', 'pricing', 'all'] as const;

/** The fixed SQL fragments the sorts map to (no identifier is ever built from input). */
const SERVICE_ORDER: Record<string, RawBuilder<unknown>> = {
  newest: sql`s.created_at desc, s.id desc`, oldest: sql`s.created_at asc, s.id asc`, name: sql`lower(s.name) asc, s.id asc`,
  price_desc: sql`s.price_cents desc, s.id desc`, price_asc: sql`s.price_cents asc, s.id asc`, duration: sql`s.duration_minutes desc, s.id desc`,
  updated: sql`s.updated_at desc nulls last, s.id desc`, category: sql`lower(coalesce(c.name, '')) asc, lower(s.name) asc, s.id asc`,
};
const CATEGORY_ORDER: Record<string, RawBuilder<unknown>> = {
  newest: sql`x.created_at desc, x.id desc`, oldest: sql`x.created_at asc, x.id asc`, name: sql`lower(x.name) asc, x.id asc`,
  most: sql`x.services desc, x.id desc`, fewest: sql`x.services asc, x.id asc`, updated: sql`x.updated_at desc nulls last, x.id desc`,
};
const ADD_ON_ORDER: Record<string, RawBuilder<unknown>> = {
  newest: sql`a.created_at desc, a.id desc`, name: sql`lower(a.name) asc, a.id asc`, price_desc: sql`a.price_cents desc, a.id desc`,
  price_asc: sql`a.price_cents asc, a.id asc`, updated: sql`a.updated_at desc nulls last, a.id desc`, service: sql`lower(s.name) asc, a.id asc`,
};

export class CatalogScreensRepository {
  constructor(private readonly db: Kysely<any>) {}
  /** tickets of the selected branch (sales were the whole salon's for a branch user) */
  private tb(ctx: CatCtx) { const b = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null; return b ? sql`t.branch_id = ${b}` : sql`true`; }
  private branch(ctx: CatCtx, a: 's' | 'c' | 'a') {
    const b = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    if (!b) return sql`true`;
    return a === 's' ? sql`(s.branch_id = ${b} or s.branch_id is null)` : a === 'c' ? sql`(c.branch_id = ${b} or c.branch_id is null)` : sql`(a.branch_id = ${b} or a.branch_id is null)`;
  }

  async period(ctx: CatCtx, q: { preset?: unknown; from?: unknown; to?: unknown }, def = 'all'): Promise<CPeriod> {
    const tz = await tenantTimeZone(this.db, ctx.tenantId);   // never throws: the salon default when unset
    const r = (await sql<any>`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as today, to_char(date_trunc('week', now() at time zone ${tz})::date, 'YYYY-MM-DD') as wk,
        to_char(date_trunc('month', now() at time zone ${tz})::date, 'YYYY-MM-DD') as mo, to_char(date_trunc('year', now() at time zone ${tz})::date, 'YYYY-MM-DD') as yr`.execute(this.db)).rows[0];
    const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset ?? '')) ? String(q.preset) : def;
    if (preset === 'all') return { preset, from: null, to: null, tz, today: r.today };
    if (preset === 'custom') {
      const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
      if (!from || !to || to < from) throw err(400, 'DATE_RANGE_INVALID', 'The start date must be on or before the end date.');
      return { preset, from, to, tz, today: r.today };
    }
    return { preset, from: preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr, to: r.today, tz, today: r.today };
  }
  /** `col` within the period: salon-local days, the end day included (DST-safe: each bound converted on its own date). */
  private inP(col: RawBuilder<unknown>, p: CPeriod): RawBuilder<unknown> {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp at time zone ${p.tz} and ${col} < ((${p.to}::date + 1))::timestamp at time zone ${p.tz})`;
  }
  /** Paid tickets of this salon (the realized-sales scope), as a fragment over `t`. */
  private paid(ctx: CatCtx) { return sql`t.tenant_id = ${ctx.tenantId} and t.paid_at is not null and t.removed_at is null and coalesce(t.payment_status, '') <> 'voided' and ${this.tb(ctx)}`; }

  // ── Services & Products dashboard ──────────────────────────────────────────────────────────────────────────────────
  async dashboard(ctx: CatCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId; const per = await this.period(ctx, q, 'month'); const today = await this.period(ctx, { preset: 'today' });
    const s = (await sql<any>`select count(*) filter (where s.status <> 'archived')::int as catalog, count(*) filter (where s.status = 'active')::int as active,
        count(*) filter (where s.status = 'inactive')::int as inactive,
        count(*) filter (where s.status = 'active' and s.online_booking_enabled)::int as online,
        count(*) filter (where s.status = 'active' and s.price_cents > 0)::int as priced,
        coalesce(sum(s.price_cents) filter (where s.status = 'active' and s.price_cents > 0), 0)::bigint as priced_sum
      from services s where s.tenant_id = ${T} and ${this.branch(ctx, 's')}`.execute(this.db)).rows[0];
    const prod = (await sql<any>`select count(*) filter (where coalesce(p.active, true) and p.archived_at is null)::int as active, count(*)::int as all_products
      from inventory_products p where p.tenant_id = ${T}`.execute(this.db)).rows[0];
    const retail = (await sql<any>`select coalesce(sum(l.line_total_cents), 0)::bigint as cents, coalesce(sum(coalesce(l.quantity, 1)), 0)::int as items, count(distinct t.id)::int as tickets
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.removed_at is null and lower(coalesce(l.line_kind, '')) = 'retail' and ${this.paid(ctx)} and ${this.inP(sql`t.paid_at`, today)}`.execute(this.db)).rows[0];
    const cat = (await sql<any>`select coalesce(nullif(l.category_snapshot, ''), 'Uncategorized') as name, sum(l.line_total_cents)::bigint as cents
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.removed_at is null and not coalesce(l.is_add_on, false) and lower(coalesce(l.line_kind, 'service')) = 'service' and ${this.paid(ctx)} and ${this.inP(sql`t.paid_at`, per)}
      group by 1 order by 2 desc, 1 asc limit 1`.execute(this.db)).rows[0];
    const menuCat = cat ? null : (await sql<any>`select c.name, sum(s.price_cents)::bigint as cents from services s join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.status = 'active' and ${this.branch(ctx, 's')} group by c.name order by 2 desc, 1 asc limit 1`.execute(this.db)).rows[0];
    const bundles = (await sql<any>`select count(*) filter (where status = 'active')::int as active, count(*)::int as total from bundles where tenant_id = ${T} and archived_at is null`.execute(this.db)).rows[0];
    const conv = await this.addOnConversion(ctx, per);
    return {
      period: per,
      kpis: {
        totalServices: N(s?.catalog), activeServices: N(s?.active), inactiveServices: N(s?.inactive),
        activeProducts: N(prod?.active), allProducts: N(prod?.all_products),
        onlineBookable: N(s?.online), onlinePctOfActive: N(s?.active) ? Math.round((N(s?.online) / N(s?.active)) * 100) : null,
        avgServicePriceCents: N(s?.priced) ? Math.round(N(s?.priced_sum) / N(s?.priced)) : null, pricedServices: N(s?.priced),
        retailRevenueTodayCents: N(retail?.cents), retailItemsToday: N(retail?.items), retailTicketsToday: N(retail?.tickets),
        // service cost is not recorded anywhere (no labour or material cost per service), so a margin would be invented
        serviceMixMargin: null as number | null, serviceMixMarginReason: 'no_service_cost',
        topCategory: cat ? String(cat.name) : menuCat ? String(menuCat.name) : null, topCategoryBasis: cat ? 'realized' : menuCat ? 'menu' : null,
        topCategoryCents: cat ? N(cat.cents) : menuCat ? N(menuCat.cents) : null,
        // bundle SALES are not recorded as their own ticket lines, so only the active bundle count is real
        packageSales: null as number | null, activeBundles: N(bundles?.active), totalBundles: N(bundles?.total),
        addOnConversionPct: conv.pct, addOnTickets: conv.withAddOn, serviceTickets: conv.serviceTickets,
      },
    };
  }
  private async addOnConversion(ctx: CatCtx, per: CPeriod) {
    const r = (await sql<any>`select count(distinct t.id) filter (where exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null
          and not coalesce(l.is_add_on, false) and lower(coalesce(l.line_kind, 'service')) = 'service'))::int as service_tickets,
        count(distinct t.id) filter (where exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null
          and not coalesce(l.is_add_on, false) and lower(coalesce(l.line_kind, 'service')) = 'service')
          and exists (select 1 from ticket_service_lines l where l.tenant_id = t.tenant_id and l.ticket_id = t.id and l.removed_at is null
          and (coalesce(l.is_add_on, false) or lower(coalesce(l.line_kind, '')) = 'add_on')))::int as with_add_on
      from tickets t where ${this.paid(ctx)} and ${this.inP(sql`t.paid_at`, per)}`.execute(this.db)).rows[0];
    const serviceTickets = N(r?.service_tickets), withAddOn = N(r?.with_add_on);
    return { serviceTickets, withAddOn, pct: serviceTickets ? Math.round((withAddOn / serviceTickets) * 1000) / 10 : null };
  }

  /** The four Top Services & Product Mix tiles over the period — realized line totals on paid tickets. */
  async charts(ctx: CatCtx, q: { preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId; const per = await this.period(ctx, q, 'month');
    const base = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.removed_at is null and ${this.paid(ctx)} and ${this.inP(sql`t.paid_at`, per)}`;
    const svc = (await sql<any>`select coalesce(nullif(l.service_name_snapshot, ''), 'Service') as label, sum(l.line_total_cents)::bigint as cents, count(*)::int as lines
      ${base} and not coalesce(l.is_add_on, false) and lower(coalesce(l.line_kind, 'service')) = 'service' group by 1 order by 2 desc, 1 asc limit 8`.execute(this.db)).rows;
    const retail = (await sql<any>`select coalesce(nullif(l.service_name_snapshot, ''), 'Product') as label, sum(l.line_total_cents)::bigint as cents, sum(coalesce(l.quantity, 1))::int as lines
      ${base} and lower(coalesce(l.line_kind, '')) = 'retail' group by 1 order by 2 desc, 1 asc limit 8`.execute(this.db)).rows;
    const cats = (await sql<any>`select coalesce(nullif(l.category_snapshot, ''), 'Uncategorized') as label, sum(l.line_total_cents)::bigint as cents, count(*)::int as lines
      ${base} and not coalesce(l.is_add_on, false) and lower(coalesce(l.line_kind, 'service')) = 'service' group by 1 order by 2 desc, 1 asc limit 8`.execute(this.db)).rows;
    const conv = await this.addOnConversion(ctx, per);
    const map = (rows: any[]) => rows.map((r) => ({ label: String(r.label), cents: N(r.cents), count: N(r.lines) }));
    return { period: per, basis: 'paid_ticket_lines_before_refunds', serviceMix: map(svc), retailMix: map(retail), categoryRevenue: map(cats), addOnConversion: conv };
  }

  // ── services list (Service Menu · Service Pricing) ─────────────────────────────────────────────────────────────────
  private serviceSearch(raw0: string) {
    const raw = raw0.trim().slice(0, 100);
    if (!raw) return { where: sql`true`, via: sql`null::text`, rank: sql`null::int` };
    const l = like(raw); const cents = moneyOf(raw); const mins = minutesOf(raw); const isId = UUID.test(raw);
    return {
      where: sql`(s.name ilike ${l} or coalesce(s.description, '') ilike ${l} or coalesce(c.name, '') ilike ${l} or (${isId} and s.id::text = ${raw.toLowerCase()})
        or (${cents}::int is not null and s.price_cents = ${cents}) or (${mins}::int is not null and s.duration_minutes = ${mins}))`,
      via: sql`case when ${isId} and s.id::text = ${raw.toLowerCase()} then 'id' when lower(s.name) = ${raw.toLowerCase()} then 'name_exact' when s.name ilike ${l} then 'name'
        when coalesce(c.name, '') ilike ${l} then 'category' when ${cents}::int is not null and s.price_cents = ${cents} then 'price'
        when ${mins}::int is not null and s.duration_minutes = ${mins} then 'duration' else 'description' end`,
      rank: sql`case when ${isId} and s.id::text = ${raw.toLowerCase()} then 0 when lower(s.name) = ${raw.toLowerCase()} then 1 when s.name ilike ${raw + '%'} then 2 else 3 end`,
    };
  }
  async services(ctx: CatCtx, f: { q?: string; technician?: string; categoryId?: string; status?: string; online?: string; minPrice?: unknown; maxPrice?: unknown; minDuration?: unknown; maxDuration?: unknown;
    dateField?: string; sort?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const status = (SERVICE_STATUSES as readonly string[]).includes(String(f.status)) ? String(f.status) : 'catalog';
    const sort = SERVICE_ORDER[String(f.sort)] ? String(f.sort) : 'newest';
    const cat = f.categoryId === 'none' ? 'none' : f.categoryId && UUID.test(f.categoryId) ? f.categoryId : null;
    const int = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
    const s0 = this.serviceSearch(String(f.q ?? ''));
    const col = f.dateField === 'updated' ? sql`s.updated_at` : sql`s.created_at`;
    // the technician scope of the Services & Products search: services an active, qualified technician of that name performs
    const tech = String(f.technician ?? '').trim().slice(0, 100);
    const techW = tech ? sql`exists (select 1 from technician_services ts2 join technicians te2 on te2.id = ts2.technician_id and te2.tenant_id = ts2.tenant_id
        where ts2.tenant_id = s.tenant_id and ts2.service_id = s.id and coalesce(te2.is_active, true) and te2.archived_at is null
          and (coalesce(te2.full_name, '') ilike ${like(tech)} or trim(coalesce(te2.first_name, '') || ' ' || coalesce(te2.last_name, '')) ilike ${like(tech)}))` : sql`true`;
    const w = sql`s.tenant_id = ${T} and ${this.branch(ctx, 's')} and ${s0.where} and ${techW} and ${this.inP(col, per)}
      and (${status} <> 'catalog' or s.status <> 'archived') and (${status} in ('catalog', 'all') or s.status = ${status})
      and (${cat}::text is null or (${cat} = 'none' and (s.category_id is null or c.id is null)) or s.category_id::text = ${cat})
      and (${f.online === 'true'} = false or s.online_booking_enabled) and (${f.online === 'false'} = false or not coalesce(s.online_booking_enabled, false))
      and (${int(f.minPrice)}::int is null or s.price_cents >= ${int(f.minPrice)}) and (${int(f.maxPrice)}::int is null or s.price_cents <= ${int(f.maxPrice)})
      and (${int(f.minDuration)}::int is null or s.duration_minutes >= ${int(f.minDuration)}) and (${int(f.maxDuration)}::int is null or s.duration_minutes <= ${int(f.maxDuration)})`;
    const from = sql`from services s left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const agg = (await sql<any>`select count(*) filter (where s.status = 'active' and s.price_cents > 0)::int as priced, coalesce(sum(s.price_cents) filter (where s.status = 'active' and s.price_cents > 0), 0)::bigint as total,
        min(s.price_cents) filter (where s.status = 'active' and s.price_cents > 0) as lo, max(s.price_cents) filter (where s.status = 'active' and s.price_cents > 0) as hi ${from} where ${w}`.execute(this.db)).rows[0];
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select s.id, s.name, s.description, s.category_id, c.name as category_name, c.status as category_status, s.price_cents, s.duration_minutes, s.commission_type, s.commission_value,
        s.online_booking_enabled, s.ai_booking_enabled, s.is_taxable, s.status, s.branch_id, b.name as branch_name, s.created_at, s.updated_at, ${s0.via} as matched_via,
        (select count(*) from service_add_ons ao where ao.tenant_id = s.tenant_id and ao.service_id = s.id and ao.is_active)::int as add_ons,
        (select count(*) from technician_services ts join technicians te on te.id = ts.technician_id and te.tenant_id = ts.tenant_id
          where ts.tenant_id = s.tenant_id and ts.service_id = s.id and coalesce(te.is_active, true) and te.archived_at is null)::int as qualified,
        (select count(*) from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = s.tenant_id and l.service_id = s.id
          and l.removed_at is null and t.paid_at >= now() - interval '30 days' and t.paid_at is not null)::int as sold_30d
      ${from} where ${w} order by ${s0.rank} nulls last, ${SERVICE_ORDER[sort]} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, status, sort, items: rows.map((r: any) => this.serviceRow(r)),
      stats: { pricedServices: N(agg?.priced), averagePriceCents: N(agg?.priced) ? Math.round(N(agg?.total) / N(agg?.priced)) : null, lowestPriceCents: agg?.lo == null ? null : N(agg.lo), highestPriceCents: agg?.hi == null ? null : N(agg.hi), priceSumCents: N(agg?.total) },
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  private serviceRow(r: any) {
    return { serviceId: String(r.id), name: String(r.name), description: r.description ?? null, categoryId: r.category_id ? String(r.category_id) : null, categoryName: r.category_name ?? null,
      categoryArchived: r.category_status === 'archived', isAddOnService: isAddOnCategory(r.category_name ?? ''), priceCents: N(r.price_cents), durationMinutes: N(r.duration_minutes),
      commissionType: r.commission_type ?? null, commissionValue: r.commission_value == null ? null : Number(r.commission_value), onlineBookable: !!r.online_booking_enabled, aiBookable: !!r.ai_booking_enabled, taxable: r.is_taxable !== false,
      status: String(r.status ?? 'active'), branchId: r.branch_id ? String(r.branch_id) : null, branchName: r.branch_name ?? null, addOns: N(r.add_ons), qualifiedTechnicians: N(r.qualified),
      sold30d: N(r.sold_30d), matchedVia: r.matched_via ?? null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
  }

  /** Service Detail: the record, its add-ons (offerings + the Add-ons category), qualified technicians, where it is offered
   *  (the real branch model), recent realized sales and the change history count. */
  async serviceDetail(ctx: CatCtx, serviceId: string) {
    const T = ctx.tenantId; if (!UUID.test(String(serviceId))) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    await this.applyDueSchedules(T, serviceId);   // D4 gaps: a schedule already due shows as the current price (the job may not have run yet)
    const r = (await sql<any>`select s.id, s.name, s.description, s.category_id, c.name as category_name, c.status as category_status, s.price_cents, s.duration_minutes, s.commission_type, s.commission_value,
        s.online_booking_enabled, s.ai_booking_enabled, s.status, s.branch_id, b.name as branch_name, s.created_at, s.updated_at, null::text as matched_via, 0 as add_ons, 0 as qualified, 0 as sold_30d
      from services s left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id left join branches b on b.id = s.branch_id and b.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.id = ${serviceId} and ${this.branch(ctx, 's')}`.execute(this.db)).rows[0];
    if (!r) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    const addOns = (await sql<any>`select a.add_on_key, a.name, a.price_cents, a.duration_delta_minutes, a.is_taxable, a.is_active from service_add_ons a where a.tenant_id = ${T} and a.service_id = ${serviceId} order by a.sort_order, a.name, a.id`.execute(this.db)).rows;
    const catAddOns = isAddOnCategory(r.category_name ?? '') ? [] : (await sql<any>`select s.id, s.name, s.price_cents, s.duration_minutes, s.status, c.name as category_name from services s join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.id <> ${serviceId} and s.status <> 'archived' and s.branch_id = ${r.branch_id} order by s.name, s.id`.execute(this.db)).rows.filter((x: any) => isAddOnCategory(x.category_name));
    const techs = (await sql<any>`select te.id, coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as name, te.status, te.branch_id, ts.proficiency, ts.is_primary
      from technician_services ts join technicians te on te.id = ts.technician_id and te.tenant_id = ts.tenant_id
      where ts.tenant_id = ${T} and ts.service_id = ${serviceId} and coalesce(te.is_active, true) and te.archived_at is null order by ts.is_primary desc, 2 asc, te.id`.execute(this.db)).rows;
    // the branch model as the database has it: every branch keeps its OWN service rows (services.branch_id is required), so
    // "this service at another branch" is the row with the same name there — its own price, duration and status. Read-only
    // here: a branch's row is changed from that branch.
    const branches = (await sql<any>`select b.id, b.name, b.status, x.id as service_id, x.price_cents, x.duration_minutes, x.status as service_status, x.online_booking_enabled
      from branches b left join lateral (select s2.id, s2.price_cents, s2.duration_minutes, s2.status, s2.online_booking_enabled from services s2
        where s2.tenant_id = b.tenant_id and s2.branch_id = b.id and lower(s2.name) = lower(${String(r.name)}) order by (s2.status = 'archived'), s2.created_at, s2.id limit 1) x on true
      where b.tenant_id = ${T} order by b.created_at, b.id`.execute(this.db)).rows;
    const sales = (await sql<any>`select count(*)::int as lines, coalesce(sum(l.line_total_cents), 0)::bigint as cents, max(t.paid_at) as last_at,
        (select l2.price_cents_snapshot from ticket_service_lines l2 join tickets t2 on t2.id = l2.ticket_id and t2.tenant_id = l2.tenant_id where l2.tenant_id = ${T} and l2.service_id = ${serviceId} and l2.removed_at is null and t2.paid_at is not null order by t2.paid_at desc, l2.id desc limit 1) as last_charged
      from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id where l.tenant_id = ${T} and l.service_id = ${serviceId} and l.removed_at is null and t.paid_at is not null and t.paid_at >= now() - interval '90 days'`.execute(this.db)).rows[0];
    const changes = N((await sql<any>`select count(*)::int as n from catalog_change_log where tenant_id = ${T} and (service_id = ${serviceId} or (entity_type = 'service' and entity_id = ${serviceId}))`.execute(this.db)).rows[0]?.n);
    const row = this.serviceRow(r);
    return {
      ...row, addOns: addOns.map((a: any) => ({ key: String(a.add_on_key), name: String(a.name), priceCents: N(a.price_cents), durationMinutes: N(a.duration_delta_minutes), taxable: !!a.is_taxable, active: !!a.is_active, source: 'offering' })),
      categoryAddOns: catAddOns.map((a: any) => ({ serviceId: String(a.id), name: String(a.name), priceCents: N(a.price_cents), durationMinutes: N(a.duration_minutes), active: a.status === 'active', source: 'category' })),
      technicians: techs.map((t: any) => ({ technicianId: String(t.id), name: String(t.name || ''), status: t.status ?? null, branchId: t.branch_id ? String(t.branch_id) : null, proficiency: t.proficiency ?? null, primary: !!t.is_primary })),
      branches: branches.map((b: any) => ({ branchId: String(b.id), name: String(b.name), branchActive: (b.status ?? 'active') === 'active', current: String(b.id) === String(r.branch_id),
        serviceId: b.service_id ? String(b.service_id) : null, offered: !!b.service_id && b.service_status !== 'archived', status: b.service_status ?? null,
        priceCents: b.service_id ? N(b.price_cents) : null, durationMinutes: b.service_id ? N(b.duration_minutes) : null, onlineBookable: b.service_id ? !!b.online_booking_enabled : null,
        differsFromThis: !!b.service_id && (N(b.price_cents) !== row.priceCents || N(b.duration_minutes) !== row.durationMinutes || b.service_status !== row.status) })),
      branchMatch: 'service_name',
      sales90d: { lines: N(sales?.lines), cents: N(sales?.cents), lastAt: iso(sales?.last_at), lastChargedCents: sales?.last_charged == null ? null : N(sales.last_charged) },
      changeCount: changes,
      ...(await this.scheduledFor(ctx, serviceId)),   // D4 gaps (Nov 5 2026): the scheduled (not yet current) change, if any
    };
  }

  // ── change history (Service Pricing · Service Detail · Category · Add-On) ───────────────────────────────────────────
  async history(ctx: CatCtx, f: { serviceId?: string; categoryId?: string; addOnKey?: string; field?: string; q?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const field = (HISTORY_FIELDS as readonly string[]).includes(String(f.field)) ? String(f.field) : 'all';
    const sid = f.serviceId && UUID.test(f.serviceId) ? f.serviceId : null; const cid = f.categoryId && UUID.test(f.categoryId) ? f.categoryId : null;
    const key = f.addOnKey && /^[A-Za-z0-9_-]{1,64}$/.test(f.addOnKey) ? f.addOnKey : null;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const cents = moneyOf(raw);
    const fw = field === 'price' ? sql`h.field = 'price_cents'` : field === 'duration' ? sql`h.field = 'duration_minutes'` : field === 'pricing' ? sql`h.field in ('price_cents', 'duration_minutes')` : sql`true`;
    // D3 (Nov 3 2026): a location user sees the history of this location's services / categories (and salon-wide ones) —
    // it showed every location's changes
    const w = sql`h.tenant_id = ${T} and ${fw} and ${this.inP(sql`h.changed_at`, per)} and ${this.branch(ctx, 's')} and ${this.branch(ctx, 'c')}
      and (${sid}::uuid is null or h.service_id = ${sid} or (h.entity_type = 'service' and h.entity_id = ${sid ?? ''}))
      and (${cid}::uuid is null or (h.entity_type = 'category' and h.entity_id = ${cid ?? ''}) or (h.field = 'category_id' and (h.old_value = ${cid ?? ''} or h.new_value = ${cid ?? ''})))
      and (${key}::text is null or (h.entity_type = 'add_on' and h.entity_id = ${key ?? ''}))
      and (${raw} = '' or coalesce(s.name, '') ilike ${l} or coalesce(c.name, '') ilike ${l} or coalesce(u.full_name, '') ilike ${l} or coalesce(h.reason, '') ilike ${l}
        or (${cents}::int is not null and (h.old_value = ${String(cents ?? '')} or h.new_value = ${String(cents ?? '')})))`;
    const from = sql`from catalog_change_log h left join services s on s.id = h.service_id and s.tenant_id = h.tenant_id
      left join service_categories c on h.entity_type = 'category' and c.id::text = h.entity_id and c.tenant_id = h.tenant_id left join users u on u.id = h.actor_user_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select h.id, h.entity_type, h.entity_id, h.service_id, s.name as service_name, c.name as category_name, h.field, h.old_value, h.new_value, h.reason, h.source,
        h.changed_at, h.effective_at, coalesce(nullif(u.full_name, ''), u.email) as actor ${from} where ${w} order by h.changed_at desc, h.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    // a category id in a category_id change is shown as its name
    const ids = [...new Set(rows.filter((r: any) => r.field === 'category_id').flatMap((r: any) => [r.old_value, r.new_value]).filter((x: any) => x && UUID.test(x)))];
    const names = ids.length ? Object.fromEntries((await sql<any>`select id::text as id, name from service_categories where tenant_id = ${T} and id::text in (${sql.join(ids.map((x) => sql`${x}`))})`.execute(this.db)).rows.map((r: any) => [r.id, r.name])) : {};
    return { period: per, field, items: rows.map((r: any) => ({ id: String(r.id), entityType: String(r.entity_type), entityId: String(r.entity_id), serviceId: r.service_id ? String(r.service_id) : null,
      serviceName: r.service_name ?? null, categoryName: r.category_name ?? null, field: String(r.field),
      oldValue: r.field === 'category_id' ? (names[r.old_value] ?? r.old_value) : r.old_value, newValue: r.field === 'category_id' ? (names[r.new_value] ?? r.new_value) : r.new_value,
      reason: r.reason ?? null, source: String(r.source), changedAt: iso(r.changed_at), effectiveAt: iso(r.effective_at), actor: r.actor ?? null })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** Edit Pricing: price and / or duration with a reason, refused when someone else saved the service since it was opened
   *  (expectedUpdatedAt). Immediate only — scheduled (future-effective) prices are not modelled, so none is accepted. */
  async updatePricing(ctx: CatCtx, serviceId: string, b: { priceCents?: unknown; durationMinutes?: unknown; reason?: unknown; expectedUpdatedAt?: unknown }, source = 'pricing_editor') {
    const T = ctx.tenantId; if (!UUID.test(String(serviceId))) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason) throw err(400, 'CHANGE_REASON_REQUIRED', 'Say why the price or duration is changing.');
    const price = b.priceCents === undefined || b.priceCents === null ? null : Number(b.priceCents);
    const dur = b.durationMinutes === undefined || b.durationMinutes === null ? null : Number(b.durationMinutes);
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10_000_000)) throw err(400, 'PRICE_INVALID', 'Price must be 0 or greater');
    if (dur !== null && (!Number.isInteger(dur) || dur <= 0 || dur > 1440)) throw err(400, 'DURATION_INVALID', 'Duration must be greater than 0');
    return this.db.transaction().execute(async (trx) => {
      const cur = (await sql<any>`select s.id, s.price_cents, s.duration_minutes, s.branch_id, s.updated_at from services s where s.tenant_id = ${T} and s.id = ${serviceId} and ${this.branch(ctx, 's')} for update`.execute(trx)).rows[0];
      if (!cur) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
      if (b.expectedUpdatedAt && iso(cur.updated_at) !== String(b.expectedUpdatedAt)) throw err(409, 'CATALOG_EDIT_CONFLICT', 'Someone else changed this service since you opened it. Reload it and try again.', { currentUpdatedAt: iso(cur.updated_at) });
      const changes: CatalogChange[] = diffFields('service', serviceId, { price_cents: N(cur.price_cents), duration_minutes: N(cur.duration_minutes) },
        { price_cents: price ?? undefined, duration_minutes: dur ?? undefined }, { serviceId, reason, source });
      if (!changes.length) return { changed: 0, updatedAt: iso(cur.updated_at) };
      const upd = (await sql<any>`update services set price_cents = coalesce(${price}::int, price_cents), duration_minutes = coalesce(${dur}::int, duration_minutes), updated_at = now(),
          updated_by = ${UUID.test(ctx.userId) ? ctx.userId : null} where tenant_id = ${T} and id = ${serviceId} returning updated_at`.execute(trx)).rows[0];
      await recordCatalogChanges(trx, ctx, changes);
      return { changed: changes.length, updatedAt: iso(upd?.updated_at) };
    });
  }

  /** D4 gaps (Nov 5 2026): schedule a price / duration change for a future time (at least 5 minutes ahead, at most a year).
   *  One open schedule per service — cancel it to schedule another. Not the current price until it takes effect. */
  async schedulePricing(ctx: CatCtx, serviceId: string, b: { priceCents?: unknown; durationMinutes?: unknown; effectiveAt?: unknown; reason?: unknown }) {
    const T = ctx.tenantId; if (!UUID.test(String(serviceId))) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (!reason) throw err(400, 'CHANGE_REASON_REQUIRED', 'Say why the price or duration is changing.');
    const price = b.priceCents === undefined || b.priceCents === null ? null : Number(b.priceCents);
    const dur = b.durationMinutes === undefined || b.durationMinutes === null ? null : Number(b.durationMinutes);
    if (price === null && dur === null) throw err(400, 'PRICE_INVALID', 'Price must be 0 or greater');
    if (price !== null && (!Number.isInteger(price) || price < 0 || price > 10_000_000)) throw err(400, 'PRICE_INVALID', 'Price must be 0 or greater');
    if (dur !== null && (!Number.isInteger(dur) || dur <= 0 || dur > 1440)) throw err(400, 'DURATION_INVALID', 'Duration must be greater than 0');
    const at = typeof b.effectiveAt === 'string' ? Date.parse(b.effectiveAt) : NaN;
    if (!Number.isFinite(at) || at < Date.now() + 5 * 60_000 || at > Date.now() + 366 * 86_400_000) throw err(400, 'PRICE_EFFECTIVE_DATE_INVALID', 'Choose a time from 5 minutes to one year ahead.');
    const svc = (await sql<any>`select s.id, s.branch_id, s.status from services s where s.tenant_id = ${T} and s.id = ${serviceId} and ${this.branch(ctx, 's')}`.execute(this.db)).rows[0];
    if (!svc || svc.status === 'archived') throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    try {
      const r = (await sql<any>`insert into service_price_schedules (tenant_id, branch_id, service_id, price_cents, duration_minutes, effective_at, reason, created_by_user_id)
        values (${T}, ${svc.branch_id ?? null}, ${serviceId}, ${price}, ${dur}, ${new Date(at).toISOString()}::timestamptz, ${reason}, ${UUID.test(ctx.userId) ? ctx.userId : null}) returning id`.execute(this.db)).rows[0];
      return { scheduleId: String(r.id), ...(await this.scheduledFor(ctx, serviceId)) };
    } catch (e) {
      if (String((e as { code?: string })?.code) === '23505') throw err(409, 'PRICE_ALREADY_SCHEDULED', 'This service already has a scheduled change. Cancel it first.');
      throw e;
    }
  }

  /** the open schedule of a service (null when none) */
  async scheduledFor(ctx: CatCtx, serviceId: string) {
    const r = (await sql<any>`select p.id, p.price_cents, p.duration_minutes, p.effective_at, p.reason, p.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor
      from service_price_schedules p left join users u on u.id = p.created_by_user_id and u.tenant_id = p.tenant_id
      where p.tenant_id = ${ctx.tenantId} and p.service_id = ${serviceId} and p.status = 'scheduled'`.execute(this.db)).rows[0];
    return { scheduled: r ? { id: String(r.id), priceCents: r.price_cents == null ? null : N(r.price_cents), durationMinutes: r.duration_minutes == null ? null : N(r.duration_minutes),
      effectiveAt: iso(r.effective_at), reason: r.reason ?? null, createdAt: iso(r.created_at), createdBy: r.actor ?? null } : null };
  }

  /** cancel a service's open schedule (with a reason) — once */
  async cancelScheduledPricing(ctx: CatCtx, serviceId: string, b: { scheduleId?: unknown; reason?: unknown }) {
    const T = ctx.tenantId; const sid = String(b.scheduleId ?? '');
    if (!UUID.test(String(serviceId)) || !UUID.test(sid)) throw err(404, 'PRICE_SCHEDULE_NOT_FOUND', 'That scheduled change was not found');
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : '';
    if (!reason) throw err(400, 'CHANGE_REASON_REQUIRED', 'Say why the price or duration is changing.');
    const svc = (await sql<any>`select s.id from services s where s.tenant_id = ${T} and s.id = ${serviceId} and ${this.branch(ctx, 's')}`.execute(this.db)).rows[0];
    if (!svc) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    const moved = await this.db.transaction().execute((trx) => transitionStatus(trx, SERVICE_PRICE_SCHEDULE, { where: { id: sid, tenant_id: T, service_id: serviceId }, from: ['scheduled'], to: 'cancelled',
      set: { cancelled_at: sql`now()`, cancelled_by_user_id: UUID.test(ctx.userId) ? ctx.userId : null, cancel_reason: reason } }).catch((e: unknown) => {
        if ((e as Error)?.name === 'InvalidStateTransitionError') throw err(409, 'PRICE_SCHEDULE_NOT_OPEN', 'That scheduled change already took effect or was cancelled.');
        throw e;
      }));
    if (!moved) throw err(404, 'PRICE_SCHEDULE_NOT_FOUND', 'That scheduled change was not found');
    return this.scheduledFor(ctx, serviceId);
  }

  /** the job (and a read of the service) applies every DUE schedule: scheduled → applied once (a conditional move, so two
   *  processes never apply it twice), the service's price / duration set, the change log written with the scheduled time as
   *  its effective time and the scheduler as the actor. A service archived meanwhile is 'superseded' (nothing changes). */
  async applyDueSchedules(tenantId: string | null = null, serviceId: string | null = null, limit = 200): Promise<number> {
    const due = (await sql<any>`select id, tenant_id, branch_id, service_id, price_cents, duration_minutes, effective_at, reason, created_by_user_id from service_price_schedules
      where status = 'scheduled' and effective_at <= now() and (${tenantId}::uuid is null or tenant_id = ${tenantId}) and (${serviceId}::uuid is null or service_id = ${serviceId})
      order by effective_at limit ${limit}`.execute(this.db)).rows;
    let applied = 0;
    for (const p of due) {
      await this.db.transaction().execute(async (trx) => {
        const cur = (await sql<any>`select id, price_cents, duration_minutes, status from services where tenant_id = ${p.tenant_id} and id = ${p.service_id} for update`.execute(trx)).rows[0];
        const live = !!cur && cur.status !== 'archived';
        const moved = await transitionStatus(trx, SERVICE_PRICE_SCHEDULE, { where: { id: p.id, tenant_id: p.tenant_id }, from: ['scheduled'], to: live ? 'applied' : 'superseded', set: { applied_at: sql`now()` } });
        if (!moved || !live) return;
        const changes = diffFields('service', String(p.service_id), { price_cents: N(cur.price_cents), duration_minutes: N(cur.duration_minutes) },
          { price_cents: p.price_cents == null ? undefined : N(p.price_cents), duration_minutes: p.duration_minutes == null ? undefined : N(p.duration_minutes) },
          { serviceId: String(p.service_id), reason: String(p.reason ?? ''), source: 'scheduled_price', effectiveAt: iso(p.effective_at) });
        if (!changes.length) return;
        await sql`update services set price_cents = coalesce(${p.price_cents}::int, price_cents), duration_minutes = coalesce(${p.duration_minutes}::int, duration_minutes), updated_at = now(),
            updated_by = ${p.created_by_user_id ?? null} where tenant_id = ${p.tenant_id} and id = ${p.service_id}`.execute(trx);
        await recordCatalogChanges(trx, { tenantId: String(p.tenant_id), branchId: p.branch_id ?? null, userId: p.created_by_user_id ?? null }, changes);
        applied += 1;
      });
    }
    return applied;
  }

  /** D4 gaps (Nov 5 2026): before a price / duration change, the upcoming bookings of this service and what they were quoted.
   *  Read only — a change never reprices a booked appointment (its quoted snapshot stays); this shows who is affected. */
  async pricingImpact(ctx: CatCtx, serviceId: string, q: { priceCents?: unknown; durationMinutes?: unknown }) {
    const T = ctx.tenantId; if (!UUID.test(String(serviceId))) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    const svc = (await sql<any>`select s.id, s.price_cents, s.duration_minutes from services s where s.tenant_id = ${T} and s.id = ${serviceId} and ${this.branch(ctx, 's')}`.execute(this.db)).rows[0];
    if (!svc) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
    const newPrice = q.priceCents === undefined || q.priceCents === '' ? N(svc.price_cents) : Number(q.priceCents);
    const newDur = q.durationMinutes === undefined || q.durationMinutes === '' ? N(svc.duration_minutes) : Number(q.durationMinutes);
    if (!Number.isInteger(newPrice) || newPrice < 0) throw err(400, 'PRICE_INVALID', 'Price must be 0 or greater');
    if (!Number.isInteger(newDur) || newDur <= 0) throw err(400, 'DURATION_INVALID', 'Duration must be greater than 0');
    const b = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    // appointments live in pos_tech_appointments (the only appointment store); each booked service is an element of its
    // `services` JSON with the price and minutes quoted at booking. Upcoming = from the salon's today, not finished.
    const tz = await tenantTimeZone(this.db, T);
    const w = sql`a.tenant_id = ${T} and e->>'serviceId' = ${serviceId} and a.appt_date >= (now() at time zone ${tz})::date
      and a.status not in ('cancelled', 'no_show', 'completed') and (${b}::uuid is null or a.branch_id = ${b} or a.branch_id is null)`;
    const from = sql`from pos_tech_appointments a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.services) = 'array' then a.services else '[]'::jsonb end) e`;
    const qp = sql`coalesce(nullif(e->>'priceCents', '')::int, 0)`, qm = sql`coalesce(nullif(e->>'durationMinutes', '')::int, 0)`;
    const agg = (await sql<any>`select count(*)::int as n, coalesce(sum(${qp}), 0)::bigint as quoted, count(*) filter (where ${qp} <> ${newPrice})::int as differs,
        count(*) filter (where ${newDur} > ${qm})::int as longer ${from} where ${w}`.execute(this.db)).rows[0] ?? {};
    const showCust = (ctx.permissions ?? []).some((p) => p === '*' || p === 'customers.view');
    const rows = (await sql<any>`select a.id, to_char(a.appt_date, 'YYYY-MM-DD') as day, a.start_time, a.status, a.customer_name, ${qp} as quoted, ${qm} as minutes ${from} where ${w} order by a.appt_date, a.start_time, a.id limit 20`.execute(this.db)).rows;
    return { serviceId, currentPriceCents: N(svc.price_cents), currentDurationMinutes: N(svc.duration_minutes), newPriceCents: newPrice, newDurationMinutes: newDur,
      upcoming: N(agg.n), quotedTotalCents: N(agg.quoted), atNewPriceTotalCents: N(agg.n) * newPrice, quotedDifferently: N(agg.differs), wouldRunLonger: N(agg.longer),
      policy: 'booked_quotes_kept',
      items: rows.map((r: any) => ({ appointmentId: String(r.id), day: String(r.day), time: String(r.start_time), status: String(r.status), customer: showCust ? r.customer_name ?? null : null,
        quotedCents: N(r.quoted), bookedMinutes: N(r.minutes) })) };
  }

  /** D4 gaps (Nov 5 2026): revert a price / duration change — a NEW revision back to that change's old value (the history
   *  rows are never deleted), with a reason, refused when the service changed since it was opened (expectedUpdatedAt). */
  async revertPricing(ctx: CatCtx, serviceId: string, b: { historyId?: unknown; reason?: unknown; expectedUpdatedAt?: unknown }) {
    const T = ctx.tenantId; const hid = String(b.historyId ?? '');
    if (!UUID.test(String(serviceId)) || !/^[0-9a-f-]{36}$|^\d+$/i.test(hid)) throw err(404, 'CATALOG_CHANGE_NOT_FOUND', 'That change was not found');
    const h = (await sql<any>`select field, old_value, changed_at from catalog_change_log where tenant_id = ${T} and id::text = ${hid} and service_id = ${serviceId}
        and field in ('price_cents', 'duration_minutes')`.execute(this.db)).rows[0];
    if (!h) throw err(404, 'CATALOG_CHANGE_NOT_FOUND', 'That change was not found');
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!reason) throw err(400, 'CHANGE_REASON_REQUIRED', 'Say why the price or duration is changing.');
    const old = Number(h.old_value);
    const label = `Revert of the ${String(iso(h.changed_at) ?? '').slice(0, 10)} change: ${reason}`.slice(0, 500);
    return this.updatePricing(ctx, serviceId, { ...(h.field === 'price_cents' ? { priceCents: old } : { durationMinutes: old }), reason: label, expectedUpdatedAt: b.expectedUpdatedAt }, 'pricing_revert');
  }

  // ── customer service history (phone / name / ticket → what was actually charged) ───────────────────────────────────
  async customerHistory(ctx: CatCtx, f: { q?: string; kind?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const raw = String(f.q ?? '').trim().slice(0, 100); const { d, phoneish } = phoneDigits(raw); const ticketNo = /^#?\d{1,9}$/.test(raw) ? raw.replace('#', '') : null;   // "1042" is a ticket number AND phone digits — search both (it was phone only)
    // never a list of every customer: a name needs 2 letters, a phone 4 digits, a ticket its number
    if (!(raw.length >= 2 && /[a-z]/i.test(raw)) && !phoneish && !ticketNo && !UUID.test(raw)) return { period: per, needsQuery: true, items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
    const kind = f.kind === 'add_on' ? sql`(coalesce(l.is_add_on, false) or lower(coalesce(l.line_kind, '')) = 'add_on')` : f.kind === 'retail' ? sql`lower(coalesce(l.line_kind, '')) = 'retail'` : f.kind === 'service' ? sql`(not coalesce(l.is_add_on, false) and lower(coalesce(l.line_kind, 'service')) = 'service')` : sql`true`;
    const w = sql`l.tenant_id = ${T} and l.removed_at is null and t.removed_at is null and ${kind} and ${this.inP(sql`coalesce(t.paid_at, t.created_at)`, per)} and ${this.tb(ctx)}
      and ((${phoneish} and regexp_replace(coalesce(cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'}) or (${!phoneish && !ticketNo} and (coalesce(cu.full_name, '') ilike ${like(raw)} or coalesce(cu.email, '') ilike ${like(raw)}))
        or (${ticketNo}::text is not null and t.ticket_number::text = ${ticketNo ?? ''}) or (${UUID.test(raw)} and (t.id::text = ${raw.toLowerCase()} or cu.id::text = ${raw.toLowerCase()})))`;
    const from = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join customers cu on cu.id = t.customer_id and cu.tenant_id = t.tenant_id
      left join technicians te on te.id = l.technician_id and te.tenant_id = l.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select l.id, l.ticket_id, t.ticket_number, t.status as ticket_status, t.payment_status, t.paid_at, t.created_at, cu.id as customer_id, cu.full_name, cu.phone_display, cu.normalized_phone,
        l.service_id, l.service_name_snapshot, l.category_snapshot, l.price_cents_snapshot, l.line_total_cents, l.is_add_on, l.line_kind, l.duration_minutes_snapshot,
        coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as technician
      ${from} where ${w} order by coalesce(t.paid_at, t.created_at) desc, l.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, needsQuery: false, items: rows.map((r: any) => ({ lineId: String(r.id), ticketId: String(r.ticket_id), ticketNumber: r.ticket_number == null ? null : String(r.ticket_number),
      paid: !!r.paid_at, at: iso(r.paid_at ?? r.created_at), ticketStatus: r.ticket_status ?? null, customerId: r.customer_id ? String(r.customer_id) : null, customerName: r.full_name ?? null,
      maskedPhone: maskPhone(r.phone_display ?? r.normalized_phone), serviceId: r.service_id && UUID.test(String(r.service_id)) && !/^0{8}-/.test(String(r.service_id)) ? String(r.service_id) : null,
      item: String(r.service_name_snapshot ?? ''), categoryAtSale: r.category_snapshot ?? null, kind: r.is_add_on ? 'add_on' : String(r.line_kind ?? 'service').toLowerCase(),
      catalogPriceAtSaleCents: r.price_cents_snapshot == null ? null : N(r.price_cents_snapshot), chargedCents: N(r.line_total_cents), minutes: r.duration_minutes_snapshot == null ? null : N(r.duration_minutes_snapshot),
      technician: r.technician || null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  // ── Service Categories ─────────────────────────────────────────────────────────────────────────────────────────────
  /** The current snapshot behind the two KPIs, the chart and Breakdown (one aggregate, so they always agree). */
  async categorySummary(ctx: CatCtx) {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select c.id, c.name, c.status, c.color_key, (select count(*) from services s where s.tenant_id = c.tenant_id and s.category_id = c.id and s.status <> 'archived' and ${this.branch(ctx, 's')})::int as services
      from service_categories c where c.tenant_id = ${T} and c.status <> 'archived' and ${this.branch(ctx, 'c')} order by c.sort_order nulls last, lower(c.name), c.id`.execute(this.db)).rows;
    const unassigned = N((await sql<any>`select count(*)::int as n from services s left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.status <> 'archived' and ${this.branch(ctx, 's')} and (s.category_id is null or c.id is null or c.status = 'archived')`.execute(this.db)).rows[0]?.n);
    const totalServices = rows.reduce((a: number, r: any) => a + N(r.services), 0) + unassigned;
    const pct = (n: number) => (totalServices ? Math.round((n / totalServices) * 1000) / 10 : 0);
    return { asOf: new Date().toISOString(), categories: rows.length, totalServices, unassigned,
      breakdown: [...rows.map((r: any) => ({ categoryId: String(r.id), name: String(r.name), colorKey: r.color_key ?? null, services: N(r.services), sharePct: pct(N(r.services)), isAddOnCategory: isAddOnCategory(r.name) })),
        ...(unassigned ? [{ categoryId: null, name: null, colorKey: null, services: unassigned, sharePct: pct(unassigned), isAddOnCategory: false }] : [])],
      review: await this.categoryReview(ctx) };
  }
  /** Things a person should look at — never auto-fixed: a category named like a code (e.g. "CD 4432"), a hair-sounding
   *  service in a nails-sounding category, an empty category. */
  private async categoryReview(ctx: CatCtx) {
    const T = ctx.tenantId;
    const rows = (await sql<any>`select c.id as category_id, c.name as category_name, s.id as service_id, s.name as service_name from service_categories c
      left join services s on s.category_id = c.id and s.tenant_id = c.tenant_id and s.status <> 'archived'
      where c.tenant_id = ${T} and c.status <> 'archived' and ${this.branch(ctx, 'c')} order by lower(c.name), c.id, lower(s.name)`.execute(this.db)).rows;
    const out: Array<{ kind: string; categoryId: string; categoryName: string; serviceId?: string; serviceName?: string }> = [];
    const seen = new Set<string>();
    const HAIR = /\b(hair|haircut|cut|color|colour|blowout|balayage|highlight|perm|keratin)\b/i, NAILS = /\b(nail|nails|mani|manicure|pedi|pedicure|gel|acrylic)\b/i;
    for (const r of rows) {
      const cid = String(r.category_id);
      if (!seen.has(cid)) { seen.add(cid); if (/^[A-Z]{1,4}\s?\d{3,}$/i.test(String(r.category_name).trim())) out.push({ kind: 'code_like_name', categoryId: cid, categoryName: r.category_name }); }
      if (!r.service_id) { if (!rows.some((x: any) => String(x.category_id) === cid && x.service_id)) { if (!out.some((o) => o.kind === 'empty' && o.categoryId === cid)) out.push({ kind: 'empty', categoryId: cid, categoryName: r.category_name }); } continue; }
      if (NAILS.test(r.category_name) && HAIR.test(r.service_name) && !NAILS.test(r.service_name)) out.push({ kind: 'service_category_mismatch', categoryId: cid, categoryName: r.category_name, serviceId: String(r.service_id), serviceName: r.service_name });
    }
    return out;
  }

  async categories(ctx: CatCtx, f: { q?: string; status?: string; dateField?: string; sort?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const status = f.status === 'archived' || f.status === 'all' ? f.status : 'current';
    const sort = CATEGORY_ORDER[String(f.sort)] ? String(f.sort) : 'newest';
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const isId = UUID.test(raw);
    const col = f.dateField === 'updated' ? sql`c.updated_at` : sql`c.created_at`;
    const inner = sql`select c.id, c.name, c.description, c.status, c.color_key, c.sort_order, c.created_at, c.updated_at,
        (select count(*) from services s where s.tenant_id = c.tenant_id and s.category_id = c.id and s.status <> 'archived' and ${this.branch(ctx, 's')})::int as services,
        (select count(*) from services s where s.tenant_id = c.tenant_id and s.category_id = c.id and s.status = 'active' and ${this.branch(ctx, 's')})::int as active_services,
        case when ${raw} = '' then null when ${isId} and c.id::text = ${raw.toLowerCase()} then 'id' when c.name ilike ${l} then 'name' when coalesce(c.description, '') ilike ${l} then 'description' else 'service' end as matched_via,
        case when ${isId} and c.id::text = ${raw.toLowerCase()} then 0 when lower(c.name) = ${raw.toLowerCase()} then 1 when c.name ilike ${l} then 2 else 3 end as rank
      from service_categories c where c.tenant_id = ${T} and ${this.branch(ctx, 'c')} and ${this.inP(col, per)}
        and (${status} <> 'current' or c.status <> 'archived') and (${status} <> 'archived' or c.status = 'archived')
        and (${raw} = '' or c.name ilike ${l} or coalesce(c.description, '') ilike ${l} or (${isId} and c.id::text = ${raw.toLowerCase()})
          or exists (select 1 from services s where s.tenant_id = c.tenant_id and s.category_id = c.id and s.status <> 'archived' and ${this.branch(ctx, 's')} and (s.name ilike ${l} or (${isId} and s.id::text = ${raw.toLowerCase()}))))`;
    const total = N((await sql<any>`select count(*)::int as n from (${inner}) x`.execute(this.db)).rows[0]?.n);
    const all = N((await sql<any>`select count(*)::int as n from services s where s.tenant_id = ${T} and s.status <> 'archived' and ${this.branch(ctx, 's')}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select x.* from (${inner}) x order by ${raw ? sql`x.rank asc, ` : sql``}${CATEGORY_ORDER[sort]} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    // the services a search matched inside each category (so "Gel Manicure" shows WHERE it lives)
    const matched = raw && rows.length ? (await sql<any>`select s.category_id, s.id, s.name from services s where s.tenant_id = ${T} and s.status <> 'archived' and ${this.branch(ctx, 's')} and s.category_id in (${sql.join(rows.map((r: any) => sql`${r.id}`))})
      and (s.name ilike ${l} or (${isId} and s.id::text = ${raw.toLowerCase()})) order by lower(s.name), s.id`.execute(this.db)).rows : [];
    return { period: per, status, sort, totalServices: all, items: rows.map((r: any) => ({ categoryId: String(r.id), name: String(r.name), description: r.description ?? null, status: String(r.status ?? 'active'),
      colorKey: r.color_key ?? null, services: N(r.services), activeServices: N(r.active_services), sharePct: all ? Math.round((N(r.services) / all) * 1000) / 10 : 0, isAddOnCategory: isAddOnCategory(r.name),
      matchedVia: r.matched_via ?? null, matchedServices: matched.filter((m: any) => String(m.category_id) === String(r.id)).slice(0, 5).map((m: any) => ({ serviceId: String(m.id), name: String(m.name) })),
      createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  async categoryDetail(ctx: CatCtx, categoryId: string, f: { page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; if (!UUID.test(String(categoryId))) throw err(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    const c = (await sql<any>`select c.id, c.name, c.description, c.status, c.color_key, c.sort_order, c.created_at, c.updated_at, c.branch_id from service_categories c
      where c.tenant_id = ${T} and c.id = ${categoryId} and ${this.branch(ctx, 'c')}`.execute(this.db)).rows[0];
    if (!c) throw err(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    const svc = await this.services(ctx, { categoryId, status: 'all', sort: 'name', page: f.page, pageSize: f.pageSize ?? 8 });
    return { categoryId: String(c.id), name: String(c.name), description: c.description ?? null, status: String(c.status ?? 'active'), colorKey: c.color_key ?? null, sortOrder: c.sort_order == null ? null : N(c.sort_order),
      isAddOnCategory: isAddOnCategory(c.name), createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), services: svc };
  }

  /** Manage Services: move services into another category. `confirm: false` previews (old → new, each service's price and
   *  duration — unchanged by a move); `confirm: true` moves them in one transaction and writes the history. */
  async reassign(ctx: CatCtx, fromCategoryId: string, b: { serviceIds?: unknown; toCategoryId?: unknown; reason?: unknown; confirm?: unknown }) {
    const T = ctx.tenantId;
    const ids = Array.isArray(b.serviceIds) ? [...new Set(b.serviceIds.map(String).filter((x) => UUID.test(x)))] : [];
    const to = typeof b.toCategoryId === 'string' && UUID.test(b.toCategoryId) ? b.toCategoryId : null;
    if (!UUID.test(String(fromCategoryId))) throw err(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    if (!ids.length) throw err(400, 'CATEGORY_REASSIGN_EMPTY', 'Choose at least one service to move.');
    if (!to || to === fromCategoryId) throw err(400, 'CATEGORY_REASSIGN_TARGET_INVALID', 'Choose a different, current category to move the services into.');
    return this.db.transaction().execute(async (trx) => {
      const cats = (await sql<any>`select c.id, c.name, c.status from service_categories c where c.tenant_id = ${T} and c.id in (${fromCategoryId}, ${to}) and ${this.branch(ctx, 'c')}`.execute(trx)).rows;
      const fromCat = cats.find((x: any) => String(x.id) === fromCategoryId), toCat = cats.find((x: any) => String(x.id) === to);
      if (!fromCat) throw err(404, 'CATEGORY_NOT_FOUND', 'Category not found');
      if (!toCat || toCat.status === 'archived') throw err(400, 'CATEGORY_REASSIGN_TARGET_INVALID', 'Choose a different, current category to move the services into.');
      const svc = (await sql<any>`select s.id, s.name, s.price_cents, s.duration_minutes, s.status from services s where s.tenant_id = ${T} and s.category_id = ${fromCategoryId}
        and s.id in (${sql.join(ids.map((x) => sql`${x}`))}) and ${this.branch(ctx, 's')} order by lower(s.name), s.id for update`.execute(trx)).rows;
      const preview = { from: { categoryId: fromCategoryId, name: String(fromCat.name) }, to: { categoryId: to, name: String(toCat.name) }, notInCategory: ids.length - svc.length,
        services: svc.map((s: any) => ({ serviceId: String(s.id), name: String(s.name), priceCents: N(s.price_cents), durationMinutes: N(s.duration_minutes), status: String(s.status) })) };
      if (b.confirm !== true) return { ...preview, moved: 0, preview: true };
      const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : null;
      if (!reason) throw err(400, 'CHANGE_REASON_REQUIRED', 'Say why these services are moving.');
      if (!svc.length) throw err(400, 'CATEGORY_REASSIGN_EMPTY', 'Choose at least one service to move.');
      await sql`update services set category_id = ${to}, updated_at = now(), updated_by = ${UUID.test(ctx.userId) ? ctx.userId : null}
        where tenant_id = ${T} and category_id = ${fromCategoryId} and id in (${sql.join(svc.map((s: any) => sql`${s.id}`))})`.execute(trx);
      await recordCatalogChanges(trx, ctx, svc.map((s: any) => ({ entityType: 'service' as const, entityId: String(s.id), serviceId: String(s.id), field: 'category_id', oldValue: fromCategoryId, newValue: to, reason, source: 'reassignment' })));
      return { ...preview, moved: svc.length, preview: false };
    });
  }

  // ── Add-Ons ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async addOnSummary(ctx: CatCtx) {
    const T = ctx.tenantId;
    const r = (await sql<any>`select count(*)::int as offerings, count(*) filter (where a.is_active)::int as active, count(distinct a.add_on_key)::int as definitions,
        count(distinct a.service_id) filter (where a.is_active and s.status = 'active')::int as services, coalesce(avg(a.price_cents) filter (where a.is_active), 0)::numeric as avg_price,
        count(*) filter (where a.is_active and s.status = 'archived')::int as on_archived
      from service_add_ons a join services s on s.id = a.service_id and s.tenant_id = a.tenant_id where a.tenant_id = ${T} and ${this.branch(ctx, 'a')}`.execute(this.db)).rows[0];
    const cat = (await sql<any>`select s.id, s.name, c.name as category_name from services s join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.status = 'active' and ${this.branch(ctx, 's')}`.execute(this.db)).rows.filter((x: any) => isAddOnCategory(x.category_name));
    return { offerings: N(r?.offerings), activeOfferings: N(r?.active), definitions: N(r?.definitions), servicesOffering: N(r?.services),
      averagePriceCents: N(r?.active) ? Math.round(Number(r?.avg_price ?? 0)) : null, offeringsOnArchivedServices: N(r?.on_archived), categoryAddOnServices: cat.length };
  }
  async addOns(ctx: CatCtx, f: { q?: string; status?: string; serviceId?: string; categoryId?: string; taxable?: string; minPrice?: unknown; maxPrice?: unknown; dateField?: string; sort?: string;
    preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f);
    const status = f.status === 'active' || f.status === 'inactive' ? f.status : 'all';
    const sort = ADD_ON_ORDER[String(f.sort)] ? String(f.sort) : 'newest';
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const cents = moneyOf(raw);
    const sid = f.serviceId && UUID.test(f.serviceId) ? f.serviceId : null; const cid = f.categoryId && UUID.test(f.categoryId) ? f.categoryId : null;
    const int = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
    const col = f.dateField === 'updated' ? sql`a.updated_at` : sql`a.created_at`;
    const w = sql`a.tenant_id = ${T} and ${this.branch(ctx, 'a')} and ${this.inP(col, per)} and (${status} = 'all' or a.is_active = ${status === 'active'})
      and (${sid}::uuid is null or a.service_id = ${sid}) and (${cid}::uuid is null or s.category_id = ${cid})
      and (${f.taxable === 'true'} = false or a.is_taxable) and (${f.taxable === 'false'} = false or not a.is_taxable)
      and (${int(f.minPrice)}::int is null or a.price_cents >= ${int(f.minPrice)}) and (${int(f.maxPrice)}::int is null or a.price_cents <= ${int(f.maxPrice)})
      and (${raw} = '' or a.name ilike ${l} or a.add_on_key = ${raw} or s.name ilike ${l} or coalesce(c.name, '') ilike ${l} or (${cents}::int is not null and a.price_cents = ${cents}))`;
    const from = sql`from service_add_ons a join services s on s.id = a.service_id and s.tenant_id = a.tenant_id left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select a.id, a.add_on_key, a.name, a.price_cents, a.duration_delta_minutes, a.is_taxable, a.is_active, a.created_at, a.updated_at, a.service_id, s.name as service_name, s.status as service_status,
        c.name as category_name, (select count(*) from service_add_ons a2 where a2.tenant_id = a.tenant_id and a2.add_on_key = a.add_on_key)::int as shared_with
      ${from} where ${w} order by ${ADD_ON_ORDER[sort]} limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    const HAIR = /\b(hair|haircut|cut|color|colour|blowout)\b/i, NAILS = /\b(tip|tips|nail|french|gel|polish|chrome|art)\b/i;
    return { period: per, status, sort, items: rows.map((r: any) => ({ offeringId: String(r.id), key: String(r.add_on_key), name: String(r.name), priceCents: N(r.price_cents), durationMinutes: N(r.duration_delta_minutes),
      taxable: !!r.is_taxable, active: !!r.is_active, serviceId: String(r.service_id), serviceName: String(r.service_name), serviceStatus: String(r.service_status ?? 'active'), categoryName: r.category_name ?? null,
      sharedWith: N(r.shared_with), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
      // flagged for review, never changed: a nail add-on offered on a hair service (the photo's French tips on Haircut)
      reviewFlag: NAILS.test(r.name) && HAIR.test(r.service_name) ? 'nail_add_on_on_hair_service' : null })), page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }
  async addOnDetail(ctx: CatCtx, key: string) {
    const T = ctx.tenantId; if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(key))) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
    const rows = (await sql<any>`select a.id, a.add_on_key, a.name, a.price_cents, a.duration_delta_minutes, a.is_taxable, a.is_active, a.created_at, a.updated_at, a.service_id, s.name as service_name, s.status as service_status, s.price_cents as service_price, s.duration_minutes as service_minutes, c.name as category_name
      from service_add_ons a join services s on s.id = a.service_id and s.tenant_id = a.tenant_id left join service_categories c on c.id = s.category_id and c.tenant_id = s.tenant_id
      where a.tenant_id = ${T} and a.add_on_key = ${key} and ${this.branch(ctx, 'a')} order by lower(s.name), a.id`.execute(this.db)).rows;
    if (!rows.length) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
    const usage = (await sql<any>`select count(*)::int as n, coalesce(sum(l.line_total_cents), 0)::bigint as cents, max(t.paid_at) as last_at from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
      where l.tenant_id = ${T} and l.removed_at is null and t.paid_at is not null and coalesce(l.is_add_on, false) and lower(l.service_name_snapshot) = lower(${String(rows[0].name)}) and ${this.tb(ctx)}`.execute(this.db)).rows[0];
    const first = rows[0];
    return { key: String(key), name: String(first.name), offerings: rows.map((r: any) => ({ offeringId: String(r.id), serviceId: String(r.service_id), serviceName: String(r.service_name), serviceStatus: String(r.service_status ?? 'active'),
      categoryName: r.category_name ?? null, priceCents: N(r.price_cents), durationMinutes: N(r.duration_delta_minutes), taxable: !!r.is_taxable, active: !!r.is_active,
      withServicePriceCents: N(r.service_price) + N(r.price_cents), withServiceMinutes: N(r.service_minutes) + N(r.duration_delta_minutes), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) })),
      differsByService: new Set(rows.map((r: any) => `${r.price_cents}|${r.duration_delta_minutes}|${r.is_taxable}`)).size > 1,
      usage: { paidLines: N(usage?.n), cents: N(usage?.cents), lastAt: iso(usage?.last_at), matchedBy: 'add_on_name_on_ticket_line' } };
  }
  /** Add-On usage: real paid / open ticket add-on lines (a legacy add-on line names the add-on in its snapshot; an Add-ons
   *  category line names the service). Search by customer name, phone in any format, ticket number, add-on or service. */
  async addOnUsage(ctx: CatCtx, f: { q?: string; key?: string; dateField?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10); const per = await this.period(ctx, f, 'month');
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const { d, phoneish } = phoneDigits(raw); const ticketNo = /^#\d{1,9}$/.test(raw) ? raw.slice(1) : null;
    const keyName = f.key && /^[A-Za-z0-9_-]{1,64}$/.test(f.key) ? (await sql<any>`select name from service_add_ons where tenant_id = ${T} and add_on_key = ${f.key} limit 1`.execute(this.db)).rows[0]?.name ?? null : null;
    // an unknown add-on key matches nothing (the '\u0000' placeholder it used made Postgres refuse the query → 500)
    if (f.key && keyName == null) return { period: per, totals: { paidLines: 0, paidCents: 0 }, items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
    const col = f.dateField === 'added' ? sql`l.created_at` : sql`coalesce(t.paid_at, l.created_at)`;
    const w = sql`l.tenant_id = ${T} and l.removed_at is null and t.removed_at is null and (coalesce(l.is_add_on, false) or lower(coalesce(l.line_kind, '')) = 'add_on') and ${this.inP(col, per)} and ${this.tb(ctx)}
      and (${keyName}::text is null or lower(l.service_name_snapshot) = lower(${keyName ?? ''}))
      and (${raw} = '' or l.service_name_snapshot ilike ${l} or coalesce(cu.full_name, '') ilike ${l} or (${ticketNo}::text is not null and t.ticket_number::text = ${ticketNo ?? ''})
        or (${phoneish} and regexp_replace(coalesce(cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + d + '%'})
        or exists (select 1 from ticket_service_lines m where m.tenant_id = l.tenant_id and m.ticket_id = l.ticket_id and m.removed_at is null and not coalesce(m.is_add_on, false) and m.service_name_snapshot ilike ${l}))`;
    const from = sql`from ticket_service_lines l join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id left join customers cu on cu.id = t.customer_id and cu.tenant_id = t.tenant_id
      left join technicians te on te.id = l.technician_id and te.tenant_id = l.tenant_id`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sums = (await sql<any>`select coalesce(sum(l.line_total_cents) filter (where t.paid_at is not null), 0)::bigint as paid_cents, count(*) filter (where t.paid_at is not null)::int as paid ${from} where ${w}`.execute(this.db)).rows[0];
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select l.id, l.service_name_snapshot, l.line_total_cents, l.price_cents_snapshot, l.duration_minutes_snapshot, l.created_at, t.paid_at, t.ticket_number, t.id as ticket_id, t.status as ticket_status,
        cu.full_name, cu.phone_display, cu.normalized_phone, coalesce(nullif(te.full_name, ''), trim(coalesce(te.first_name, '') || ' ' || coalesce(te.last_name, ''))) as technician,
        (select string_agg(m.service_name_snapshot, ', ' order by m.created_at) from ticket_service_lines m where m.tenant_id = l.tenant_id and m.ticket_id = l.ticket_id and m.removed_at is null and not coalesce(m.is_add_on, false) and lower(coalesce(m.line_kind, 'service')) = 'service') as main_services
      ${from} where ${w} order by ${col} desc, l.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { period: per, totals: { paidLines: N(sums?.paid), paidCents: N(sums?.paid_cents) }, items: rows.map((r: any) => ({ lineId: String(r.id), addOn: String(r.service_name_snapshot ?? ''), chargedCents: N(r.line_total_cents),
      minutes: r.duration_minutes_snapshot == null ? null : N(r.duration_minutes_snapshot), at: iso(r.paid_at ?? r.created_at), paid: !!r.paid_at, ticketId: String(r.ticket_id), ticketNumber: r.ticket_number == null ? null : String(r.ticket_number),
      ticketStatus: r.ticket_status ?? null, customerName: r.full_name ?? null, maskedPhone: maskPhone(r.phone_display ?? r.normalized_phone), technician: r.technician || null, mainServices: r.main_services ?? null })),
      page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages };
  }

  /** New Add-On: the eligible services must be CHOSEN (an add-on is never attached to every service by default). A name that
   *  already exists is refused with the existing one unless confirmed (409 ADD_ON_DUPLICATE). */
  async createAddOn(ctx: CatCtx, b: { name?: unknown; priceCents?: unknown; durationMinutes?: unknown; taxable?: unknown; serviceIds?: unknown; confirmDuplicate?: unknown }) {
    const T = ctx.tenantId; const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : '';
    if (!name) throw err(400, 'NAME_REQUIRED', 'Name is required');
    const price = Number(b.priceCents ?? 0), mins = Number(b.durationMinutes ?? 0);
    if (!Number.isInteger(price) || price < 0) throw err(400, 'PRICE_INVALID', 'Price must be 0 or greater');
    if (!Number.isInteger(mins) || mins < 0 || mins > 600) throw err(400, 'DURATION_INVALID', 'Duration must be greater than 0');
    const ids = Array.isArray(b.serviceIds) ? [...new Set(b.serviceIds.map(String).filter((x) => UUID.test(x)))] : [];
    if (!ids.length) throw err(400, 'ADD_ON_SERVICES_REQUIRED', 'Choose the services this add-on can be added to.');
    return this.db.transaction().execute(async (trx) => {
      const dup = (await sql<any>`select add_on_key, count(*)::int as n from service_add_ons where tenant_id = ${T} and lower(name) = lower(${name}) group by add_on_key order by 2 desc limit 3`.execute(trx)).rows;
      if (dup.length && b.confirmDuplicate !== true) throw err(409, 'ADD_ON_DUPLICATE', 'An add-on with this name already exists. Add these services to it instead, or confirm to create a separate one.', { existing: dup.map((x: any) => ({ key: String(x.add_on_key), offerings: N(x.n) })) });
      const svc = (await sql<any>`select s.id, s.branch_id from services s where s.tenant_id = ${T} and s.status <> 'archived' and s.id in (${sql.join(ids.map((x) => sql`${x}`))}) and ${this.branch(ctx, 's')}`.execute(trx)).rows;
      if (svc.length !== ids.length) throw err(400, 'ADD_ON_SERVICES_REQUIRED', 'Choose the services this add-on can be added to.');
      const key = 'ao_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      for (const s of svc) {
        await sql`insert into service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active, sort_order, updated_at, updated_by)
          values (${T}, ${s.branch_id ?? (UUID.test(ctx.branchId) ? ctx.branchId : null)}, ${s.id}, ${key}, ${name}, ${price}, ${mins}, ${b.taxable === true}, true,
            (select coalesce(max(sort_order), -1) + 1 from service_add_ons where tenant_id = ${T} and service_id = ${s.id}), now(), ${UUID.test(ctx.userId) ? ctx.userId : null})`.execute(trx);
      }
      await recordCatalogChanges(trx, ctx, svc.map((s: any) => ({ entityType: 'add_on' as const, entityId: key, serviceId: String(s.id), field: 'offering', oldValue: null, newValue: `${name} · ${price}c · +${mins}m`, source: 'add_ons' })));
      return { key, offerings: svc.length };
    });
  }

  /** Edit Add-On. scope 'definition' changes every offering of the key (name / price / minutes / taxable); scope 'offering'
   *  changes ONE service's price / minutes / taxable. addServiceIds adds offerings (definition defaults); removeServiceIds
   *  deactivates offerings (never deleted — ticket history keeps them). Each changed field is a history row. */
  async updateAddOn(ctx: CatCtx, key: string, b: { scope?: unknown; serviceId?: unknown; name?: unknown; priceCents?: unknown; durationMinutes?: unknown; taxable?: unknown; addServiceIds?: unknown; removeServiceIds?: unknown; reason?: unknown }) {
    const T = ctx.tenantId; if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(key))) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
    const scope = b.scope === 'offering' ? 'offering' : 'definition';
    const sid = scope === 'offering' && typeof b.serviceId === 'string' && UUID.test(b.serviceId) ? b.serviceId : null;
    if (scope === 'offering' && !sid) throw err(400, 'ADD_ON_SERVICES_REQUIRED', 'Choose the service whose offering you are changing.');
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 200) : undefined;
    if (name !== undefined && !name) throw err(400, 'NAME_REQUIRED', 'Name is required');
    const price = b.priceCents === undefined || b.priceCents === null ? undefined : Number(b.priceCents);
    const mins = b.durationMinutes === undefined || b.durationMinutes === null ? undefined : Number(b.durationMinutes);
    if (price !== undefined && (!Number.isInteger(price) || price < 0)) throw err(400, 'PRICE_INVALID', 'Price must be 0 or greater');
    if (mins !== undefined && (!Number.isInteger(mins) || mins < 0 || mins > 600)) throw err(400, 'DURATION_INVALID', 'Duration must be greater than 0');
    const taxable = typeof b.taxable === 'boolean' ? b.taxable : undefined;
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim() : null;
    const add = Array.isArray(b.addServiceIds) ? [...new Set(b.addServiceIds.map(String).filter((x) => UUID.test(x)))] : [];
    const remove = Array.isArray(b.removeServiceIds) ? [...new Set(b.removeServiceIds.map(String).filter((x) => UUID.test(x)))] : [];
    return this.db.transaction().execute(async (trx) => {
      const rows = (await sql<any>`select a.id, a.service_id, a.name, a.price_cents, a.duration_delta_minutes, a.is_taxable, a.is_active, a.branch_id from service_add_ons a
        where a.tenant_id = ${T} and a.add_on_key = ${key} and ${this.branch(ctx, 'a')} order by a.id for update`.execute(trx)).rows;
      if (!rows.length) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
      const targets = scope === 'offering' ? rows.filter((r: any) => String(r.service_id) === sid) : rows;
      if (!targets.length) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
      const changes: CatalogChange[] = [];
      for (const r of targets) {
        const after = { name: scope === 'definition' ? name : undefined, price_cents: price, duration_delta_minutes: mins, is_taxable: taxable };
        const c = diffFields('add_on', key, { name: r.name, price_cents: N(r.price_cents), duration_delta_minutes: N(r.duration_delta_minutes), is_taxable: !!r.is_taxable }, after, { serviceId: String(r.service_id), reason, source: 'add_ons' });
        if (!c.length) continue;
        changes.push(...c);
        await sql`update service_add_ons set name = coalesce(${after.name ?? null}::text, name), price_cents = coalesce(${price ?? null}::bigint, price_cents),
            duration_delta_minutes = coalesce(${mins ?? null}::int, duration_delta_minutes), is_taxable = coalesce(${taxable ?? null}::boolean, is_taxable), updated_at = now(),
            updated_by = ${UUID.test(ctx.userId) ? ctx.userId : null} where tenant_id = ${T} and id = ${r.id}`.execute(trx);
      }
      if (add.length) {
        const have = new Set(rows.map((r: any) => String(r.service_id)));
        const svc = (await sql<any>`select s.id, s.branch_id from services s where s.tenant_id = ${T} and s.status <> 'archived' and s.id in (${sql.join(add.map((x) => sql`${x}`))}) and ${this.branch(ctx, 's')}`.execute(trx)).rows;
        const def = rows[0];
        for (const s of svc) {
          if (have.has(String(s.id))) {   // an existing (maybe deactivated) offering comes back instead of a second row
            const ex = rows.find((r: any) => String(r.service_id) === String(s.id));
            if (!ex.is_active) { await sql`update service_add_ons set is_active = true, updated_at = now() where tenant_id = ${T} and id = ${ex.id}`.execute(trx); changes.push({ entityType: 'add_on', entityId: key, serviceId: String(s.id), field: 'is_active', oldValue: false, newValue: true, reason, source: 'add_ons' }); }
            continue;
          }
          await sql`insert into service_add_ons (tenant_id, branch_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_taxable, is_active, sort_order, updated_at, updated_by)
            values (${T}, ${s.branch_id ?? def.branch_id}, ${s.id}, ${key}, ${name ?? def.name}, ${price ?? N(def.price_cents)}, ${mins ?? N(def.duration_delta_minutes)}, ${taxable ?? !!def.is_taxable}, true,
              (select coalesce(max(sort_order), -1) + 1 from service_add_ons where tenant_id = ${T} and service_id = ${s.id}), now(), ${UUID.test(ctx.userId) ? ctx.userId : null})`.execute(trx);
          changes.push({ entityType: 'add_on', entityId: key, serviceId: String(s.id), field: 'offering', oldValue: null, newValue: 'added', reason, source: 'add_ons' });
        }
      }
      for (const rid of remove) {
        const ex = rows.find((r: any) => String(r.service_id) === rid);
        if (ex && ex.is_active) { await sql`update service_add_ons set is_active = false, updated_at = now() where tenant_id = ${T} and id = ${ex.id}`.execute(trx); changes.push({ entityType: 'add_on', entityId: key, serviceId: rid, field: 'is_active', oldValue: true, newValue: false, reason, source: 'add_ons' }); }
      }
      await recordCatalogChanges(trx, ctx, changes);
      return { changed: changes.length };
    });
  }

  /** Archive / Restore: the whole add-on (every offering) or one service's offering. Soft — tickets keep their lines. */
  async setAddOnActive(ctx: CatCtx, key: string, active: boolean, b: { serviceId?: unknown; reason?: unknown }) {
    const T = ctx.tenantId; if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(key))) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
    const sid = typeof b.serviceId === 'string' && UUID.test(b.serviceId) ? b.serviceId : null;
    return this.db.transaction().execute(async (trx) => {
      const rows = (await sql<any>`select a.id, a.service_id, a.is_active from service_add_ons a where a.tenant_id = ${T} and a.add_on_key = ${key} and ${this.branch(ctx, 'a')}
        and (${sid}::uuid is null or a.service_id = ${sid}) order by a.id for update`.execute(trx)).rows;
      if (!rows.length) throw err(404, 'ADD_ON_NOT_FOUND', 'That add-on was not found.');
      const flip = rows.filter((r: any) => !!r.is_active !== active);
      for (const r of flip) await sql`update service_add_ons set is_active = ${active}, updated_at = now(), updated_by = ${UUID.test(ctx.userId) ? ctx.userId : null} where tenant_id = ${T} and id = ${r.id}`.execute(trx);
      await recordCatalogChanges(trx, ctx, flip.map((r: any) => ({ entityType: 'add_on' as const, entityId: key, serviceId: String(r.service_id), field: 'is_active', oldValue: !active, newValue: active,
        reason: typeof b.reason === 'string' ? b.reason : null, source: 'add_ons' })));
      return { changed: flip.length };
    });
  }
}
