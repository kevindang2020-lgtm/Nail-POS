// posEodFollowUpsApi.ts — End-of-Day Follow-Ups management center (pos/eod-follow-ups/*, EOD guide §4–§12). Tenant and
// branch come from the session; the client never sends them. Reads are read-only (Preview Tonight writes nothing);
// writes go through the server's one send path. Settings stay on the existing pos/follow-ups/settings route.
import { api } from './client';

export type EodHealthState = 'ready' | 'pending' | 'attention_required' | 'failed' | 'unknown' | 'not_used' | 'off';
export interface EodHealthRow { key: string; state: EodHealthState; detail: string; evidence: string; nextStep: string | null }
export interface EodNextRun { businessDate: string; localTime: string; timezone: string; at: string | null; dueNow: boolean }
export interface EodSummary {
  settings: import('./posFollowUpApi').FollowUpSettings;
  today: string; timezone: string; nextRun: EodNextRun | null; generatedAt: string;
  lastRun: { businessDate: string; status: string; trigger: string; finishedAt: string | null; created: number; skipped: number; candidates: number; excluded: number } | null;
  kpis: { pending: number; awaitingApproval: number; rejected: number; sentToday: number; failedToday: number; expiredToday: number; bookedAfter30d: number };
}
export interface EodPreview {
  businessDate: string; timezone: string; enabled: boolean; nextRun: EodNextRun | null; generatedAt: string; note: string;
  totals: { candidates: number; wouldCreate: number; excluded: number; noApp: number; reasons: Record<string, number> };
  technicians: { technicianId: string; technicianName: string; wouldCreate: number; excluded: number; noApp: number }[];
  rows: { technicianId: string; technicianName: string; customerName: string; serviceName: string; ticketNumber: string | null; completedAt: string | null; excluded: string | null; noApp: boolean; nextBookingDate: string | null }[];
}
export interface EodTaskRow {
  id: string; businessDate: string; status: string; customerId: string; customerName: string; customerPhoneLast4: string | null; customerHasApp: boolean;
  serviceName: string; technicianId: string; technicianName: string; completedAt: string | null; createdAt: string | null; sentAt: string | null; expiredAt: string | null;
  reason: string | null; managerNote: string | null; ticketId: string; ticketNumber: string | null; appointmentId: string | null; approved: boolean; overridden: boolean;
}
export interface EodPage<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }
export interface EodRun { id: string; businessDate: string; status: string; trigger: string; startedAt: string | null; finishedAt: string | null; created: number; skipped: number; candidates: number; excluded: number; exclusions: Record<string, number>; ruleVersion: string | null; timezone: string | null; generationTime: string | null; error: string | null }
export interface EodTaskDetail {
  id: string; status: string; businessDate: string; customerId: string; customerName: string; customerPhone: string | null; customerHasApp: boolean;
  technicianId: string; technicianName: string; serviceName: string; ticketId: string; ticketNumber: string | null; appointmentId: string | null; completedAt: string | null;
  createdAt: string | null; submittedAt: string | null; sentAt: string | null; expiredAt: string | null; rejectedAt: string | null; templateKey: string | null; draft: string;
  sentMessage: string | null; reason: string | null; managerNote: string | null; overrideReason: string | null; approved: boolean;
  delivery: { channel: string; deliveredToInboxAt: string | null; readAt: string | null } | null; customerViewedAt: string | null;
  bookedAfter: { appointmentId: string; date: string; bookedAt: string | null; label: string } | null;
  timeline: { action: string; role: string | null; at: string | null }[];
}
export interface EodTaskQuery { q?: string; status?: string; approval?: string; technicianId?: string; basis?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number }

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const posEodFollowUpsApi = {
  summary: () => api.get<EodSummary>('/pos/eod-follow-ups/summary'),
  health: () => api.get<{ overall: EodHealthState; rows: EodHealthRow[] }>('/pos/eod-follow-ups/health'),
  preview: (date?: string) => api.get<EodPreview>('/pos/eod-follow-ups/preview', clean({ date })),
  runs: (page = 1, pageSize = 10) => api.get<EodPage<EodRun>>('/pos/eod-follow-ups/runs', { page, pageSize }),
  tasks: (f: EodTaskQuery) => api.get<EodPage<EodTaskRow> & { basis: string; sort: string }>('/pos/eod-follow-ups/tasks', clean(f as Record<string, unknown>)),
  task: (id: string) => api.get<EodTaskDetail>(`/pos/eod-follow-ups/tasks/${encodeURIComponent(id)}`),
  send: (id: string, body: { message?: string; override?: { reason: string } | null }) => api.post(`/pos/eod-follow-ups/tasks/${encodeURIComponent(id)}/send`, clean(body as Record<string, unknown>)),
  approve: (id: string, body: { message?: string; override?: { reason: string } | null }) => api.post(`/pos/eod-follow-ups/tasks/${encodeURIComponent(id)}/approve`, clean(body as Record<string, unknown>)),
  reject: (id: string, note: string) => api.post(`/pos/eod-follow-ups/tasks/${encodeURIComponent(id)}/reject`, { note }),
};
