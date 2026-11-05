import { api } from './client';

// superAdminLoyaltyApi — platform-wide Loyalty Programs overview (Super Admin, read-only). Cross-tenant aggregation over
// the loyalty points system (profiles, rewards, redemptions). Distinct from Memberships (recurring plans).

export interface SALoyaltyKpis { loyaltyMembers: number; pointsOutstanding: number; pointsRedeemed: number; activeRewards: number; salonsWithLoyalty: number }
export interface SALoyaltyTenantRow { tenantId: string; tenantName: string | null; members: number; pointsOutstanding: number; activeRewards: number; redemptions: number }
export interface SALoyaltyRewardRow { rewardId: string; tenantId: string; tenantName: string | null; title: string; pointsCost: number; active: boolean; redemptionCount: number }
export interface SALoyaltyRedemptionRow { redemptionId: string; tenantId: string; tenantName: string | null; customerName: string | null; rewardTitle: string; pointsSpent: number; createdAt: string | null }
export interface SALoyaltyTierSlice { tier: string; count: number }

export interface SALoyaltyOverview {
  ok: boolean;
  kpis: SALoyaltyKpis;
  tenants: SALoyaltyTenantRow[];
  rewards: SALoyaltyRewardRow[];
  redemptions: SALoyaltyRedemptionRow[];
  tierBreakdown: SALoyaltyTierSlice[];
  tenantCount: number;
}

export const superAdminLoyaltyApi = {
  overview: (q?: { search?: string; status?: string; limit?: number }) =>
    api.get<SALoyaltyOverview>('/super-admin/loyalty/overview', q as Record<string, unknown> | undefined),
  dashboard: (q?: { centsPerPoint?: number }) =>
    api.get<{ ok: true } & SALoyaltyDashboard>('/super-admin/loyalty/dashboard', q as Record<string, unknown> | undefined),
  exportCsv: (q?: { centsPerPoint?: number }) => api.exportAsync<Blob>('/super-admin/loyalty/export', q as Record<string, unknown> | undefined, 'blob'),
  exportXlsx: (q?: { centsPerPoint?: number }) => api.exportAsync<Blob>('/super-admin/loyalty/export-xlsx', q as Record<string, unknown> | undefined, 'blob'),
  getConfig: () => api.get<{ ok: true; config: SALoyaltyConfig }>('/super-admin/loyalty/config'),
  putConfig: (patch: Partial<SALoyaltyConfig>) => api.put<{ ok: boolean; config: SALoyaltyConfig }>('/super-admin/loyalty/config', patch as Record<string, unknown>),
  listTemplates: () => api.get<{ ok: true; templates: SALoyaltyTemplate[] }>('/super-admin/loyalty/templates'),
  createTemplate: (body: { name: string; programType?: string; structure?: unknown }) => api.post<{ ok: boolean; error?: string; id?: string }>('/super-admin/loyalty/templates', body),
  detectSuspicious: () => api.post<{ ok: true; upserted: number; open: number }>('/super-admin/loyalty/suspicious/detect', {}),
  listSuspicious: (q?: { status?: string; limit?: number }) => api.get<{ ok: true; cases: SALoyaltySuspiciousCase[] }>('/super-admin/loyalty/suspicious', q as Record<string, unknown> | undefined),
  transitionSuspicious: (id: string, body: { to: 'reviewing' | 'resolved' | 'dismissed'; note?: string }) => api.post<{ ok: boolean; error?: string; status?: string }>(`/super-admin/loyalty/suspicious/${id}/transition`, body),
  detectCorrections: () => api.post<{ ok: true; upserted: number; open: number }>('/super-admin/loyalty/corrections/detect', {}),
  listCorrections: (q?: { status?: string; limit?: number }) => api.get<{ ok: true; corrections: SALoyaltyCorrection[] }>('/super-admin/loyalty/corrections', q as Record<string, unknown> | undefined),
  reviewCorrection: (id: string, body: { to: 'proposed' | 'approved' | 'rejected'; proposedAdjustment?: number; rootCause?: string; reason?: string }) => api.post<{ ok: boolean; error?: string; status?: string }>(`/super-admin/loyalty/corrections/${id}/review`, body),
};

export interface SALoyaltyCorrection { id: string; tenantId: string; customerId: string | null; discrepancyType: string; expectedPoints: number; actualPoints: number; differencePoints: number; status: string; proposedAdjustmentPoints: number | null; rootCause: string | null; reason: string | null; detail: any; detectedAt: string; updatedAt: string }

export interface SALoyaltySuspiciousCase { id: string; tenantId: string; customerId: string | null; signalType: string; severity: string; status: string; detail: any; detectedAt: string; updatedAt: string }

export interface SALoyaltyConfig {
  limits: { maxPointsPerTxn: number; maxRedemptionPerTxn: number; minRedemptionThreshold: number; maxPointsPerDayPerMember: number };
  expiration: { enabled: boolean; pointExpiryDays: number; rewardValidityDays: number };
  programTypes: { points: boolean; tiered: boolean; visit_based: boolean; spend_based: boolean };
  planFeatures: Record<string, boolean>;
  valuation: { centsPerPoint: number };
}
export interface SALoyaltyTemplate { id: string; name: string; programType: string; active: boolean; createdAt: string }


// --- fuller dashboard (GET /super-admin/loyalty/dashboard) ---
export interface SALoyaltyDashKpis {
  loyaltyMembers: number; pointsIssued: number; pointsRedeemed: number; liabilityCents: number;
  rewardsIssued: number; tierMembership: number; expiredPoints: number; suspiciousActivity: number;
  engagementPct: number; programPerformancePct: number; activePrograms: number; avgRedemptionRatePct: number;
}
export interface SALoyaltyTopProgram { tenantId: string; tenantName: string | null; name: string; type: 'Points' | 'Tiered'; members: number; pointsIssued: number; pointsRedeemed: number; rewardsIssued: number; redemptionRatePct: number; liabilityCents: number; status: 'Active' | 'Inactive' }
export interface SALoyaltyTenantPerf { tenantId: string; tenantName: string | null; activePrograms: number; members: number; engagementPct: number; redemptionRatePct: number; liabilityCents: number; status: 'Healthy' | 'Strong' | 'Watch' }
export interface SALoyaltyDashboard {
  meta: { generatedAt: string; scope: 'platform' | 'tenant'; centsPerPoint: number };
  kpis: SALoyaltyDashKpis;
  tierDistribution: { total: number; slices: { tier: string; count: number; pct: number }[] };
  redemptionStatus: { total: number; slices: { status: string; count: number; pct: number }[] };
  pointsActivityTrend: { day: string; issued: number | null; redeemed: number; expired: number | null }[];
  memberGrowth: { day: string; members: number; engagementPct: number | null }[];
  topPrograms: SALoyaltyTopProgram[];
  tenantPerformance: SALoyaltyTenantPerf[];
  suspiciousReview: { available: boolean; reason?: string; rows: { id: string; tenantName: string | null; signalType: string; severity: string; status: string; detail: any; detectedAt: string }[] };
  atAGlance: { newMembers: number; rewardsRedeemed: number; pointsIssued: number | null; expiredPoints: number | null; liabilityChangeCents: number | null; flaggedCasesOpen: number };
  tenantCount: number;
}
