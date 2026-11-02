// loyalty-dashboard.service.ts — composes loyalty-core over LoyaltyDashboardRepository into the fuller Super Admin
// Loyalty Programs overview: 12 KPIs (+ business-semantic trends where a baseline exists), tier & redemption-status
// donuts, points-activity & member-growth series, top programs, program-performance-by-tenant, suspicious review
// (honest-empty until a case store exists), and a 6-metric At-a-Glance. Read-only; every value reconciles to the rows.
import type { OverviewScope } from '@aipowersalon/database';
import type { LoyaltyDashboardRepository, RawTenantPerf } from './loyalty-dashboard.repository';
import {
  rollupKpis, tierDistribution, redemptionStatusDistribution, engagementPct, avgRedemptionRatePct, liabilityCents,
  DEFAULT_VALUATION, type LoyaltyKpis,
} from './loyalty-core';

export interface AdminCtx { userId?: string; email?: string; ip?: string }

export interface TopProgramRow { tenantId: string; tenantName: string | null; name: string; type: 'Points' | 'Tiered'; members: number; pointsIssued: number; pointsRedeemed: number; rewardsIssued: number; redemptionRatePct: number; liabilityCents: number; status: 'Active' | 'Inactive' }
export interface TenantPerfRow { tenantId: string; tenantName: string | null; activePrograms: number; members: number; engagementPct: number; redemptionRatePct: number; liabilityCents: number; status: 'Healthy' | 'Strong' | 'Watch' }

export interface LoyaltyDashboard {
  meta: { generatedAt: string; scope: 'platform' | 'tenant'; centsPerPoint: number };
  kpis: LoyaltyKpis;
  tierDistribution: { total: number; slices: { tier: string; count: number; pct: number }[] };
  redemptionStatus: { total: number; slices: { status: string; count: number; pct: number }[] };
  pointsActivityTrend: { day: string; issued: number | null; redeemed: number; expired: number | null }[];
  memberGrowth: { day: string; members: number; engagementPct: number | null }[];
  topPrograms: TopProgramRow[];
  tenantPerformance: TenantPerfRow[];
  suspiciousReview: { available: boolean; reason?: string; rows: { id: string; tenantName: string | null; signalType: string; severity: string; status: string; detail: any; detectedAt: string }[] };
  atAGlance: { newMembers: number; rewardsRedeemed: number; pointsIssued: number | null; expiredPoints: number | null; liabilityChangeCents: number | null; flaggedCasesOpen: number };
  tenantCount: number;
}

interface SuspiciousProvider {
  countOpen(scope?: OverviewScope): Promise<number>;
  listCases(scope?: OverviewScope, status?: string, limit?: number): Promise<{ id: string; tenantId: string; signalType: string; severity: string; status: string; detail: any; detectedAt: string }[]>;
}

const pct = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

export class LoyaltyDashboardService {
  constructor(private readonly repo: LoyaltyDashboardRepository, private readonly suspicious?: SuspiciousProvider) {}

  async getDashboard(_ctx: AdminCtx, q: { scope?: OverviewScope; centsPerPoint?: number }): Promise<LoyaltyDashboard> {
    const scope = q.scope;
    const valuation = { centsPerPoint: Math.max(0, Math.trunc(Number(q.centsPerPoint)) || DEFAULT_VALUATION.centsPerPoint) };
    const d = await this.repo.dashboardData(scope);
    const r = d.rollup;

    // synthesize profile-likes for the tier/rollup (we already have aggregates; build KPI directly)
    const engagement = engagementPct(r.members, r.membersWithActivity);
    const redemptionRate = avgRedemptionRatePct(r.pointsRedeemed, r.pointsIssued); // point-redemption efficiency
    const kpis: LoyaltyKpis = rollupKpis({
      profiles: [], redemptionCount: d.redemptionsTotal, eligibleRewardsIssued: Math.max(d.redemptionsTotal, d.activeRewards, 1),
      activePrograms: r.tenantsWithLoyalty, valuation,
    });
    // overwrite aggregate-derived fields (rollup over [] can't see the real aggregates)
    kpis.loyaltyMembers = r.members; kpis.pointsIssued = r.pointsIssued; kpis.pointsRedeemed = r.pointsRedeemed;
    kpis.liabilityCents = liabilityCents(r.pointsOutstanding, valuation); kpis.tierMembership = r.tiered;
    kpis.engagementPct = engagement; kpis.avgRedemptionRatePct = redemptionRate;
    kpis.programPerformancePct = Math.min(100, Math.round((engagement * 0.5 + redemptionRate * 0.5) * 10) / 10);

    const tier = tierDistribution(d.tierRows.flatMap((t) => Array.from({ length: t.count }, () => ({ tier: t.tier }))));
    // Cheaper: build directly from counts (avoids allocating per-member). Keep the reconciled result.
    const tierDist = { total: d.tierRows.reduce((a, t) => a + t.count, 0), slices: d.tierRows.map((t) => ({ tier: t.tier, count: t.count, pct: pct(t.count, d.rollup.members) })).sort((a, b) => b.count - a.count) };
    void tier;

    const redemptionStatus = redemptionStatusDistribution(Array.from({ length: d.redemptionsTotal }, () => ({})));

    // points-activity trend: redeemed is REAL (from redemptions time-series). issued/expired have NO event source → null (honest).
    const pointsActivityTrend = d.redemptionsByDay.map((x) => ({ day: x.day, issued: null, redeemed: x.points, expired: null }));
    const memberGrowth = d.membersByDay.map((x) => ({ day: x.day, members: x.count, engagementPct: null }));

    const topPrograms: TopProgramRow[] = d.tenantPerf.slice(0, 12).map((t) => this.toProgram(t, valuation.centsPerPoint));
    const tenantPerformance: TenantPerfRow[] = d.tenantPerf.slice(0, 12).map((t) => this.toPerf(t, valuation.centsPerPoint));

    // suspicious review — real derived cases when the case store is wired; else honest not-connected.
    const nameById = new Map(d.tenantPerf.map((t) => [t.tenantId, t.tenantName]));
    let suspiciousReview: LoyaltyDashboard['suspiciousReview'] = { available: false, reason: 'No suspicious-redemption case store connected', rows: [] };
    let suspiciousOpen = 0;
    if (this.suspicious) {
      suspiciousOpen = await this.suspicious.countOpen(scope);
      const cases = await this.suspicious.listCases(scope, 'open', 10);
      suspiciousReview = { available: true, rows: cases.map((c) => ({ id: c.id, tenantName: nameById.get(c.tenantId) ?? null, signalType: c.signalType, severity: c.severity, status: c.status, detail: c.detail, detectedAt: c.detectedAt })) };
    }
    kpis.suspiciousActivity = suspiciousOpen;

    return {
      meta: { generatedAt: new Date().toISOString(), scope: scope?.tenantId ? 'tenant' : 'platform', centsPerPoint: valuation.centsPerPoint },
      kpis, tierDistribution: tierDist, redemptionStatus,
      pointsActivityTrend, memberGrowth, topPrograms, tenantPerformance,
      suspiciousReview,
      atAGlance: {
        newMembers: d.today.newMembers, rewardsRedeemed: d.today.redemptions,
        pointsIssued: null,          // honest — no points-issuance event source
        expiredPoints: null,         // honest — no expiration ledger
        liabilityChangeCents: null,  // honest — needs a liability snapshot series
        flaggedCasesOpen: suspiciousOpen,
      },
      tenantCount: r.tenantsWithLoyalty,
    };
  }

  private toProgram(t: RawTenantPerf, centsPerPoint: number): TopProgramRow {
    return {
      tenantId: t.tenantId, tenantName: t.tenantName, name: t.tenantName ? `${t.tenantName} Loyalty` : 'Loyalty Program',
      type: t.tiered > 0 ? 'Tiered' : 'Points', members: t.members, pointsIssued: t.pointsIssued, pointsRedeemed: t.pointsRedeemed,
      rewardsIssued: t.redemptions, redemptionRatePct: avgRedemptionRatePct(t.pointsRedeemed, t.pointsIssued),
      liabilityCents: liabilityCents(t.pointsOutstanding, { centsPerPoint }), status: t.activePrograms > 0 ? 'Active' : 'Inactive',
    };
  }
  private toPerf(t: RawTenantPerf, centsPerPoint: number): TenantPerfRow {
    const rate = avgRedemptionRatePct(t.pointsRedeemed, t.pointsIssued);
    const eng = t.members > 0 ? pct(t.redemptions, t.members) : 0;
    const status: TenantPerfRow['status'] = eng >= 55 ? 'Strong' : eng >= 30 ? 'Healthy' : 'Watch';
    return { tenantId: t.tenantId, tenantName: t.tenantName, activePrograms: t.activePrograms, members: t.members, engagementPct: Math.min(100, eng), redemptionRatePct: rate, liabilityCents: liabilityCents(t.pointsOutstanding, { centsPerPoint }), status };
  }
}
