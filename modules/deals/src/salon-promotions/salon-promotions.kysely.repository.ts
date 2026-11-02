// salon-promotions.kysely.repository.ts — BUILD_PLAN Phase 5: the COMPATIBILITY ADAPTER. Marketing → Promotions keeps
// its API (pos/salon-promotions), but a "salon promotion" is now a `deals` row of kind 'coupon' with its code in
// deal_coupon_codes (hashed — the code is never stored or shown again; the list shows its last four characters).
// salon_promotions itself is frozen (migration 523) after the backfill (522). Tenant scope is pinned in every query.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { SalonPromotionsContext, SalonPromotion, CreateSalonPromotionInput, SalonPromotionStatus } from './salon-promotions.dto';
import type { SalonPromotionsRepositoryPort } from './salon-promotions.repository';
import { hashCode, codeHint } from '../engine/coupons';
import { withCode } from '@aipowersalon/api-contracts';
import { SalonPromotionValidationError } from './salon-promotions.service';
import { KyselyDealsRepository } from '../deals/deals.kysely.repository';
import type { DealContext } from '../deals/deals.dto';
import type { DealStatus } from '../deals/deals.core';

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
// deals statuses → the five the Promotions screen knows
// Promotions guide §09: a scheduled promotion is NOT active (it was shown as active before)
const STATUS_OUT: Record<string, SalonPromotionStatus> = { draft: 'draft', pending_approval: 'draft', approved: 'draft', scheduled: 'scheduled', active: 'active', paused: 'paused', sold_out: 'expired', expired: 'expired', rejected: 'archived', canceled: 'archived', archived: 'archived' };

function toDomain(r: any): SalonPromotion {
  return {
    id: String(r.id), code: r.code_hint ? '••••' + String(r.code_hint) : '', name: String(r.title), discountType: (String(r.discount_type) === 'percent' ? 'percent' : 'fixed') as any,
    discountPercent: r.discount_percent == null ? null : Number(r.discount_percent), discountCents: r.discount_cents == null ? null : Number(r.discount_cents),
    minPurchaseCents: Number(r.min_spend_cents || 0), status: STATUS_OUT[String(r.status)] ?? 'archived',
    startsAt: iso(r.starts_at), endsAt: iso(r.ends_at), maxRedemptions: r.max_redemptions == null ? null : Number(r.max_redemptions),
    redemptionCount: Number(r.redemption_count || 0), createdAt: iso(r.created_at) || '',
  };
}

export class KyselySalonPromotionsRepository implements SalonPromotionsRepositoryPort {
  constructor(private readonly db: AppDatabase) {}
  private get d(): any { return this.db; }
  private branchClause(ctx: SalonPromotionsContext) { return ctx.branchId ? sql`AND (d.branch_id = ${ctx.branchId} OR d.branch_id IS NULL)` : sql``; }

  async list(ctx: SalonPromotionsContext): Promise<SalonPromotion[]> {
    return rowsOf(await sql`SELECT d.*, (SELECT c.code_hint FROM deal_coupon_codes c WHERE c.tenant_id = d.tenant_id AND c.deal_id = d.id ORDER BY c.created_at LIMIT 1) AS code_hint
                              FROM deals d WHERE d.tenant_id = ${ctx.tenantId} AND d.kind = 'coupon' ${this.branchClause(ctx)}
                             ORDER BY d.created_at DESC LIMIT 500`.execute(this.d)).map(toDomain);
  }

  async create(ctx: SalonPromotionsContext, input: CreateSalonPromotionInput): Promise<SalonPromotion> {
    return this.d.transaction().execute(async (trx: any) => {
      const pct = input.discountType === 'percent' ? Number(input.discountPercent) : null;
      const cents = input.discountType === 'fixed' ? Number(input.discountCents) : null;
      const row = rowsOf(await sql`INSERT INTO deals (tenant_id, branch_id, owner_type, kind, title, discount_type, discount_percent, discount_cents, min_spend_cents, status,
                                      starts_at, ends_at, max_redemptions, stackable, requires_code, created_by_user_id, published_at)
                                    VALUES (${ctx.tenantId}, ${ctx.branchId || null}, 'salon', 'coupon', ${input.name.trim()}, ${input.discountType}, ${pct}, ${cents},
                                      ${Number(input.minPurchaseCents || 0) || null}, 'active', ${input.startsAt ?? null}, ${input.endsAt ?? null}, ${input.maxRedemptions ?? null},
                                      true, true, ${ctx.userId}, now())
                                    RETURNING *`.execute(trx))[0];
      await sql`INSERT INTO deal_coupon_codes (tenant_id, deal_id, code_hash, code_hint, single_use, status)
                VALUES (${ctx.tenantId}, ${row.id}, ${hashCode(ctx.tenantId, input.code)}, ${codeHint(input.code)}, false, 'active')`.execute(trx);
      await sql`INSERT INTO deal_versions (deal_id, tenant_id, version, terms, changed_by_user_id) VALUES (${row.id}, ${ctx.tenantId}, 1, ${JSON.stringify({ title: row.title, kind: 'coupon', discountType: row.discount_type, discountPercent: pct, discountCents: cents })}::jsonb, ${ctx.userId})`.execute(trx);
      return toDomain({ ...row, code_hint: codeHint(input.code) });
    });
  }

  /** Promotions guide §09: Activate (resume) re-checks dates and the use cap exactly like DealsService.resume — an ended or
   *  used-up promotion is refused, a future start becomes 'scheduled' — and the change itself goes through the deals
   *  repository's transitionStatus: the ONE conditional status write (only from the status just read, under the DEAL
   *  machine) that also writes the lifecycle audit row (actor, before → after). Expired / archived never come back. */
  async setStatus(ctx: SalonPromotionsContext, id: string, status: SalonPromotionStatus): Promise<SalonPromotion | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const before = rowsOf(await sql`SELECT d.status, d.starts_at, d.ends_at, d.max_redemptions, d.redemption_count FROM deals d
                                     WHERE d.tenant_id = ${ctx.tenantId} AND d.id = ${id} AND d.kind = 'coupon' AND d.suspended_at IS NULL ${this.branchClause(ctx)}`.execute(this.d))[0];
    if (!before) return null;
    let to: DealStatus = status === 'expired' ? 'expired' : status === 'scheduled' ? 'scheduled' : status;
    if (to === 'active') {
      if (before.ends_at && new Date(before.ends_at).getTime() <= Date.now()) throw withCode(new SalonPromotionValidationError('This promotion has already ended — change its end date first.'), 'DEAL_ENDED');
      if (before.max_redemptions != null && Number(before.redemption_count) >= Number(before.max_redemptions)) throw withCode(new SalonPromotionValidationError('Its redemption limit is used up — raise the limit first.'), 'DEAL_SOLD_OUT');
      if (before.starts_at && new Date(before.starts_at).getTime() > Date.now()) to = 'scheduled';
    }
    const dctx: DealContext = { tenantId: ctx.tenantId, branchId: ctx.branchId ?? '', userId: ctx.userId ?? '', role: ctx.role ?? '', permissions: ctx.permissions ?? [], technicianId: null };
    const view = await new KyselyDealsRepository(this.db).transitionStatus(dctx, id, to, [before.status as DealStatus]);
    if (!view) return null;
    const row = rowsOf(await sql`SELECT d.*, (SELECT c.code_hint FROM deal_coupon_codes c WHERE c.tenant_id = d.tenant_id AND c.deal_id = d.id ORDER BY c.created_at LIMIT 1) AS code_hint
                                  FROM deals d WHERE d.tenant_id = ${ctx.tenantId} AND d.id = ${id}`.execute(this.d))[0];
    return row ? toDomain(row) : null;
  }

  async findByCode(ctx: SalonPromotionsContext, code: string): Promise<SalonPromotion | null> {
    const row = rowsOf(await sql`SELECT d.*, c.code_hint FROM deal_coupon_codes c JOIN deals d ON d.id = c.deal_id AND d.tenant_id = c.tenant_id
                                  WHERE c.tenant_id = ${ctx.tenantId} AND c.code_hash = ${hashCode(ctx.tenantId, code)} ${this.branchClause(ctx)} LIMIT 1`.execute(this.d))[0];
    return row ? toDomain(row) : null;
  }
}
