// superAdminVoiceApi.ts — typed client for Super Admin → AI Receptionist management. Wraps the real /super-admin/voice/*
// endpoints (keys, call history, learning). No fabricated data: everything here reflects a real backend store.
import type { VoiceAnalytics } from '@aipowersalon/api-contracts/tenant';
export type { VoiceAnalytics };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';
import type { FleetSummary } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { Suggestion } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { VoicePromptVersion } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { CallOutcomeRecord } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export interface VoiceKey { id: string; tenantId: string; branchId: string; label: string; provider: string; prefix: string; lastUsedMs: number | null; expiresMs: number | null; revokedMs: number | null; createdMs: number }
export interface IssuedVoiceKey { raw: string; key: VoiceKey }

export interface ProvisioningMetrics { since: string; attempts: number; succeeded: number; failed: number; successRatePct: number | null; byErrorCode: Record<string, number> }
export interface GatewayMetrics {
  since: string; totalRequests: number; totalErrors: number; successRatePct: number | null;
  idempotentReplays: number; rateLimitEvents: number; handoffs: number;
  byOperation: Record<string, { requests: number; errors: number }>; byErrorCode: Record<string, number>;
}

export const superAdminVoiceApi = {
  listKeys: (tenantId: string) => api.get<VoiceKey[]>('/super-admin/voice/keys', { tenantId }),
  issueKey: (b: { tenantId: string; branchId: string; label: string; provider?: string; environment?: 'live' | 'test' }) => api.post<IssuedVoiceKey>('/super-admin/voice/keys', b),
  revokeKey: (tenantId: string, id: string) => api.patch<{ revoked: boolean }>(`/super-admin/voice/keys/${id}/revoke?tenantId=${encodeURIComponent(tenantId)}`, {}),

  listCalls: (tenantId: string, opts: { branchId?: string; limit?: number } = {}) => api.get<CallOutcomeRecord[]>('/super-admin/voice/calls', { tenantId, ...opts }),
  analytics: (tenantId: string, branchId?: string) => api.get<VoiceAnalytics>('/super-admin/voice/analytics', { tenantId, ...(branchId ? { branchId } : {}) }),
  gatewayMetrics: () => api.get<GatewayMetrics>('/super-admin/voice/gateway-metrics'),
  fleet: () => api.get<FleetSummary>('/super-admin/voice/fleet'),
  provisioningMetrics: () => api.get<ProvisioningMetrics>('/super-admin/voice/provisioning-metrics'),

  listSuggestions: (tenantId: string, status?: string) => api.get<Suggestion[]>('/super-admin/voice/suggestions', { tenantId, ...(status ? { status } : {}) }),
  approveSuggestion: (tenantId: string, id: string, newPromptBody?: string, scope?: string) => api.post(`/super-admin/voice/suggestions/${id}/approve?tenantId=${encodeURIComponent(tenantId)}`, { newPromptBody, scope }),
  rejectSuggestion: (tenantId: string, id: string) => api.post(`/super-admin/voice/suggestions/${id}/reject?tenantId=${encodeURIComponent(tenantId)}`, {}),
  rollbackPrompt: (tenantId: string, scope?: string) => api.post(`/super-admin/voice/prompts/rollback?tenantId=${encodeURIComponent(tenantId)}`, { scope }),
  activePrompt: (tenantId: string, scope?: string) => api.get<VoicePromptVersion | null>('/super-admin/voice/prompts/active', { tenantId, ...(scope ? { scope } : {}) }),
};
export type { FleetSummary };
export type { Suggestion };
export type { VoicePromptVersion };
export type { CallOutcomeRecord };
