// menu-insights.repository.ts — port + in-memory adapter. The repository's only job is to GATHER real metrics
// (per-service revenue/margin/bookings, product sales, combo lift); the rules engine (menu-insights-core) turns them
// into insights. Only the demo tenant (luxe001) is seeded; every other tenant gathers empty metrics → the service
// reports hasEnoughData=false and zero insights (honest, never fabricated).
import type { MenuInsightsGathered } from './menu-insights.dto';

export interface InsightsContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface MenuInsightsRepositoryPort {
  gather(ctx: InsightsContext, windowDays: number): Promise<MenuInsightsGathered>;
}

export class InMemoryMenuInsightsRepository implements MenuInsightsRepositoryPort {
  async gather(ctx: InsightsContext, _windowDays: number): Promise<MenuInsightsGathered> {
    if (ctx.tenantId !== 'luxe001') return { services: [], products: [], combos: [] };
    // Real-shaped demo metrics (one window's worth) for luxe001 — the SAME inputs production reads from ticket data.
    return {
      services: [
        { serviceId: 'svc_gelmani', name: 'Gel Manicure', categoryId: 'cat_mani', categoryName: 'Manicures', priceCents: 4500, costCents: 1400, bookings: 120, revenueCents: 540000, addOnAttachRate: 0.31 },
        { serviceId: 'svc_acrylic', name: 'Acrylic Full Set', categoryId: 'cat_acrylic', categoryName: 'Acrylic', priceCents: 6500, costCents: 2100, bookings: 64, revenueCents: 416000, addOnAttachRate: 0.22 },
        { serviceId: 'svc_pedi', name: 'Spa Pedicure', categoryId: 'cat_pedi', categoryName: 'Pedicures', priceCents: 5500, costCents: 1800, bookings: 70, revenueCents: 385000, addOnAttachRate: 0.18 },
        { serviceId: 'svc_gelx', name: 'Gel X Full Set', categoryId: 'cat_acrylic', categoryName: 'Acrylic', priceCents: 6000, costCents: 2000, bookings: 58, revenueCents: 348000, addOnAttachRate: 0.20 },
        { serviceId: 'svc_paraffin', name: 'Paraffin Treatment', categoryId: 'cat_addons', categoryName: 'Add-Ons', priceCents: 1200, costCents: 960, bookings: 24, revenueCents: 28800, addOnAttachRate: null },
      ],
      products: [
        { productId: 'prod_base', name: 'Base Coat', unitsSold: 41, revenueCents: 40959, marginPct: 68 },
        { productId: 'prod_top', name: 'Top Coat - No Wipe', unitsSold: 28, revenueCents: 30772, marginPct: 69 },
        { productId: 'prod_lotion', name: 'Hand & Body Lotion', unitsSold: 38, revenueCents: 49362, marginPct: 65 },
        { productId: 'prod_cuticle', name: 'Cuticle Oil - Lavender', unitsSold: 4, revenueCents: 3596, marginPct: 66 },
      ],
      combos: [
        { aId: 'svc_gelmani', aName: 'Gel Mani', bId: 'svc_nailart', bName: 'Nail Art', baseConversion: 0.20, comboConversion: 0.58, sampleSize: 64 },
      ],
    };
  }
}
