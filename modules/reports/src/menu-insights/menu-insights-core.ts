// menu-insights-core.ts — framework-free rules engine for "AI Pricing & Menu Insights".
// Insights are DERIVED from supplied real metrics (per-service revenue/margin/bookings, product sales, combo lift);
// this module invents nothing — when the grounding metrics are absent, the corresponding insight simply does not fire,
// and an empty metric set yields hasEnoughData=false. All thresholds are explicit constants. Money is integer cents.

export type InsightKind = 'top_performer' | 'raise_price' | 'low_margin' | 'promote_underperformer' | 'bundle_opportunity';
export type InsightSeverity = 'info' | 'opportunity' | 'warning';
export type InsightSubjectType = 'service' | 'product' | 'combo';
export type InsightImpactUnit = 'cents_per_month' | 'percent' | null;

export interface ServiceMetric {
  serviceId: string; name: string; categoryId: string; categoryName: string;
  priceCents: number; costCents: number | null;       // null = unknown (no costed recipe) → no margin insight
  bookings: number;                                   // over the window
  revenueCents: number;                               // over the window
  addOnAttachRate: number | null;                     // 0..1, null = unknown
}
export interface ProductMetric { productId: string; name: string; unitsSold: number; revenueCents: number; marginPct: number | null; }
export interface ComboMetric { aId: string; aName: string; bId: string; bName: string; baseConversion: number; comboConversion: number; sampleSize: number; }
export interface MenuInsightsInput { windowDays: number; services: ServiceMetric[]; products: ProductMetric[]; combos: ComboMetric[]; nowIso: string; }

export interface MenuInsight {
  id: string; kind: InsightKind; severity: InsightSeverity; subjectType: InsightSubjectType; subjectId: string;
  title: string; message: string; ctaLabel: string; ctaAction: string;
  impactValue: number | null; impactUnit: InsightImpactUnit; impactLabel: string | null;
}
export interface MenuInsightsCoverage {
  services: number; servicesWithCost: number; servicesWithBookings: number; products: number; combos: number; totalServiceRevenueCents: number;
}
export interface MenuInsightsResult {
  generatedAt: string; windowDays: number; hasEnoughData: boolean; insights: MenuInsight[]; coverage: MenuInsightsCoverage;
}

// ---- tunable thresholds ----
export const TOP_SHARE_MIN = 0.15;            // a service must drive ≥15% of service revenue to be flagged a top performer
export const LOW_MARGIN_PCT = 35;             // services below this margin% are flagged (cost must be known)
export const RAISE_MIN_HEADROOM_CENTS = 200;  // only suggest a raise when ≥$2.00 below the category median
export const RAISE_CAP_CENTS = 1000;          // never suggest more than a $10.00 increase in one step
export const RAISE_BOOKINGS_PCTL = 0.67;      // "high demand" = bookings at/above the 67th percentile
export const BUNDLE_LIFT_MIN = 0.10;          // ≥10 percentage-point conversion lift to suggest a bundle
export const BUNDLE_MIN_SAMPLE = 20;          // ignore combos with thin sample sizes
export const PROMOTE_MIN_PRODUCTS = 4;        // need a real catalog before calling something an underperformer
export const PROMOTE_RATIO = 0.5;             // underperformer = sold < half the peer median
export const MAX_INSIGHTS = 8;

export function marginPct(priceCents: number, costCents: number | null): number | null {
  if (costCents == null || priceCents <= 0) return null;
  return Math.round(((priceCents - costCents) / priceCents) * 100);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Lowest value v such that at least p of the population is ≤ v (nearest-rank). */
function percentile(nums: number[], p: number): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

function withCommas(n: number): string { return n.toLocaleString('en-US'); }
export function fmtUsd(cents: number, plus = false): string {
  const sign = plus ? '+' : '';
  const whole = Math.round(cents / 100);
  if (cents % 100 === 0) return `${sign}$${withCommas(whole)}`;
  return `${sign}$${(cents / 100).toFixed(2)}`;
}

export function computeMenuInsights(input: MenuInsightsInput): MenuInsightsResult {
  const services = input.services || [];
  const products = input.products || [];
  const combos = input.combos || [];
  const windowDays = input.windowDays > 0 ? input.windowDays : 30;
  const totalRevenue = services.reduce((a, s) => a + Math.max(0, s.revenueCents || 0), 0);
  const coverage: MenuInsightsCoverage = {
    services: services.length, servicesWithCost: services.filter((s) => s.costCents != null).length,
    servicesWithBookings: services.filter((s) => (s.bookings || 0) > 0).length, products: products.length,
    combos: combos.length, totalServiceRevenueCents: totalRevenue,
  };
  const hasEnoughData = totalRevenue > 0 || products.some((p) => (p.unitsSold || 0) > 0) || combos.length > 0;
  if (!hasEnoughData) return { generatedAt: input.nowIso, windowDays, hasEnoughData: false, insights: [], coverage };

  const out: MenuInsight[] = [];

  // --- low margin (warning) ---
  const lowMargin = services
    .map((s) => ({ s, m: marginPct(s.priceCents, s.costCents) }))
    .filter((x) => x.m != null && (x.m as number) < LOW_MARGIN_PCT)
    .sort((a, b) => (a.m as number) - (b.m as number))
    .slice(0, 2);
  for (const { s, m } of lowMargin) {
    out.push({
      id: `low_margin:${s.serviceId}`, kind: 'low_margin', severity: 'warning', subjectType: 'service', subjectId: s.serviceId,
      title: 'Low margin alert', message: `${s.name} margin is only ${m}%. Review pricing.`,
      ctaLabel: 'Review', ctaAction: 'review_pricing', impactValue: m, impactUnit: 'percent', impactLabel: `${m}% margin`,
    });
  }

  // --- raise price (opportunity) ---
  const byCat = new Map<string, number[]>();
  for (const s of services) if (s.priceCents > 0) { const arr = byCat.get(s.categoryId) || []; arr.push(s.priceCents); byCat.set(s.categoryId, arr); }
  const bookingsList = services.map((s) => s.bookings || 0);
  const demandThreshold = percentile(bookingsList.filter((b) => b > 0), RAISE_BOOKINGS_PCTL);
  const monthly = (bookings: number) => bookings * (30 / windowDays);
  const raises = services
    .map((s) => {
      const catPrices = byCat.get(s.categoryId) || [];
      if (catPrices.length < 2 || (s.bookings || 0) <= 0) return null;
      const med = median(catPrices);
      const headroom = med - s.priceCents;
      if (headroom < RAISE_MIN_HEADROOM_CENTS) return null;
      if ((s.bookings || 0) < demandThreshold) return null;
      const suggested = Math.min(headroom, RAISE_CAP_CENTS);
      const uplift = Math.round(suggested * monthly(s.bookings));
      return { s, suggested, uplift };
    })
    .filter((x): x is { s: ServiceMetric; suggested: number; uplift: number } => x != null)
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, 2);
  for (const { s, suggested, uplift } of raises) {
    out.push({
      id: `raise_price:${s.serviceId}`, kind: 'raise_price', severity: 'opportunity', subjectType: 'service', subjectId: s.serviceId,
      title: 'Raise price', message: `${s.name} can increase by ${fmtUsd(suggested)} (high demand, ${fmtUsd(Math.max(0, suggested))} below category median).`,
      ctaLabel: 'Review', ctaAction: 'review_pricing', impactValue: uplift, impactUnit: 'cents_per_month', impactLabel: `${fmtUsd(uplift, true)}/mo`,
    });
  }

  // --- bundle opportunity (opportunity) ---
  const bundleable = combos
    .map((c) => ({ c, lift: (c.comboConversion - c.baseConversion) }))
    .filter((x) => x.lift >= BUNDLE_LIFT_MIN && x.c.sampleSize >= BUNDLE_MIN_SAMPLE)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 2);
  for (const { c, lift } of bundleable) {
    const liftPct = Math.round(lift * 100);
    out.push({
      id: `bundle_opportunity:${c.aId}_${c.bId}`, kind: 'bundle_opportunity', severity: 'opportunity', subjectType: 'combo', subjectId: `${c.aId}_${c.bId}`,
      title: 'Bundle opportunity', message: `${liftPct}% more conversions when "${c.aName}" and "${c.bName}" are bundled.`,
      ctaLabel: 'Create Bundle', ctaAction: 'create_bundle', impactValue: liftPct, impactUnit: 'percent', impactLabel: `+${liftPct}% conv.`,
    });
  }

  // --- promote underperformer (opportunity, products) ---
  if (products.length >= PROMOTE_MIN_PRODUCTS) {
    const peerMedian = median(products.map((p) => p.unitsSold || 0));
    const under = products
      .filter((p) => (p.unitsSold || 0) < peerMedian * PROMOTE_RATIO)
      .sort((a, b) => (a.unitsSold || 0) - (b.unitsSold || 0))
      .slice(0, 1);
    for (const p of under) {
      out.push({
        id: `promote_underperformer:${p.productId}`, kind: 'promote_underperformer', severity: 'opportunity', subjectType: 'product', subjectId: p.productId,
        title: 'Promote', message: `${p.name} is underperforming. Consider bundling or a promotion.`,
        ctaLabel: 'Action Suggested', ctaAction: 'create_bundle', impactValue: null, impactUnit: null, impactLabel: null,
      });
    }
  }

  // --- top performer (info) ---
  if (totalRevenue > 0) {
    const top = [...services].sort((a, b) => (b.revenueCents || 0) - (a.revenueCents || 0))[0];
    if (top && top.revenueCents > 0) {
      const share = top.revenueCents / totalRevenue;
      if (share >= TOP_SHARE_MIN) {
        const pct = Math.round(share * 100);
        out.push({
          id: `top_performer:${top.serviceId}`, kind: 'top_performer', severity: 'info', subjectType: 'service', subjectId: top.serviceId,
          title: 'Top performer', message: `${top.name} drives ${pct}% of total service revenue.`,
          ctaLabel: 'Keep Promoting', ctaAction: 'keep_promoting', impactValue: pct, impactUnit: 'percent', impactLabel: `${pct}% of revenue`,
        });
      }
    }
  }

  return { generatedAt: input.nowIso, windowDays, hasEnoughData: true, insights: out.slice(0, MAX_INSIGHTS), coverage };
}
