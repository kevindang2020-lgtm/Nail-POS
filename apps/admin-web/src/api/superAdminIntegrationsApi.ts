import { api } from './client';

export type IntKpis = {
  totalActiveIntegrations: number; connectedTenants: number; healthyConnections: number; healthyPct: number;
  failedSynchronizations: number; failedSync24h: number; expiredAuthTokens: number; webhookErrors: number;
  apiUsageToday: number; integrationsRequiringAttention: number; successfulSyncs24h: number; disabledConnections: number;
};
export type IntOverview = {
  available: boolean; kpis?: IntKpis;
  syncTrend?: { label: string; date: string; successPct: number; total: number }[];
  apiUsageByIntegration?: { integration: string; calls: number }[];
  statusBreakdown?: { status: string; count: number }[];
  webhookHealth?: { status: string; count: number }[];
};
export type IntConnection = { key: string; name: string; category: string; status: string; tenantsUsing: number; authStatus: string; lastSuccessfulSync: string | null; failedSyncs: number; apiUsageToday: number; webhookStatus: string; errorLogs: number; modelled: boolean };
export type IntWebhookEvent = { id: string; eventSource: string; tenantName: string | null; result: string; retries: number; statusCode: number | null; error: string | null; timestamp: string | null };
export type IntAuthAlert = { id: string; integration: string; tenantName: string | null; issue: string; expiresOn: string | null };
export type IntErrorLog = { id: string; integration: string; tenantName: string | null; errorType: string; severity: string; lastAttempt: string | null; statusCode: number | null; message: string | null; nextAction: string };
export type IntTenantUsage = { tenantId: string; tenantName: string; integrations: number; status: string; apiCallsToday: number; lastSync: string | null };
export type IntMarketplaceItem = { key: string; name: string; category: string };

export type IntFilters = { integrationType?: string; tenantId?: string; status?: string; authStatus?: string; syncState?: string; dateFrom?: string; dateTo?: string; q?: string };
const qy = (o: IntFilters): Record<string, unknown> => { const q: Record<string, unknown> = {}; for (const k of ['integrationType', 'tenantId', 'status', 'authStatus', 'syncState', 'dateFrom', 'dateTo', 'q'] as const) if (o[k]) q[k] = o[k]; return q; };

export const fetchIntegrationsOverview = (f: IntFilters = {}): Promise<IntOverview> => api.get('/super-admin/integrations/overview', qy(f));
export const listConnectedIntegrations = (f: IntFilters = {}): Promise<{ available: boolean; integrations: IntConnection[] }> => api.get('/super-admin/integrations/connected', qy(f));
export const listWebhookEvents = (f: IntFilters = {}): Promise<{ available: boolean; events: IntWebhookEvent[] }> => api.get('/super-admin/integrations/webhooks/events', qy(f));
export const listAuthAlerts = (f: IntFilters = {}): Promise<{ available: boolean; alerts: IntAuthAlert[] }> => api.get('/super-admin/integrations/alerts', qy(f));
export const listErrorLogs = (f: IntFilters = {}): Promise<{ available: boolean; errors: IntErrorLog[] }> => api.get('/super-admin/integrations/errors', qy(f));
export const listTenantUsage = (f: IntFilters = {}): Promise<{ available: boolean; tenants: IntTenantUsage[] }> => api.get('/super-admin/integrations/tenant-usage', qy(f));
export const listMarketplace = (): Promise<{ available: boolean; services: IntMarketplaceItem[] }> => api.get('/super-admin/integrations/marketplace', {});
export const disableConnection = (id: string, reason: string): Promise<{ ok: boolean; status: string }> => api.post(`/super-admin/integrations/connections/${id}/disable`, { reason });

export async function exportIntegrationReport(opts: IntFilters & { format?: 'csv' | 'xlsx' | 'pdf' } = {}): Promise<{ filename: string; rowCount: number }> {
  const query: Record<string, unknown> = { ...qy(opts) };
  if (opts.format) query.format = opts.format;
  const res = await api.exportAsync<{ ok: boolean; filename: string; mime: string; content: string; rowCount: number; encoding?: 'utf8' | 'base64' }>('/super-admin/integrations/export', query);
  if (typeof document !== 'undefined' && typeof URL?.createObjectURL === 'function') {
    let body: BlobPart = res.content ?? '';
    if (res.encoding === 'base64' && typeof atob === 'function') { const bin = atob(res.content ?? ''); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); body = b; }
    const blob = new Blob([body], { type: res.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = res.filename || 'integrations-export'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { filename: res.filename, rowCount: res.rowCount };
}

// ── Connection lifecycle (Add-Integration / OAuth / Refresh / Credentials / Test / Disable) ──
// Backed by super-admin/integrations/connections/* (migration 184). Tokens/secrets are never returned by any of these.
export type ApprovedProvider = { key: string; name: string; category: string; authMethods: string[]; defaultScopes: string[]; webhookCapable: boolean };
export const listApprovedProviders = (): Promise<{ available: boolean; providers: ApprovedProvider[] }> => api.get('/super-admin/integrations/providers', {});
export const createConnection = (body: { providerKey: string; ownershipType: string; tenantId?: string | null; branchId?: string | null; authMethod?: string }): Promise<{ ok: boolean; connection: { id: string; provider_key: string; category: string; connection_status: string } }> => api.post('/super-admin/integrations/connections', body);
export const beginOAuth = (id: string, body: { redirectUri: string; scopes?: string[] }): Promise<{ ok: boolean; authorizationUrl: string; state: string; scopes: string[] }> => api.post(`/super-admin/integrations/connections/${id}/oauth/begin`, body);
export const completeOAuth = (id: string, body: { state: string; code: string }): Promise<{ ok: boolean; authenticationStatus: string; grantedScopes: string[]; providerAccount: string | null; tokenExpiresAt: string | null }> => api.post(`/super-admin/integrations/connections/${id}/oauth/complete`, body);
export const refreshAuthentication = (id: string): Promise<{ ok: boolean; authenticationStatus: string; tokenExpiresAt: string | null }> => api.post(`/super-admin/integrations/connections/${id}/auth/refresh`, {});
export const configureApiKey = (id: string, apiKey: string): Promise<{ ok: boolean; maskedCredential?: string; unchanged?: boolean; authenticationStatus?: string }> => api.post(`/super-admin/integrations/connections/${id}/credentials`, { apiKey });
export const rotateCredential = (id: string, body: { kind?: string; newSecret: string; reason: string }): Promise<{ ok: boolean; maskedCredential: string }> => api.post(`/super-admin/integrations/connections/${id}/credentials/rotate`, body);
export const getCredentialSummary = (id: string): Promise<{ ok: boolean; connection: any; credentials: { id: string; kind: string; masked_value: string; status: string }[] }> => api.get(`/super-admin/integrations/connections/${id}/credentials`, {});
export const testConnectionLive = (id: string): Promise<{ ok: boolean; result: { succeeded: boolean; latencyMs: number | null; providerAccount: string | null; apiVersion: string | null; errorCategory: string | null } }> => api.post(`/super-admin/integrations/connections/${id}/test`, {});
export const disableConnectionLifecycle = (id: string, reason: string): Promise<{ ok: boolean; connectionStatus: string }> => api.post(`/super-admin/integrations/connections/${id}/lifecycle-disable`, { reason });

export type ManagedConnection = { id: string; tenant_id: string | null; provider_key: string; category: string; ownership_type: string; connection_status: string; authentication_status: string; sync_status: string; webhook_status: string; auth_method: string | null; granted_scopes: string[]; provider_account: string | null; token_expires_at: string | null; created_at: string };
export const listConnections = (f: { providerKey?: string; status?: string; tenantId?: string } = {}): Promise<{ ok: boolean; connections: ManagedConnection[] }> => api.get('/super-admin/integrations/connections', f as Record<string, unknown>);

// ── Synchronization engine ──
export type SyncJob = { id: string; sync_type: string; status: string; items_read: number; items_created: number; items_skipped: number; items_failed: number; retry_count: number; error_category: string | null; created_at: string; completed_at: string | null };
export const enqueueSync = (id: string, body: { syncType?: string; idempotencyKey?: string } = {}): Promise<{ ok: boolean; jobId: string; jobStatus: string; deduped?: boolean }> => api.post(`/super-admin/integrations/connections/${id}/sync`, body);
export const listSyncJobs = (id: string): Promise<{ ok: boolean; jobs: SyncJob[] }> => api.get(`/super-admin/integrations/connections/${id}/syncs`, {});
export const retrySyncJob = (jobId: string): Promise<{ ok: boolean; jobStatus: string; retryCount?: number }> => api.post(`/super-admin/integrations/sync/${jobId}/retry`, {});
export const drainSyncQueue = (limit = 10): Promise<{ ok: boolean; processed: number }> => api.post('/super-admin/integrations/sync/drain', { limit });

// ── Inbound webhook events (review / retry / drain) ──
export type InboundWebhookEvent = { id: string; provider_event_id: string; event_type: string | null; signature_result: string; replay_result: string; status: string; attempt_count: number; error_category: string | null; received_at: string; processed_at: string | null };
export const listConnectionWebhookEvents = (id: string): Promise<{ ok: boolean; events: InboundWebhookEvent[] }> => api.get(`/super-admin/integrations/connections/${id}/webhook-events`, {});
export const retryWebhookEvent = (eventId: string): Promise<{ ok: boolean; eventStatus: string }> => api.post(`/super-admin/integrations/webhook-events/${eventId}/retry`, {});
export const drainWebhookQueue = (limit = 20): Promise<{ ok: boolean; processed: number }> => api.post('/super-admin/integrations/webhook/drain', { limit });

// ── Reliability (circuit breaker + rate limits) ──
export type ReliabilityState = { ok: boolean; breaker: { state: string; failure_count: number; failure_threshold?: number; cooldown_seconds?: number; opened_at?: string | null }; rateLimits: { scope_type: string; scope_key: string; count: number; limit_per_window: number; window_seconds: number; retry_after_until: string | null }[] };
export const getConnectionReliability = (id: string): Promise<ReliabilityState> => api.get(`/super-admin/integrations/connections/${id}/reliability`, {});
export const resetCircuitBreaker = (id: string, reason: string): Promise<{ ok: boolean; breakerState: string }> => api.post(`/super-admin/integrations/connections/${id}/circuit/reset`, { reason });

// ── Scheduler (bounded maintenance pass) ──
export type SchedulerTickResult = { ok: boolean; scheduledEnqueued: number; syncDrained: number; webhookDrained: number; tokensRefreshed: number; refreshFailures: number };
export const runSchedulerTick = (limit = 25): Promise<SchedulerTickResult> => api.post('/super-admin/integrations/scheduler/tick', { limit });
