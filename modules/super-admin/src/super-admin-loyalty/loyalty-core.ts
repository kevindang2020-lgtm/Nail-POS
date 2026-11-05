// loyalty-core.ts — pure, I/O-free math for the Super Admin "Loyalty Programs" oversight dashboard. No DB, no clock.
// Points are INTEGER units; money is INTEGER CENTS. Derives from the real loyalty tables (customer_loyalty_profiles,
// loyalty_redemptions, loyalty_rewards). Where no event source exists (points-issuance/expiration time-series,
// suspicious-case store), callers surface honest zeros / NotConnected rather than fabricating — never invented here.

export interface ProfileLike { tier: string; pointsBalance: number; totalEarned: number; totalRedeemed: number; hasRecentActivity?: boolean }

const int = (n: unknown): number => { const v = Math.trunc(Number(n)); return Number.isFinite(v) ? v : 0; };

// --- point liability -------------------------------------------------------------------------------------------
export interface LiabilityValuation { centsPerPoint: number }         // documented, effective-dated by the caller
export const DEFAULT_VALUATION: LiabilityValuation = { centsPerPoint: 1 }; // $0.01 / point unless a tenant overrides

/** Outstanding liability = eligible outstanding points × monetary value per point (integer cents, decimal-safe). */
export function liabilityCents(outstandingPoints: number, v: LiabilityValuation = DEFAULT_VALUATION): number {
  return int(outstandingPoints) * int(v.centsPerPoint);
}

// --- distributions ---------------------------------------------------------------------------------------------
/** Tier distribution over members; counts are mutually exclusive and reconcile to the member total. Tier names are
 *  used dynamically (never forced onto Bronze/Silver/Gold/Platinum). */
export function tierDistribution(profiles: { tier: string }[]): { total: number; slices: { tier: string; count: number; pct: number }[] } {
  const total = profiles.length;
  const counts = new Map<string, number>();
  for (const p of profiles) { const t = (p.tier || 'Regular').trim() || 'Regular'; counts.set(t, (counts.get(t) ?? 0) + 1); }
  const slices = [...counts.entries()].map(([tier, count]) => ({ tier, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 })).sort((a, b) => b.count - a.count);
  return { total, slices };
}

export type RedemptionStatus = 'redeemed' | 'pending' | 'flagged';
/** Redemption-status distribution. Redemptions without a status field are 'redeemed' (completed) — honest, since the
 *  base table records completed redemptions only; pending/flagged appear only when a real status is present. */
export function redemptionStatusDistribution(redemptions: { status?: string | null }[]): { total: number; slices: { status: RedemptionStatus; count: number; pct: number }[] } {
  const total = redemptions.length;
  const counts = new Map<RedemptionStatus, number>([['redeemed', 0], ['pending', 0], ['flagged', 0]]);
  for (const r of redemptions) {
    const s = String(r.status ?? 'redeemed').toLowerCase();
    const key: RedemptionStatus = s === 'pending' ? 'pending' : s === 'flagged' || s === 'suspicious' ? 'flagged' : 'redeemed';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const slices = [...counts.entries()].filter(([, c]) => c > 0).map(([status, count]) => ({ status, count, pct: total ? Math.round((count / total) * 1000) / 10 : 0 }));
  return { total, slices };
}

// --- engagement ------------------------------------------------------------------------------------------------
/** Loyalty engagement = active members with qualifying activity ÷ active members (0..100, one decimal). */
export function engagementPct(activeMembers: number, membersWithActivity: number): number {
  if (activeMembers <= 0) return 0;
  return Math.round((Math.min(membersWithActivity, activeMembers) / activeMembers) * 1000) / 10;
}

/** Average reward redemption rate = successful redemptions ÷ eligible rewards issued (0..100). Distinct from the
 *  point-redemption rate. Returns 0 when there are no eligible rewards. */
export function avgRedemptionRatePct(redeemed: number, eligibleIssued: number): number {
  if (eligibleIssued <= 0) return 0;
  return Math.round((redeemed / eligibleIssued) * 1000) / 10;
}

// --- KPI rollup ------------------------------------------------------------------------------------------------
export interface LoyaltyKpis {
  loyaltyMembers: number; pointsIssued: number; pointsRedeemed: number; liabilityCents: number;
  rewardsIssued: number; tierMembership: number; expiredPoints: number; suspiciousActivity: number;
  engagementPct: number; programPerformancePct: number; activePrograms: number; avgRedemptionRatePct: number;
}

export interface RollupInput {
  profiles: ProfileLike[]; redemptionCount: number; eligibleRewardsIssued: number; activePrograms: number;
  baseTier?: string;                       // members in tiers above this count toward "tier membership"
  expiredPoints?: number;                  // 0 unless an expiration ledger is connected (honest)
  suspiciousActivity?: number;             // 0 unless a suspicious-case store is connected (honest)
  programPerformancePct?: number;          // documented composite; null/undefined → 0 when not modeled
  valuation?: LiabilityValuation;
}

export function rollupKpis(inp: RollupInput): LoyaltyKpis {
  const base = (inp.baseTier ?? 'Regular').toLowerCase();
  let outstanding = 0, issued = 0, redeemed = 0, tiered = 0, active = 0;
  for (const p of inp.profiles) {
    outstanding += int(p.pointsBalance); issued += int(p.totalEarned); redeemed += int(p.totalRedeemed);
    active += 1;
    if ((p.tier || 'Regular').toLowerCase() !== base) tiered += 1;
  }
  const withActivity = inp.profiles.filter((p) => p.hasRecentActivity).length;
  return {
    loyaltyMembers: active, pointsIssued: issued, pointsRedeemed: redeemed, liabilityCents: liabilityCents(outstanding, inp.valuation),
    rewardsIssued: inp.redemptionCount, tierMembership: tiered, expiredPoints: int(inp.expiredPoints), suspiciousActivity: int(inp.suspiciousActivity),
    engagementPct: engagementPct(active, withActivity), programPerformancePct: Math.max(0, Math.min(100, Number(inp.programPerformancePct ?? 0))),
    activePrograms: int(inp.activePrograms), avgRedemptionRatePct: avgRedemptionRatePct(inp.redemptionCount, inp.eligibleRewardsIssued),
  };
}

// --- business-semantic trend favorability ----------------------------------------------------------------------
// Whether an INCREASE in a metric is good for the loyalty program's health. Absent = neutral.
export const INCREASE_GOOD: Record<string, boolean> = {
  loyaltyMembers: true, pointsIssued: true, pointsRedeemed: true, rewardsIssued: true, tierMembership: true,
  engagementPct: true, programPerformancePct: true, activePrograms: true, avgRedemptionRatePct: true, newMembers: true,
  suspiciousActivity: false, expiredPoints: false, flaggedCases: false,
  // liability & liabilityCents are intentionally ABSENT → neutral (an increase is not automatically good or bad).
};
export interface MetricTrend { delta: number; pct: number | null; favorable: boolean | null }
export function trendOf(metric: string, current: number, prior: number | null): MetricTrend | null {
  if (prior == null) return null;
  const delta = Math.round((current - prior) * 10) / 10;
  const pct = prior !== 0 ? Math.round(((current - prior) / Math.abs(prior)) * 1000) / 10 : null;
  const good = INCREASE_GOOD[metric];
  const favorable = delta === 0 || good === undefined ? null : good ? delta > 0 : delta < 0;
  return { delta, pct, favorable };
}
