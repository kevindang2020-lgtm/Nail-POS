// posCommunicationsApi.ts — unified inbox client. Reads tenant-scoped inbox state + conversation detail and drives the
// conversation (reply, mark read, assign, status). All endpoints guarded + tenant-scoped server-side.
// Communications / SMS Inbox guide (Oct 30 2026): `inbox` = the pos/communications/inbox/* read model (server-side search,
// salon-local dates, priority sorts, numbered pages, unified timeline, honest delivery states). Tenant / branch are never
// sent in a body; search text never goes into the page URL (it may be a phone number).
import type { ActivityMetric, InboxPeriod, InboxTimelineEvent } from '@aipowersalon/api-contracts/tenant';
export type { ActivityMetric, InboxTimelineEvent };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';

export type InboxDelivery = 'received' | 'sending' | 'submitted' | 'sent' | 'delivered' | 'failed' | 'undelivered' | 'blocked' | 'simulated' | 'not_tracked';
export interface InboxThread {
  id: string; branchId: string | null; branchName: string | null; customerId: string | null; displayName: string | null;
  identity: 'linked' | 'ambiguous' | 'unknown'; contactMasked: string | null; channel: 'sms' | 'email' | 'call'; status: 'open' | 'pending' | 'replied' | 'missed' | 'closed';
  assignedTo: string | null; assignedToName: string | null; unreadCount: number; lastActivityAt: string | null; lastMessagePreview: string | null;
  lastDirection: string | null; awaitingSince: string | null; followUpDueAt: string | null; version: number; createdAt: string;
}
export interface InboxPage { items: InboxThread[]; total: number; page: number; pageSize: number; pageCount: number; sort: string; period: InboxPeriod; branch: string | null }
export interface InboxMessage {
  id: string; threadId: string; direction: 'inbound' | 'outbound'; channel: string; body: string; authorKind: 'customer' | 'staff' | 'ai' | 'system'; authorName: string | null;
  createdAt: string; delivery: InboxDelivery; reasonCode: string | null; providerErrorCode: string | null; deliveredAt: string | null; mediaCount: number;
}
export interface InboxComposer { enabled: boolean; reasonCode: string | null; readiness: { ok: boolean; reasonCode: string | null; state: string; warnings: string[]; deliveryTracking: boolean; fixLink: string | null } | null }
export interface InboxDetail {
  thread: InboxThread & { contact: string | null; customerMatch: string | null; closedAt: string | null; lastInboundAt: string | null };
  customer: { id: string; name: string | null; phone: string | null; email: string | null; marketingSmsOptIn: boolean; archived: boolean } | null;
  consent: { smsOptedOut: boolean; marketingSmsOptIn: boolean | null };
  nextAppointment: { id: string; date: string; startTime: string | null; status: string } | null;
  ambiguousCandidates: number; messages: InboxMessage[]; olderCursor: string | null;
  permissions: { canSend: boolean; canManage: boolean }; composer: InboxComposer;
}
export interface InboxSummary {
  scope: { branch: string | null; tz: string };
  conversations: { total: number; open: number; unreadThreads: number; unreadMessages: number; replied: number; missed: number; awaiting: number; oldestAwaitingSince: string | null };
  channelMix: { channel: string; count: number }[];
  sentToday: { total: number; submitted: number; delivered: number; failed: number; simulated: number };
  /** Missing-webhook warning (Extras · SMS Inbox 12): timestamps only — waiting texts are never counted as failed */
  callbacks?: { state: 'ok' | 'delayed' | 'stale'; awaiting: number; oldestAwaitingAt: string | null; lastCallbackAt: string | null; waitMinutes: number; lookbackDays: number };
  definitions: Record<string, string>; generatedAt: string;
}
export interface ThreadChange { id: string; version: number; status: string; unreadCount: number; assignedTo: string | null; assignedToName: string | null; followUpDueAt: string | null; customerId: string | null; changed: boolean }

const enc = encodeURIComponent;
const I = '/pos/communications/inbox';
export const newRequestKey = (): string => globalThis.crypto?.randomUUID?.() || `ci-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const posCommunicationsApi = {
  getState: (q?: Record<string, unknown>) => api.get<any>('/pos/communications/state', q),
  // Activity/volume metrics — each value carries `available`; a false one means the SOURCE is absent, not a zero.
  getActivity: (days = 30, branch?: string | null) => api.get<{
    windowDays: number;
    messagesSentToday: ActivityMetric; campaignDeliveryRatePct: ActivityMetric; aiCallsHandled: ActivityMetric;
    reviewRequestsSent: ActivityMetric; avgResponseMinutes: ActivityMetric; rebookingConversionPct: ActivityMetric;
  }>('/pos/communications/activity', branch ? { days, branch } : { days }),
  reply: (id: string, body: string) => api.post<any>(`/pos/communications/threads/${id}/reply`, { body }, { 'Idempotency-Key': newRequestKey() }),
  setStatus: (id: string, status: string) => api.post<any>(`/pos/communications/threads/${id}/status`, { status }),
  create: (body: Record<string, unknown>) => api.post<any>('/pos/communications/threads', body),

  inbox: {
    list: (q: Record<string, unknown>) => api.get<InboxPage>(`${I}/threads`, q),
    /** C2 audit: link the booking made from this conversation back to it */
    linkBooking: (threadId: string, appointmentId: string) => api.post<unknown>(`${I}/threads/${encodeURIComponent(threadId)}/booking`, { appointmentId }),
    summary: (branch?: string | null) => api.get<InboxSummary>(`${I}/summary`, branch ? { branch } : undefined),
    /** C2 gap (Nov 5 2026): the campaigns of the last 90 days for the source filter (a reply within 14 days of the send) */
    sourceCampaigns: () => api.get<{ items: { value: string; name: string; kind: 'rsms' | 'cc'; sentAt: string | null }[]; windowDays: number }>(`${I}/source-campaigns`),
    detail: (id: string) => api.get<InboxDetail>(`${I}/threads/${enc(id)}`),
    older: (id: string, before: string) => api.get<{ items: InboxMessage[]; olderCursor: string | null }>(`${I}/threads/${enc(id)}/messages`, { before }),
    timeline: (id: string, q: { before?: string | null; sources?: string | null }) => api.get<{ customerId: string | null; scope: 'customer' | 'contact'; events: InboxTimelineEvent[]; olderCursor: string | null; sources: string[] }>(`${I}/threads/${enc(id)}/timeline`, { ...(q.before ? { before: q.before } : {}), ...(q.sources ? { sources: q.sources } : {}) }),
    /** one key per intended Send — a retry of the SAME send reuses it, so the customer gets one text */
    reply: (id: string, body: string, key: string, templateId?: string | null) => api.post<{ message: InboxMessage | null; duplicate: boolean; thread: { id: string; version: number; status: string; unreadCount: number }; readiness?: { state: string; warnings: string[]; deliveryTracking: boolean } }>(`${I}/threads/${enc(id)}/reply`, templateId ? { body, templateId } : { body }, { 'Idempotency-Key': key }),
    /** Message Templates (740): the template's text filled in for THIS conversation's customer — text only, never sends */
    renderTemplate: (threadId: string, templateId: string) => api.post<{ templateId: string; version: number | null; scope: 'salon' | 'platform'; text: string; missing: string[]; unknown: string[] }>(`/pos/message-templates/render-for-thread/${enc(threadId)}`, { templateId }),
    read: (id: string) => api.post<ThreadChange>(`${I}/threads/${enc(id)}/read`, {}),
    unread: (id: string) => api.post<ThreadChange>(`${I}/threads/${enc(id)}/unread`, {}),
    assign: (id: string, userId: string | null, expectedVersion: number) => api.post<ThreadChange>(`${I}/threads/${enc(id)}/assign`, { userId, expectedVersion }),
    status: (id: string, status: string, expectedVersion: number) => api.post<ThreadChange>(`${I}/threads/${enc(id)}/status`, { status, expectedVersion }),
    followUp: (id: string, dueAt: string | null, expectedVersion: number, reason?: string) => api.post<ThreadChange>(`${I}/threads/${enc(id)}/follow-up`, { dueAt, expectedVersion, ...(reason ? { reason } : {}) }),
    linkCustomer: (id: string, customerId: string, expectedVersion: number) => api.post<ThreadChange>(`${I}/threads/${enc(id)}/link-customer`, { customerId, expectedVersion }),
    start: (b: { customerId?: string; phone?: string }, key: string) => api.post<{ threadId: string; created: boolean }>(`${I}/conversations`, b, { 'Idempotency-Key': key }),
    templates: () => api.get<{ items: { id: string; name: string; category: string | null; body: string; scope: 'salon' | 'platform' }[] }>(`${I}/templates`),
    customers: (q: string) => api.get<{ items: { id: string; name: string | null; phoneMasked: string | null; hasPhone: boolean; emailMasked: string | null }[] }>(`${I}/customers`, { q }),
    staff: () => api.get<{ items: { id: string; name: string }[] }>(`${I}/staff`),
  },
};
