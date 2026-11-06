// posAiFollowUpsApi.ts — AI Follow-Ups & Human Handoff Center (/pos/ai/follow-ups-center/*). Tenant and branch come from
// the session. Every write carries the row version (or a request key); nothing here sends a text without the confirm step.
import { api } from './client';

export interface FuRow {
  id: string; status: string; priority: string; reason: string; source: string; description: string | null;
  customer: { id: string; name: string } | null; caller: string | null; customerMatch: string; providerCallId: string | null; callStartedAt: string | null;
  handoffOutcome: string | null; appointmentId: string | null; assignee: { id: string; name: string | null } | null; dueAt: string | null; overdue: boolean;
  contactAttempts: number; lastContactAt: string | null; escalationLevel: number; createdAt: string | null; updatedAt: string | null; resolvedAt: string | null; version: number;
}
export interface FuPeriod { preset: string; from: string | null; to: string | null; tz: string; today: string }
export interface FuPage { items: FuRow[]; page: number; pageSize: number; totalItems: number; totalPages: number; filters: { status: string; basis: string; sort: string; period: FuPeriod; q: string | null } }
export interface FuKpis { asOf: string; timeZone: string; today: string; cards: { open: number; assigned: number; inProgress: number; waiting: number; overdue: number; resolved: number; resolvedToday: number; unassigned: number; total: number }; handoffs30d: { needsStaff: number; transfersCompleted: number }; definitions: Record<string, string> }
interface FuQuery { q?: string; status?: string; priority?: string; source?: string; assignee?: string; overdue?: string; basis?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number }
export interface FuCheck { domain: string; status: string; detail: string; evidence: string; nextAction: string | null; responsibleRole: string; checkedAt: string }
export interface FuDetail {
  overview: FuRow & { resolution: string | null; resolutionCategory: string | null; notes: string | null; createdBy: string; branchId: string | null; dueTimeZone: string | null; reopenedCount: number; waitingUntil: string | null };
  customer: { id: string | null; name: string | null; phone: string | null; email?: string | null; completedVisits?: number; upcoming?: { id: string; date: string; start: string; status: string }[]; unmatched?: boolean; match?: string; smsOptedOut: boolean; sharedPhoneProfiles: number };
  call: null | { providerCallId: string; agent: string | null; startedAt: string | null; endedAt: string | null; durationSeconds: number | null; transfer: string; disconnection: string | null; error: string | null; summary: string | null; sentiment: string | null; handoffs: { kind: string; source: string; callbackRequired: boolean; reason: string | null; at: string | null }[] };
  attempts: { id: string; channel: string; outcome: string; recordedBy: string | null; recipient: string | null; note: string | null; nextAttemptAt: string | null; at: string | null; attestation: boolean }[];
  booking: { linked: { id: string; date: string; start: string; status: string; source: string } | null; upcoming: number };
  activity: { type: string; from: string | null; to: string | null; note: string | null; actor: string | null; at: string | null }[];
  permissions: { canWork: boolean; canManage: boolean; canText: boolean; canBook: boolean };
}
export interface FuPrepared { state: string; blocked: string[]; warnings: string[]; notices: string[]; token: string | null; proposed: Record<string, unknown> | null; duplicateOf?: string | null }
export interface FuPriority { taskId: string; version: number; reason: string; priority: string; ageMinutes: number; signal: string; rank: number; recommendation: string; evidence: string[] }

const B = '/pos/ai/follow-ups-center';
export const posAiFollowUpsApi = {
  kpis: () => api.get<FuKpis>(`${B}/kpis`),
  list: (q: FuQuery) => api.get<FuPage>(`${B}/tasks`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string>),
  staff: () => api.get<{ items: { id: string; name: string; role: string }[] }>(`${B}/staff`),
  create: (b: { reason: string; description: string; priority?: string; dueLocal?: string | null; customerId?: string | null; callerPhone?: string | null; assignedUserId?: string | null; providerCallId?: string | null; appointmentId?: string | null; idempotencyKey: string }) =>
    api.post<{ id: string; duplicate: boolean }>(`${B}/tasks`, b),
  detail: (id: string) => api.get<FuDetail>(`${B}/tasks/${id}`),
  assign: (id: string, b: { assignedUserId: string | null; version: number; note?: string | null }) => api.post<FuRow>(`${B}/tasks/${id}/assign`, b),
  status: (id: string, b: { to: string; version: number; reason?: string | null; resolutionCategory?: string | null; note?: string | null; waitingUntilLocal?: string | null }) => api.post<FuRow>(`${B}/tasks/${id}/status`, b),
  edit: (id: string, b: { description?: string | null; dueLocal?: string | null; version: number }) => api.post<FuRow>(`${B}/tasks/${id}/edit`, b),
  note: (id: string, b: { note: string; version: number }) => api.post<FuRow>(`${B}/tasks/${id}/note`, b),
  priority: (id: string, b: { priority?: string | null; reason: string; version: number; escalate?: boolean }) => api.post<FuRow>(`${B}/tasks/${id}/priority`, b),
  attempt: (id: string, b: { channel: string; outcome: string; note?: string | null; nextAttemptLocal?: string | null; idempotencyKey: string }) => api.post<{ duplicate: boolean }>(`${B}/tasks/${id}/attempts`, b),
  prepareText: (id: string, b: { body: string; overrideReason?: string | null }) => api.post<FuPrepared>(`${B}/tasks/${id}/text/prepare`, b),
  confirmText: (id: string, b: { body: string; token: string; idempotencyKey: string; overrideReason?: string | null }) => api.post<{ duplicate: boolean; state: string; ok: boolean; errorCode: string | null; message: string | null }>(`${B}/tasks/${id}/text/confirm`, b),
  health: () => api.post<{ overall: string; checks: FuCheck[]; ranAt: string; cached: boolean }>(`${B}/health`, {}),
  /** A13 Nov 6 */
  importSources: () => api.post<{ createdFromMissedCalls: number; createdFromCopilot: number }>(`${B}/import-sources`, {}),
  recommendedAssignee: () => api.get<{ userId: string; name: string; role: string; openTasks: number; reason: string } | null>(`${B}/recommended-assignee`),
  healthHistory: (page = 1, pageSize = 10) => api.get<{ items: { overall: string; at: string | null; by: string | null; failed: number }[]; page: number; pageSize: number; totalItems: number; totalPages: number }>(`${B}/health/history`, { page: String(page), pageSize: String(pageSize) }),
  priorities: () => api.get<{ items: FuPriority[]; bookingsAwaitingVerification: number; note: string }>(`${B}/priorities`),
  decide: (b: { taskId: string; signal: string; decision: 'accept' | 'dismiss' | 'escalate'; note?: string | null; version?: number }) => api.post<unknown>(`${B}/priorities/decide`, b),
};
