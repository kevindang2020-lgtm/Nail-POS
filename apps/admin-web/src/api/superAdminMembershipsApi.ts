import { api, apiUrl } from './client';

// superAdminMembershipsApi — platform-wide Membership Overview (Super Admin, read-only). Cross-tenant aggregation over
// the canonical membership tables. Tenant/branch are NOT sent; this is the platform view. Money is integer cents.

export interface SAKpis { totalMembers: number; activeMembers: number; activePctOfTotal: number; newMembersThisMonth: number; membershipRevenueCents: number; revenueDeltaPct: number | null; expiringSoon: number; expiringWindowDays: number; canceledThisMonth: number; canceledDeltaPct: number | null }
export interface SAPlanRow { planId: string; name: string; description: string | null; productType: string; status: string; isPopular: boolean; badge: string | null; billingInterval: string; intervalCount: number; priceCents: number; isCustomPricing: boolean; memberCount: number; revenueCents: number }
export interface SAMemberRow { membershipId: string; customerId: string; customerName: string; maskedPhone: string | null; avatarUrl: string | null; planName: string; joinDate: string | null; nextBillingAt: string | null; status: string }
export interface SAActivityRow { id: string; activityType: string; customerName: string | null; planName: string | null; occurredAt: string | null; amountCents: number | null }
export interface SARevenuePoint { label: string; cents: number }
export interface SAStatusSlice { status: string; count: number }
export interface SAPlanSlice { planName: string; count: number }
export interface SATopServiceRow { name: string; redemptions: number }
export interface SAExpiringRow { membershipId: string; customerName: string; avatarUrl: string | null; planName: string; expiresOn: string | null; daysLeft: number; status: string }
export interface SARecentRow { membershipId: string; customerName: string; avatarUrl: string | null; planName: string; joinDate: string | null; amountCents: number; status: string }
export interface SASummary { totalMembers: number; activeMembers: number; totalRevenueCents: number; avgRevenuePerMemberCents: number; renewalRatePct: number | null; renewalRateDeltaPct: number | null; churnRatePct: number | null }
export type SARevenueRange = 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year';
export interface SARevenueRangeInfo { range: SARevenueRange; label: string; totalCents: number; deltaPct: number | null }

export interface SAMembershipOverview {
  ok: boolean;
  kpis: SAKpis;
  plans: SAPlanRow[];
  members: SAMemberRow[];
  activity: SAActivityRow[];
  revenueSeries: SARevenuePoint[];
  revenueRange: SARevenueRangeInfo;
  statusBreakdown: SAStatusSlice[];
  planDistribution: SAPlanSlice[];
  topServices: SATopServiceRow[];
  expiring: SAExpiringRow[];
  recentlyCreated: SARecentRow[];
  summary: SASummary;
  tenantCount: number;
  rangeDays: number;
}

export interface SABenefit { benefitType: string; label: string; creditsPerCycle: number; valueCents: number; percent: number }
export interface SAPlanDetail {
  planId: string; tenantId: string; tenantName: string | null; name: string; description: string | null; productType: string; status: string; isPopular: boolean; badge: string | null;
  branchId: string | null; branchName: string | null; memberCount: number; revenueCents: number;
  version: { versionNumber: number; billingInterval: string; intervalCount: number; priceCents: number; isCustomPricing: boolean; autoRenew: boolean; termType: string; termDays: number | null; techSplitPct: number; ownerSplitPct: number; allocationTiming: string; cancellationPolicy: string; isPublished: boolean; benefits: SABenefit[] } | null;
}
export interface SAMemberPayment { kind: string; amountCents: number; taxCents: number; status: string; processor: string | null; createdAt: string | null; settledAt: string | null }
export interface SAMemberActivity { activityType: string; occurredAt: string | null; amountCents: number | null }
export interface SAMemberDetail {
  membershipId: string; tenantId: string; tenantName: string | null; status: string; memberNumber: string | null;
  startedAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; nextBillingAt: string | null; termEndAt: string | null;
  autoRenew: boolean; cancelAtPeriodEnd: boolean; canceledAt: string | null; cancelReason: string | null; pausedAt: string | null; pauseResumesAt: string | null; cyclesBilled: number;
  customer: { customerId: string; name: string; maskedPhone: string | null; email: string | null; avatarUrl: string | null };
  planId: string; planName: string; technicianId: string | null; technicianName: string | null; branchId: string | null; branchName: string | null;
  versionNumber: number; billingInterval: string; intervalCount: number; priceCents: number; techSplitPct: number; ownerSplitPct: number;
  benefits: SABenefit[]; payments: SAMemberPayment[]; activity: SAMemberActivity[];
}

export const superAdminMembershipsApi = {
  overview: (q?: { rangeDays?: number; expiringWindowDays?: number; revenueRange?: SARevenueRange }) =>
    api.get<SAMembershipOverview>('/super-admin/memberships/overview', q as Record<string, unknown> | undefined),
  planDetail: (planId: string) => api.get<{ ok: boolean; plan: SAPlanDetail }>(`/super-admin/memberships/plans/${encodeURIComponent(planId)}`),
  memberDetail: (membershipId: string) => api.get<{ ok: boolean; member: SAMemberDetail }>(`/super-admin/memberships/members/${encodeURIComponent(membershipId)}`),
};

// ---- Membership Programs (canonical Super Admin platform-oversight surface) ----
export interface MPKpis {
  totalPrograms: number; activeMembers: number; pausedMembers: number; cancelledMembers: number; pastDueMembers: number;
  trialMembers: number; mrrCents: number; failedPayments: number; benefitsIssued: number; benefitsRedeemed: number;
  unusedCredits: number; expiringCredits: number; tenantParticipation: { active: number; total: number };
  branchParticipation: { active: number; total: number }; suspiciousCount: number;
}
export interface MembershipProgramsOverview {
  ok: boolean; kpis: MPKpis;
  kpiTrends: Record<string, { deltaPct: number | null; favorable: boolean | null }>;
  programMix: { type: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
  revenueTrend: { date: string; cents: number }[];
  membersVsRedeemed: { date: string; members: number; redeemed: number }[];
  topPrograms: { planId: string; name: string; type: string; activeMembers: number; priceCents: number; includedBenefits: number; redemptionRatePct: number; revenueCents: number; status: string }[];
  tenantPerformance: { tenantId: string; tenant: string; activePrograms: number; members: number; mrrCents: number; billingFailures: number; pauseRatePct: number; status: string }[];
  billingFailures: { tenantProgram: string; issue: string; severity: string; status: string; at: string | null }[];
  atAGlance: { newMembersToday: number; revenueTodayCents: number; failedPaymentsToday: number; benefitsRedeemedToday: number; expiringCreditsToday: number; supportCasesOpen: number };
}
export const membershipProgramsApi = {
  overview: () => api.get<MembershipProgramsOverview>('/super-admin/membership-programs/overview'),
};

export interface MPControls {
  ok: boolean; enabledGlobally: boolean; planGating: Record<string, boolean>; limits: Record<string, number>; rules: any;
  plans: { code: string; name: string }[];
  templates: { id: string; name: string; description: string | null; productType: string; billingInterval: string; intervalCount: number; priceCents: number; trialDays: number; benefits: any[]; status: string; version: number; updatedAt: string }[];
}
export const membershipControlsApi = {
  controls: () => api.get<MPControls>('/super-admin/membership-programs/controls'),
  setEnabled: (enabled: boolean) => api.post<{ ok: boolean }>('/super-admin/membership-programs/enabled', { enabled }),
  setGating: (planGating: Record<string, boolean>) => api.post<{ ok: boolean; planGating: Record<string, boolean> }>('/super-admin/membership-programs/plan-gating', { planGating }),
  setLimits: (limits: Record<string, number>) => api.post<{ ok: boolean; limits: Record<string, number> }>('/super-admin/membership-programs/limits', { limits }),
  setRules: (rules: any) => api.post<{ ok: boolean; rules: any }>('/super-admin/membership-programs/rules', { rules }),
  createTemplate: (t: any) => api.post<{ ok: boolean; id: string }>('/super-admin/membership-programs/templates', t),
  updateTemplate: (id: string, t: any) => api.patch<{ ok: boolean }>(`/super-admin/membership-programs/templates/${encodeURIComponent(id)}`, t),
};

export const membershipOversightApi = {
  programs: (f?: { tenantId?: string; status?: string; productType?: string }) => {
    const p = new URLSearchParams(); if (f?.tenantId) p.set('tenantId', f.tenantId); if (f?.status) p.set('status', f.status); if (f?.productType) p.set('productType', f.productType);
    const qs = p.toString();
    return api.get<{ ok: boolean; programs: any[] }>(`/super-admin/membership-programs/programs${qs ? `?${qs}` : ''}`);
  },
  billingFailures: () => api.get<{ ok: boolean; failures: any[] }>('/super-admin/membership-programs/billing-failures'),
  revenue: () => api.get<{ ok: boolean; totalCents: number; byTenant: any[]; byProgram: any[] }>('/super-admin/membership-programs/revenue'),
  cancellations: () => api.get<{ ok: boolean; items: any[] }>('/super-admin/membership-programs/cancellations'),
};

export const membershipActionsApi = {
  duplicateCharges: () => api.get<{ ok: boolean; cases: any[] }>('/super-admin/membership-programs/duplicate-charges'),
  programImpact: (id: string) => api.get<{ ok: boolean; impact: any }>(`/super-admin/membership-programs/programs/${encodeURIComponent(id)}/impact`),
  disableProgram: (id: string, reason: string) => api.post<{ ok: boolean }>(`/super-admin/membership-programs/programs/${encodeURIComponent(id)}/disable`, { reason }),
  createCorrection: (body: { membershipId: string; direction: 'credit' | 'debit'; quantity: number; amountCents: number; reason: string }) => api.post<{ ok: boolean; entryId: string }>('/super-admin/membership-programs/corrections', body),
};

export const membershipSupportApi = {
  suspicious: () => api.get<{ ok: boolean; cases: any[] }>('/super-admin/membership-programs/suspicious'),
  activeSession: () => api.get<{ ok: boolean; session: any | null }>('/super-admin/membership-programs/support-sessions/active'),
  enter: (body: { tenantId: string; reason: string; durationMinutes: number; accessLevel: string }) => api.post<{ ok: boolean; session: any }>('/super-admin/membership-programs/support-sessions', body),
  exit: (id: string) => api.post<{ ok: boolean }>(`/super-admin/membership-programs/support-sessions/${encodeURIComponent(id)}/exit`, {}),
};

export const membershipExportApi = {
  exportCsv: async (filters: Record<string, unknown>): Promise<{ filename: string; csv: string }> => {
    const res = await fetch(apiUrl('/super-admin/membership-programs/exports'), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(filters) });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const csv = await res.text();
    const cd = res.headers.get('content-disposition') || '';
    const m = /filename="?([^"]+)"?/.exec(cd);
    return { filename: m?.[1] ?? 'membership-programs.csv', csv };
  },
};

export const membershipDrilldownApi = {
  members: (status?: string) => api.get<{ ok: boolean; members: any[] }>(`/super-admin/membership-programs/members${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  creditsSummary: () => api.get<{ ok: boolean; rows: any[] }>('/super-admin/membership-programs/credits-summary'),
};
