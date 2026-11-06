// posReminderCenterApi.ts — Appointment Reminders center (pos/reminder-center/*, Appointment Reminders guide §13). Tenant
// and branch come from the session; the client never sends them, and no phone / email is ever put in a URL. Settings
// stay on posRemindersApi (GET/PATCH /pos/reminders).
import { api } from './client';

type RcState = 'scheduled' | 'short_notice' | 'missed_window' | 'claimed' | 'submitted' | 'sent' | 'simulated' | 'delivered' | 'undelivered' | 'failed' | 'skipped' | 'cancelled' | 'deferred';
type HealthState = 'ready' | 'attention_required' | 'pending' | 'failed' | 'unknown' | 'off' | 'test_mode';
export interface RcKpi { value: number | null; basis: string; known?: boolean; lastReportAt?: string | null }
export interface RcKpis { timezone: string; period: { preset: string; from: string | null; to: string | null }; scheduled: RcKpi; sent: RcKpi; delivered: RcKpi; failed: RcKpi; cancelled: RcKpi; upcomingToday: RcKpi }
export interface RcRow {
  id: string; kind: 'upcoming' | 'dispatch'; state: RcState; engineState?: string; reason?: string | null; reasonText: string | null;
  appointmentId: string; customerId: string | null; customerName: string; phoneLast4: string | null; emailMasked: string | null; hasDestination?: boolean;
  technicianName: string | null; branchId: string | null; branchName: string | null; channel: 'sms' | 'email'; leadMinutes: number; occurrenceKey?: string;
  appointmentStartAt: string | null; intendedSendAt: string | null; createdAt: string | null; updatedAt?: string | null; sentAt: string | null; deliveredAt: string | null;
  providerStatus: string | null; providerErrorCode?: string | null; attempts?: number; notificationId?: string | null; superseded: boolean; appointmentStatus?: string | null; retryable?: boolean;
}
export interface RcPage { tab: string; basis: string; timezone: string; period: { preset: string; from: string | null; to: string | null }; page: number; pageSize: number; totalItems: number; totalPages: number; items: RcRow[] }
export interface ReminderRcQuery { tab?: string; q?: string; channel?: string; branchId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }
export interface RcAttempt { id: string; status: string; reason: string | null; reasonText: string | null; kind: string; notificationId: string | null; byStaff: boolean; note: string | null; at: string | null }
export interface RcDetails {
  item: RcRow & { providerReference?: string | null; failureReason?: string | null };
  rule: { enabled: boolean; leadMinutes: number; windowMinutes: number; channel: string; ladderMinutes: number[] };
  template: { templateId: string | null; version: number | null; source: 'salon_template' | 'built_in' };
  attempts: RcAttempt[]; deliveryEvents: { providerStatus: string; errorCode: string | null; applied: boolean; signatureVerified: boolean; at: string | null }[]; timezone: string;
}
export interface RcHealthItem { key: 'scheduler' | 'twilio' | 'email' | 'booking_sync' | 'history'; state: HealthState; summary: string; evidence: string; checkedAt: string | null; nextAction: string | null }
export interface RcHealth { overall: HealthState; items: RcHealthItem[]; timezone: string; schedulerEnabledHere: boolean; checkedAt: string }
export interface RcCustomerHistory { page: number; pageSize: number; totalItems: number; totalPages: number; items: (RcRow & { events: { status: string; reason: string | null; reasonText: string | null; kind: string; at: string | null }[] })[] }

const qs = (o: Record<string, unknown>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString(); return s ? `?${s}` : '';
};

export const posReminderCenterApi = {
  kpis: (q: { preset?: string; from?: string; to?: string; branchId?: string }) => api.get<RcKpis>(`/pos/reminder-center/kpis${qs(q)}`),
  list: (q: ReminderRcQuery) => api.get<RcPage>(`/pos/reminder-center/reminders${qs(q as Record<string, unknown>)}`),
  details: (id: string) => api.get<RcDetails>(`/pos/reminder-center/reminders/${encodeURIComponent(id)}`),
  cancel: (id: string, reason: string) => api.post<{ id: string; state: string }>(`/pos/reminder-center/reminders/${encodeURIComponent(id)}/cancel`, { reason }),
  retry: (id: string, b: { idempotencyKey: string; reason: string; confirm: boolean; acknowledgeDuplicateRisk?: boolean }) =>
    api.post<{ replayed: boolean; id: string; state: string }>(`/pos/reminder-center/reminders/${encodeURIComponent(id)}/retry`, b),
  health: () => api.get<RcHealth>('/pos/reminder-center/health'),
  customerHistory: (customerId: string, page = 1, pageSize = 10) => api.get<RcCustomerHistory>(`/pos/reminder-center/customers/${encodeURIComponent(customerId)}/reminders${qs({ page, pageSize })}`),
};
