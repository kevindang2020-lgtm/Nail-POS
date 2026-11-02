// Repository port for Promotions & Offers oversight — now reads the REAL promotions + tenant_promotion_redemptions tables.
// Widgets with no schema yet (templates, abuse, redemption-rate denominator) remain honest gaps in the service.
import type { OfferFacts } from './promotions-core';

export interface StatusCount { status: string; count: number }
export interface TypeCount { type: string; count: number }
export interface KpiTotals {
  active: number; scheduled: number; completed: number; redemptions: number; revenueCents: number; participatingBranches: number;
  platformOffers: number; highValuePending: number; discountTotalCents: number; eligibleTotalCents: number;
}
export interface DailyPoint { day: string; redemptions: number; revenueCents: number }
export interface TopPromotionRow { id: string; name: string | null; tenant: string | null; branch: string | null; offer: string | null; status: string; revenueCents: number; redemptions: number; startAt: string | null; endAt: string | null }
export interface TenantOversightRow { tenantId: string; tenant: string | null; active: number; redemptions: number; revenueCents: number; lastActivity: string | null }
export interface BottomTotals { redemptionsToday: number; revenueTodayCents: number; newOffersToday: number }

export interface PromotionsOversightRepositoryPort {
  statusCounts(): Promise<StatusCount[]>;
  typeCounts(): Promise<TypeCount[]>;
  kpiTotals(): Promise<KpiTotals>;
  daily7(): Promise<DailyPoint[]>;
  topPromotions(limit: number): Promise<TopPromotionRow[]>;
  byTenant(limit: number): Promise<TenantOversightRow[]>;
  exceptionCandidates(limit: number): Promise<OfferFacts[]>;
  bottomTotals(): Promise<BottomTotals>;
}

export class InMemoryPromotionsOversightRepository implements PromotionsOversightRepositoryPort {
  async statusCounts() { return []; }
  async typeCounts() { return []; }
  async kpiTotals() { return { active: 0, scheduled: 0, completed: 0, redemptions: 0, revenueCents: 0, participatingBranches: 0, platformOffers: 0, highValuePending: 0, discountTotalCents: 0, eligibleTotalCents: 0 }; }
  async daily7() { return []; }
  async topPromotions() { return []; }
  async byTenant() { return []; }
  async exceptionCandidates() { return []; }
  async bottomTotals() { return { redemptionsToday: 0, revenueTodayCents: 0, newOffersToday: 0 }; }
}
