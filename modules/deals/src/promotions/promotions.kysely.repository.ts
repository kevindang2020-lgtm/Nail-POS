// promotions.kysely.repository.ts — BUILD_PLAN Phase 5: the COMPATIBILITY ADAPTER for the tenant promotion engine
// (/promotions/validate|redeem|reverse). A "tenant promotion" is now a `deals` row of kind 'automatic' (backfilled from
// tenant_promotions by migration 522 — the old id still resolves through deals.legacy_id), and its redemptions live in
// the one application ledger, deal_redemptions. tenant_promotions / tenant_promotion_redemptions are frozen (523).
//
// Atomicity: insertRedemption takes the deal's advisory lock, RE-COUNTS the limits inside the transaction and inserts;
// the UNIQUE (deal_id, idempotency_key) index guarantees a retry (or a concurrent duplicate) returns the existing row.
// coupon.redeemed is emitted only for a NEW row, in the same transaction. Reversal preserves history.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { DEAL_REDEMPTION } from '../engine/deal-lifecycles';
import type { PromotionsRepositoryPort, PromotionFacts, RedemptionRow, RedemptionCounts, InsertRedemptionInput } from './promotions.repository';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const STATUS_OUT: Record<string, string> = { canceled: 'cancelled', sold_out: 'completed' };
const mapRedemption = (r: any): RedemptionRow => ({ id: String(r.id), promotionId: String(r.deal_id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null, customerId: r.customer_id ? String(r.customer_id) : null,
  eligibleSubtotalCents: n(r.terms_snapshot?.eligibleSubtotalCents), discountCents: n(r.amount_discounted_cents), finalSubtotalCents: n(r.terms_snapshot?.finalSubtotalCents),
  status: String(r.status), idempotencyKey: String(r.idempotency_key ?? ''), redeemedAt: iso(r.redeemed_at), reversedAt: iso(r.reversed_at) });

export class KyselyPromotionsRepository implements PromotionsRepositoryPort {
  constructor(private readonly db: AppDatabase, private readonly outbox: OutboxWriter | null = null) {}
  private get d(): any { return this.db; }

  private async dealId(promotionId: string, tenantId: string, q?: any): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(promotionId || ''))) return null;
    const r: any = (await sql`SELECT id FROM deals WHERE tenant_id = ${tenantId} AND (id = ${promotionId} OR legacy_id = ${promotionId}) AND kind IN ('automatic','coupon','deal') LIMIT 1`.execute(q ?? this.d)).rows[0];
    return r ? String(r.id) : null;
  }

  async getPromotion(id: string, tenantId: string): Promise<PromotionFacts | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const r: any = await sql`SELECT * FROM deals WHERE tenant_id = ${tenantId} AND (id = ${id} OR legacy_id = ${id}) AND kind IN ('automatic','coupon','deal') LIMIT 1`.execute(this.d).then((x) => x.rows[0]);
    if (!r) return null;
    return { id: String(r.id), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null,
      promotionType: r.discount_type === 'percent' ? 'percentage' : 'fixed_amount', discountValue: r.discount_type === 'percent' ? n(r.discount_percent) : n(r.discount_cents),
      maxDiscountCents: r.max_discount_cents == null ? null : n(r.max_discount_cents), minPurchaseCents: n(r.min_spend_cents), startAt: iso(r.starts_at), endAt: iso(r.ends_at),
      status: r.suspended_at ? 'disabled' : (STATUS_OUT[r.status] ?? r.status), approvalRequired: false, approvalStatus: 'not_required',
      customerLimit: n(r.max_per_customer), branchLimit: 0, tenantLimit: n(r.max_redemptions), globalLimit: 0 };
  }

  async findRedemptionByIdem(promotionId: string, idempotencyKey: string, tenantId?: string): Promise<RedemptionRow | null> {
    if (!tenantId) return null;
    const deal = await this.dealId(promotionId, tenantId);
    if (!deal) return null;
    const r: any = await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${tenantId} AND deal_id = ${deal} AND idempotency_key = ${idempotencyKey} LIMIT 1`.execute(this.d).then((x) => x.rows[0]).catch(() => undefined);
    return r ? mapRedemption(r) : null;
  }

  async countRedemptions(promotionId: string, scope: { customerId: string | null; branchId: string | null; tenantId: string }, q?: any): Promise<RedemptionCounts> {
    const deal = await this.dealId(promotionId, scope.tenantId, q);
    // NO .catch here, deliberately: a failed count must fail the redemption (the safe direction), never read as 0.
    const r: any = await sql`
      SELECT count(*) FILTER (WHERE customer_id = ${scope.customerId})::int AS customer_count,
             count(*) FILTER (WHERE branch_id = ${scope.branchId})::int AS branch_count,
             count(*)::int AS tenant_count
        FROM deal_redemptions WHERE tenant_id = ${scope.tenantId} AND deal_id = ${deal} AND status IN ('redeemed','partially_reversed')`.execute(q ?? this.d).then((x) => x.rows[0]);
    return { customerCount: n(r?.customer_count), branchCount: n(r?.branch_count), tenantCount: n(r?.tenant_count), globalCount: n(r?.tenant_count) };
  }

  async insertRedemption(i: InsertRedemptionInput, limits?: { customerLimit: number; tenantLimit: number }): Promise<RedemptionRow> {
    return this.d.transaction().execute(async (trx: any) => {
      const deal = await this.dealId(i.promotionId, i.tenantId, trx);
      if (!deal) throw new Error('promotion not found');
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'dealhold:' + deal}, 0))`.execute(trx);
      const prior: any = (await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${i.tenantId} AND deal_id = ${deal} AND idempotency_key = ${i.idempotencyKey} LIMIT 1`.execute(trx)).rows[0];
      if (prior) return mapRedemption(prior);
      if (limits) {   // re-counted under the lock: two registers cannot both take the last redemption
        const c = await this.countRedemptions(deal, { customerId: i.customerId, branchId: i.branchId, tenantId: i.tenantId }, trx);
        if ((limits.customerLimit > 0 && c.customerCount >= limits.customerLimit) || (limits.tenantLimit > 0 && c.tenantCount >= limits.tenantLimit)) throw new Error('redemption limit reached');
      }
      const r: any = (await sql`
        INSERT INTO deal_redemptions (deal_id, tenant_id, branch_id, customer_id, ticket_id, amount_discounted_cents, deal_version, status, kind, redeemed_at, idempotency_key, terms_snapshot)
        VALUES (${deal}, ${i.tenantId}, ${i.branchId}, ${i.customerId}, ${i.ticketId}, ${i.discountCents}, 1, 'redeemed', 'automatic', now(), ${i.idempotencyKey},
                ${JSON.stringify({ eligibleSubtotalCents: i.eligibleSubtotalCents, finalSubtotalCents: i.finalSubtotalCents, currency: i.currency, checkoutId: i.checkoutId })}::jsonb)
        RETURNING *`.execute(trx)).rows[0];
      await sql`UPDATE deals SET redemption_count = redemption_count + 1 WHERE tenant_id = ${i.tenantId} AND id = ${deal}`.execute(trx);
      if (this.outbox) {
        await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.COUPON_REDEEMED, tenantId: i.tenantId, branchId: i.branchId ?? undefined,
          aggregateType: 'promotion_redemption', aggregateId: String(r.id), actorType: 'user', correlationId: i.ticketId ? `ticket:${i.ticketId}` : undefined,
          payload: { redemptionId: String(r.id), promotionId: i.promotionId, dealId: deal, customerId: i.customerId ?? null, ticketId: i.ticketId ?? null, checkoutId: i.checkoutId ?? null, discountCents: i.discountCents } }));
      }
      return mapRedemption(r);
    });
  }

  async getRedemption(id: string, tenantId: string): Promise<RedemptionRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
    const r: any = await sql`SELECT * FROM deal_redemptions WHERE tenant_id = ${tenantId} AND id = ${id} LIMIT 1`.execute(this.d).then((x) => x.rows[0]).catch(() => undefined);
    return r ? mapRedemption(r) : null;
  }

  async reverseRedemption(id: string, reason: string, tenantId?: string): Promise<RedemptionRow | null> {
    if (!tenantId) return null;
    return this.d.transaction().execute(async (trx: any) => {
      const r: any = (await sql`UPDATE deal_redemptions SET status = 'reversed', reversed_at = now(), reversal_reason = ${reason}, reversed_cents = amount_discounted_cents, updated_at = now()
                                 WHERE ${canMoveToSql(DEAL_REDEMPTION, 'reversed')} AND tenant_id = ${tenantId} AND id = ${id} AND status = 'redeemed' RETURNING *`.execute(trx)).rows[0];
      if (!r) return null;
      await sql`UPDATE deals SET redemption_count = GREATEST(0, redemption_count - 1) WHERE tenant_id = ${tenantId} AND id = ${r.deal_id}`.execute(trx);
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.DEAL_REDEMPTION_REVERSED, tenantId, branchId: r.branch_id ?? undefined, aggregateType: 'deal_redemption', aggregateId: String(r.id),
        actorType: 'user', payload: { redemptionId: String(r.id), dealId: String(r.deal_id), kind: 'automatic', full: true, reversedCents: n(r.amount_discounted_cents), reason } }));
      return mapRedemption(r);
    });
  }
}
