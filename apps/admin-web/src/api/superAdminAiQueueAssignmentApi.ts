import { api } from './client';

// superAdminAiQueueAssignmentApi — BUILD_PLAN Phase 6 (ai_queue_assignment): Super Admin oversight of the AI queue
// assignment across salons. The audit found admin-web never called `/super-admin/ai-queue-assignment` (UI row "Super
// Admin oversight screen: MISSING"). Counts and switches only — never a guest, never recommendation content.
//
// The shapes mirror agent C's server code exactly (modules/ai/src/ai-queue-assignment/ai-queue-assignment-superadmin.
// {controller,repository}.ts + the settings port's effective settings). They are not in @aipowersalon/api-contracts
// yet — the lead may move them there and this file then re-exports them.
// Reads need super_admin.operations.view; the salon kill switch needs super_admin.ai.manage + a recent step-up.

export const AQ_MANAGE_PERMISSION = 'super_admin.ai.manage';
export const AQ_MIN_KILL_REASON = 12;

export interface AqPlatformOverview {
  ok?: boolean;
  /** bug 12: DISTINCT salons — with any AI-queue data / effective auto on / salon kill on / an active package */
  salons: { using: number; autoEnabled: number; autoKilled: number; entitled: number };
  platformAutoActionsDisabled: boolean;
  recommendations: { total: number; last30Days: number };
  /** acceptanceRate = accepted ÷ staff decisions (0–1); auto-assignments are counted on their own (bug 13) */
  decisions: { accepted: number; rejected: number; overridden: number; kept_unassigned: number; auto_assigned: number; total: number; acceptanceRate: number | null };
  alerts: { total: number; open: number; autoResolved: number; openByType: Record<string, number>; openBySeverity: Record<string, number> };
  /** the statuses AiPlatform really writes (success / failed / blocked_*), plus total and other */
  aiCalls: Record<string, number>;
  jobs: { lastScanAt: string | null; lastAutoRunAt: string | null; branchesScannedLast10Min: number };
  auto: { tenantsEnabled: number };
  tenantsWithSettings: number;
}

export interface AqSalonRow {
  tenantId: string; name: string; status: string; branches: number; branchesAutoOn: number; autoKilled: boolean; autoKilledReason: string | null;
  openAlerts: number; criticalAlerts: number; decisions30d: number; autoAssigned30d: number; lastScanAt: string | null; lastAutoRunAt: string | null;
}

/** the settings port's effective settings for one location (salon values with the location's overrides on top) */
export interface AqEffectiveSettings {
  waitApproachingMin: number; waitExceededMin: number; waitSevereMin: number; waitCriticalMin: number;
  stuckMinutes: number; longServiceFactor: number; congestionWaitingPerTech: number; lateGraceMin: number;
  rotationPolicy: string; fixedOrder: string[];
  autoEnabled: boolean; autoConfidenceFloor: number; autoMaxPerRun: number; autoDelaySeconds: number; autoExclusions: Record<string, unknown>;
  tenantVersion: number; branchVersion: number; configVersion: string;
  salonAutoKilled: boolean; salonAutoKilledReason: string | null; platformAutoActionsDisabled: boolean;
  autoAllowed: boolean; autoBlockedBy: null | 'platform' | 'salon_kill_switch' | 'disabled';
}
export type AqSalonSettings = Omit<AqEffectiveSettings, 'tenantVersion' | 'branchVersion' | 'configVersion' | 'salonAutoKilled' | 'salonAutoKilledReason' | 'platformAutoActionsDisabled' | 'autoAllowed' | 'autoBlockedBy'>
  & { version: number; autoKilled: boolean; autoKilledReason: string | null };

export interface AqSalonDetail {
  tenant: { tenantId: string; name: string; status: string };
  branches: { branchId: string; name: string; status: string; openAlerts: number; lastScanAt: string | null; lastAutoRunAt: string | null; effective: AqEffectiveSettings | null }[];
  /** open alerts only (resolved ones are not listed — bug 9); reasons are minutes and counts, never a guest */
  openAlerts: { id: string; branchId: string; type: string; severity: string; reason: string; ageMinutes: number; createdAt: string; autoResolved: boolean }[];
  alertsByType: Record<string, number>;
  decisions30d: Record<string, number>;
  aiCalls30d: Record<string, number>;
  salonSettings: AqSalonSettings | null;
  versions: { version: number; branchId: string | null; change: string; reason: string | null; changedBy: string | null; createdAt: string; settings: unknown }[];
  auto: { salonKilled: boolean; salonKilledReason: string | null; platformAutoActionsDisabled: boolean; branchesAllowed: number };
}

export interface AqAutoKillResult { tenantId: string; killed: boolean; reason: string | null; version: number }

export const superAdminAiQueueAssignmentApi = {
  overview: () => api.get<AqPlatformOverview>('/super-admin/ai-queue-assignment/overview'),
  /** GET tenants?search → { rows } */
  tenants: (search?: string) => api.get<{ rows: AqSalonRow[] }>('/super-admin/ai-queue-assignment/tenants', search && search.trim() ? { search: search.trim() } : undefined)
    .then((r) => (Array.isArray(r?.rows) ? r.rows : [])),
  tenant: (tenantId: string) => api.get<AqSalonDetail>(`/super-admin/ai-queue-assignment/tenants/${encodeURIComponent(tenantId)}`),
  /** Salon-wide auto-assignment kill switch: super_admin.ai.manage + step-up (the client re-confirms and retries once) + reason ≥ 12; audited. */
  setAutoKill: (tenantId: string, killed: boolean, reason: string) =>
    api.post<AqAutoKillResult>(`/super-admin/ai-queue-assignment/tenants/${encodeURIComponent(tenantId)}/auto-kill`, { killed, reason }),
};
