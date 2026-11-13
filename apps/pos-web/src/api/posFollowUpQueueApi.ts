// posFollowUpQueueApi.ts — Follow-Up Queue (pos/follow-up-queue/*, Follow-Up Queue guide §05–§15). Tenant and branch come
// from the session; the client never sends them, and no phone number or message text is ever put in a URL. Send / Skip /
// Approve / Reject stay on the existing routes (posFollowUpApi.skip, posEodFollowUpsApi.send/approve/reject).
import { api } from './client';

type Priority = 'high' | 'normal' | 'low';
export interface FollowUpPriorityReason { code: 'overdue' | 'open_concern' | 'already_booked' | 'recently_contacted' | 'several_unanswered'; at: string | null; detail: string | null }
export interface FollowUpQueueKpis {
  date: string; timezone: string; basis: string; pending: number; awaitingApproval: number; sent: number; skipped: number; expired: number; rebooked: number; total: number;
  overdueEarlier: number; missedCalls: number; updatedAt: string;
  generation: { status: string; trigger: string; finishedAt: string | null; eligible: number; created: number; excluded: number; exclusions: Record<string, number>; ruleVersion: string | null } | null;
}
export interface FollowUpQueueRow {
  id: string; type: 'after_service'; dueDate: string; overdue: boolean; status: string; customerId: string; customerName: string; customerPhoneLast4: string | null;
  customerHasApp: boolean; serviceName: string; technicianId: string; technicianName: string; completedAt: string | null; createdAt: string | null; sentAt: string | null;
  reason: string | null; ticketId: string; ticketNumber: string | null; appointmentId: string | null; priority: Priority; priorityReasons: FollowUpPriorityReason[];
}
export interface QueuePage<T> { items: T[]; total: number; page: number; pageSize: number; totalPages: number }
export interface FollowUpQueueQuery { view?: string; q?: string; status?: string; technicianId?: string; priority?: string; due?: string; basis?: string; from?: string; to?: string; page?: number; pageSize?: number }
type ContactCategory = 'eligible' | 'recently_contacted' | 'already_sent' | 'opted_out' | 'missing_contact' | 'blocked' | 'needs_approval' | 'source_cancelled';
export interface ContactCheck {
  taskId: string; category: ContactCategory; categories: ContactCategory[]; channel: string; cooldownHours: number;
  lastFollowUp: { taskId: string; at: string | null; technicianName: string } | null;
  otherChannel: { channel: string; purpose: string | null; status: string; at: string | null; enforced: boolean } | null;
  optOuts: { channel: string; at: string | null; enforced?: boolean }[]; marketing: { sms: boolean; email: boolean }; upcomingBooking: string | null;
  priority: Priority; priorityReasons: FollowUpPriorityReason[]; priorityVersion: string;
}
export interface MissedCallRow { id: string; type: 'missed_call'; customerId: string | null; customerName: string | null; callerLast4: string | null; at: string | null; aiHandled: boolean; state: 'recovered' | 'replied' | 'awaiting_callback'; recoveredAppointmentId: string | null }
export interface QueueResults {
  from: string; to: string; timezone: string; windowDays: number;
  funnel: { eligible: number; generated: number; sent: number; deliveredToApp: number; viewed: number; bookedAfter: number; returnVisits: number };
  closed: { skipped: number; expired: number; unsent: number }; associatedRevenueCents: number;
  skipReasons: { reason: string; count: number }[];
  byTechnician: { technicianId: string; name: string; generated: number; sent: number; skipped: number; bookedAfter: number; smallSample: boolean }[];
  queueAge: { under1Day: number; oneToThreeDays: number; overThreeDays: number };
}
export interface CustomerFollowUp { id: string; dueDate: string; status: string; serviceName: string; technicianName: string; createdAt: string | null; sentAt: string | null; reason: string | null; viewedAt: string | null; messagePreview: string | null; bookedAfterAt: string | null; /** round 10 (EOD 14) */ repliedAt?: string | null; returnedAt?: string | null }
export interface GenerateOutcome {
  result: { businessDate: string; created: number; skipped: number; alreadyRan: boolean };
  summary: { businessDate: string; status: string; eligible: number; created: number; createdToday: number; alreadyExisted: number; skippedByReason: Record<string, number>; failed: number; error: string | null } | null;
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const posFollowUpQueueApi = {
  kpis: (date?: string) => api.get<FollowUpQueueKpis>('/pos/follow-up-queue/kpis', clean({ date })),
  tasks: (f: FollowUpQueueQuery) => api.get<QueuePage<FollowUpQueueRow> & { view: string; basis: string; status: string }>('/pos/follow-up-queue/tasks', clean(f as Record<string, unknown>)),
  contactCheck: (id: string) => api.get<ContactCheck>(`/pos/follow-up-queue/tasks/${encodeURIComponent(id)}/contact-check`),
  missedCalls: (f: { q?: string; from?: string; to?: string; state?: string; page?: number; pageSize?: number }) => api.get<QueuePage<MissedCallRow>>('/pos/follow-up-queue/missed-calls', clean(f)),
  results: (f: { from?: string; to?: string; technicianId?: string }) => api.get<QueueResults>('/pos/follow-up-queue/results', clean(f)),
  customerHistory: (customerId: string, page = 1) => api.get<QueuePage<CustomerFollowUp>>(`/pos/follow-up-queue/customers/${encodeURIComponent(customerId)}/history`, { page, pageSize: 10 }),
  generate: () => api.post<GenerateOutcome>('/pos/follow-up-queue/generate', {}),
};
