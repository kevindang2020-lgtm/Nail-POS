// super-admin-memberships.service.ts — thin orchestration for the platform-wide Membership Overview. Read-only; all
// aggregation lives in the Kysely repository. Filters are clamped here. No write paths by design (Super Admin oversight).

import type { OverviewScope } from '@aipowersalon/database';

export interface PlatformOverviewFilters {
  rangeDays: number;          // revenue/series window context (default 30)
  expiringWindowDays: number; // "expiring soon" KPI window (default 7)
  revenueRange: RevenueRange; // which window the Revenue panel chart + total cover
  scope?: OverviewScope;      // optional single-tenant narrowing (Phase 1); absent = platform-wide
}

export type RevenueRange = 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year';
export const REVENUE_RANGES: readonly RevenueRange[] = ['this_week', 'this_month', 'last_month', 'this_quarter', 'this_year'];

export interface PlatformKpis {
  totalMembers: number;
  activeMembers: number;
  activePctOfTotal: number;
  newMembersThisMonth: number;
  membershipRevenueCents: number;
  revenueDeltaPct: number | null;
  expiringSoon: number;
  expiringWindowDays: number;
  canceledThisMonth: number;
  canceledDeltaPct: number | null;
}
export interface PlatformPlanRow { planId: string; name: string; description: string | null; productType: string; status: string; isPopular: boolean; badge: string | null; billingInterval: string; intervalCount: number; priceCents: number; isCustomPricing: boolean; memberCount: number; revenueCents: number }
export interface PlatformMemberRow { membershipId: string; customerId: string; customerName: string; maskedPhone: string | null; avatarUrl: string | null; planName: string; joinDate: string | null; nextBillingAt: string | null; status: string }
export interface PlatformActivityRow { id: string; activityType: string; customerName: string | null; planName: string | null; occurredAt: string | null; amountCents: number | null }
export interface PlatformRevenuePoint { label: string; cents: number }
export interface PlatformStatusSlice { status: string; count: number }
export interface PlatformPlanSlice { planName: string; count: number }
export interface PlatformTopServiceRow { name: string; redemptions: number }
export interface PlatformExpiringRow { membershipId: string; customerName: string; avatarUrl: string | null; planName: string; expiresOn: string | null; daysLeft: number; status: string }
export interface PlatformRecentRow { membershipId: string; customerName: string; avatarUrl: string | null; planName: string; joinDate: string | null; amountCents: number; status: string }
export interface PlatformSummary { totalMembers: number; activeMembers: number; totalRevenueCents: number; avgRevenuePerMemberCents: number; renewalRatePct: number | null; renewalRateDeltaPct: number | null; churnRatePct: number | null }
export interface RevenueRangeInfo { range: RevenueRange; label: string; totalCents: number; deltaPct: number | null }

export interface PlatformMembershipOverview {
  kpis: PlatformKpis;
  plans: PlatformPlanRow[];
  members: PlatformMemberRow[];
  activity: PlatformActivityRow[];
  revenueSeries: PlatformRevenuePoint[];
  revenueRange: RevenueRangeInfo;
  statusBreakdown: PlatformStatusSlice[];
  planDistribution: PlatformPlanSlice[];
  topServices: PlatformTopServiceRow[];
  expiring: PlatformExpiringRow[];
  recentlyCreated: PlatformRecentRow[];
  summary: PlatformSummary;
  tenantCount: number;
  rangeDays: number;
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }

// ── Read-only drill-down detail (platform, by id) ──
export interface PlatformBenefit { benefitType: string; label: string; creditsPerCycle: number; valueCents: number; percent: number }
export interface PlatformPlanDetail {
  planId: string; tenantId: string; tenantName: string | null; name: string; description: string | null;
  productType: string; status: string; isPopular: boolean; badge: string | null;
  branchId: string | null; branchName: string | null; memberCount: number; revenueCents: number;
  version: {
    versionNumber: number; billingInterval: string; intervalCount: number; priceCents: number; isCustomPricing: boolean;
    autoRenew: boolean; termType: string; termDays: number | null; techSplitPct: number; ownerSplitPct: number;
    allocationTiming: string; cancellationPolicy: string; isPublished: boolean; benefits: PlatformBenefit[];
  } | null;
}
export interface PlatformMemberPayment { kind: string; amountCents: number; taxCents: number; status: string; processor: string | null; createdAt: string | null; settledAt: string | null }
export interface PlatformMemberActivity { activityType: string; occurredAt: string | null; amountCents: number | null }
export interface PlatformMemberDetail {
  membershipId: string; tenantId: string; tenantName: string | null; status: string; memberNumber: string | null;
  startedAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; nextBillingAt: string | null; termEndAt: string | null;
  autoRenew: boolean; cancelAtPeriodEnd: boolean; canceledAt: string | null; cancelReason: string | null; pausedAt: string | null; pauseResumesAt: string | null; cyclesBilled: number;
  customer: { customerId: string; name: string; maskedPhone: string | null; email: string | null; avatarUrl: string | null };
  planId: string; planName: string; technicianId: string | null; technicianName: string | null; branchId: string | null; branchName: string | null;
  versionNumber: number; billingInterval: string; intervalCount: number; priceCents: number; techSplitPct: number; ownerSplitPct: number;
  benefits: PlatformBenefit[]; payments: PlatformMemberPayment[]; activity: PlatformMemberActivity[];
}

export class SuperAdminMembershipsError extends Error {
  constructor(public code: 'not_found', message: string) { super(message); this.name = 'SuperAdminMembershipsError'; }
}

interface Repo {
  platformOverview(f: PlatformOverviewFilters): Promise<PlatformMembershipOverview>;
  planDetail(planId: string): Promise<PlatformPlanDetail | null>;
  memberDetail(membershipId: string): Promise<PlatformMemberDetail | null>;
}

const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};

export class SuperAdminMembershipsService {
  constructor(private readonly repo: Repo) {}

  getOverview(_ctx: AdminCtx, q: { rangeDays?: unknown; expiringWindowDays?: unknown; revenueRange?: unknown; scope?: OverviewScope }): Promise<PlatformMembershipOverview> {
    const rr = String(q?.revenueRange ?? '') as RevenueRange;
    return this.repo.platformOverview({
      rangeDays: clampInt(q?.rangeDays, 30, 1, 365),
      expiringWindowDays: clampInt(q?.expiringWindowDays, 7, 1, 90),
      revenueRange: REVENUE_RANGES.includes(rr) ? rr : 'this_month',
      scope: q?.scope,
    });
  }

  async getPlanDetail(_ctx: AdminCtx, planId: string): Promise<PlatformPlanDetail> {
    const d = await this.repo.planDetail(planId);
    if (!d) throw new SuperAdminMembershipsError('not_found', 'Plan not found');
    return d;
  }

  async getMemberDetail(_ctx: AdminCtx, membershipId: string): Promise<PlatformMemberDetail> {
    const d = await this.repo.memberDetail(membershipId);
    if (!d) throw new SuperAdminMembershipsError('not_found', 'Membership not found');
    return d;
  }
}
