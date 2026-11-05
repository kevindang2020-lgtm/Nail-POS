import { api } from './client';

// superAdminStaffApi — platform-wide Staff / Technicians overview (Super Admin, read-only). Cross-tenant aggregation
// over the canonical technicians table. Tenant/branch are NOT sent; this is the platform view.

export interface SAStaffKpis { totalTechnicians: number; activeTechnicians: number; tenantsWithStaff: number; avgTechsPerTenant: number }
export interface SAStaffTenantRow { tenantId: string; tenantName: string | null; technicianCount: number; activeCount: number }
export interface SAStaffRow { technicianId: string; tenantId: string; tenantName: string | null; fullName: string; branchName: string | null; roleLabel: string | null; status: string; isActive: boolean; createdAt: string | null }
export interface SAStaffStatusSlice { status: string; count: number }

export interface SAStaffOverview {
  ok: boolean;
  kpis: SAStaffKpis;
  tenants: SAStaffTenantRow[];
  technicians: SAStaffRow[];
  statusBreakdown: SAStaffStatusSlice[];
  tenantCount: number;
}

export interface SAStaffDetail {
  technicianId: string; tenantId: string; tenantName: string | null;
  fullName: string; firstName: string | null; lastName: string | null;
  maskedPhone: string | null; email: string | null;
  branchId: string | null; branchName: string | null;
  roleLabel: string | null; status: string; isActive: boolean;
  commissionSplitPct: number | null; createdAt: string | null; updatedAt: string | null;
}

export interface SAWorkforceKpi { value: number | null; available: boolean }
export interface SAWorkforceTenantRow { tenantId: string; tenantName: string | null; count: number }
export interface SAWorkforceActivityRow { id: string; actionType: string; entityType: string | null; userId: string | null; tenantId: string | null; at: string | null }
export interface SAGapSection { available: false; reason: string }
export interface SAWorkforceOverview {
  ok: boolean;
  scope: { tenantScoped: boolean };
  kpis: Record<'totalWorkers' | 'activeWorkers' | 'inactiveWorkers' | 'technicians' | 'receptionists' | 'managers' | 'duplicateProfiles' | 'branchTransfers' | 'accountAccessIssues' | 'payrollSyncIssues' | 'missingEmploymentInfo' | 'suspiciousPermissionActivity', SAWorkforceKpi>;
  roleDistribution: { technicians: number; receptionists: number; managers: number; other: number; total: number };
  statusDistribution: { active: number; inactive: number; suspended: number; invited: number; total: number };
  workersByTenant: { rows: SAWorkforceTenantRow[]; total: number };
  healthAlerts: { key: string; label: string; count: number | null; severity: 'critical' | 'warning' | 'info'; available: boolean; to: string }[];
  availabilityDistribution: SAGapSection; workforceTrend: SAGapSection; transferPipeline: SAGapSection;
  technicianConnectivity: SAGapSection; payrollSyncRate: SAGapSection;
  recentActivity: SAWorkforceActivityRow[];
  auditEventSummary: { category: string; count: number }[];
  todaySummary: { auditEvents: SAWorkforceKpi };
}
export interface SAWorkforceDirectoryRow {
  workerId: string; name: string; role: string; roleCategory: string;
  tenantId: string | null; tenant: string | null; branchId: string | null; branch: string | null;
  status: string; availability: string; profileStatus: string; accessStatus: string; payrollSync: string;
  lastActivity: string | null; flags: string[];
}
export interface SAWorkforceDirectoryPage {
  ok: boolean; rows: SAWorkforceDirectoryRow[]; total: number; page: number; pageSize: number; pages: number; facets: { statuses: string[] };
}

export interface SAWorkforceProfile {
  workerId: string; name: string; firstName: string | null; lastName: string | null;
  maskedEmail: string | null; maskedPhone: string | null; role: string; roleCategory: string;
  tenantId: string | null; tenant: string | null; branchId: string | null; branch: string | null;
  status: string; createdAt: string | null;
  access: { accountStatus: string; accessStatus: string; mfaEnabled: boolean; mustChangePassword: boolean; lastLogin: string | null; activeSessions: number; appRegistrations: number };
  monitoring: { availability: SAGapSection; connectivity: SAGapSection; payrollSync: SAGapSection };
  history: SAWorkforceActivityRow[];
}

export interface SAWorkforceDeactivationRow { workerId: string; name: string; role: string; tenant: string | null; status: string; activeSessions: number; appRegistrations: number }

export interface SAWorkforceDuplicateMember { workerId: string; name: string; role: string; status: string; lastLogin: string | null; createdAt: string | null }
export interface SAWorkforceDuplicateGroup { tenantId: string | null; tenant: string | null; maskedEmail: string; members: SAWorkforceDuplicateMember[] }

export interface SAWorkforceTransferRow { id: string; workerId: string; workerName: string; tenant: string | null; fromBranch: string | null; toBranch: string | null; status: string; reason: string; requestedAt: string | null; decidedAt: string | null; decisionNote: string | null }
export interface SAWorkforceTransferPipeline { available: true; total: number; byStatus: Record<string, number>; pending: SAWorkforceTransferRow[] }
export interface SAWorkforceCrossTransferRow { id: string; workerId: string; workerName: string; fromTenant: string | null; toTenant: string | null; toBranch: string | null; effectiveDate: string | null; status: string; reason: string; requestedAt: string | null; decidedAt: string | null; decisionNote: string | null }

export interface SAPayrollSyncSummary { total: number; byStatus: Record<string, number>; successful: number; failed: number; successRate: number | null; configured: boolean }
export interface SAPayrollSyncEventRow { id: string; workerId: string | null; workerName: string | null; tenant: string | null; provider: string; eventType: string; status: string; errorCode: string | null; errorMessage: string | null; attemptCount: number; maxAttempts: number; lastAttemptAt: string | null; nextRetryAt: string | null; retryable: boolean; retryBlockedReason: string | null }

export interface SAWorkforceSecurityAlert { key: string; type: string; label: string; severity: string; workerId: string; workerName: string; tenant: string | null; count: number; reason: string }

export interface SATechnicianConnectivitySummary { total: number; connected: number; disconnected: number; unknown: number; connectedRate: number | null; configured: boolean }

export interface SASavedView { id: string; name: string; filters: { role?: string; status?: string; tenantId?: string; search?: string; sort?: string; dir?: 'asc' | 'desc'; pageSize?: number }; isDefault: boolean; createdAt: string | null }

export const superAdminStaffApi = {
  overview: (q?: { search?: string; status?: string; limit?: number }) =>
    api.get<SAStaffOverview>('/super-admin/staff/overview', q as Record<string, unknown> | undefined),
  staffDetail: (technicianId: string) =>
    api.get<{ ok: boolean; technician: SAStaffDetail }>(`/super-admin/staff/technicians/${encodeURIComponent(technicianId)}`),
  workforceOverview: () => api.get<SAWorkforceOverview>('/super-admin/staff/workforce-overview'),
  workforceDirectory: (q?: Record<string, unknown>) => api.get<SAWorkforceDirectoryPage>('/super-admin/staff/workforce', q),
  workforceProfile: (userId: string) => api.get<{ ok: boolean; profile: SAWorkforceProfile }>(`/super-admin/staff/workforce/${encodeURIComponent(userId)}`),
  workforceAccessSupport: (userId: string, body: { action: string; reason: string }) =>
    api.post<{ ok: boolean; action: string; result: Record<string, unknown> }>(`/super-admin/staff/workforce/${encodeURIComponent(userId)}/access-support`, body),
  workforceDeactivationQueue: () => api.get<{ ok: boolean; rows: SAWorkforceDeactivationRow[] }>('/super-admin/staff/workforce-deactivation-queue'),
  workforceDeactivateAccess: (userId: string, body: { reason: string }) =>
    api.post<{ ok: boolean; result: { sessionsRevoked: number; devicesRevoked: number } }>(`/super-admin/staff/workforce/${encodeURIComponent(userId)}/deactivate-access`, body),
  workforceDuplicates: () => api.get<{ ok: boolean; groups: SAWorkforceDuplicateGroup[] }>('/super-admin/staff/workforce-duplicates'),
  workforceReviewDuplicate: (body: { canonicalId: string; memberIds: string[]; reason: string }) =>
    api.post<{ ok: boolean; canonicalId: string; flaggedIds: string[]; maskedEmail: string }>('/super-admin/staff/workforce-duplicates/review', body),
  workforceTransfers: () => api.get<{ ok: boolean; pipeline: SAWorkforceTransferPipeline }>('/super-admin/staff/workforce-transfers'),
  workforceRequestTransfer: (userId: string, body: { toBranchId: string; reason: string }) =>
    api.post<{ ok: boolean; id: string; status: string }>(`/super-admin/staff/workforce/${encodeURIComponent(userId)}/transfer`, body),
  workforceDecideTransfer: (id: string, body: { decision: 'approve' | 'reject'; note?: string }) =>
    api.post<{ ok: boolean; id: string; status: string }>(`/super-admin/staff/workforce-transfers/${encodeURIComponent(id)}/decision`, body),
  workforceCrossTransfers: () => api.get<{ ok: boolean; rows: SAWorkforceCrossTransferRow[] }>('/super-admin/staff/workforce-cross-transfers'),
  workforceRequestCrossTransfer: (userId: string, body: { toTenantId: string; toBranchId?: string; effectiveDate?: string; reason: string }) =>
    api.post<{ ok: boolean; id: string; status: string }>(`/super-admin/staff/workforce/${encodeURIComponent(userId)}/cross-transfer`, body),
  workforceDecideCrossTransfer: (id: string, body: { decision: 'approve' | 'reject'; note?: string }) =>
    api.post<{ ok: boolean; id: string; status: string }>(`/super-admin/staff/workforce-cross-transfers/${encodeURIComponent(id)}/decision`, body),
  workforcePayrollSync: () => api.get<{ ok: boolean; summary: SAPayrollSyncSummary; events: SAPayrollSyncEventRow[] }>('/super-admin/staff/workforce-payroll-sync'),
  workforceRetryPayrollSync: (id: string, body: { reason: string }) =>
    api.post<{ ok: boolean; id: string; status: string; attemptCount: number; nextRetryAt: string }>(`/super-admin/staff/workforce-payroll-sync/${encodeURIComponent(id)}/retry`, body),
  workforceSecurityActivity: () => api.get<{ ok: boolean; alerts: SAWorkforceSecurityAlert[]; total: number }>('/super-admin/staff/workforce-security-activity'),
  workforceReviewSecurity: (body: { alertKey: string; resolution: string; reason: string }) =>
    api.post<{ ok: boolean; alertKey: string; resolution: string }>('/super-admin/staff/workforce-security-activity/review', body),
  workforceConnectivity: () => api.get<{ ok: boolean; summary: SATechnicianConnectivitySummary }>('/super-admin/staff/workforce-connectivity'),
  workforceSavedViews: () => api.get<{ ok: boolean; views: SASavedView[] }>('/super-admin/staff/workforce-views'),
  workforceSaveView: (body: { name: string; filters: SASavedView['filters']; isDefault?: boolean }) =>
    api.post<{ ok: boolean; id: string }>('/super-admin/staff/workforce-views', body),
  workforceDeleteView: (id: string) => api.del<{ ok: boolean; deleted: boolean }>(`/super-admin/staff/workforce-views/${encodeURIComponent(id)}`),
};
