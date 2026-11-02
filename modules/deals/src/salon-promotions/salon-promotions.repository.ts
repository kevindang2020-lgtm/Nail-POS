// salon-promotions.repository.ts — repository port + in-memory adapter (dev/offline/tests default).
import type { SalonPromotionsContext, SalonPromotion, CreateSalonPromotionInput, SalonPromotionStatus } from './salon-promotions.dto';

export interface SalonPromotionsRepositoryPort {
  list(ctx: SalonPromotionsContext): Promise<SalonPromotion[]>;
  create(ctx: SalonPromotionsContext, input: CreateSalonPromotionInput): Promise<SalonPromotion>;
  setStatus(ctx: SalonPromotionsContext, id: string, status: SalonPromotionStatus): Promise<SalonPromotion | null>;
  findByCode(ctx: SalonPromotionsContext, code: string): Promise<SalonPromotion | null>;
}

export class InMemorySalonPromotionsRepository implements SalonPromotionsRepositoryPort {
  private rows: SalonPromotion[];
  constructor(seed: SalonPromotion[] = []) { this.rows = seed.slice(); }
  async list(_ctx: SalonPromotionsContext): Promise<SalonPromotion[]> { return this.rows.slice(); }
  async create(_ctx: SalonPromotionsContext, input: CreateSalonPromotionInput): Promise<SalonPromotion> {
    const row: SalonPromotion = {
      id: 'salonpromo_' + (this.rows.length + 1), code: input.code, name: input.name, discountType: input.discountType,
      discountPercent: input.discountType === 'percent' ? Number(input.discountPercent) : null,
      discountCents: input.discountType === 'fixed' ? Number(input.discountCents) : null,
      minPurchaseCents: Number(input.minPurchaseCents || 0), status: 'active',
      startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
      maxRedemptions: input.maxRedemptions ?? null, redemptionCount: 0, createdAt: new Date().toISOString(),
    };
    this.rows.push(row); return row;
  }
  async setStatus(_ctx: SalonPromotionsContext, id: string, status: SalonPromotionStatus): Promise<SalonPromotion | null> {
    const r = this.rows.find((x) => x.id === id); if (!r) return null; r.status = status; return r;
  }
  async findByCode(_ctx: SalonPromotionsContext, code: string): Promise<SalonPromotion | null> {
    return this.rows.find((x) => x.code.toLowerCase() === (code || '').toLowerCase()) ?? null;
  }
}
