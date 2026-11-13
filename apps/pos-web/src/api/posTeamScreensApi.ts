// posTeamScreensApi.ts — the Team screen read models (Oct 30 2026): Technicians (`/pos/technicians-screen/*`). Writes stay on
// posTechniciansApi (create · edit · lifecycle · services mapping · commission).
import { api } from './client';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const enc = encodeURIComponent;
const TS = '/pos/technicians-screen';
export const posTechniciansScreenApi = {
  dashboard: (q: Q) => api.get<any>(`${TS}/dashboard`, clean(q)),
  directory: (q: Q) => api.get<any>(`${TS}/directory`, clean(q)),
  history: (q: Q) => api.get<any>(`${TS}/history`, clean(q)),
  certifications: (q: Q) => api.get<any>(`${TS}/certifications`, clean(q)),
  appointments: (id: string, q: Q) => api.get<any>(`${TS}/${enc(id)}/appointments`, clean(q)),
  serviceHistory: (id: string, q: Q) => api.get<any>(`${TS}/${enc(id)}/service-history`, clean(q)),
  mapping: (id: string) => api.get<any>(`${TS}/${enc(id)}/mapping`),
};
const TA = '/pos/tech-appointments-screen';
export const posTechAppointmentsScreenApi = {
  kpis: (q: Q) => api.get<any>(`${TA}/kpis`, clean(q)),
  appointments: (q: Q) => api.get<any>(`${TA}/appointments`, clean(q)),
  week: (q: Q) => api.get<any>(`${TA}/week`, clean(q)),
  conflicts: (q: Q) => api.get<any>(`${TA}/conflicts`, clean(q)),
  history: (q: Q) => api.get<any>(`${TA}/history`, clean(q)),
};
const LS = '/pos/live-schedule-screen';
export const posLiveScheduleScreenApi = {
  kpis: (q: Q) => api.get<any>(`${LS}/kpis`, clean(q)),
  search: (q: Q) => api.get<any>(`${LS}/search`, clean(q)),
  activity: (q: Q) => api.get<any>(`${LS}/activity`, clean(q)),
  shiftImpact: (q: Q) => api.get<any>(`${LS}/shift-impact`, clean(q)),
};
const TQ = '/pos/tech-queue-screen';
export const posTechQueueScreenApi = {
  tickets: (q: Q) => api.get<any>(`${TQ}/tickets`, clean(q)),
  tabCounts: () => api.get<any>(`${TQ}/tab-counts`),
  ticket: (id: string) => api.get<any>(`${TQ}/tickets/${enc(id)}`),
  technician: (id: string, q: Q = {}) => api.get<any>(`${TQ}/technicians/${enc(id)}`, clean(q)),
  search: (q: Q) => api.get<any>(`${TQ}/search`, clean(q)),
};
const CM = '/pos/commission-screen';
export const posCommissionScreenApi = {
  summary: (q: Q) => api.get<any>(`${CM}/summary`, clean(q)),
  technicians: (q: Q) => api.get<any>(`${CM}/technicians`, clean(q)),
  lines: (id: string, q: Q) => api.get<any>(`${CM}/technicians/${enc(id)}/lines`, clean(q)),
  tips: (id: string, q: Q) => api.get<any>(`${CM}/technicians/${enc(id)}/tips`, clean(q)),
  adjustments: (id: string, q: Q) => api.get<any>(`${CM}/technicians/${enc(id)}/adjustments`, clean(q)),
  payouts: (q: Q) => api.get<any>(`${CM}/payouts`, clean(q)),
  /** F3: the server-built, audited CSV (requested → succeeded | failed; denied without the export permission) */
  exportCsv: (q: Q) => api.exportAsync<string>(`${CM}/export`, clean(q), 'text'),
  exportHistory: (q: Q) => api.get<any>(`${CM}/export-history`, clean(q)),
};
/** F1 + F2 (Oct 30 2026): the persisted Commission Discrepancy Review — workflow only, nothing here moves money */
const CR = '/pos/commission-discrepancies';
export const posCommissionReviewApi = {
  list: (q: Q) => api.get<any>(`${CR}`, clean(q)),
  detail: (id: string, q: Q = {}) => api.get<any>(`${CR}/${enc(id)}`, clean(q)),
  assignees: (q?: string) => api.get<any>(`${CR}/assignees`, clean({ q })),
  runCheck: (q: Q) => api.post<any>(`${CR}/run-check`, clean(q)),
  // round 10 (Finish the Five 06): expectedPolicy = what the screen loaded (null = not set); a change since → 409 VERSION_CONFLICT
  setRefundPolicy: (policy: string, expectedPolicy?: string | null) => api.put<any>(`${CR}/refund-policy`, expectedPolicy === undefined ? { policy } : { policy, expectedPolicy }),
  assign: (id: string, b: { assigneeUserId: string; expectedVersion: number; note?: string }) => api.post<any>(`${CR}/${enc(id)}/assign`, b),
  investigate: (id: string, b: { expectedVersion: number; note?: string }) => api.post<any>(`${CR}/${enc(id)}/investigate`, b),
  note: (id: string, b: { expectedVersion: number; note: string }) => api.post<any>(`${CR}/${enc(id)}/notes`, b),
  resolve: (id: string, b: { expectedVersion: number; resolutionCode: string; note: string }) => api.post<any>(`${CR}/${enc(id)}/resolve`, b),
  dismiss: (id: string, b: { expectedVersion: number; reason: string }) => api.post<any>(`${CR}/${enc(id)}/dismiss`, b),
  reopen: (id: string, b: { expectedVersion: number; reason: string }) => api.post<any>(`${CR}/${enc(id)}/reopen`, b),
};
/** F4 (Oct 30 2026): Edit Shift for Selected Date — the weekly template is never written here */
const SO = '/pos/shift-overrides';
export const posShiftOverrideApi = {
  editor: (technicianId: string, date: string) => api.get<any>(`${SO}`, { technicianId, date }),
  preview: (b: Q) => api.post<any>(`${SO}/preview`, b),
  save: (b: Q) => api.put<any>(`${SO}`, b),
};
const TP = '/pos/team-performance-screen';
export const posTeamPerformanceScreenApi = {
  dashboard: (q: Q) => api.get<any>(`${TP}/dashboard`, clean(q)),
  directory: (q: Q) => api.get<any>(`${TP}/directory`, clean(q)),
  technician: (id: string, q: Q) => api.get<any>(`${TP}/technicians/${enc(id)}`, clean(q)),
  services: (id: string, q: Q) => api.get<any>(`${TP}/technicians/${enc(id)}/services`, clean(q)),
  reviews: (id: string, q: Q) => api.get<any>(`${TP}/technicians/${enc(id)}/reviews`, clean(q)),
  /** F3: the server-built, audited directory CSV */
  exportCsv: (q: Q) => api.exportAsync<string>(`${TP}/export`, clean(q), 'text'),
  /** F5: the versioned 0–100 composite (separate from the 0–5 rating), its comparison view and snapshots */
  composite: (id: string, q: Q) => api.get<any>(`${TP}/technicians/${enc(id)}/composite`, clean(q)),
  comparison: (q: Q) => api.get<any>(`${TP}/composite/comparison`, clean(q)),
  snapshot: (b: Q) => api.post<any>(`${TP}/composite/snapshots`, b),
};
/** Team Management (/tenant/team/members, 30 Oct 2026): the user-keyed read model, the lazy profile tabs and the audited CSV */
const TM = '/pos/team-members-screen';
export const posTeamMembersScreenApi = {
  dashboard: (q: Q) => api.get<any>(`${TM}/dashboard`, clean(q)),
  directory: (q: Q) => api.get<any>(`${TM}/directory`, clean(q)),
  exportCsv: (q: Q) => api.exportAsync<string>(`${TM}/export`, clean(q), 'text'),
  live: () => api.get<any>(`${TM}/live`),
  profile: (id: string) => api.get<any>(`${TM}/members/${enc(id)}`),
  access: (id: string) => api.get<any>(`${TM}/members/${enc(id)}/access`),
  schedule: (id: string) => api.get<any>(`${TM}/members/${enc(id)}/schedule`),
  attendance: (id: string, q: Q) => api.get<any>(`${TM}/members/${enc(id)}/attendance`, clean(q)),
  skills: (id: string) => api.get<any>(`${TM}/members/${enc(id)}/skills`),
  work: (id: string, q: Q) => api.get<any>(`${TM}/members/${enc(id)}/work`, clean(q)),
  performance: (id: string, q: Q) => api.get<any>(`${TM}/members/${enc(id)}/performance`, clean(q)),
  earnings: (id: string, q: Q) => api.get<any>(`${TM}/members/${enc(id)}/earnings`, clean(q)),
  training: (id: string) => api.get<any>(`${TM}/members/${enc(id)}/training`),
  history: (id: string, q: Q) => api.get<any>(`${TM}/members/${enc(id)}/history`, clean(q)),
  /** TM-01: staff linked to a customer (name or phone) through appointments and completed services, with why */
  customerLinks: (q: Q) => api.get<any>(`${TM}/customer-links`, clean(q)),
  /** TM-04: the preferred technician's verdict at a start + qualified alternatives (never books) */
  preferredCheck: (q: { technicianId: string; date: string; time?: string; serviceIds: string[] }) => api.get<any>(`${TM}/preferred-check`, clean({ ...q, serviceIds: q.serviceIds.join(',') })),
};
/** Team Management Data Accuracy Alerts — workflow only; nothing here changes a shift, a status, a link or pay */
const DA = '/pos/team-data-alerts';
export const posTeamDataAlertsApi = {
  list: (q: Q) => api.get<any>(`${DA}`, clean(q)),
  detail: (id: string, q: Q = {}) => api.get<any>(`${DA}/${enc(id)}`, clean(q)),
  assignees: (q?: string) => api.get<any>(`${DA}/assignees`, clean({ q })),
  runCheck: () => api.post<any>(`${DA}/run-check`, {}),
  assign: (id: string, b: { assigneeUserId: string; expectedVersion: number; note?: string }) => api.post<any>(`${DA}/${enc(id)}/assign`, b),
  investigate: (id: string, b: { expectedVersion: number; note?: string }) => api.post<any>(`${DA}/${enc(id)}/investigate`, b),
  note: (id: string, b: { expectedVersion: number; note: string }) => api.post<any>(`${DA}/${enc(id)}/notes`, b),
  resolve: (id: string, b: { expectedVersion: number; note: string }) => api.post<any>(`${DA}/${enc(id)}/resolve`, b),
  dismiss: (id: string, b: { expectedVersion: number; reason: string }) => api.post<any>(`${DA}/${enc(id)}/dismiss`, b),
  reopen: (id: string, b: { expectedVersion: number; reason: string }) => api.post<any>(`${DA}/${enc(id)}/reopen`, b),
};
