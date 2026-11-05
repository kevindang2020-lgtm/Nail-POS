// salon-promotions.kysely.repository.ts — BUILD_PLAN Phase 5: the COMPATIBILITY ADAPTER. Marketing → Promotions keeps
// its API (pos/salon-promotions), but a "salon promotion" is now a `deals` row of kind 'coupon' with its code in
// deal_coupon_codes (hashed — the code is never stored or shown again; the list shows its last four characters).
// salon_promotions itself is frozen (migration 523) after the backfill (522). Tenant scope is pinned in every query.
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL } from '../engine/deal-lifecycles';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { SalonPromotionsContext, SalonPromotion, CreateSalonPromotionInput, SalonPromotionStatus } from './salon-promotions.dto';
import type { SalonPromotionsRepositoryPort } from './salon-promotions.repository';
import { hashCode, codeHint } from '../engine/coupons';

const rowsOf = (r: any): any[] => (r && Array.isArray(r.rows) ? r.rows : []);
const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
// deals statuses → the five the Promotions screen knows
const STATUS_OUT: Record<string, SalonPromotionStatus> = { draft: 'draft', pending_approval: 'draft', approved: 'draft', scheduled: 'active', active: 'active', paused: 'paused', sold_out: 'expired', expired: 'expired', rejected: 'archived', canceled: 'archived', archived: 'archived' };

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

  async setStatus(ctx: SalonPromotionsContext, id: string, status: SalonPromotionStatus): Promise<SalonPromotion | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const to = status === 'expired' ? 'expired' : status;
    const row = rowsOf(await sql`UPDATE deals d SET status = ${to}, version = version + 1, updated_at = now(), published_at = CASE WHEN ${to} = 'active' THEN COALESCE(published_at, now()) ELSE published_at END
                                  WHERE d.tenant_id = ${ctx.tenantId} AND d.id = ${id} AND d.kind = 'coupon' AND d.suspended_at IS NULL AND ${canMoveToSql(DEAL, to, 'd')} ${this.branchClause(ctx)}
                                  RETURNING d.*, (SELECT c.code_hint FROM deal_coupon_codes c WHERE c.tenant_id = d.tenant_id AND c.deal_id = d.id ORDER BY c.created_at LIMIT 1) AS code_hint`.execute(this.d))[0];
    return row ? toDomain(row) : null;
  }

  async findByCode(ctx: SalonPromotionsContext, code: string): Promise<SalonPromotion | null> {
    const row = rowsOf(await sql`SELECT d.*, c.code_hint FROM deal_coupon_codes c JOIN deals d ON d.id = c.deal_id AND d.tenant_id = c.tenant_id
                                  WHERE c.tenant_id = ${ctx.tenantId} AND c.code_hash = ${hashCode(ctx.tenantId, code)} ${this.branchClause(ctx)} LIMIT 1`.execute(this.d))[0];
    return row ? toDomain(row) : null;
  }
}
