// Repository port for the promotion redemption engine. The Kysely impl enforces atomicity (unique idempotency key +
// in-transaction re-count); the in-memory impl mirrors that contract for tests.

export interface PromotionFacts {
  id: string; tenantId: string; branchId: string | null; promotionType: string; discountValue: number;
  maxDiscountCents: number | null; minPurchaseCents: number; startAt: string | null; endAt: string | null;
  status: string; approvalRequired: boolean; approvalStatus: string;
  customerLimit: number; branchLimit: number; tenantLimit: number; globalLimit: number;
}
export interface RedemptionRow {
  id: string; promotionId: string; tenantId: string; branchId: string | null; customerId: string | null;
  eligibleSubtotalCents: number; discountCents: number; finalSubtotalCents: number; status: string; idempotencyKey: string;
  redeemedAt: string | null; reversedAt: string | null;
}
export interface RedemptionCounts { customerCount: number; branchCount: number; tenantCount: number; globalCount: number }
export interface InsertRedemptionInput {
  promotionId: string; tenantId: string; branchId: string | null; customerId: string | null; ticketId: string | null; checkoutId: string | null;
  eligibleSubtotalCents: number; discountCents: number; finalSubtotalCents: number; currency: string; idempotencyKey: string;
}

export interface PromotionsRepositoryPort {
  getPromotion(id: string, tenantId: string): Promise<PromotionFacts | null>;
  findRedemptionByIdem(promotionId: string, idempotencyKey: string, tenantId?: string): Promise<RedemptionRow | null>;
  countRedemptions(promotionId: string, scope: { customerId: string | null; branchId: string | null; tenantId: string }): Promise<RedemptionCounts>;
  insertRedemption(input: InsertRedemptionInput, limits?: { customerLimit: number; tenantLimit: number }): Promise<RedemptionRow>;
  getRedemption(id: string, tenantId: string): Promise<RedemptionRow | null>;
  reverseRedemption(id: string, reason: string, tenantId?: string): Promise<RedemptionRow | null>;
}

// In-memory impl — models the unique-idempotency and count-based limit behavior for tests / no-DB.
export class InMemoryPromotionsRepository implements PromotionsRepositoryPort {
  promotions = new Map<string, PromotionFacts>();
  redemptions: RedemptionRow[] = [];
  private seq = 1;
  async getPromotion(id: string, tenantId: string) { const p = this.promotions.get(id); return p && p.tenantId === tenantId ? p : null; }
  async findRedemptionByIdem(promotionId: string, idempotencyKey: string) { return this.redemptions.find((r) => r.promotionId === promotionId && r.idempotencyKey === idempotencyKey) || null; }
  async countRedemptions(promotionId: string, scope: { customerId: string | null; branchId: string | null; tenantId: string }) {
    const live = this.redemptions.filter((r) => r.promotionId === promotionId && r.status === 'redeemed');
    return {
      customerCount: scope.customerId ? live.filter((r) => r.customerId === scope.customerId).length : 0,
      branchCount: scope.branchId ? live.filter((r) => r.branchId === scope.branchId).length : 0,
      tenantCount: live.filter((r) => r.tenantId === scope.tenantId).length,
      globalCount: live.length,
    };
  }
  async insertRedemption(i: InsertRedemptionInput): Promise<RedemptionRow> {
    const existing = await this.findRedemptionByIdem(i.promotionId, i.idempotencyKey);
    if (existing) return existing; // unique constraint behavior
    const row: RedemptionRow = { id: `r${this.seq++}`, promotionId: i.promotionId, tenantId: i.tenantId, branchId: i.branchId, customerId: i.customerId, eligibleSubtotalCents: i.eligibleSubtotalCents, discountCents: i.discountCents, finalSubtotalCents: i.finalSubtotalCents, status: 'redeemed', idempotencyKey: i.idempotencyKey, redeemedAt: new Date().toISOString(), reversedAt: null };
    this.redemptions.push(row); return row;
  }
  async getRedemption(id: string, tenantId: string) { return this.redemptions.find((r) => r.id === id && r.tenantId === tenantId) || null; }
  async reverseRedemption(id: string, reason: string) { const r = this.redemptions.find((x) => x.id === id); if (!r) return null; r.status = 'reversed'; r.reversedAt = new Date().toISOString(); (r as any).reversalReason = reason; return r; }
}
