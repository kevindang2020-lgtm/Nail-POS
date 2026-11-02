// posAiGovernanceApi.ts — Constitution 10 §166/§52/§53/§129: the tenant's view of the AI PLATFORM itself —
// budget, automation level per task against the platform ceiling, approvals waiting on a human, and the
// tenant's own safety settings.
//
// NOT the same thing as posAiCenterApi. That one serves `/tenant/ai/center/overview`, the business-outcome
// dashboard built to the 12-module reference image (conversations, campaigns, call intelligence). This one
// serves the governance surface: what the platform is allowed to do here, who may change it, and what it cost.
// They share an input table (ai_usage_logs) and nothing else, so they stay separate screens rather than one
// page trying to be both.
import { api } from './client';
import type { AutomationLevel } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

/**
 * The SIX levels the safety engine actually uses, in the server's own order and spelling
 * (src/ai/ai-safety-policy.ts AUTOMATION_LEVELS). A first draft of this file invented a four-value lowercase
 * vocabulary; every real task would then have rendered its raw level string, and the screen's tests passed
 * only because the same wrong vocabulary was used in their fixtures.
 */
export const AUTOMATION_LEVELS = ['OFF', 'SUGGEST_ONLY', 'DRAFT', 'APPROVAL_REQUIRED', 'LIMITED_AUTOMATION', 'AUTOMATIC'] as const;

export interface TenantAiDashboard {
  enabledModules: Array<{ packageCode: string; name: string; automation: AutomationLevel | null }>;
  /** null means the caller may not see this section — the name appears in `hidden`. Not the same as zero. */
  usage: { requests: number; failures: number; costMicroUsd: number } | null;
  budget: { limitMicroUsd: number; spentMicroUsd: number; usedPercent: number } | null;
  pendingApprovals: Array<Record<string, unknown>>;
  automationByTask: Array<{ taskKey: string; effective: AutomationLevel; platformMax: AutomationLevel }>;
  canManageSettings: boolean;
  /** §166: sections the caller may not see, NAMED so the UI can say why rather than silently omit them. */
  hidden: string[];
}

export interface TenantAiSettingsPayload {
  settings: { automation?: Record<string, AutomationLevel>; killSwitch?: boolean; disabledTasks?: string[]; disabledTools?: string[] };
  /** The server's own level list, so the editor never offers a word the engine does not know. */
  levels: readonly AutomationLevel[];
  /** Per task: the ceiling it cannot be raised above (§110), so the UI offers only adjustable choices. */
  tasks: Array<{ taskKey: string; module: string; risk: string; platformMax: AutomationLevel }>;
}

export const posAiGovernanceApi = {
  dashboard: () => api.get<TenantAiDashboard>('/ai/dashboard'),
  getSettings: () => api.get<TenantAiSettingsPayload>('/ai/dashboard/settings'),
  /** §110: the server REJECTS a payload above the ceiling rather than clamping it, so a 400 here is a real answer. */
  saveSettings: (settings: TenantAiSettingsPayload['settings']) => api.post<{ ok: boolean; settings: TenantAiSettingsPayload['settings'] }>('/ai/dashboard/settings', { settings }),
  feedbackSummary: (taskKey?: string) => api.get<any>(`/ai/dashboard/feedback${taskKey ? `?taskKey=${encodeURIComponent(taskKey)}` : ''}`),
};
export type { AutomationLevel };
