// promotions-center.ts — Marketing → Promotions (/tenant/marketing/promotions), "Promotions Management Complete Build Guide"
// (30 Oct 2026). A salon promotion IS a coupon: a `deals` row of kind 'coupon' + its hashed code in deal_coupon_codes + the
// deal_redemptions ledger (the compatibility adapter salon-promotions.kysely.repository says so). So this file adds ONLY
// what the Promotions guide asks for beyond the Coupons center over the same records — no second pricing, coupon,
// promotion or redemption engine:
//   reused  library / KPIs / redemption history / details / exports      → pos/discounts/*   (discounts-screen.ts)
//   reused  create / edit / preview / publish / pause / resume / archive  → pos/deals/*       (DealsService, audited)
//   reused  duplicate / assistant draft / related campaigns / health      → pos/coupons/*     (coupon-center.ts)
//   POST pos/promotions/:dealId/check        §11 Check Promotion: Checkout's own verdict (CouponCenter.check → DealsCheckoutService
//                                            .check), then ONE insert into promotion_eligibility_checks (738). Never consumes.
//   GET  pos/promotions/eligibility-checks   §05 search scope "Eligibility Checks": only customers somebody actually checked
//   GET  pos/promotions/trends               §14 daily / weekly / monthly redemptions, top promotions, branch and service views
//   POST pos/promotions/assistant/suggest    §13 the coupon assistant's rules-v1 suggestion + safety flags + a message PREVIEW
//                                            (never saved, never sent); saving it is pos/coupons/assistant/draft (a DRAFT)
//   GET  pos/promotions/:dealId/activity     §12 Audit tab: created / edited / published / paused / resumed / archived — actor,
//                                            time, before → after — from audit_logs, plus where an assistant draft came from
// Tenant pinned in every statement; a branch user sees salon-wide promotions and their branch's. Money is integer cents; days
// are the salon's (tenantTimeZone) with inclusive calendar days ([from 00:00, to + 1 day 00:00) local, DST-correct).
import { sql, type Kysely } from 'kysely';
import { Body, Controller, Get, HttpException, HttpStatus, Inject, Optional, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { withCode, type ApiErrorCode } from '@aipowersalon/api-contracts';
import { tenantTimeZone, ListQuery } from '@aipowersalon/database';
import { TenantAuthGuard, RolePermissionGuard, RequirePermission, ValidatedBody } from '@aipowersalon/permissions/guards';
import { COUPON_ASSIST_BODY, COUPON_CHECK_BODY } from '../request-schemas';
import type { CouponCenter } from './coupon-center';
import type { DiscountsScreenRepository, DPeriod } from './discounts-screen';
import { DealRefusedError } from '../engine/deals-checkout.service';
import { DealConflictError, DealForbiddenError, DealValidationError } from '../deals/deals.service';
import type { DealContext } from '../deals/deals.dto';

const N = (v: unknown) => Number(v ?? 0) || 0;
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const like = (raw: string) => '%' + raw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const maskPhone = (p: string | null | undefined) => { if (!p) return null; const d = String(p).replace(/\D/g, ''); return d.length >= 4 ? `••• ${d.slice(-4)}` : '•••'; };
function paging(page: unknown, pageSize: unknown, def = 10) { return { page: Math.max(1, Math.trunc(Number(page)) || 1), pageSize: Math.max(1, Math.min(100, Math.trunc(Number(pageSize)) || def)) }; }
function served(page: number, pageSize: number, total: number) { const totalPages = Math.max(1, Math.ceil(total / pageSize)); const p = Math.min(page, totalPages); return { page: p, totalPages, offset: (p - 1) * pageSize }; }

export const CHECK_VERDICT_FILTERS = ['all', 'eligible', 'not_eligible'] as const;
export const TREND_GRAINS = ['day', 'week', 'month'] as const;
export type TrendGrain = (typeof TREND_GRAINS)[number];
/** a safety flag on an assistant suggestion: 'ok' checked and fine · 'warn' checked and needs a look · 'unknown' NOT checked
 *  (no data in the system) — never shown as fine */
export interface SafetyFlag { key: string; level: 'ok' | 'warn' | 'unknown'; detail: string }
const CONFIRMED = sql`r.status in ('redeemed', 'partially_reversed')`;

export class PromotionsCenter {
  constructor(private readonly db: Kysely<any>, private readonly center: CouponCenter, private readonly discounts: DiscountsScreenRepository) {}
  /** the promotion's own scope: a branch user sees salon-wide promotions and their branch's (alias d = deals) */
  private branch(ctx: DealContext) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(d.branch_id = ${ctx.branchId} or d.branch_id is null)` : sql`true`; }
  /** [from 00:00, to + 1 day 00:00) in the salon's zone — the whole To day, correct across DST */
  private inP(col: any, per: DPeriod) {
    if (!per.from || !per.to) return sql`true`;
    return sql`(${col} >= ((${per.from}::date)::timestamp at time zone ${per.tz}) and ${col} < (((${per.to}::date) + 1)::timestamp at time zone ${per.tz}))`;
  }

  // ── §11 Check Promotion (read-only verdict) + the eligibility-check log ────────────────────────────────────────────
  async check(ctx: DealContext, dealId: string, b: Record<string, any>) {
    const r: any = await this.center.check(ctx, dealId, b);   // Checkout's own engine; refusals (not found / ticket missing) throw before anything is written
    const c = r?.context ?? {};
    const ticketId = c.ticketId && UUID.test(String(c.ticketId)) ? String(c.ticketId) : null;
    const customerId = c.customerId && UUID.test(String(c.customerId)) ? String(c.customerId) : null;
    const branchId = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    const row = (await sql<any>`insert into promotion_eligibility_checks (tenant_id, branch_id, deal_id, ticket_id, customer_id, verdict, eligible, reasons_json, spend_cents, eligible_base_cents, discount_preview_cents, source, created_by_user_id)
      values (${ctx.tenantId}, ${branchId}, ${dealId}, ${ticketId}, ${customerId}, ${String(r.verdict)}, ${!!r.eligible}, ${JSON.stringify(r.reasons ?? [])}::jsonb,
        ${c.spendCents == null ? null : Math.max(0, Math.trunc(N(c.spendCents)))}, ${Math.max(0, Math.trunc(N(r.eligibleBaseCents)))}, ${Math.max(0, Math.trunc(N(r.discountPreviewCents)))}, 'promotions', ${UUID.test(String(ctx.userId)) ? ctx.userId : null})
      returning id, created_at`.execute(this.db)).rows[0];
    return { ...r, checkId: String(row.id), checkedAt: iso(row.created_at), logged: true };
  }

  // ── §05 search scope "Eligibility Checks" ─────────────────────────────────────────────────────────────────────────
  async eligibilityChecks(ctx: DealContext, f: { q?: string; verdict?: string; dealId?: string; preset?: unknown; from?: unknown; to?: unknown; page?: unknown; pageSize?: unknown }) {
    const T = ctx.tenantId; const { page, pageSize } = paging(f.page, f.pageSize, 10);
    const per = await this.discounts.period({ tenantId: T, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }, f);
    const verdict = (CHECK_VERDICT_FILTERS as readonly string[]).includes(String(f.verdict)) ? String(f.verdict) : 'all';
    const vW = verdict === 'eligible' ? sql`k.eligible` : verdict === 'not_eligible' ? sql`not k.eligible` : sql`true`;
    const dealId = f.dealId && UUID.test(f.dealId) ? f.dealId : null;
    const raw = String(f.q ?? '').trim().slice(0, 100); const l = like(raw); const digits = raw.replace(/\D/g, ''); const phoneish = digits.length >= 4 && /^[\d\s()+.-]+$/.test(raw);
    const from = sql`from promotion_eligibility_checks k join deals d on d.id = k.deal_id and d.tenant_id = k.tenant_id left join customers cu on cu.id = k.customer_id and cu.tenant_id = k.tenant_id
      left join tickets tk on tk.id = k.ticket_id and tk.tenant_id = k.tenant_id left join users u on u.id = k.created_by_user_id`;
    const w = sql`k.tenant_id = ${T} and ${this.branch(ctx)} and ${vW} and ${this.inP(sql`k.created_at`, per)} and (${dealId}::uuid is null or k.deal_id = ${dealId})
      and (${raw} = '' or coalesce(cu.full_name, '') ilike ${l} or d.title ilike ${l} or (${phoneish} and regexp_replace(coalesce(cu.normalized_phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'})
        or (${raw.includes('@')} and coalesce(cu.email, '') ilike ${l}) or coalesce(tk.ticket_number::text, '') = ${raw.replace(/^#/, '')}
        or k.id::text = ${raw.toLowerCase()} or coalesce(k.customer_id::text, '') = ${raw.toLowerCase()} or coalesce(k.ticket_id::text, '') = ${raw.toLowerCase()} or k.deal_id::text = ${raw.toLowerCase()})`;
    const total = N((await sql<any>`select count(*)::int as n ${from} where ${w}`.execute(this.db)).rows[0]?.n);
    const sp = served(page, pageSize, total);
    const rows = (await sql<any>`select k.id, k.created_at, k.verdict, k.eligible, k.reasons_json, k.spend_cents, k.eligible_base_cents, k.discount_preview_cents, k.deal_id, d.title,
        k.customer_id, cu.full_name, cu.phone_display, cu.normalized_phone, k.ticket_id, tk.ticket_number, coalesce(nullif(u.full_name, ''), u.email) as checked_by
      ${from} where ${w} order by k.created_at desc, k.id desc limit ${pageSize} offset ${sp.offset}`.execute(this.db)).rows;
    return { verdict, period: per, page: sp.page, pageSize, totalItems: total, totalPages: sp.totalPages,
      items: rows.map((r: any) => ({ id: String(r.id), at: iso(r.created_at), verdict: String(r.verdict), eligible: !!r.eligible, reasons: Array.isArray(r.reasons_json) ? r.reasons_json : [],
        spendCents: r.spend_cents == null ? null : N(r.spend_cents), eligibleBaseCents: N(r.eligible_base_cents), discountPreviewCents: N(r.discount_preview_cents),
        dealId: String(r.deal_id), dealName: String(r.title), customerId: r.customer_id ? String(r.customer_id) : null, customerName: r.full_name ?? null, maskedPhone: maskPhone(r.phone_display ?? r.normalized_phone),
        ticketId: r.ticket_id ? String(r.ticket_id) : null, ticketNumber: r.ticket_number == null ? null : String(r.ticket_number), checkedBy: r.checked_by ?? null })),
      note: 'A check is a preview: it never used the promotion, reserved anything or sent a message.' };
  }

  // ── §14 trends, top promotions, branch and service views (completed redemptions only) ─────────────────────────────
  async trends(ctx: DealContext, f: { grain?: string; branchId?: string; preset?: unknown; from?: unknown; to?: unknown }) {
    const T = ctx.tenantId; const tz = await tenantTimeZone(this.db, T);
    const grain: TrendGrain = (TREND_GRAINS as readonly string[]).includes(String(f.grain)) ? (f.grain as TrendGrain) : 'day';
    const per = await this.discounts.period({ tenantId: T, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions }, { preset: f.preset ?? 'month', from: f.from, to: f.to }, 'month');
    const branchId = f.branchId && UUID.test(f.branchId) ? f.branchId : null;
    const at = sql`coalesce(r.redeemed_at, r.applied_at, r.created_at)`;
    const w = sql`r.tenant_id = ${T} and d.kind = 'coupon' and ${this.branch(ctx)} and ${CONFIRMED} and ${this.inP(at, per)} and (${branchId}::uuid is null or r.branch_id = ${branchId})`;
    const base = sql`from deal_redemptions r join deals d on d.id = r.deal_id and d.tenant_id = r.tenant_id`;
    const series = (await sql<any>`select to_char(date_trunc(${grain}, (${at}) at time zone ${tz}), 'YYYY-MM-DD') as bucket, count(*)::int as n,
        coalesce(sum(r.amount_discounted_cents), 0)::bigint as gross, coalesce(sum(coalesce(r.reversed_cents, 0)), 0)::bigint as reversed
      ${base} where ${w} group by 1 order by 1`.execute(this.db)).rows;
    const top = (await sql<any>`select d.id, d.title, count(*)::int as n, coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)), 0)::bigint as net,
        (select c.code_hint from deal_coupon_codes c where c.tenant_id = d.tenant_id and c.deal_id = d.id order by c.created_at, c.id limit 1) as hint
      ${base} where ${w} group by d.id, d.title order by n desc, net desc, d.id limit 10`.execute(this.db)).rows;
    const byBranch = (await sql<any>`select r.branch_id, coalesce(b.name, 'Unknown branch') as name, count(*)::int as n, coalesce(sum(r.amount_discounted_cents - coalesce(r.reversed_cents, 0)), 0)::bigint as net
      ${base} left join branches b on b.id = r.branch_id and b.tenant_id = r.tenant_id where ${w} group by r.branch_id, b.name order by n desc, r.branch_id nulls last limit 20`.execute(this.db)).rows;
    // services on the tickets that carried a completed redemption — ASSOCIATED, not caused by the promotion
    const byService = (await sql<any>`select l.service_id, max(l.service_name_snapshot) as name, count(distinct r.id)::int as n, coalesce(sum(l.line_total_cents), 0)::bigint as lines
      ${base} join ticket_service_lines l on l.ticket_id = r.ticket_id and l.tenant_id = r.tenant_id where ${w} group by l.service_id order by n desc, lines desc, l.service_id limit 20`.execute(this.db)).rows;
    const tot = series.reduce((a: any, s: any) => ({ n: a.n + N(s.n), gross: a.gross + N(s.gross), reversed: a.reversed + N(s.reversed) }), { n: 0, gross: 0, reversed: 0 });
    return { grain, period: per, branchId,
      totals: { redemptions: tot.n, grossDiscountCents: tot.gross, reversedCents: tot.reversed, netDiscountCents: tot.gross - tot.reversed },
      series: series.map((s: any) => ({ bucket: String(s.bucket), redemptions: N(s.n), grossDiscountCents: N(s.gross), reversedCents: N(s.reversed), netDiscountCents: N(s.gross) - N(s.reversed) })),
      top: top.map((t: any) => ({ dealId: String(t.id), name: String(t.title), code: t.hint ? '••••' + String(t.hint) : null, redemptions: N(t.n), netDiscountCents: N(t.net) })),
      byBranch: byBranch.map((b: any) => ({ branchId: b.branch_id ? String(b.branch_id) : null, name: String(b.name), redemptions: N(b.n), netDiscountCents: N(b.net) })),
      byService: byService.map((s: any) => ({ serviceId: s.service_id ? String(s.service_id) : null, name: String(s.name ?? 'Service'), redemptions: N(s.n), associatedLineSalesCents: N(s.lines) })),
      note: 'Completed redemptions (paid tickets) only; previews, checks and unpaid tickets are never counted. Service sales are associated revenue, not caused by the promotion.' };
  }

  // ── §13 assistant: the rules-v1 suggestion + safety flags + a message PREVIEW (never saved, never sent) ───────────────
  async suggest(ctx: DealContext, goal: string) {
    const s: any = await this.center.suggest(ctx, goal);
    const T = ctx.tenantId; const flags: SafetyFlag[] = [];
    const pct = s.terms.discountType === 'percent' ? N(s.terms.discountPercent) : null;
    flags.push(pct != null && pct >= 30 ? { key: 'discount_size', level: 'warn', detail: `${pct}% is a deep discount; confirm it fits your margins.` }
      : { key: 'discount_size', level: 'ok', detail: pct != null ? `${pct}% off.` : 'A fixed amount off.' });
    flags.push(s.exposure ? { key: 'exposure', level: s.exposure.maxDiscountIfRepeatedCents > 50000 ? 'warn' : 'ok', detail: `Up to $${(s.exposure.maxDiscountIfRepeatedCents / 100).toFixed(2)} in discounts if the ${s.exposure.visitsInBasis} visit(s) in the basis repeated with the promotion. A bound, not a forecast.` }
      : { key: 'exposure', level: 'unknown', detail: 'No visits in the basis to estimate the discount exposure from. Set a total-uses limit if you want a hard cap.' });
    // overlapping live / scheduled coupons (same services, or salon-wide on either side) that do not stack — Checkout picks one
    const svc: string[] = Array.isArray(s.terms.serviceIds) ? s.terms.serviceIds.filter((x: string) => UUID.test(x)) : [];
    const overlap = (await sql<any>`select d.id, d.title from deals d where d.tenant_id = ${T} and d.kind = 'coupon' and ${this.branch(ctx)} and d.status in ('active', 'scheduled')
        and (d.ends_at is null or d.ends_at > ${s.terms.startsAt}::timestamptz) and (d.starts_at is null or ${s.terms.endsAt}::timestamptz is null or d.starts_at < ${s.terms.endsAt}::timestamptz)
        and (${svc.length === 0} or not exists (select 1 from deal_services x where x.tenant_id = d.tenant_id and x.deal_id = d.id)
          or exists (select 1 from deal_services x where x.tenant_id = d.tenant_id and x.deal_id = d.id and x.service_id = any(${svc}::uuid[])))
      order by d.created_at desc, d.id limit 5`.execute(this.db)).rows;
    flags.push(overlap.length ? { key: 'conflicts', level: 'warn', detail: `${overlap.length} live or scheduled promotion(s) cover the same services and dates (${overlap.map((o: any) => String(o.title)).join(', ')}). Checkout applies the salon's stacking policy; customers will not get both unless both stack.` }
      : { key: 'conflicts', level: 'ok', detail: 'No live or scheduled promotion overlaps these services and dates.' });
    const consent = (await sql<any>`select count(*) filter (where c.marketing_sms_opt_in)::int as sms, count(*) filter (where c.marketing_email_opt_in)::int as email, count(*)::int as n
      from customers c where c.tenant_id = ${T} and coalesce(c.status, 'active') = 'active'`.execute(this.db)).rows[0];
    flags.push({ key: 'consent', level: N(consent?.sms) + N(consent?.email) > 0 ? 'ok' : 'warn',
      detail: `${N(consent?.sms)} active customer(s) accept marketing texts and ${N(consent?.email)} accept marketing email (of ${N(consent?.n)}). Campaign Center re-checks consent and opt-outs at send time.` });
    const numbers = N((await sql<any>`select count(*)::int as n from tenant_messaging_numbers m where m.tenant_id = ${T} and m.status = 'active' and m.released_at is null`.execute(this.db)).rows[0]?.n);
    flags.push(numbers > 0 ? { key: 'provider', level: 'ok', detail: 'This salon has an active texting number. Sending still needs a separately approved campaign.' }
      : { key: 'provider', level: 'warn', detail: 'This salon has no active texting number, so a text campaign cannot be sent yet. Email or in-salon use is unaffected.' });
    flags.push({ key: 'staffing', level: 'unknown', detail: 'Staffing for the extra visits is not checked: the system has no forecast of technician capacity for future days.' });
    flags.push({ key: 'service_cost', level: 'unknown', detail: 'Service costs are not checked: the system does not store a cost per service.' });
    const offer = s.terms.discountType === 'percent' ? `${N(s.terms.discountPercent)}% off` : `$${(N(s.terms.discountCents) / 100).toFixed(2)} off`;
    const messagePreview = { sms: `${s.terms.title}: ${offer}${s.terms.endsAt ? ' — limited time' : ''}. Book or mention this offer at your next visit. Reply STOP to opt out.`,
      email: { subject: s.terms.title, body: `${offer} at our salon${s.terms.daysOfWeek?.length ? ' on selected days' : ''}. Mention the offer at checkout; terms and limits apply.` },
      note: 'A preview only: nothing is saved or sent. Sending is a separate Campaign Center campaign with consent checks and its own approval.' };
    return { ...s, safety: flags, messagePreview, approval: 'Saving creates a DRAFT promotion. Activating it is the separate, permission-checked Publish step; sending a campaign is a separate approval in Campaign Center.' };
  }

  // ── §12 Audit tab ─────────────────────────────────────────────────────────────────────────────────────────────────
  async activity(ctx: DealContext, dealId: string) {
    if (!UUID.test(String(dealId))) throw this.notFound();
    const d = (await sql<any>`select d.id, d.created_at, d.created_by_user_id, coalesce(nullif(u.full_name, ''), u.email) as creator from deals d left join users u on u.id = d.created_by_user_id
      where d.tenant_id = ${ctx.tenantId} and d.id = ${dealId} and d.kind = 'coupon' and ${this.branch(ctx)}`.execute(this.db)).rows[0];
    if (!d) throw this.notFound();
    const rows = (await sql<any>`select a.id, a.created_at, a.action_type, a.role, a.metadata_json, coalesce(nullif(u.full_name, ''), u.email) as actor
      from audit_logs a left join users u on u.id = a.user_id where a.tenant_id = ${ctx.tenantId} and a.entity_type = 'deal' and a.entity_id = ${dealId}
      order by a.created_at desc, a.id desc limit 100`.execute(this.db)).rows;
    const origin = (await sql<any>`select x.goal, x.method, x.edited_fields, x.created_at, coalesce(nullif(u.full_name, ''), u.email) as actor from coupon_assistant_drafts x left join users u on u.id = x.created_by_user_id
      where x.tenant_id = ${ctx.tenantId} and x.deal_id = ${dealId} order by x.created_at, x.id limit 1`.execute(this.db)).rows[0];
    const meta = (m: any) => (m && typeof m === 'object' ? m : {});
    return { dealId, createdAt: iso(d.created_at), createdBy: d.creator ?? null,
      assistantOrigin: origin ? { goal: String(origin.goal), method: String(origin.method), editedFields: origin.edited_fields ?? [], at: iso(origin.created_at), by: origin.actor ?? null } : null,
      items: rows.map((r: any) => { const m = meta(r.metadata_json); const before = meta(m.before); const after = meta(m.after);
        return { id: String(r.id), at: iso(r.created_at), action: String(r.action_type), actor: r.actor ?? null, role: r.role ?? null,
          fromStatus: before.status ?? null, toStatus: after.status ?? null, version: after.version ?? null }; }) };
  }

  private notFound() { return withCode(new HttpException({ code: 'PROMOTION_NOT_FOUND', message: 'Promotion not found' }, HttpStatus.NOT_FOUND), 'PROMOTION_NOT_FOUND'); }
}

// ── controller ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const PROMOTIONS_CENTER = 'PROMOTIONS_CENTER';
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
const PRESET = { type: 'enum', values: ['today', 'week', 'month', 'year', 'custom', 'all'] } as const;
const CHECKS_SPEC = { filters: { preset: PRESET, verdict: { type: 'enum', values: CHECK_VERDICT_FILTERS }, dealId: { type: 'uuid' } }, search: { maxLength: 100 }, maxLimit: 100, defaultLimit: 10, dateRange: { maxDays: 3700 }, params: ['page'] } as const;
const TRENDS_SPEC = { filters: { preset: PRESET, grain: { type: 'enum', values: TREND_GRAINS }, branchId: { type: 'uuid' } }, dateRange: { maxDays: 3700 } } as const;

@UseGuards(TenantAuthGuard, RolePermissionGuard)
@Controller('pos/promotions')
export class PromotionsCenterController {
  constructor(@Optional() @Inject(PROMOTIONS_CENTER) private readonly center: PromotionsCenter | null) {}
  private c(): PromotionsCenter {
    if (!this.center) throw withCode(new HttpException({ code: 'DEALS_NOT_AVAILABLE', message: 'Deals and coupons are not available here.' }, HttpStatus.SERVICE_UNAVAILABLE), 'DEALS_NOT_AVAILABLE');
    return this.center;
  }
  @Get('eligibility-checks') @RequirePermission('pos.marketing.view') @ListQuery(CHECKS_SPEC)
  checks(@Req() r: any, @Query() q: any) { return run(() => this.c().eligibilityChecks(ctxOf(r), { q: s(q?.q), verdict: s(q?.verdict), dealId: s(q?.dealId), preset: s(q?.preset), from: s(q?.from), to: s(q?.to), page: q?.page, pageSize: q?.pageSize })); }

  @Get('trends') @RequirePermission('pos.marketing.view') @ListQuery(TRENDS_SPEC)
  trends(@Req() r: any, @Query() q: any) { return run(() => this.c().trends(ctxOf(r), { grain: s(q?.grain), branchId: s(q?.branchId), preset: s(q?.preset), from: s(q?.from), to: s(q?.to) })); }

  @Post('assistant/suggest') @RequirePermission('pos.marketing.manage')
  suggest(@Req() r: any, @Body(ValidatedBody(COUPON_ASSIST_BODY, { strict: true })) b: any) { return run(() => this.c().suggest(ctxOf(r), String(b?.goal ?? ''))); }

  @Post(':dealId/check') @RequirePermission('pos.marketing.view')
  check(@Req() r: any, @Param('dealId') id: string, @Body(ValidatedBody(COUPON_CHECK_BODY, { strict: true })) b: any) { return run(() => this.c().check(ctxOf(r), id, b || {})); }

  @Get(':dealId/activity') @RequirePermission('pos.marketing.view')
  activity(@Req() r: any, @Param('dealId') id: string) { return run(() => this.c().activity(ctxOf(r), id)); }
}
