import { api } from './client';

// superAdminJobsApi — the ONE job queue (BUILD_PLAN Phase 2, migration 519) and the event dead letters (Constitution 8
// §150–155), which had an API and no screen. Retry / cancel a job need a reason (audited); event retry re-runs the
// consumer, discard keeps the row for history.

export type JobClass = 'critical' | 'standard' | 'ai' | 'report' | 'import' | 'reconciliation';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'dead' | 'canceled';
export interface JobClassStats { jobClass: JobClass; queued: number; running: number; dead: number; succeededLastHour: number; oldestQueuedSeconds: number | null }
export interface JobListRow {
  id: string; jobClass: JobClass; jobType: string; tenantId: string | null; priority: number; status: JobStatus;
  attempts: number; maxAttempts: number; runAfter: string; lastError: string | null; createdAt: string; finishedAt: string | null;
  correlationId: string | null; payloadKeys: string[];
}
export interface EventDeadLetter {
  id: string; event_id: string; consumer_name: string; tenant_id: string | null; event_type: string; correlation_id: string | null;
  attempts: number; error_class: string | null; last_error_code: string | null; first_failed_at: string; last_failed_at: string;
  status: 'open' | 'retrying' | 'resolved' | 'discarded'; next_attempt_at: string | null;
}

export const superAdminJobsApi = {
  stats: () => api.get<{ classes: JobClassStats[]; handlers: string[] }>('/super-admin/jobs/stats'),
  list: (q: { status?: JobStatus; jobClass?: JobClass; limit?: number } = {}) => api.get<{ items: JobListRow[] }>('/super-admin/jobs', q as Record<string, unknown>),
  retry: (id: string, reason: string) => api.post<{ ok: true }>(`/super-admin/jobs/${encodeURIComponent(id)}/retry`, { reason }),
  cancel: (id: string, reason: string) => api.post<{ ok: true }>(`/super-admin/jobs/${encodeURIComponent(id)}/cancel`, { reason }),
  selfTest: (count = 5) => api.post<{ ok: true; ids: string[] }>('/super-admin/jobs/self-test', { count, holdMs: 500 }),
  deadLetters: (q: { status?: string; limit?: number } = {}) => api.get<EventDeadLetter[]>('/super-admin/events/dead-letters', q as Record<string, unknown>),
  retryDeadLetter: (id: string) => api.post<{ ok: boolean; reason?: string }>(`/super-admin/events/dead-letters/${encodeURIComponent(id)}/retry`, {}),
  discardDeadLetter: (id: string) => api.post<{ ok: boolean; reason?: string }>(`/super-admin/events/dead-letters/${encodeURIComponent(id)}/discard`, {}),
};
