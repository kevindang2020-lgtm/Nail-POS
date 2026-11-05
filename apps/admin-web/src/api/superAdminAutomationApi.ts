import { api } from './client';
import type { AutomationDashboard } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)


export const superAdminAutomationApi = {
  dashboard: () => api.get<{ ok: true } & AutomationDashboard>('/super-admin/automation-rules/overview'),
  createRule: (body: { name: string; description?: string; ruleType?: string; triggerId: string; conditions?: unknown; actions: { type: string }[]; scopeKind?: string; tenantId?: string | null }) => api.post<{ ok: boolean; error?: string; errors?: string[]; id?: string }>('/super-admin/automation-rules/rules', body),
  testRule: (body: { triggerId?: string; conditions?: unknown; actions?: { type: string }[]; context?: Record<string, unknown> }) => api.post<AutomationTestResult>('/super-admin/automation-rules/test', body),
  setStatus: (id: string, body: { to: string; reason?: string }) => api.post<{ ok: boolean; error?: string; status?: string }>(`/super-admin/automation-rules/rules/${id}/status`, body),
  createException: (body: { ruleId: string; tenantId: string; exceptionType: string; overrideValue?: string; notes?: string; reason?: string }) => api.post<{ ok: boolean; error?: string; id?: string }>('/super-admin/automation-rules/exceptions', body),
  retryFailure: (id: string) => api.post<{ ok: boolean; error?: string; status?: string; class?: string }>(`/super-admin/automation-rules/failures/${id}/retry`, {}),
};

export interface AutomationTestResult { ok: boolean; dryRun: true; triggerMatched: boolean; conditionsPassed: boolean; trace: { field: string; operator: string; passed: boolean }[]; resolvedActions: string[]; skippedActions: string[]; warnings: string[] }
export type { AutomationDashboard };
