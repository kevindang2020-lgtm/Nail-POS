// posAiSchedulingOptimizerApi.ts — typed client for /pos/ai-scheduling-optimizer (BUILD_PLAN Phase 7, contract
// scratchpad/p7/CONTRACT.md §2–§3). Every shape is the API's own (@aipowersalon/api-contracts/tenant `Sched*`) — never
// re-declared here. The client NEVER sends tenant / branch (the server derives them from the session) and never sends a
// computed result: `generate` sends only the appointment + an optional target, `apply` sends only `expectedVersion` —
// the server applies the change it STORED, through the booking service.
//
// Audit bug (fixed): the recommendations filter used to be sent as `{ query: filters }`; the shared client's second
// argument IS the query, so the server received `?query=[object Object]` and the status / type filter never applied.
import { api } from './client';
import type {
  SchedApplyResponse, SchedCalendarIndicators, SchedDecisionRequest, SchedGenerateRequest, SchedGenerateResponse,
  SchedInsightDecisionRequest, SchedInsightKind, SchedInsightList, SchedInsightStatus, SchedOptionsRequest,
  SchedOptionsResponse, SchedRecommendation, SchedRecommendationFilters, SchedRecommendationList, SchedRecommendationResponse,
  SchedLock, SchedProposalSummary, SchedRuleVersion, SchedRun, SchedRunDetail, SchedRunRequest, SchedServiceProfile, SchedSettingsUpdate, SchedSettingsView,
  SchedTimeOff, SchedTimeOffCreate, SchedUsageSummary,
} from '@aipowersalon/api-contracts/tenant';

const BASE = '/pos/ai-scheduling-optimizer';
const enc = encodeURIComponent;
/** list routes may answer a bare array or `{ items }` — read both, never crash on either */
const items = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : Array.isArray((r as { items?: T[] } | null)?.items) ? (r as { items: T[] }).items : []);
/** one-recommendation routes answer `{ recommendation }` (SchedRecommendationResponse); tolerate a bare row */
const oneRec = (r: SchedRecommendationResponse | SchedRecommendation): SchedRecommendation =>
  ((r as SchedRecommendationResponse)?.recommendation ?? (r as SchedRecommendation));
const body = <T extends object>(b: T) => b as unknown as Record<string, unknown>;

type Q = Record<string, string | number | undefined>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;

export type SchedExportKind = 'recommendations' | 'runs' | 'insights';

export const posAiSchedulingOptimizerApi = {
  // ── settings (tri-state platform → salon → location; read-only unless ai_scheduling.configure) ──
  settings: () => api.get<SchedSettingsView>(`${BASE}/settings`),
  saveSettings: (u: SchedSettingsUpdate) => api.put<SchedSettingsView>(`${BASE}/settings`, body(u)),
  settingsVersions: () => api.get<SchedRuleVersion[] | { items: SchedRuleVersion[] }>(`${BASE}/settings/versions`).then((r) => items<SchedRuleVersion>(r)),

  // ── recommendations ──
  recommendations: (f: SchedRecommendationFilters = {}) => api.get<SchedRecommendationList>(`${BASE}/recommendations`, body(f)),
  recommendation: (id: string) => api.get<SchedRecommendationResponse | SchedRecommendation>(`${BASE}/recommendations/${enc(id)}`).then(oneRec),
  generate: (req: SchedGenerateRequest) => api.post<SchedGenerateResponse>(`${BASE}/recommendations/generate`, body(req)),
  accept: (id: string, d: SchedDecisionRequest) => api.post<SchedRecommendationResponse>(`${BASE}/recommendations/${enc(id)}/accept`, body(d)),
  reject: (id: string, d: SchedDecisionRequest) => api.post<SchedRecommendationResponse>(`${BASE}/recommendations/${enc(id)}/reject`, body(d)),
  returnForRevision: (id: string, d: SchedDecisionRequest) => api.post<SchedRecommendationResponse>(`${BASE}/recommendations/${enc(id)}/return`, body(d)),
  apply: (id: string, expectedVersion: number) => api.post<SchedApplyResponse>(`${BASE}/recommendations/${enc(id)}/apply`, { expectedVersion }),
  retry: (id: string, expectedVersion: number) => api.post<SchedApplyResponse>(`${BASE}/recommendations/${enc(id)}/retry`, { expectedVersion }),
  rollback: (id: string, expectedVersion: number) => api.post<SchedApplyResponse | SchedRecommendationResponse>(`${BASE}/recommendations/${enc(id)}/rollback`, { expectedVersion }),
  explain: (id: string) => api.post<SchedRecommendationResponse>(`${BASE}/recommendations/${enc(id)}/explain`, {}),
  /** answers the proposal summary (not the recommendation) — callers reload the recommendation */
  resendProposal: (id: string) => api.post<SchedProposalSummary>(`${BASE}/recommendations/${enc(id)}/proposal/resend`, {}),
  /** the customer answered by phone / in person — staff record it (B: proposals.recordStaffDecision → customerDecided) */
  customerDecision: (id: string, approved: boolean, expectedVersion: number) =>
    api.post<SchedRecommendationResponse>(`${BASE}/recommendations/${enc(id)}/customer-decision`, { approved, expectedVersion }),

  // ── find a time (+ hold) ──
  options: (req: SchedOptionsRequest) => api.post<SchedOptionsResponse>(`${BASE}/options`, body(req)),
  releaseHold: (holdId: string) => api.post<unknown>(`${BASE}/holds/${enc(holdId)}/release`, {}),

  // ── runs (branch day / technician day) ──
  runDay: (req: SchedRunRequest) => api.post<SchedRunDetail>(`${BASE}/runs`, body(req)),
  runs: (q: { date?: string | null; limit?: number | null } = {}) => api.get<SchedRun[] | { items: SchedRun[] }>(`${BASE}/runs`, body(q)).then((r) => items<SchedRun>(r)),
  run: (id: string) => api.get<SchedRunDetail>(`${BASE}/runs/${enc(id)}`),

  // ── booking calendar overlay ──
  calendar: (date: string) => api.get<SchedCalendarIndicators>(`${BASE}/calendar`, { date }),

  // ── inputs the hard-constraint gate reads ──
  timeOff: () => api.get<SchedTimeOff[] | { items: SchedTimeOff[] }>(`${BASE}/time-off`).then((r) => items<SchedTimeOff>(r)),
  addTimeOff: (t: SchedTimeOffCreate) => api.post<SchedTimeOff>(`${BASE}/time-off`, body(t)),
  removeTimeOff: (id: string) => api.del<unknown>(`${BASE}/time-off/${enc(id)}`),
  /** manual locks (staff-set). Status / deposit locks are computed server-side and show on GET calendar instead. */
  locks: () => api.get<SchedLock[] | { items: SchedLock[] }>(`${BASE}/locks`).then((r) => items<SchedLock>(r)),
  lock: (appointmentId: string, reason: string | null) => api.put<unknown>(`${BASE}/locks/${enc(appointmentId)}`, { reason }),
  unlock: (appointmentId: string) => api.del<unknown>(`${BASE}/locks/${enc(appointmentId)}`),
  serviceProfiles: () => api.get<SchedServiceProfile[] | { items: SchedServiceProfile[] }>(`${BASE}/service-profiles`).then((r) => items<SchedServiceProfile>(r)),
  saveServiceProfile: (serviceId: string, p: Omit<SchedServiceProfile, 'serviceId'>) => api.put<SchedServiceProfile>(`${BASE}/service-profiles/${enc(serviceId)}`, body(p)),

  // ── insights (durations / staffing / availability — approval required) ──
  insights: (q: { kind?: SchedInsightKind | null; status?: SchedInsightStatus | null } = {}) => api.get<SchedInsightList>(`${BASE}/insights`, body(q)),
  decideInsight: (kind: SchedInsightKind, id: string, decision: 'approve' | 'reject', d: SchedInsightDecisionRequest) =>
    api.post<unknown>(`${BASE}/insights/${enc(kind)}/${enc(id)}/${decision}`, body(d)),
  refreshInsights: () => api.post<unknown>(`${BASE}/insights/refresh`, {}),

  // ── the page's read side (Scheduling Optimizer guide, Nov 2026): counters · queue · event trail · read-only health ──
  center: {
    summary: () => api.get<any>(`${BASE}/center/summary`),
    recommendations: (q: Q = {}) => api.get<any>(`${BASE}/center/recommendations`, clean(q)),
    history: (q: Q = {}) => api.get<any>(`${BASE}/center/history`, clean(q)),
    check: () => api.post<any>(`${BASE}/center/check`, {}),
  },

  // ── usage + export ──
  usage: (from: string, to: string) => api.get<SchedUsageSummary>(`${BASE}/usage`, { from, to }),
  /** text/csv (formula-leading cells escaped server-side), through the ONE async export contract (BUILD_PLAN Phase 12):
   *  Prefer: respond-async → poll → download, read as text. Errors carry { status, code, message } as before. */
  exportCsv: (kind: SchedExportKind, from: string, to: string): Promise<string> => api.exportAsync<string>(`${BASE}/export`, { kind, from, to }, 'text'),
};
