// super-admin-staff.service.ts — read-only, cross-tenant Staff / Technicians overview for Super Admin (Phase 9).
// Thin orchestration; all aggregation lives in the Kysely repository. Filters are clamped here. No write paths by design
// (tenants manage their own staff via the POS/Owner surfaces). Mirrors the super-admin-memberships service shape.

import type { OverviewScope } from '@aipowersalon/database';
import {
  bucketRoleDistribution, bucketStatus, assembleHealthAlerts, summarizeAudit,
  type RoleDistribution, type StatusDistribution, type HealthAlert,
} from './workforce-core';
import { normalizeWorkforceQuery } from './workforce-directory-core';
import { validateAccessSupport, accessAuditType, type AccessAction, type AccessSupportInput } from './workforce-access-core';
import { validateDeactivation, DEACTIVATION_AUDIT_TYPE, type DeactivationInput } from './workforce-deactivation-core';
import { validateDuplicateReview, DUPLICATE_REVIEW_AUDIT_TYPE, type DuplicateReviewInput } from './workforce-duplicate-core';
import { validateTransferRequest, validateTransferDecision, summarizeTransferPipeline, TRANSFER_REQUEST_AUDIT_TYPE, TRANSFER_DECIDE_AUDIT_TYPE, type TransferRequestInput, type TransferDecisionInput } from './workforce-transfer-core';
import { validateCrossTransferRequest, validateCrossTransferDecision, CROSS_TRANSFER_REQUEST_AUDIT_TYPE, CROSS_TRANSFER_DECIDE_AUDIT_TYPE, type CrossTransferRequestInput, type CrossTransferDecisionInput } from './workforce-cross-transfer-core';
import { summarizePayrollSync, retryEligibility, backoffSeconds, validatePayrollRetry, PAYROLL_RETRY_AUDIT_TYPE, type PayrollRetryInput } from './workforce-payroll-core';
import { assembleSecurityAlerts, validateSecurityReview, SECURITY_REVIEW_AUDIT_TYPE, type SecuritySignal, type SecurityReviewInput } from './workforce-security-core';
import { classifyConnectivity, summarizeConnectivity } from './workforce-connectivity-core';
import { validateSavedView, type SavedViewInput } from './workforce-savedview-core';

// --- Workforce Oversight aggregate (all-workers surface). Honest KPIs: a value is null + available:false when no real
// source exists yet (payroll-sync, worker transfers, suspicious activity). ---
export interface WorkforceKpi { value: number | null; available: boolean }
export interface WorkforceTenantRow { tenantId: string; tenantName: string | null; count: number }
export interface WorkforceActivityRow { id: string; actionType: string; entityType: string | null; userId: string | null; tenantId: string | null; at: string | null }
export interface GapSection { available: false; reason: string }
export interface WorkforceRaw {
  roleCounts: { role: string; count: number }[];
  statusCounts: { status: string; count: number }[];
  byTenant: WorkforceTenantRow[];
  duplicateGroups: number;
  accessIssues: number;
  missingInfo: number;
  recentActivity: WorkforceActivityRow[];
  auditToday: { actionType: string; count: number }[];
}
export interface WorkforceOverview {
  scope: { tenantScoped: boolean };
  kpis: {
    totalWorkers: WorkforceKpi; activeWorkers: WorkforceKpi; inactiveWorkers: WorkforceKpi;
    technicians: WorkforceKpi; receptionists: WorkforceKpi; managers: WorkforceKpi;
    duplicateProfiles: WorkforceKpi; branchTransfers: WorkforceKpi; accountAccessIssues: WorkforceKpi;
    payrollSyncIssues: WorkforceKpi; missingEmploymentInfo: WorkforceKpi; suspiciousPermissionActivity: WorkforceKpi;
  };
  roleDistribution: RoleDistribution;
  statusDistribution: StatusDistribution;
  workersByTenant: { rows: WorkforceTenantRow[]; total: number };
  healthAlerts: HealthAlert[];
  availabilityDistribution: GapSection;
  workforceTrend: GapSection;
  transferPipeline: GapSection;
  technicianConnectivity: GapSection;
  payrollSyncRate: GapSection;
  recentActivity: WorkforceActivityRow[];
  auditEventSummary: { category: string; count: number }[];
  todaySummary: { auditEvents: WorkforceKpi };
}

export interface StaffOverviewFilters {
  search: string;   // free-text match on technician name / tenant name (server-side, trimmed)
  status: string;   // '' = all, else exact lifecycle status (e.g. 'active', 'inactive')
  limit: number;    // roster row cap (default 200)
  scope?: OverviewScope;  // optional single-tenant narrowing (Phase 1); absent = platform-wide
}

export interface PlatformStaffKpis {
  totalTechnicians: number;
  activeTechnicians: number;
  tenantsWithStaff: number;
  avgTechsPerTenant: number; // rounded to 1 decimal, over tenants that have any staff
}
export interface PlatformStaffTenantRow { tenantId: string; tenantName: string | null; technicianCount: number; activeCount: number }
export interface PlatformStaffRow { technicianId: string; tenantId: string; tenantName: string | null; fullName: string; branchName: string | null; roleLabel: string | null; status: string; isActive: boolean; createdAt: string | null }
export interface PlatformStaffStatusSlice { status: string; count: number }

export interface PlatformStaffOverview {
  kpis: PlatformStaffKpis;
  tenants: PlatformStaffTenantRow[];
  technicians: PlatformStaffRow[];
  statusBreakdown: PlatformStaffStatusSlice[];
  tenantCount: number;
}

export interface PlatformStaffDetail {
  technicianId: string; tenantId: string; tenantName: string | null;
  fullName: string; firstName: string | null; lastName: string | null;
  maskedPhone: string | null; email: string | null;
  branchId: string | null; branchName: string | null;
  roleLabel: string | null; status: string; isActive: boolean;
  commissionSplitPct: number | null; createdAt: string | null; updatedAt: string | null;
}

export interface WorkforceDirectoryRow {
  workerId: string; name: string; role: string; roleCategory: string;
  avatarUrl?: string | null;
  tenantId: string | null; tenant: string | null; branchId: string | null; branch: string | null;
  status: string; availability: string; profileStatus: string; accessStatus: string; payrollSync: string;
  lastActivity: string | null; flags: string[];
}
export interface WorkforceDirectoryPage {
  rows: WorkforceDirectoryRow[]; total: number; page: number; pageSize: number; pages: number;
  facets: { statuses: string[] };
}

export interface WorkforceProfile {
  workerId: string; name: string; firstName: string | null; lastName: string | null;
  avatarUrl?: string | null;
  maskedEmail: string | null; maskedPhone: string | null; role: string; roleCategory: string;
  tenantId: string | null; tenant: string | null; branchId: string | null; branch: string | null;
  status: string; createdAt: string | null;
  access: { accountStatus: string; accessStatus: string; mfaEnabled: boolean; mustChangePassword: boolean; lastLogin: string | null; activeSessions: number; appRegistrations: number };
  monitoring: { availability: GapSection; connectivity: GapSection; payrollSync: GapSection };
  history: WorkforceActivityRow[];
}

export interface WorkforceDeactivationRow { workerId: string; name: string; role: string; tenant: string | null; status: string; activeSessions: number; appRegistrations: number }

export interface WorkforceDuplicateMember { workerId: string; name: string; role: string; status: string; lastLogin: string | null; createdAt: string | null }
export interface WorkforceDuplicateGroup { tenantId: string | null; tenant: string | null; maskedEmail: string; members: WorkforceDuplicateMember[] }

export interface WorkforceTransferRow { id: string; workerId: string; workerName: string; tenant: string | null; fromBranch: string | null; toBranch: string | null; status: string; reason: string; requestedAt: string | null; decidedAt: string | null; decisionNote: string | null }
export interface WorkforceTransferPipeline { available: true; total: number; byStatus: Record<string, number>; pending: WorkforceTransferRow[] }
export interface WorkerTransferTarget { userId: string; name: string; tenantId: string | null; branchId: string | null }
export interface WorkerTransferRecord { id: string; tenantId: string | null; userId: string; toBranchId: string; status: string }

export interface WorkforceCrossTransferRow { id: string; workerId: string; workerName: string; fromTenant: string | null; toTenant: string | null; toBranch: string | null; effectiveDate: string | null; status: string; reason: string; requestedAt: string | null; decidedAt: string | null; decisionNote: string | null }
export interface WorkerCrossTransferTarget { userId: string; name: string; tenantId: string | null }
export interface WorkerCrossTransferRecord {
  id: string; userId: string; toTenantId: string; status: string;
  // These four are columns on worker_cross_tenant_transfer_requests and always were. Nothing selected them,
  // because nothing ever executed the transfer they describe.
  fromTenantId?: string | null; toBranchId?: string | null; requestedByUserId?: string | null; effectiveDate?: string | null;
}

export interface PayrollSyncSummary { total: number; byStatus: Record<string, number>; successful: number; failed: number; successRate: number | null; configured: boolean }
export interface PayrollSyncEventRow { id: string; workerId: string | null; workerName: string | null; tenant: string | null; provider: string; eventType: string; status: string; errorCode: string | null; errorMessage: string | null; attemptCount: number; maxAttempts: number; lastAttemptAt: string | null; nextRetryAt: string | null; retryable: boolean; retryBlockedReason: string | null }
export interface PayrollSyncEventRecord { id: string; status: string; errorCode: string | null; attemptCount: number; maxAttempts: number }

export interface WorkforceSecurityAlert { key: string; type: string; label: string; severity: string; workerId: string; workerName: string; tenant: string | null; count: number; reason: string }
export interface SecuritySignalRow { type: string; userId: string; name: string; tenant: string | null; status: string; count: number }

export interface TechnicianConnectivitySummary { total: number; connected: number; disconnected: number; unknown: number; connectedRate: number | null; configured: boolean }
export interface TechnicianConnectivityRawRow { userId: string; lastSeen: string | null; hasToken: boolean }

export interface SavedViewRow { id: string; name: string; filters: import('./workforce-savedview-core').SavedViewFilters; isDefault: boolean; createdAt: string | null }

export interface AdminCtx { userId?: string; email?: string; ip?: string }

/**
 * Executes an approved cross-tenant transfer through `tech_salon_memberships` — the same rows the Tech App and
 * the POS approval flow use. A port, so this service still has no idea what a Kysely is.
 */
export interface CrossTenantTransferExecutor {
  execute(input: {
    requestId: string; userId: string; fromTenantId: string | null; toTenantId: string; toBranchId: string | null;
    requestedBy: string | null; decidedByUserId?: string;
  }): Promise<{ executed: boolean; reason?: string; membershipId?: string; membershipStatus?: string; profileId?: string }>;
}

export class SuperAdminStaffError extends Error {
  constructor(public code: 'not_found' | 'invalid', message: string) { super(message); this.name = 'SuperAdminStaffError'; }
}

interface Repo {
  platformStaffOverview(f: StaffOverviewFilters): Promise<PlatformStaffOverview>;
  staffDetail(technicianId: string): Promise<PlatformStaffDetail | null>;
  workforceRaw(scope?: OverviewScope): Promise<WorkforceRaw>;
  workforceDirectory(q: ReturnType<typeof normalizeWorkforceQuery>, scope?: OverviewScope): Promise<WorkforceDirectoryPage>;
  workforceProfile(userId: string, scope?: OverviewScope): Promise<WorkforceProfile | null>;
  workforceAccessTarget(userId: string, scope?: OverviewScope): Promise<{ userId: string; name: string; role: string; status: string } | null>;
  revokeWorkerSessions(userId: string): Promise<number>;
  revokeWorkerDeviceTokens(userId: string): Promise<number>;
  deactivationQueue(scope?: OverviewScope): Promise<WorkforceDeactivationRow[]>;
  workerTransferTarget(userId: string, scope?: OverviewScope): Promise<WorkerTransferTarget | null>;
  createWorkerTransferRequest(input: { tenantId: string | null; userId: string; fromBranchId: string | null; toBranchId: string; reason: string; requestedBy?: string }): Promise<{ id: string }>;
  workerTransferPipeline(scope?: OverviewScope): Promise<{ counts: { status: string; count: number }[]; pending: WorkforceTransferRow[] }>;
  getWorkerTransferRequest(id: string, scope?: OverviewScope): Promise<WorkerTransferRecord | null>;
  decideWorkerTransfer(id: string, decision: 'approve' | 'reject', note: string | null, reviewedBy?: string): Promise<WorkerTransferRecord>;
  workerCrossTransferTarget(userId: string, scope?: OverviewScope): Promise<WorkerCrossTransferTarget | null>;
  tenantExists(tenantId: string): Promise<boolean>;
  createCrossTransferRequest(input: { userId: string; fromTenantId: string | null; toTenantId: string; toBranchId: string | null; effectiveDate: string | null; reason: string; requestedBy?: string }): Promise<{ id: string }>;
  crossTransferList(scope?: OverviewScope): Promise<WorkforceCrossTransferRow[]>;
  getCrossTransferRequest(id: string, scope?: OverviewScope): Promise<WorkerCrossTransferRecord | null>;
  decideCrossTransfer(id: string, decision: 'approve' | 'reject', note: string | null, reviewedBy?: string): Promise<WorkerCrossTransferRecord>;
  payrollSyncCounts(scope?: OverviewScope): Promise<{ status: string; count: number }[]>;
  payrollSyncEvents(scope?: OverviewScope): Promise<Array<{ id: string; userId: string | null; workerName: string | null; tenant: string | null; provider: string; eventType: string; status: string; errorCode: string | null; errorMessage: string | null; attemptCount: number; maxAttempts: number; lastAttemptAt: string | null; nextRetryAt: string | null }>>;
  getPayrollSyncEventRecord(id: string, scope?: OverviewScope): Promise<PayrollSyncEventRecord | null>;
  recordPayrollRetryAttempt(id: string, nextRetryAt: string): Promise<{ status: string; attemptCount: number }>;
  securitySignals(scope?: OverviewScope): Promise<SecuritySignalRow[]>;
  technicianConnectivity(scope?: OverviewScope): Promise<TechnicianConnectivityRawRow[]>;
  listSavedViews(ownerUserId: string, surface: string): Promise<SavedViewRow[]>;
  createSavedView(input: { ownerUserId: string; surface: string; name: string; filtersJson: string; isDefault: boolean }): Promise<{ id: string }>;
  clearDefaultViews(ownerUserId: string, surface: string): Promise<void>;
  deleteSavedView(id: string, ownerUserId: string): Promise<boolean>;
  duplicateGroups(scope?: OverviewScope): Promise<WorkforceDuplicateGroup[]>;
  confirmDuplicateGroup(canonicalId: string, memberIds: string[], scope?: OverviewScope): Promise<{ tenantId: string | null; maskedEmail: string } | null>;
  forceWorkerPasswordReset(userId: string): Promise<void>;
  resetWorkerMfa(userId: string): Promise<void>;
  recordWorkforceAudit(ctx: AdminCtx, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};
const clampStr = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export class SuperAdminStaffService {
  // `transfers` executes an approved cross-tenant move through the ONE canonical path (tech_salon_memberships).
  // Optional so the no-database adapter and every existing unit test still construct `new SuperAdminStaffService(repo)`.
  constructor(private readonly repo: Repo, private readonly transfers?: CrossTenantTransferExecutor) {}

  getOverview(_ctx: AdminCtx, q: { search?: unknown; status?: unknown; limit?: unknown; scope?: OverviewScope }): Promise<PlatformStaffOverview> {
    return this.repo.platformStaffOverview({
      search: clampStr(q?.search),
      status: clampStr(q?.status, 40),
      limit: clampInt(q?.limit, 200, 1, 1000),
      scope: q?.scope,
    });
  }

  async getStaffDetail(_ctx: AdminCtx, technicianId: string): Promise<PlatformStaffDetail> {
    const d = await this.repo.staffDetail(technicianId);
    if (!d) throw new SuperAdminStaffError('not_found', 'Technician not found');
    return d;
  }

  // Workforce Oversight aggregate. The repo returns real grouped counts from `users` (+ audit_logs); the math is
  // composed here with the pure workforce-core helpers so every total reconciles. Sections without a real source are
  // returned as honest gaps (available:false) rather than fabricated values.
  async getWorkforceOverview(_ctx: AdminCtx, q: { scope?: OverviewScope }): Promise<WorkforceOverview> {
    const raw = await this.repo.workforceRaw(q?.scope);
    const roleDistribution = bucketRoleDistribution(raw.roleCounts);
    const statusDistribution = bucketStatus(raw.statusCounts);
    const top = raw.byTenant.slice(0, 7);
    const othersCount = raw.byTenant.slice(7).reduce((s, r) => s + r.count, 0);
    const rows = othersCount > 0 ? [...top, { tenantId: 'others', tenantName: 'Others', count: othersCount }] : top;
    const tenantTotal = raw.byTenant.reduce((s, r) => s + r.count, 0);
    const kpi = (value: number | null): WorkforceKpi => ({ value, available: value != null });
    const gap = (reason: string): GapSection => ({ available: false, reason });
    return {
      scope: { tenantScoped: !!q?.scope },
      kpis: {
        totalWorkers: kpi(roleDistribution.total),
        activeWorkers: kpi(statusDistribution.active),
        inactiveWorkers: kpi(statusDistribution.inactive),
        technicians: kpi(roleDistribution.technicians),
        receptionists: kpi(roleDistribution.receptionists),
        managers: kpi(roleDistribution.managers),
        duplicateProfiles: kpi(raw.duplicateGroups),
        branchTransfers: kpi(null), // no worker-transfer source yet
        accountAccessIssues: kpi(raw.accessIssues),
        payrollSyncIssues: kpi(null), // no payroll-sync integration yet
        missingEmploymentInfo: kpi(raw.missingInfo),
        suspiciousPermissionActivity: kpi(null), // no security-activity source yet
      },
      roleDistribution,
      statusDistribution,
      workersByTenant: { rows, total: tenantTotal },
      healthAlerts: assembleHealthAlerts({
        duplicates: raw.duplicateGroups, missingTax: null, payrollFailures: null, suspiciousLogin: null,
        inactiveUsers: statusDistribution.inactive, transferRequests: null, connectivityIssues: null,
      }),
      availabilityDistribution: gap('No real-time availability source connected'),
      workforceTrend: gap('No historical workforce status snapshots'),
      transferPipeline: gap('Worker transfer pipeline not yet modeled'),
      technicianConnectivity: gap('No technician app heartbeat source connected'),
      payrollSyncRate: gap('No payroll synchronization integration connected'),
      recentActivity: raw.recentActivity,
      auditEventSummary: summarizeAudit(raw.auditToday),
      todaySummary: { auditEvents: kpi(raw.auditToday.reduce((s, a) => s + a.count, 0)) },
    };
  }

  // Server-side workforce directory: real paginated/filtered/sorted `users` rows (scope-honored). The query is
  // normalized (page/pageSize clamped, sort whitelisted) before it reaches the repo's SQL.
  async getWorkforceDirectory(_ctx: AdminCtx, q: Record<string, unknown> & { scope?: OverviewScope }): Promise<WorkforceDirectoryPage> {
    const nq = normalizeWorkforceQuery(q);
    return this.repo.workforceDirectory(nq, q?.scope);
  }

  // Read-only workforce profile (§27): real identity (masked), employment, derived access, live session/device counts,
  // and recent audit history. Never returns secrets (no password hash, tokens, MFA secrets). 404 when the worker is
  // missing, not a staff role, or out of the caller's scope.
  async getWorkforceProfile(_ctx: AdminCtx, userId: string): Promise<WorkforceProfile> {
    const p = await this.repo.workforceProfile(String(userId || ''));
    if (!p) throw new SuperAdminStaffError('not_found', 'Worker not found');
    return p;
  }

  // Controlled, audited account-access support (§32). Validates action + reason (pure core), confirms the target is a
  // worker in scope (404 otherwise), performs exactly the requested real mutation, and writes one audit row capturing
  // the reason and result. Returns a structured result so the UI can show what actually changed.
  async accessSupport(ctx: AdminCtx, userId: string, body: AccessSupportInput): Promise<{ ok: true; action: AccessAction; result: Record<string, unknown> }> {
    const v = validateAccessSupport(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const target = await this.repo.workforceAccessTarget(String(userId || ''));
    if (!target) throw new SuperAdminStaffError('not_found', 'Worker not found');

    let result: Record<string, unknown>;
    if (v.action === 'revoke_sessions') result = { sessionsRevoked: await this.repo.revokeWorkerSessions(target.userId) };
    else if (v.action === 'force_password_reset') { await this.repo.forceWorkerPasswordReset(target.userId); result = { mustChangePassword: true }; }
    else { await this.repo.resetWorkerMfa(target.userId); result = { mfaReset: true }; }

    await this.repo.recordWorkforceAudit(ctx, accessAuditType(v.action), target.userId, { reason: v.reason, role: target.role, result });
    return { ok: true, action: v.action, result };
  }

  // Read: workers who are already inactive/suspended but still hold lingering access (active sessions or device
  // registrations) — the queue an admin would work through. Real query; empty when nothing needs cleanup.
  getDeactivationQueue(_ctx: AdminCtx, scope?: OverviewScope): Promise<WorkforceDeactivationRow[]> {
    return this.repo.deactivationQueue(scope);
  }

  // Controlled, audited terminated-user access cleanup (§33). Refuses to run on an active worker (status changes are a
  // tenant responsibility); for an inactive/suspended worker it revokes all active sessions + device registrations and
  // writes one audit row. Never alters the worker's status.
  async deactivateAccess(ctx: AdminCtx, userId: string, body: DeactivationInput): Promise<{ ok: true; result: { sessionsRevoked: number; devicesRevoked: number } }> {
    const target = await this.repo.workforceAccessTarget(String(userId || ''));
    if (!target) throw new SuperAdminStaffError('not_found', 'Worker not found');
    const v = validateDeactivation(target.status, body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const sessionsRevoked = await this.repo.revokeWorkerSessions(target.userId);
    const devicesRevoked = await this.repo.revokeWorkerDeviceTokens(target.userId);
    const result = { sessionsRevoked, devicesRevoked };
    await this.repo.recordWorkforceAudit(ctx, DEACTIVATION_AUDIT_TYPE, target.userId, { reason: v.reason, role: target.role, status: target.status, result });
    return { ok: true, result };
  }

  // Read: real duplicate-profile groups (workers sharing lower(email) within a tenant), members side-by-side.
  getDuplicateGroups(_ctx: AdminCtx, scope?: OverviewScope): Promise<WorkforceDuplicateGroup[]> {
    return this.repo.duplicateGroups(scope);
  }

  // Controlled duplicate review (§28/29). Validates the submitted group + canonical choice, re-confirms server-side
  // that the members truly form a duplicate group (so an admin can't flag arbitrary unrelated users), and records an
  // audit row capturing the canonical choice + flagged profiles + reason. It does NOT merge or delete anything —
  // resolving the duplicate (reassigning history) remains a tenant responsibility.
  async reviewDuplicate(ctx: AdminCtx, body: DuplicateReviewInput): Promise<{ ok: true; canonicalId: string; flaggedIds: string[]; maskedEmail: string }> {
    const v = validateDuplicateReview(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const confirmed = await this.repo.confirmDuplicateGroup(v.canonicalId, [v.canonicalId, ...v.flaggedIds]);
    if (!confirmed) throw new SuperAdminStaffError('invalid', 'the selected profiles are not a confirmed duplicate group');
    await this.repo.recordWorkforceAudit(ctx, DUPLICATE_REVIEW_AUDIT_TYPE, v.canonicalId, { reason: v.reason, canonicalId: v.canonicalId, flaggedIds: v.flaggedIds, tenantId: confirmed.tenantId, maskedEmail: confirmed.maskedEmail });
    return { ok: true, canonicalId: v.canonicalId, flaggedIds: v.flaggedIds, maskedEmail: confirmed.maskedEmail };
  }

  // ---- controlled worker branch transfer (§30) ----
  async requestWorkerTransfer(ctx: AdminCtx, userId: string, body: TransferRequestInput): Promise<{ ok: true; id: string; status: 'requested' }> {
    const target = await this.repo.workerTransferTarget(String(userId || ''));
    if (!target) throw new SuperAdminStaffError('not_found', 'Worker not found');
    const v = validateTransferRequest(body, target.branchId);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const { id } = await this.repo.createWorkerTransferRequest({ tenantId: target.tenantId, userId: target.userId, fromBranchId: target.branchId, toBranchId: v.toBranchId, reason: v.reason, requestedBy: ctx.userId });
    await this.repo.recordWorkforceAudit(ctx, TRANSFER_REQUEST_AUDIT_TYPE, target.userId, { requestId: id, fromBranchId: target.branchId, toBranchId: v.toBranchId, reason: v.reason });
    return { ok: true, id, status: 'requested' };
  }

  async getWorkforceTransfers(_ctx: AdminCtx, scope?: OverviewScope): Promise<WorkforceTransferPipeline> {
    const { counts, pending } = await this.repo.workerTransferPipeline(scope);
    const s = summarizeTransferPipeline(counts);
    return { available: true, total: s.total, byStatus: s.byStatus, pending };
  }

  async decideWorkerTransfer(ctx: AdminCtx, id: string, body: TransferDecisionInput): Promise<{ ok: true; id: string; status: string }> {
    const v = validateTransferDecision(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const req = await this.repo.getWorkerTransferRequest(String(id || ''));
    if (!req) throw new SuperAdminStaffError('not_found', 'Transfer request not found');
    if (req.status !== 'requested') throw new SuperAdminStaffError('invalid', `request is already ${req.status}`);
    const updated = await this.repo.decideWorkerTransfer(req.id, v.decision, v.note, ctx.userId);
    await this.repo.recordWorkforceAudit(ctx, TRANSFER_DECIDE_AUDIT_TYPE, req.userId, { requestId: req.id, decision: v.decision, note: v.note, toBranchId: req.toBranchId, status: updated.status });
    return { ok: true, id: updated.id, status: updated.status };
  }

  // ---- controlled CROSS-TENANT transfer (§31) — reviewed request + decision; NO provisioning here ----
  async requestCrossTenantTransfer(ctx: AdminCtx, userId: string, body: CrossTransferRequestInput): Promise<{ ok: true; id: string; status: 'requested' }> {
    const target = await this.repo.workerCrossTransferTarget(String(userId || ''));
    if (!target) throw new SuperAdminStaffError('not_found', 'Worker not found');
    const v = validateCrossTransferRequest(body, target.tenantId);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    if (!(await this.repo.tenantExists(v.toTenantId))) throw new SuperAdminStaffError('invalid', 'destination tenant not found');
    const { id } = await this.repo.createCrossTransferRequest({ userId: target.userId, fromTenantId: target.tenantId, toTenantId: v.toTenantId, toBranchId: v.toBranchId, effectiveDate: v.effectiveDate, reason: v.reason, requestedBy: ctx.userId });
    await this.repo.recordWorkforceAudit(ctx, CROSS_TRANSFER_REQUEST_AUDIT_TYPE, target.userId, { requestId: id, fromTenantId: target.tenantId, toTenantId: v.toTenantId, toBranchId: v.toBranchId, effectiveDate: v.effectiveDate, reason: v.reason });
    return { ok: true, id, status: 'requested' };
  }

  getCrossTenantTransfers(_ctx: AdminCtx, scope?: OverviewScope): Promise<WorkforceCrossTransferRow[]> {
    return this.repo.crossTransferList(scope);
  }

  /**
   * Approve or reject a cross-tenant transfer — and, on approval, ACTUALLY MOVE THE TECHNICIAN.
   *
   * == D4: THE TWO TRANSFER SYSTEMS =======================================================================
   *
   * This used to only flip a status. Its own repository said so, and the audit row it wrote carried
   * `provisioning: 'deferred'`. A Super Admin approved a transfer, every screen showed "approved", and the
   * technician was still at the old salon with no access to the new one and nothing anywhere to explain why.
   *
   * Meanwhile `tech_salon_memberships` — the Tech App's and the POS's transfer system — knew nothing about any
   * of it. Two systems, both claiming to move a technician between salons, neither aware the other existed.
   *
   * Now approval executes through the CANONICAL path: one transfer state, two entry points.
   *
   * == AND IT STILL ASKS HER =============================================================================
   *
   * The new membership lands as `pending_tech_approval`, not `active` — UNLESS the technician requested the
   * move herself, in which case consent is already on the record and it goes straight to active.
   *
   * A platform admin who can silently attach a technician's global identity — her followers, her portfolio, her
   * public profile — to a salon she never agreed to work at is not an administrator, it is a back door around
   * the consent the salons themselves are required to get. Super Admin gets to approve the transfer. It does not
   * get to answer for her.
   */
  async decideCrossTenantTransfer(ctx: AdminCtx, id: string, body: CrossTransferDecisionInput): Promise<{ ok: true; id: string; status: string; execution?: unknown }> {
    const v = validateCrossTransferDecision(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const req = await this.repo.getCrossTransferRequest(String(id || ''));
    if (!req) throw new SuperAdminStaffError('not_found', 'Cross-tenant transfer request not found');
    if (req.status !== 'requested') throw new SuperAdminStaffError('invalid', `request is already ${req.status}`);
    const updated = await this.repo.decideCrossTransfer(req.id, v.decision, v.note, ctx.userId);

    // Execute. A rejection moves nobody, and a worker who is not a global technician (an owner, a manager, a
    // front-desk hire) has no membership to write — reported honestly as `executed: false` with the reason,
    // never as a success.
    const execution = v.decision === 'approve' && this.transfers
      ? await this.transfers.execute({
        requestId: req.id, userId: req.userId, fromTenantId: req.fromTenantId ?? null,
        toTenantId: req.toTenantId, toBranchId: req.toBranchId ?? null, requestedBy: req.requestedByUserId ?? null,
        decidedByUserId: ctx.userId,
      })
      : { executed: false as const, reason: v.decision === 'approve' ? 'executor_not_configured' : 'rejected' };

    await this.repo.recordWorkforceAudit(ctx, CROSS_TRANSFER_DECIDE_AUDIT_TYPE, req.userId, {
      requestId: req.id, decision: v.decision, note: v.note, toTenantId: req.toTenantId, status: updated.status,
      execution,
    });
    return { ok: true, id: updated.id, status: updated.status, execution };
  }

  // ---- payroll-sync monitoring + controlled retry (§35). Status/error metadata only — never amounts. ----
  async getPayrollSync(_ctx: AdminCtx, scope?: OverviewScope): Promise<{ summary: PayrollSyncSummary; events: PayrollSyncEventRow[] }> {
    const [counts, raw] = await Promise.all([this.repo.payrollSyncCounts(scope), this.repo.payrollSyncEvents(scope)]);
    const s = summarizePayrollSync(counts);
    const summary: PayrollSyncSummary = { ...s, configured: s.total > 0 };
    const events: PayrollSyncEventRow[] = raw.map((e) => {
      const elig = retryEligibility({ status: e.status, errorCode: e.errorCode, attemptCount: e.attemptCount, maxAttempts: e.maxAttempts });
      return { id: e.id, workerId: e.userId, workerName: e.workerName, tenant: e.tenant, provider: e.provider, eventType: e.eventType, status: e.status, errorCode: e.errorCode, errorMessage: e.errorMessage, attemptCount: e.attemptCount, maxAttempts: e.maxAttempts, lastAttemptAt: e.lastAttemptAt, nextRetryAt: e.nextRetryAt, retryable: elig.ok, retryBlockedReason: elig.ok ? null : elig.reason };
    });
    return { summary, events };
  }

  // A retry re-attempts the integration send: it validates a reason, checks eligibility (transient failure, attempts
  // remaining, not a permanent config error), then records ONE more attempt with exponential backoff and audits it.
  // The row's idempotency key prevents duplicate payroll entries. It never edits payroll amounts.
  async retryPayrollSync(ctx: AdminCtx, id: string, body: PayrollRetryInput): Promise<{ ok: true; id: string; status: string; attemptCount: number; nextRetryAt: string }> {
    const v = validatePayrollRetry(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    const rec = await this.repo.getPayrollSyncEventRecord(String(id || ''));
    if (!rec) throw new SuperAdminStaffError('not_found', 'Payroll sync event not found');
    const elig = retryEligibility({ status: rec.status, errorCode: rec.errorCode, attemptCount: rec.attemptCount, maxAttempts: rec.maxAttempts });
    if (!elig.ok) throw new SuperAdminStaffError('invalid', elig.reason);
    const nextRetryAt = new Date(Date.now() + backoffSeconds(rec.attemptCount + 1) * 1000).toISOString();
    const updated = await this.repo.recordPayrollRetryAttempt(rec.id, nextRetryAt);
    await this.repo.recordWorkforceAudit(ctx, PAYROLL_RETRY_AUDIT_TYPE, rec.id, { reason: v.reason, errorCode: rec.errorCode, attemptCount: updated.attemptCount, nextRetryAt });
    return { ok: true, id: rec.id, status: updated.status, attemptCount: updated.attemptCount, nextRetryAt };
  }

  // ---- suspicious login/permission activity (§37): DERIVED from real signals, never fabricated ----
  async getSecurityActivity(_ctx: AdminCtx, scope?: OverviewScope): Promise<{ alerts: WorkforceSecurityAlert[]; total: number }> {
    const signals = await this.repo.securitySignals(scope);
    const alerts = assembleSecurityAlerts(signals as SecuritySignal[]);
    return { alerts, total: alerts.length };
  }

  // Records a review decision (reviewed / dismissed / escalated) for a derived alert. Alerts are recomputed each
  // request, so the decision lives in the audit trail keyed by the stable alert key; it does not mutate any record.
  async reviewSecurityAlert(ctx: AdminCtx, body: SecurityReviewInput): Promise<{ ok: true; alertKey: string; resolution: string }> {
    const v = validateSecurityReview(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    await this.repo.recordWorkforceAudit(ctx, SECURITY_REVIEW_AUDIT_TYPE, v.alertKey, { alertKey: v.alertKey, resolution: v.resolution, reason: v.reason });
    return { ok: true, alertKey: v.alertKey, resolution: v.resolution };
  }

  // ---- technician-app connectivity (§21/§34): derived from real device_push_tokens heartbeats ----
  async getTechnicianConnectivity(_ctx: AdminCtx, scope?: OverviewScope): Promise<{ summary: TechnicianConnectivitySummary }> {
    const raw = await this.repo.technicianConnectivity(scope);
    const now = Date.now();
    const rows = raw.map((r) => ({ status: classifyConnectivity(r.lastSeen, r.hasToken, now) }));
    return { summary: summarizeConnectivity(rows) };
  }

  // ---- persisted saved views (§6). Owner is always ctx.userId (server-derived), never client-supplied. ----
  async getSavedViews(ctx: AdminCtx, surface: string): Promise<SavedViewRow[]> {
    if (!ctx.userId) return [];
    return this.repo.listSavedViews(ctx.userId, surface);
  }

  async saveView(ctx: AdminCtx, surface: string, body: SavedViewInput): Promise<{ ok: true; id: string }> {
    if (!ctx.userId) throw new SuperAdminStaffError('invalid', 'a signed-in Super Admin is required to save a view');
    const v = validateSavedView(body);
    if (!v.ok) throw new SuperAdminStaffError('invalid', v.error);
    if (v.isDefault) await this.repo.clearDefaultViews(ctx.userId, surface);
    const { id } = await this.repo.createSavedView({ ownerUserId: ctx.userId, surface, name: v.name, filtersJson: JSON.stringify(v.filters), isDefault: v.isDefault });
    return { ok: true, id };
  }

  async deleteView(ctx: AdminCtx, id: string): Promise<{ ok: true; deleted: boolean }> {
    if (!ctx.userId) throw new SuperAdminStaffError('invalid', 'a signed-in Super Admin is required');
    const deleted = await this.repo.deleteSavedView(String(id || ''), ctx.userId);
    return { ok: true, deleted };
  }
}
