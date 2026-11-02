// posAIQueueAssignmentApi.ts — tenant AI Queue Assignment API client. Same-origin; tenant/branch/role from session.
import type {   // the wire contract (Constitution 13 §15)
  DecisionAnalytics, QueueAssignmentRecommendation, QueueAssignmentPanel, QueueAssignmentDecisionRecord, QueueAssignmentDecisionRequest,
  QueueAssignmentDecisionResponse, QueueRotationPolicyResponse, QueueRotationPolicyUpdate, QueueAutoConfigView, QueueAutoConfigUpdate,
  QueueAutoRunResponse, QueueAutoKillRequest, QueueAutoExclusions, PlanRecommendationView, PlanDecisionRequest, PlanDecisionResponse,
} from '@aipowersalon/api-contracts/tenant';
// Wraps /pos/ai-queue-assignment/*: overview, the per-customer panel, recommendations + decisions (accept / reject /
// override / keep unassigned), alerts, the ONE settings source (salon + branch, versioned), rotation policy + fixed
// order, auto-assignment + kill switches, analytics, exports and usage.
//
// BUILD_PLAN Phase 6 (audit bug 7): GET /rotation-policy used to answer a bare string, so `res.json()` threw inside the
// screen's initial Promise.all and the whole screen failed to load. It now answers `{ policy, fixedOrder }` JSON. The
// client also reads the body as TEXT first and parses it, so a non-JSON answer surfaces as a plain error on the one
// card that asked for it — never as a crash of the screen.
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public body?: any) { super(message); this.name = 'ApiError'; }
}
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { runAsyncExport } from '@aipowersalon/api-client';   // BUILD_PLAN Phase 12: the async export flow, over this app's apiUrl
import { posHttp } from './client';
import { t } from '@aipowersalon/mobile-sdk/i18n';
const BASE = apiUrl('/pos/ai-queue-assignment');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => status === 402 ? new ApiError(t('admin.aiQueue.notEnabled'), 402) : new ApiError(message, status, body && typeof body === 'object' ? body.code : undefined, body) });
/** BUILD_PLAN Phase 12: the async export transport — this app's apiUrl (base + /api/v1) and session cookie. */
const aqRaw = (p: string, init: { query?: Record<string, unknown>; headers?: Record<string, string> }) => fetch(apiUrl(p, init.query), { credentials: 'include', headers: init.headers });

const id = (s: string) => encodeURIComponent(s);
const qs = (o: Record<string, string | number | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
/** One key per decision attempt; the server replays the same answer for the same key (BUILD_PLAN Phase 6, contract §B). */
export const newIdempotencyKey = (): string => globalThis.crypto?.randomUUID?.() || `aq-${Date.now()}-${(globalThis.performance?.now?.() ?? 0).toFixed(3)}`;

// ── shapes ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Round 2 (BUILD_PLAN Phase 6): the AI layer's shapes come from @aipowersalon/api-contracts (one definition — the
// architecture gate flags a frontend type that mirrors an API type). The ops routes (agent C: overview, settings,
// alerts, analytics, usage) have no contract types yet, so their READ shapes are declared here under `Aq*` names that
// mirror nothing; they follow modules/ai/src/ai-queue-assignment/ai-queue-assignment-ops.service.ts / -alerts.*.
export type AqBlockedBy = QueueAutoConfigView['autoBlockedBy'];
export type AqScopeName = QueueAutoKillRequest['scope'];   // 'salon' | 'branch'
/** an alert row (ai-queue-assignment-alerts.repository AlertRecord). Closed = status 'resolved'; `autoResolved` marks
 *  one the scan closed because the condition cleared (resolution 'condition_cleared'). */
export interface AqAlert {
  id: string; queueEntryId: string | null; type: string; severity: string; reason: string; ageMinutes: number;
  /** `reason` as code + vars (Vietnamese POS §21; srv.AIQ_ALERT.*) — null when the stored text has another shape */
  reasonCoded?: import('@aipowersalon/api-contracts').CodedText | null;
  status: 'open' | 'acknowledged' | 'resolved' | string; technicianId: string | null;
  autoResolved?: boolean; resolution?: string | null; reviewNote?: string | null;
  acknowledgedAt?: string | null; resolvedAt?: string | null; lastSeenAt?: string | null; createdAt?: string;
}
export interface AqScanResult { raised: number; updated?: number; autoResolved?: number; total: number; notified?: number }
export type AqRepairAction = 'unassign' | 'reassign' | 'call' | 'start_service' | 'move_to_tech_queue' | 'cancel' | 'dismiss';
export interface AqRepairBody { action: AqRepairAction; technicianId?: string | null; queueItemId?: string | null; expectedVersion?: number | null; reason?: string | null }
export interface AqWaitLevels { approachingMin: number; exceededMin: number; severeMin: number; criticalMin: number; configVersion?: string }
export interface AqOverview {
  waiting: number; unassigned: number; inService: number; avgWaitMinutes: number | null; longestWaitMinutes: number | null;
  byWaitLevel?: Record<string, number>; congestion?: string; freeTechnicians?: number;
  openAlerts: number; byType?: Record<string, number>;
  autoEnabled: boolean; autoAllowed: boolean; autoBlockedBy: AqBlockedBy; salonAutoKilled?: boolean; configVersion?: string;
  lastScanAt?: string | null; lastAutoRunAt?: string | null;
  decisionsToday: { accepted: number; rejected: number; overridden: number; keptUnassigned?: number; autoAssigned: number };
  technicians: { technicianId: string; name: string | null; status: string; activeAssignments: number; availableInMinutes: number | null }[];
}
export type AqSettingsValues = {
  waitApproachingMin: number; waitExceededMin: number; waitSevereMin: number; waitCriticalMin: number;
  stuckMinutes: number; longServiceFactor: number; congestionWaitingPerTech: number; lateGraceMin: number;
  rotationPolicy: string; fixedOrder: string[];
  autoEnabled: boolean; autoConfidenceFloor: number; autoMaxPerRun: number; autoDelaySeconds: number; autoExclusions: QueueAutoExclusions;
};
export interface AqSettingsVersion { version: number; branchId: string | null; change: string; reason: string | null; changedBy: string | null; createdAt: string; settings?: unknown }
/** GET settings: the salon row, the location's OWN values (every key present; null = inherits the salon value), the
 *  effective result, the version log, and whether this user may edit the salon-wide values (OWNER / ADMIN). */
export interface AqSettingsView {
  salon: AqSettingsValues & { version: number; autoKilled?: boolean; autoKilledReason?: string | null };
  branch: { [K in keyof AqSettingsValues]: AqSettingsValues[K] | null } & { version: number };
  effective: AqSettingsValues & { configVersion?: string; autoAllowed?: boolean; autoBlockedBy?: AqBlockedBy; salonAutoKilled?: boolean; salonAutoKilledReason?: string | null; platformAutoActionsDisabled?: boolean };
  versions: AqSettingsVersion[];
  canEditSalon?: boolean;
}
export interface AqSettingsSave { scope: AqScopeName; patch?: Partial<AqSettingsValues>; clear?: (keyof AqSettingsValues)[]; expectedVersion?: number; reason?: string | null }
/** GET analytics (ops.service analytics): rates are 0–1; auto-assignments are counted apart from staff decisions. */
export interface AqAnalytics {
  range: { from: string; to: string }; timeZone: string | null;
  decisions: DecisionAnalytics & { autoAssigned: number; staffTotal: number; topFeedbackCodes: { code: string; count: number }[]; byHour: { hour: number; total: number; accepted: number; autoAssigned: number }[] };
  waits: { served: number; avgMinutes: number | null; medianMinutes: number | null; p90Minutes: number | null; longestMinutes: number | null };
  byTechnician: { technicianId: string; name: string | null; served: number; avgWaitMinutes: number | null; chosenByStaff: number; autoAssigned: number; overriddenTo: number }[];
  byHour: { hour: number; served: number; avgWaitMinutes: number | null; decisions: number; autoAssigned: number }[];
  alerts: { total: number; autoResolved: number; byType: Record<string, number> };
}
export interface AqUsage { range: { from: string; to: string }; byStatus: Record<string, number>; byAction: Record<string, number>; calls: number; costMicroUsd: number; recommendations: number; explanations: number }
export type AqExportType = 'decisions' | 'alerts' | 'history';
export interface AqExportResult { format: 'csv'; filename: string; csv: string; rows?: number }

export const posAIQueueAssignmentApi = {
  // overview (ops)
  overview: () => http<AqOverview>('/overview'),

  // per-customer panel + recommendations + decisions (AI layer)
  panel: (queueEntryId: string) => http<QueueAssignmentPanel>('/entries/' + id(queueEntryId) + '/panel'),
  recommend: (queueEntryId: string) => http<QueueAssignmentRecommendation>('/entries/' + id(queueEntryId) + '/recommend', { method: 'POST' }),
  latestRecommendation: (queueEntryId: string) => http<QueueAssignmentRecommendation | null>('/entries/' + id(queueEntryId) + '/recommendation'),
  getRecommendation: (recommendationId: string) => http<QueueAssignmentRecommendation>('/recommendations/' + id(recommendationId)),
  explain: (recommendationId: string) => http<{ explanation: string; source: 'ai' | 'fallback'; language?: 'en' | 'vi' }>('/recommendations/' + id(recommendationId) + '/explanation'),
  decide: (recommendationId: string, body: QueueAssignmentDecisionRequest) => http<QueueAssignmentDecisionResponse>('/recommendations/' + id(recommendationId) + '/decision', { method: 'POST', body: JSON.stringify({ ...body, idempotencyKey: body.idempotencyKey || newIdempotencyKey() }) }),
  // multi-technician routing (contract §5): a visit plan (one or several technicians per service) / a party plan; reading
  // a plan stores it as a recommendation. Deciding: accepted (as shown) / adjusted (full line list; needs the override
  // permission) / rejected / kept_unassigned — accepted & adjusted assign through the queue's ONE plan writer.
  planVisit: (queueEntryId: string) => http<PlanRecommendationView>('/entries/' + id(queueEntryId) + '/plan', { method: 'POST' }),
  planParty: (groupId: string) => http<PlanRecommendationView>('/groups/' + id(groupId) + '/plan', { method: 'POST' }),
  decidePlan: (recommendationId: string, body: PlanDecisionRequest) => http<PlanDecisionResponse>('/plans/' + id(recommendationId) + '/decision', { method: 'POST', body: JSON.stringify({ ...body, idempotencyKey: body.idempotencyKey || newIdempotencyKey() }) }),
  entryDecisions: (queueEntryId: string) => http<QueueAssignmentDecisionRecord[]>('/entries/' + id(queueEntryId) + '/decisions'),
  decisionHistory: (f: { from?: string; to?: string; limit?: number } = {}) => http<QueueAssignmentDecisionRecord[]>('/decisions' + qs(f)),
  decisionAnalytics: (f: { from?: string; to?: string } = {}) => http<DecisionAnalytics>('/decisions/analytics' + qs(f)),

  // alerts (ops) — `status` defaults to 'open' so resolved alerts stay hidden (audit bug 9)
  scanAlerts: () => http<AqScanResult>('/alerts/scan', { method: 'POST' }),
  listAlerts: (status: 'open' | 'all' = 'open') => http<AqAlert[]>('/alerts?status=' + id(status)),
  acknowledgeAlert: (alertId: string, note?: string) => http<AqAlert>('/alerts/' + id(alertId) + '/acknowledge', { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  resolveAlert: (alertId: string, note?: string) => http<AqAlert>('/alerts/' + id(alertId) + '/resolve', { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  repairAlert: (alertId: string, body: AqRepairBody) => http<{ alert: AqAlert; action: string; queueItemId: string | null; result: unknown }>('/alerts/' + id(alertId) + '/repair', { method: 'POST', body: JSON.stringify(body) }),
  getWaitThresholds: () => http<AqWaitLevels>('/wait-thresholds'),
  setWaitThresholds: (t: Partial<AqWaitLevels>) => http<AqWaitLevels>('/wait-thresholds', { method: 'PUT', body: JSON.stringify(t) }),

  // settings — the ONE source (ops). Clearing a location override = `clear: [keys]` (never null in the patch).
  getSettings: () => http<AqSettingsView>('/settings'),
  saveSettings: (body: AqSettingsSave) => http<{ effective: AqSettingsView['effective']; scope: AqScopeName }>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  settingsVersions: (scope?: AqScopeName) => http<AqSettingsVersion[]>('/settings/versions' + qs({ scope })),

  // rotation (AI layer, audit bug 7: JSON { policy, fixedOrder })
  getRotationPolicy: () => http<QueueRotationPolicyResponse>('/rotation-policy'),
  setRotationPolicy: (body: QueueRotationPolicyUpdate) => http<QueueRotationPolicyResponse>('/rotation-policy', { method: 'PUT', body: JSON.stringify(body) }),

  // auto-assignment (AI layer). Salon-scope kill / unkill also live here (unkill at salon scope: OWNER only).
  getAutoConfig: () => http<QueueAutoConfigView>('/auto-config'),
  setAutoConfig: (body: QueueAutoConfigUpdate) => http<QueueAutoConfigView>('/auto-config', { method: 'PUT', body: JSON.stringify(body) }),
  runAuto: () => http<QueueAutoRunResponse>('/auto/run', { method: 'POST' }),
  killAuto: (scope: AqScopeName, reason: string) => http<QueueAutoConfigView>('/auto/kill', { method: 'POST', body: JSON.stringify({ scope, reason } satisfies QueueAutoKillRequest) }),
  unkillAuto: (scope: AqScopeName, reason: string) => http<QueueAutoConfigView>('/auto/unkill', { method: 'POST', body: JSON.stringify({ scope, reason } satisfies QueueAutoKillRequest) }),

  // analytics / exports / usage (ops)
  analytics: (f: { from?: string; to?: string } = {}) => http<AqAnalytics>('/analytics' + qs(f)),
  // BUILD_PLAN Phase 12: through the ONE async export contract (Prefer: respond-async → poll → download); same JSON result
  exportCsv: (type: AqExportType, f: { from?: string; to?: string } = {}) => runAsyncExport<AqExportResult>(aqRaw, '/pos/ai-queue-assignment/export', { type, ...f }),
  usage: (f: { from?: string; to?: string } = {}) => http<AqUsage>('/usage' + qs(f)),
};
