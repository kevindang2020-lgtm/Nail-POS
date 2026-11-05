// superAdminAiPlatformApi.ts — Constitution 10 §171–176: the AI PLATFORM control plane.
//
// Distinct from superAdminAiApi, which serves the AI subscription/package commerce surface (who subscribes to
// which AI package, MRR). This one answers operational questions: which providers are healthy, what is each
// model costing, which tenants are spending, what the router would choose.
//
// §173: no credentials appear anywhere in these payloads, by construction — the service method that builds the
// provider panel never reads one.
import { api } from './client';

/** null means UNKNOWN, not zero and not 100%. A rate over zero requests has not been measured. */
export type Measured = number | null;

export interface AiPlatformOverview {
  requestsToday: number;
  successRate: Measured;
  averageLatencyMs: Measured;
  costTodayMicroUsd: number;
  costMonthMicroUsd: number;
  activeTenants: number;
  jobsRunning: number;
  failures: number;
  providerHealth: Record<string, { status: string; latencyMsP50: number | null; lastFailureAt?: number | null }>;
  safetyEvents: number;
}

export interface AiProviderPanel {
  provider: string; status: string; latencyMsP50: Measured; errorRate: Measured;
  requests: number; costMicroUsd: number; lastIncidentAt: string | null; routableModels: string[];
}

export interface AiModelPanel {
  model: string; provider: string; status: string; tier: string;
  allowedTasks: string[]; requests: number; costMicroUsd: number;
  inPerM: number; outPerM: number; qualityScore: Measured;
}

/** §175: derived from the registries, not from a query — what the router WOULD do for each task. */
export interface AiRoutingPanel {
  taskKey: string; module: string; riskLevel: string; capability: string; preferredTier: string;
  allowedProviders: string[]; defaultModel: string | null; maxOutputTokens: number; timeoutMs: number;
  maxAutomation: string; approval: string; routingPolicyVersion: string;
}

export interface AiTenantUsagePanel {
  tenantId: string; requests: number; costMicroUsd: number; failures: number; topAction?: string | null;
}

export const superAdminAiPlatformApi = {
  overview: () => api.get<AiPlatformOverview>('/super-admin/ai-platform/overview'),
  providers: () => api.get<AiProviderPanel[]>('/super-admin/ai-platform/providers'),
  models: () => api.get<AiModelPanel[]>('/super-admin/ai-platform/models'),
  routing: () => api.get<AiRoutingPanel[]>('/super-admin/ai-platform/routing'),
  tenants: (limit?: number) => api.get<AiTenantUsagePanel[]>(`/super-admin/ai-platform/tenants${limit ? `?limit=${limit}` : ''}`),
};
