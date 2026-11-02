// super-admin-ai-scheduling.ts — BUILD_PLAN Phase 7: Super Admin oversight of the AI Scheduling Optimizer. Platform
// counts only; a salon's detail requires an ACTIVE canonical support session (support_access_sessions) for that salon,
// and every write (retry / disable / rollback / platform kill switch) needs step-up and is audited.
export interface SaSchedOverview {
  enabledTenants: number; killedTenants: number; platformKilled: boolean;
  runs: { total: number; completed: number; failed: number; last24h: number };
  recommendations: Record<string, number>;               // by status
  applied: { manual: number; automated: number; failed: number };
  proposals: Record<string, number>;                      // by status
  conflictsOpen: number; understaffingOpen: number;
  explanations: { llm: number; template: number }; llmCostMicroUsd30d: number;
  generatedAt: string;
}
export interface SaSchedTenantRow { tenantId: string; tenantName: string; enabled: boolean; killed: boolean; runs30d: number; applied30d: number; failed30d: number; lastRunAt: string | null }
export interface SaSchedTenantDetail {
  tenantId: string; supportSessionId: string;
  settings: { enabled: boolean; killed: boolean; automationAllowed: boolean; version: number };
  runs: { id: string; scope: string; status: string; startedAt: string; errorCode: string | null }[];
  failedApplications: { recommendationId: string; status: string; errorCode: string | null; attempt: number; updatedAt: string }[];
  recommendationsByStatus: Record<string, number>;
}
export interface SaSchedActionRequest { reason: string }
export interface SaSchedPlatformSwitch { killed: boolean; reason: string }
