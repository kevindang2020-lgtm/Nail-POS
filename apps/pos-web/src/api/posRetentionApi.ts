// posRetentionApi — Customer Retention (/pos/retention/*). Oct 29 2026 mandate + the Complete Build Guide (Oct 30 2026):
// cohorts with the salon's thresholds (Never Visited / New / Returning / Active / Approaching / At Risk / Recovered),
// period + date basis, Smart Win-Back Priority, consent-checked win-back SMS (preview → confirm → per-recipient results),
// Recovery tracking (observed returns, never claimed as caused), settings and the audited CSV export.
// Tenant and branch come from the session.
// Four-Module Completion Guide (Oct 30 2026): CR-01 historical snapshots (read-only; backfill queues jobs), CR-02 `branch`
// activity filter (the session's authorized branches only), CR-03 SMS price + estimate.
import { api } from './client';
const enc = encodeURIComponent;
export type RetentionPeriodQuery = { preset?: string; from?: string; to?: string; branch?: string };
export type RetentionListQuery = RetentionPeriodQuery & { segment: string; page: number; pageSize: number; q?: string; scope?: string; category?: string; technician?: string; spend?: string; sort?: string; basis?: string; band?: string; sms?: string; minVisits?: number;
  /** Win-Back guide §06: inactivity threshold (salon days), marketing-email eligibility, upcoming booking yes / no */ minDays?: number; email?: string; future?: string;
  /** Win-Back §01: a 3-digit area code (+1 numbers stored for this salon) */ areaCode?: string };
export type RetentionSelection = Omit<RetentionListQuery, 'page' | 'pageSize'> & { excludeIds?: string[] };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posRetentionApi = {
  summary: (p: RetentionPeriodQuery = {}) => api.get<any>(`/pos/retention/summary`, clean(p)),
  customers: (q: RetentionListQuery) => api.get<any>(`/pos/retention/customers`, clean(q)),
  customer: (id: string) => api.get<any>(`/pos/retention/customers/${enc(id)}`),
  recovery: (q: RetentionPeriodQuery & { page?: number; pageSize?: number }) => api.get<any>(`/pos/retention/recovery`, clean(q)),
  settings: () => api.get<any>(`/pos/retention/settings`),
  saveSettings: (b: { riskDays: number; approachingDays: number; observationWindowDays: number; bulkSelectionWarnAt?: number | null; expectedVersion: number }) => api.put<any>(`/pos/retention/settings`, b as Record<string, unknown>),
  /** text/csv through the ONE async export contract; audited on the server (requested → succeeded | failed | denied) */
  exportCsv: (q: Omit<RetentionListQuery, 'page' | 'pageSize'>) => api.exportAsync<string>(`/pos/retention/customers/export`, clean(q), 'text'),
  readiness: () => api.get<any>(`/pos/retention/sms/readiness`),
  // Win-Back guide §09 Check Retention Data (read-only; one run per salon per minute) · §10 Win-Back Assistant (nothing sends)
  health: () => api.get<any>(`/pos/retention/health`),
  healthCheck: () => api.post<any>(`/pos/retention/health-check`, {}),
  winbackPlan: (b: { goal: string; channel?: 'sms' | 'email'; service?: string }) => api.post<any>(`/pos/retention/winback/plan`, b),
  /** A19 Nov 6: the picked customers become an unsent win-back audience draft (Campaign Center sends) */
  winbackPicked: (b: { customerIds: string[]; channel?: 'sms' | 'email'; idempotencyKey: string }) => api.post<any>(`/pos/retention/winback/audience/picked`, b),
  winbackAudience: (b: { goal: string; channel?: 'sms' | 'email'; service?: string; message?: string; idempotencyKey: string }) => api.post<any>(`/pos/retention/winback/audience`, b),
  preview: (b: { customerIds?: string[]; selection?: RetentionSelection; body: string; label?: string; audience?: 'win_back' | 'first_visit' }) => api.post<any>(`/pos/retention/sms/preview`, b as Record<string, unknown>),
  confirm: (b: { previewId: string; idempotencyKey: string; acceptChanges?: boolean; label?: string; confirmLargeSelection?: number }) => api.post<any>(`/pos/retention/sms/campaigns`, b as Record<string, unknown>),
  snapshotDay: (date: string, branch?: string) => api.get<any>(`/pos/retention/snapshots/day`, clean({ date, branch })),
  snapshotMembers: (q: { date: string; segment?: string; q?: string; branch?: string; page: number; pageSize: number }) => api.get<any>(`/pos/retention/snapshots/members`, clean(q)),
  snapshotCompare: (a: string, b: string, branch?: string) => api.get<any>(`/pos/retention/snapshots/compare`, clean({ a, b, branch })),
  snapshotRuns: (q: { from?: string; to?: string; page: number; pageSize: number }) => api.get<any>(`/pos/retention/snapshots/runs`, clean(q)),
  backfill: (b: { from: string; to: string }) => api.post<any>(`/pos/retention/snapshots/backfill`, b as Record<string, unknown>),
  smsPricing: () => api.get<any>(`/pos/retention/sms/pricing`),
  setSmsPricing: (b: { retailPricePerSegment: string; carrierFeePerSegment?: string | null; taxRatePercent?: string | null; currency?: string; effectiveFrom?: string | null }) =>
    api.put<any>(`/pos/retention/sms/pricing`, b as Record<string, unknown>),
  campaigns: (q: { page: number; pageSize: number }) => api.get<any>(`/pos/retention/sms/campaigns`, q),
  campaign: (id: string, q: { page: number; pageSize: number; status?: string }) => api.get<any>(`/pos/retention/sms/campaigns/${enc(id)}`, q),
  /** C5 audit: stop a queued / sending campaign (sent texts stay sent) */
  cancelCampaign: (id: string, reason: string) => api.post<any>(`/pos/retention/sms/campaigns/${enc(id)}/cancel`, { reason }),
};
