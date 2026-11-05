// posCustomerNotificationsApi.ts — Communications → Customer Notifications (pos/customer-notifications/*, migration 741).
// Tenant / branch come from the session. Nothing here sends except `retry` (one confirmed, idempotent resend of one failed row).
import { api } from './client';

export type CnState = 'delivered' | 'sent' | 'pending' | 'unknown' | 'failed' | 'blocked' | 'simulated';
export interface CnFailure { category: string; retry: 'never' | 'after_fix' | 'allowed'; action: string; rootCause: string | null }
export interface CnRow {
  id: string; createdAt: string | null; channel: 'sms' | 'email'; type: string | null; status: string; state: CnState;
  customer: { id: string; name: string | null } | null; recipient: string; recipientMasked: string; recipientValid: boolean; detail: string | null;
  providerErrorCode: string | null; deliveredAt: string | null; branchId: string | null; failure: CnFailure | null; retryOf: string | null; resent: boolean; source: { type: string; id: string } | null;
}
export interface CnPage<T> { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number }
export interface CnWindow { preset: 'today' | 'week' | 'month' | 'year' | 'custom' | 'all'; from: string | null; to: string | null; tz: string; today?: string; basis?: string }
export interface CnSummary {
  kpis: { sent: number; delivered: number; failed: number; blocked: number; pending: number; unknown: number; simulated: number; total: number; optOutsCurrent: number; optOutsNew: number; deliveryRate: number | null };
  legacy: { sentRecent: number; blockedFailedRecent: number };
  window: CnWindow & { today: string; basis: string; branchId: string | null };
  canManage: boolean;
  provenance: { computedAt: string; lastCallbackAt: string | null; unknownAfterHours: number; definitions: Record<string, string> };
}
export interface CnDetail extends CnRow {
  header: { category: string | null; state: CnState };
  identity: { customer: CnRow['customer']; recipient: string; branch: { id: string; name: string | null } | null; sender: { route: string | null; from: string | null } };
  message: { subject: string | null; body: string | null; bodyHidden: boolean; segments: number | null };
  timing: { createdAt: string | null; providerAcceptedAt: string | null; providerAcceptedNote?: string | null; deliveredAt: string | null; failedAt: string | null; lastCallbackAt: string | null; unknownSince: string | null };
  diagnostics: { category: string | null; rootCause: string | null; providerErrorCode: string | null; providerStatus: string | null; message: string | null; providerReference: string | null;
    events: { providerStatus: string; errorCode: string | null; applied: boolean; signatureVerified: boolean; receivedAt: string | null }[] };
  attempts: { id: string; retryOf: string | null; status: string; createdAt: string | null; current: boolean; failure: string | null }[];
  retryRequests: { id: string; outcome: string; refusalCode: string | null; category: string; at: string | null; newNotificationId: string | null; byName: string | null }[];
  consent: { optedOut: boolean };
  retry: { eligible: boolean; code: string | null; category?: string };
  links: Record<string, string | null>;
}
export interface CnFailureGroup { category: string; channel: string; count: number; latestAt: string | null; firstAt: string | null; sampleIds: string[]; retry: string; action: string; rootCauses: Record<string, number>; example: string | null; fixLink: string | null; setupNow: string | null }
export interface CnHealthItem { state: 'ready' | 'pending' | 'attention' | 'unknown' | 'not_applicable'; detail?: string | null; reasonCode?: string | null; fixLink?: string; lastCheckedAt?: string | null; lastVerifiedEventAt?: string | null }
export interface CnHealth {
  twilio: CnHealthItem; sender: CnHealthItem; registration: CnHealthItem; webhooks: CnHealthItem; outbound: CnHealthItem & { blockers: string[]; warnings: string[] };
  email: CnHealthItem & { lastAcceptedAt: string | null; deliveryEvents: string }; callbacks: { lastReceivedAt: string | null; awaiting: number; unknown: number; oldestAwaitingAt: string | null; state: string };
  worker: { state: string; detail: string }; failedLast24h: number; readinessAvailable: boolean; generatedAt: string | null; checkedNowAt: string | null; overall: string;
}
export interface CnOptOut { channel: 'sms' | 'email'; recipient: string; recipientKey: string | null; reason: string | null; source: string; since: string | null; matchingCustomers: number; reOptIn: 'customer_only' | 'staff_with_note' | 'not_permitted' }
export interface CnConsentEvent { id: string; channel: string; recipient: string; action: 'opt_out' | 'opt_in'; source: string; purpose: string; reason: string | null; consentNote: string | null; at: string | null; byName: string | null }
export interface CnTimelineItem { kind: string; id: string; channel: string; direction: string; at: string | null; type: string | null; status: string; counterpart?: string | null; summary?: string | null; failed?: boolean; unresolved?: boolean; link?: string | null }
export interface CnIncident { id: string; severity: string; status: string; title: string; body: string; rule: string | null; channel: string | null; category: string | null; count: number; firstEventAt: string | null; lastEventAt: string | null; detections: number; openedAt: string | null; updatedAt: string | null; resolvedAt: string | null; resolvedBy: string | null }
export interface CnAlertSettings { repeatedFailures: { count: number; windowMinutes: number }; failureRatio: { minAttempts: number; ratioPercent: number; windowMinutes: number }; callbackStaleHours: number; pendingBacklog: { count: number; oldestMinutes: number }; enabled: boolean }

const B = '/pos/customer-notifications';
const enc = encodeURIComponent;
const clean = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
export const newCnKey = (): string => globalThis.crypto?.randomUUID?.() || `cn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const posCustomerNotificationsApi = {
  summary: (q: Record<string, unknown>) => api.get<CnSummary>(`${B}/summary`, clean(q)),
  list: (q: Record<string, unknown>) => api.get<CnPage<CnRow> & { window: CnWindow & { tab: string; sort: string }; recipientsMasked: boolean }>(`${B}/records`, clean(q)),
  /** C2 audit (Nov 4 2026): the filtered list as CSV (every page, masked by the same rule) */
  exportCsv: (q: Record<string, unknown>) => api.exportAsync<string>(`${B}/records/export`, clean(q), 'text'),
  detail: (id: string) => api.get<CnDetail>(`${B}/records/${enc(id)}`),
  retry: (id: string, key: string) => api.post<{ requestId: string; outcome: string; refusalCode: string | null; newNotificationId: string | null; category: string; replayed: boolean }>(`${B}/records/${enc(id)}/retry`, { confirm: true }, { 'Idempotency-Key': key }),
  failures: (q: Record<string, unknown>) => api.get<{ groups: CnFailureGroup[]; scanned: number; truncated: boolean; window: CnWindow }>(`${B}/failures`, clean(q)),
  optOuts: (q: Record<string, unknown>) => api.get<CnPage<CnOptOut | CnConsentEvent> & { view: 'current' | 'history' }>(`${B}/opt-outs`, clean(q)),
  timeline: (customerId: string, q: Record<string, unknown>) => api.get<CnPage<CnTimelineItem> & { customer: { id: string; name: string }; channel: string; capped: boolean; links: { profile: string; booking: string } }>(`${B}/customers/${enc(customerId)}/timeline`, clean(q)),
  health: () => api.get<CnHealth>(`${B}/health`),
  checkHealth: () => api.post<CnHealth>(`${B}/health/check`, {}),
  incidents: (q: Record<string, unknown>) => api.get<CnPage<CnIncident> & { canResolve: boolean; evaluatedAt: string | null }>(`${B}/incidents`, clean(q)),
  /** the one owner-alert lifecycle (analytics OWNER_ALERT) — reused, not copied */
  acknowledgeIncident: (id: string) => api.post<unknown>(`/owner/alerts/${enc(id)}/acknowledge`, {}),
  resolveIncident: (id: string) => api.post<unknown>(`/owner/alerts/${enc(id)}/resolve`, {}),
  alertSettings: () => api.get<{ settings: CnAlertSettings; defaults: CnAlertSettings; updatedAt: string | null; isDefault: boolean }>(`${B}/alert-settings`),
  saveAlertSettings: (s: CnAlertSettings) => api.put<{ settings: CnAlertSettings; defaults: CnAlertSettings; updatedAt: string | null; isDefault: boolean }>(`${B}/alert-settings`, s as unknown as Record<string, unknown>),
};
