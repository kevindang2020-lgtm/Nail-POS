// Pure logic for the Super Admin Promotions & Offers oversight surface. No DB/Nest deps. The real source is the
// `campaigns` table (a marketing record with name/status/offer/revenue/bookings), mapped to an offer-oversight view.
// Anything without a real column (templates, platform offers, abuse, discount %, redemption limits) stays an HONEST
// GAP (available:false) — never fabricated.

// campaign.status → offer-status label + tone. Kept as the single mapping used by counts, the donut, and the table.
export const OFFER_STATUS_MAP: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info' }> = {
  draft: { label: 'Draft', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'warn' },
  in_progress: { label: 'Active', tone: 'ok' },
  active: { label: 'Active', tone: 'ok' },
  completed: { label: 'Completed', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  paused: { label: 'Paused', tone: 'warn' },
  expired: { label: 'Expired', tone: 'muted' },
  disabled: { label: 'Disabled', tone: 'danger' },
};
export function offerStatus(status: string | null | undefined): { label: string; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info' } {
  return OFFER_STATUS_MAP[String(status || '').toLowerCase()] || { label: status ? String(status) : 'Unknown', tone: 'muted' };
}

export interface PromotionKpi { value: number | null; available: boolean; note?: string }
const kpi = (v: number | null | undefined, note?: string): PromotionKpi => ({ value: v == null ? null : Number(v), available: v != null, ...(note ? { note } : {}) });

export interface PromotionKpiRaw {
  activePromotions?: number | null; scheduledPromotions?: number | null; completedPromotions?: number | null;
  discountRedemptions?: number | null; revenueImpactCents?: number | null; participatingBranches?: number | null;
  platformOffers?: number | null; highValuePending?: number | null; averageDiscountPct?: number | null;
}

// Assembles the 12 headline KPIs. Sourceable KPIs resolve; only those with genuinely no schema (templates, abuse
// alerts, redemption rate) stay honest gaps. A value of 0 is a real answer (e.g. zero platform offers), not a gap.
export function assemblePromotionKpis(raw: PromotionKpiRaw): {
  promotionTemplates: PromotionKpi; activePromotions: PromotionKpi; scheduledPromotions: PromotionKpi; completedPromotions: PromotionKpi;
  platformOffers: PromotionKpi; discountRedemptions: PromotionKpi; revenueImpactCents: PromotionKpi; abuseAlerts: PromotionKpi;
  participatingBranches: PromotionKpi; averageDiscountPct: PromotionKpi; redemptionRatePct: PromotionKpi; highValuePending: PromotionKpi;
} {
  return {
    promotionTemplates: kpi(null, 'No promotion-template schema'),
    activePromotions: kpi(raw.activePromotions),
    scheduledPromotions: kpi(raw.scheduledPromotions),
    completedPromotions: kpi(raw.completedPromotions),
    platformOffers: kpi(raw.platformOffers, 'Promotions owned by the platform'),
    discountRedemptions: kpi(raw.discountRedemptions, 'Successful promotion redemptions'),
    revenueImpactCents: kpi(raw.revenueImpactCents, 'Gross attributed post-discount revenue'),
    abuseAlerts: kpi(null, 'No abuse-detection schema'),
    participatingBranches: kpi(raw.participatingBranches, 'Distinct branches with promotions'),
    averageDiscountPct: kpi(raw.averageDiscountPct, 'Weighted: total discount ÷ eligible subtotal'),
    redemptionRatePct: kpi(null, 'No offer-exposure denominator'),
    highValuePending: kpi(raw.highValuePending, 'Promotions pending high-value approval'),
  };
}

// Weighted average discount percentage — total discount cents ÷ total eligible-subtotal cents (documented denominator).
export function weightedDiscountPct(totalDiscountCents: number, totalEligibleCents: number): number | null {
  if (!totalEligibleCents || totalEligibleCents <= 0) return null;
  return Math.round((totalDiscountCents / totalEligibleCents) * 1000) / 10;
}

const TYPE_LABELS: Record<string, string> = {
  percentage: 'Percentage Discount', fixed_amount: 'Fixed Amount Discount', buy_x_get_y: 'Buy X Get Y', bundle: 'Bundle Offer',
  free_service: 'Free Service', free_product: 'Free Product', package: 'Package Discount', new_client: 'New Client Offer', platform_sponsored: 'Platform-Sponsored',
};
// Donut segments for Promotion Mix by Type — center total reconciles with the sum of segments (real structured type).
export function assembleTypeMix(counts: { type: string; count: number }[]): { segments: { label: string; value: number }[]; total: number } {
  const segments = (counts || []).map((c) => ({ label: TYPE_LABELS[String(c.type || '').toLowerCase()] || String(c.type || 'Other'), value: Number(c.count) || 0 })).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  return { segments, total: segments.reduce((s, x) => s + x.value, 0) };
}

// Donut segments for Offer Status Overview — center total equals the sum of included segments (reconciles by design).
export function assembleStatusMix(counts: { status: string; count: number }[]): { segments: { label: string; value: number; tone: string }[]; total: number } {
  const byLabel = new Map<string, { value: number; tone: string }>();
  for (const c of counts || []) {
    const s = offerStatus(c.status); const n = Number(c.count) || 0;
    const cur = byLabel.get(s.label) || { value: 0, tone: s.tone };
    cur.value += n; byLabel.set(s.label, cur);
  }
  const segments = Array.from(byLabel.entries()).map(([label, v]) => ({ label, value: v.value, tone: v.tone })).sort((a, b) => b.value - a.value);
  return { segments, total: segments.reduce((s, x) => s + x.value, 0) };
}

export function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

// Offer Exceptions — REAL integrity checks derived from the actual record (no separate table needed). Each returned
// exception is a genuine data problem, an investigation signal, not an accusation.
export interface OfferFacts { id: string; name: string | null; tenant: string | null; status: string; startAt: string | null; endAt: string | null; branchId: string | null; tenantId: string | null; revenueCents: number }
export interface OfferException { id: string; name: string; tenant: string | null; issue: string; severity: 'Low' | 'Medium' | 'High'; }
export function deriveOfferExceptions(o: OfferFacts): OfferException[] {
  const out: OfferException[] = [];
  const name = o.name || '(unnamed)';
  const push = (issue: string, severity: 'Low' | 'Medium' | 'High') => out.push({ id: o.id, name, tenant: o.tenant, issue, severity });
  const start = o.startAt ? Date.parse(o.startAt) : NaN;
  const end = o.endAt ? Date.parse(o.endAt) : NaN;
  if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) push('End date before start date', 'High');
  const status = String(o.status || '').toLowerCase();
  if (['in_progress', 'active'].includes(status) && !Number.isNaN(end) && end < Date.now()) push('Expired but still active', 'Medium');
  if (!o.tenantId) push('Missing tenant', 'High');
  if (!o.branchId && ['in_progress', 'active', 'scheduled'].includes(status)) push('No branch assigned', 'Low');
  if (o.revenueCents < 0) push('Negative revenue recorded', 'Medium');
  return out;
}
