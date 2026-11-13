/**
 * deal-commission-review.ts — Extras · Deals & Offers 12 "Commission Impact Review: flag deals where commission basis or
 * funding allocation is not approved before production".
 *
 * For every deal / coupon that is not finished (draft → pending approval → approved / scheduled → active / paused):
 *   • the funding allocation the money path applies to a deal discount TODAY (CHECKOUT_DISCOUNT_FUNDING — the one constant
 *     the rule loader stamps on every line) and what that means for the commissionable base;
 *   • a worked sample on the deal's first service: each affected technician's service earnings at the full price and with
 *     the deal's discount, computed by THE compensation engine (computeTicketCompensation) with each technician's rate
 *     picked by the money path's precedence (pickLineCommission) and the discount by THE deals pricing rule
 *     (dealRule + ruleDiscount) — nothing is re-implemented here; no sample when the deal names no service ("—");
 *   • the latest approval in deal_commission_reviews (migration 881, append-only) and a FLAG when there is none, when the
 *     deal's terms changed after it (a newer deal version), or when the money path's funding is no longer the one approved.
 * Approving records one review row for the deal's CURRENT version + an audit row. It never edits a deal, a price, a
 * ticket, a rule or anyone's pay, and it never blocks activation (the flag is for a person to act on).
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { DealCommissionReviewFlag, DealCommissionReviewSample, DealCommissionReviewItem, DealCommissionReviewListResponse } from '@aipowersalon/api-contracts/tenant';
import { dealRule, ruleDiscount } from '@aipowersalon/deals';
import { loadEffectiveRules, resolveFromRules, defaultCommissionForTenant, pickLineCommission, CHECKOUT_DISCOUNT_FUNDING, type PickedLineCommission } from './compensation-rule-loader';
import { computeTicketCompensation } from './compensation-engine';

export interface DealReviewCtx { tenantId: string; branchId: string | null; userId?: string | null; role?: string | null }
export interface DealReviewAudit { record(who: { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null }, ev: { module: string; action: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> }): unknown }
export class DealCommissionReviewError extends Error {
  constructor(message: string, readonly code: 'SERVICE_UNAVAILABLE' | 'DEAL_NOT_FOUND' | 'VALIDATION_FAILED', readonly status: number) { super(message); }
}

/** statuses still on their way to (or in) production — finished deals (expired, sold out, rejected, canceled, archived) need no review */
export const REVIEWABLE_DEAL_STATUSES = ['draft', 'pending_approval', 'approved', 'scheduled', 'active', 'paused'] as const;
export type DealReviewFlag = DealCommissionReviewFlag;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const MAX_TECHS = 50;

/** PURE: the flag for one deal — no review, terms changed after the review, or the money path's funding moved. */
export function dealReviewFlag(dealVersion: number, review: { version: number; funding: string } | null, fundingNow: string): DealReviewFlag | null {
  if (!review) return 'not_reviewed';
  if (dealVersion > review.version) return 'terms_changed';
  if (review.funding !== fundingNow) return 'funding_changed';
  return null;
}

/** the engine's service earnings for one technician on one line, with a deal discount under the checkout funding allocation */
export function earningsWith(tenantId: string, branchId: string | null, serviceId: string, technicianId: string, priceCents: number, discountCents: number, rate: PickedLineCommission): number {
  const r = computeTicketCompensation({
    tenantId, branchId, ticketId: 'deal-review',
    serviceLines: [{
      lineId: 'deal-review', serviceId, priceCents, discountCents, discountFunding: CHECKOUT_DISCOUNT_FUNDING,
      supply: { method: (rate.supplyMethod === 'fixed' || rate.supplyMethod === 'percent' ? rate.supplyMethod : 'none'), value: rate.supplyValue },
      commission: { type: rate.commissionType, value: rate.commissionValue, source: rate.source },
      technicians: [{ technicianId, method: 'percent', value: 100 }],
    }],
  });
  return r.perTechnician.find((p) => p.technicianId === technicianId)?.serviceEarningsCents ?? 0;
}

export class DealCommissionReviewService {
  constructor(private readonly db: Kysely<DB> | null, private readonly audit: DealReviewAudit | null = null) {}
  private d(): Kysely<DB> {
    if (!this.db) throw withCode(new DealCommissionReviewError('Commission impact review needs the database.', 'SERVICE_UNAVAILABLE', 503), 'SERVICE_UNAVAILABLE');
    return this.db;
  }
  private branchW(ctx: DealReviewCtx) { return ctx.branchId && UUID.test(ctx.branchId) ? sql`(d.branch_id is null or d.branch_id = ${ctx.branchId}::uuid)` : sql`true`; }

  async list(ctx: DealReviewCtx, f: { flagged?: unknown; page?: unknown; pageSize?: unknown; dealId?: string }): Promise<DealCommissionReviewListResponse> {
    const db = this.d(); const T = ctx.tenantId;
    const pageSize = Math.max(1, Math.min(50, Math.trunc(Number(f.pageSize)) || 10));
    const onlyFlagged = f.flagged === true || f.flagged === 'true' || f.flagged === '1';
    const fundingNow = CHECKOUT_DISCOUNT_FUNDING;
    const statuses = sql.join(REVIEWABLE_DEAL_STATUSES.map((s) => sql`${s}`));
    const latest = sql`(select r.deal_version, r.discount_funding, r.note, r.reviewed_at, r.reviewed_by_user_id from deal_commission_reviews r
        where r.tenant_id = d.tenant_id and r.deal_id = d.id order by r.reviewed_at desc, r.id desc limit 1)`;
    const flagW = sql`(lr.deal_version is null or d.version > lr.deal_version or lr.discount_funding <> ${fundingNow})`;
    const one = f.dealId && UUID.test(f.dealId) ? sql`and d.id = ${f.dealId}::uuid` : sql``;
    const base = sql`from deals d left join lateral ${latest} lr on true where d.tenant_id = ${T} and d.kind <> 'announcement' and d.status in (${statuses}) and ${this.branchW(ctx)} ${one}`;
    const counts = (await sql<{ n: number; flagged: number }>`select count(*)::int as n, count(*) filter (where ${flagW})::int as flagged ${base}`.execute(db)).rows[0];
    const totalItems = onlyFlagged ? N(counts?.flagged) : N(counts?.n);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const page = Math.min(Math.max(1, Math.trunc(Number(f.page)) || 1), totalPages);
    const rows = (await sql<{ id: string; title: string; kind: string; status: string; owner_type: string; technician_id: string | null; tech_name: string | null; version: number;
        discount_type: string; discount_percent: number | null; discount_cents: number | null; max_discount_cents: number | null; branch_id: string | null;
        r_version: number | null; r_funding: string | null; r_note: string | null; r_at: Date | string | null; r_by: string | null }>`
      select d.id, d.title, d.kind, d.status, d.owner_type, d.technician_id, nullif(btrim(coalesce(nullif(te.full_name, ''), te.first_name || ' ' || te.last_name)), '') as tech_name, d.version,
        d.discount_type, d.discount_percent, d.discount_cents, d.max_discount_cents, d.branch_id,
        lr.deal_version as r_version, lr.discount_funding as r_funding, lr.note as r_note, lr.reviewed_at as r_at, coalesce(nullif(u.full_name, ''), u.email) as r_by
      from deals d left join lateral ${latest} lr on true
        left join technicians te on te.tenant_id = d.tenant_id and te.id = d.technician_id
        left join users u on u.id = lr.reviewed_by_user_id
      where d.tenant_id = ${T} and d.kind <> 'announcement' and d.status in (${statuses}) and ${this.branchW(ctx)} ${one} ${onlyFlagged ? sql`and ${flagW}` : sql``}
      order by (${flagW}) desc, d.updated_at desc, d.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(db)).rows;

    const [rules, tenantDefault] = await Promise.all([loadEffectiveRules(db, T), defaultCommissionForTenant(db, T)]);
    const items: DealCommissionReviewItem[] = [];
    for (const r of rows) {
      const review = r.r_version == null ? null : { reviewedAt: new Date(r.r_at as string).toISOString(), reviewedBy: r.r_by ?? null, version: N(r.r_version), funding: String(r.r_funding), note: r.r_note ?? null };
      items.push({
        dealId: String(r.id), title: String(r.title), kind: String(r.kind), status: String(r.status), ownerType: String(r.owner_type), technicianId: r.technician_id ? String(r.technician_id) : null,
        technicianName: r.tech_name ?? null, version: N(r.version), discountType: String(r.discount_type), discountPercent: numOrNull(r.discount_percent), discountCents: numOrNull(r.discount_cents),
        maxDiscountCents: numOrNull(r.max_discount_cents), fundingNow, review, flag: dealReviewFlag(N(r.version), review, fundingNow),
        sample: await this.sample(ctx, r, rules, tenantDefault),
      });
    }
    return { items, page, pageSize, totalItems, totalPages, flaggedTotal: N(counts?.flagged), fundingNow };
  }

  /** the first service the deal names, at its price: each affected technician's earnings without / with the discount */
  private async sample(ctx: DealReviewCtx, r: { id: string; technician_id: string | null; branch_id: string | null; discount_type: string; discount_percent: number | null; discount_cents: number | null; max_discount_cents: number | null },
    rules: Awaited<ReturnType<typeof loadEffectiveRules>>, tenantDefault: Awaited<ReturnType<typeof defaultCommissionForTenant>>): Promise<DealCommissionReviewSample | null> {
    const db = this.d(); const T = ctx.tenantId;
    const svc = (await sql<{ id: string; name: string; price_cents: number; commission_type: string | null; commission_value: number | null; category: string | null }>`
      select s.id, s.name, s.price_cents, s.commission_type, s.commission_value, c.name as category from deal_services ds
        join services s on s.tenant_id = ds.tenant_id and s.id = ds.service_id left join service_categories c on c.tenant_id = s.tenant_id and c.id = s.category_id
      where ds.tenant_id = ${T} and ds.deal_id = ${r.id} order by s.name, s.id limit 1`.execute(db)).rows[0];
    if (!svc) return null;
    const price = N(svc.price_cents);
    const discount = ruleDiscount(dealRule({ discountType: r.discount_type, discountPercent: numOrNull(r.discount_percent), discountCents: numOrNull(r.discount_cents), maxDiscountCents: numOrNull(r.max_discount_cents) } as never), price);
    const B = r.branch_id ?? (ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null);
    const techs = r.technician_id ? [{ id: String(r.technician_id), branch_id: B }]
      : (await sql<{ id: string; branch_id: string | null }>`select te.id, te.branch_id from technicians te where te.tenant_id = ${T} and te.is_active = true and te.archived_at is null
          and (${B}::uuid is null or te.branch_id = ${B}::uuid) order by te.id limit ${MAX_TECHS}`.execute(db)).rows;
    if (!techs.length) return null;
    const full: number[] = []; const disc: number[] = []; const chg: number[] = [];
    for (const te of techs) {
      const branchId = te.branch_id ?? B;
      const resolved = rules.length ? resolveFromRules(rules, { tenantId: T, branchId, technicianId: te.id, serviceId: svc.id, serviceCategory: svc.category ?? null, ticketId: null }) : null;
      const rate = pickLineCommission(resolved, { commission_type: svc.commission_type, commission_value: svc.commission_value }, tenantDefault);
      const a = earningsWith(T, branchId, svc.id, te.id, price, 0, rate); const b = earningsWith(T, branchId, svc.id, te.id, price, discount, rate);
      full.push(a); disc.push(b); chg.push(b - a);
    }
    return { serviceId: String(svc.id), serviceName: String(svc.name), priceCents: price, discountCents: discount, technicians: techs.length,
      earningsFullMinCents: Math.min(...full), earningsFullMaxCents: Math.max(...full), earningsDiscountedMinCents: Math.min(...disc), earningsDiscountedMaxCents: Math.max(...disc),
      changeMinCents: Math.min(...chg), changeMaxCents: Math.max(...chg) };
  }

  /** Approve the commission impact of the deal's CURRENT version under today's funding allocation. Append-only + audited. */
  async approve(ctx: DealReviewCtx, dealId: string, body: { note?: unknown }): Promise<DealCommissionReviewItem> {
    const db = this.d(); const T = ctx.tenantId;
    const note = body.note == null ? null : String(body.note).trim() || null;
    if (note && note.length > 500) throw withCode(new DealCommissionReviewError('Keep the note under 500 characters.', 'VALIDATION_FAILED', 400), 'VALIDATION_FAILED');
    if (!UUID.test(String(dealId))) throw withCode(new DealCommissionReviewError('Deal not found.', 'DEAL_NOT_FOUND', 404), 'DEAL_NOT_FOUND');
    const statuses = sql.join(REVIEWABLE_DEAL_STATUSES.map((s) => sql`${s}`));
    const deal = (await sql<{ id: string; version: number }>`select d.id, d.version from deals d where d.tenant_id = ${T} and d.id = ${dealId}::uuid and d.kind <> 'announcement'
        and d.status in (${statuses}) and ${this.branchW(ctx)}`.execute(db)).rows[0];
    if (!deal) throw withCode(new DealCommissionReviewError('Deal not found.', 'DEAL_NOT_FOUND', 404), 'DEAL_NOT_FOUND');
    const by = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
    const ins = (await sql<{ id: string }>`insert into deal_commission_reviews (tenant_id, deal_id, deal_version, discount_funding, note, reviewed_by_user_id)
        values (${T}, ${deal.id}, ${N(deal.version)}, ${CHECKOUT_DISCOUNT_FUNDING}, ${note}, ${by}) returning id`.execute(db)).rows[0]!;
    await this.audit?.record({ tenantId: T, branchId: ctx.branchId, userId: by, role: ctx.role ?? null },
      { module: 'compensation', action: 'deal_commission_impact_approved', resourceType: 'deal', resourceId: deal.id, metadata: { reviewId: ins.id, dealVersion: N(deal.version), funding: CHECKOUT_DISCOUNT_FUNDING } });
    return (await this.list(ctx, { dealId: deal.id })).items[0]!;
  }
}
