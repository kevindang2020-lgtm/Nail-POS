import { api } from './client';
import { superAdminApi } from './superAdminApi';
import type { SaSchedOverview, SaSchedTenantRow, SaSchedTenantDetail, SaSchedActionRequest, SaSchedPlatformSwitch } from '@aipowersalon/api-contracts/platform';

// superAdminAiSchedulingOptimizerApi — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): Super Admin oversight of the AI
// Scheduling Optimizer across salons (contract scratchpad/p7/CONTRACT.md §3.9; agent B's
// modules/super-admin/src/super-admin-ai-scheduling-optimizer/*.controller.ts). Shapes are the API's own contract.
//   reads   super_admin.operations.view — platform counts; a salon's detail ONLY inside an active canonical support
//           session for that salon (403 SUPPORT_SESSION_REQUIRED otherwise — the old ad-hoc `?reason=` gate is gone)
//   writes  super_admin.ai.manage + step-up (the shared client re-confirms and retries once) + reason ≥ 12; audited
export type { SaSchedOverview, SaSchedTenantRow, SaSchedTenantDetail };
export const SCHED_MANAGE_PERMISSION = 'super_admin.ai.manage';
export const SCHED_MIN_REASON = 12;
const enc = encodeURIComponent;
const B = '/super-admin/ai-scheduling-optimizer';

export const superAdminAiSchedulingOptimizerApi = {
  overview: () => api.get<SaSchedOverview>(`${B}/overview`),
  tenants: (search?: string) => api.get<SaSchedTenantRow[] | { rows: SaSchedTenantRow[] }>(`${B}/tenants`, search && search.trim() ? { search: search.trim() } : undefined)
    .then((r) => (Array.isArray(r) ? r : Array.isArray((r as { rows?: SaSchedTenantRow[] })?.rows) ? (r as { rows: SaSchedTenantRow[] }).rows : [])),
  tenant: (tenantId: string) => api.get<SaSchedTenantDetail>(`${B}/tenants/${enc(tenantId)}`),
  retry: (tenantId: string, recommendationId: string, reason: string) =>
    api.post<{ ok: true }>(`${B}/tenants/${enc(tenantId)}/recommendations/${enc(recommendationId)}/retry`, { reason } satisfies SaSchedActionRequest),
  rollback: (tenantId: string, recommendationId: string, reason: string) =>
    api.post<{ ok: true }>(`${B}/tenants/${enc(tenantId)}/recommendations/${enc(recommendationId)}/rollback`, { reason } satisfies SaSchedActionRequest),
  disable: (tenantId: string, reason: string) => api.post<{ ok: true; killed: boolean }>(`${B}/tenants/${enc(tenantId)}/disable`, { reason } satisfies SaSchedActionRequest),
  platformSwitch: (killed: boolean, reason: string) => api.put<{ ok: true; killed: boolean }>(`${B}/platform-switch`, { killed, reason } satisfies SaSchedPlatformSwitch),
  /** opens the canonical support session (Support Mode) for one salon — the same route Tenants › Support uses */
  startSupportSession: (tenantId: string, reason: string) => superAdminApi.supportAccess(tenantId, { reason, source: 'ai_scheduling_oversight' }),
};
