// posEmailCenterApi.ts — Communications → Email (pos/email-center/*, Email Complete Build Guide). Tenant and branch come
// from the session; no address is ever put in a URL. Settings are SAVED through the existing settings route
// (PATCH /pos/settings/notifications-reminders) and READ here as the send path honours them.
import { api } from './client';

export type EmStatus = 'accepted' | 'delivered' | 'failed' | 'bounced' | 'blocked' | 'suppressed' | 'simulated';
export type EmCategory = 'booking' | 'receipt' | 'reminder' | 'follow_up' | 'marketing' | 'manual';
export interface EmWindow { preset: string; from: string | null; to: string | null; tz: string; today: string }
export interface EmSettings { senderName: string; replyTo: string | null; bookingConfirmations: boolean; receipts: boolean; source: string; fromAddress: string; savedAt: string | null; canEdit: boolean }
export interface EmSummary { window: EmWindow; provider: string; accepted: number; delivered: number | null; failed: number; bounced: number; blocked: number; simulated: number; bookingConfirmations: number; receipts: number; deliveryRate: number | null; deliveryRateDenominator: string | null }
export interface EmLayer { key: string; state: string; detail: string; next: string | null; checkedAt?: string | null; lastSuccessAt?: string | null; lastEventAt?: string | null; lastReason?: string | null }
export interface EmHealth { overall: string; layers: EmLayer[]; fromAddress: string; lastCheckedAt: string | null; lastSuccessAt: string | null }
export interface EmRow { id: string; createdAt: string; to: string; customer: { id: string; name: string | null } | null; subject: string | null; category: EmCategory; status: EmStatus; reason: string | null; deliveredAt: string | null; resendOf: string | null }
export interface EmPage { items: EmRow[]; total: number; page: number; pageSize: number; totalPages: number; basis: string; window: EmWindow; masked: boolean }
export interface EmDetail {
  id: string; createdAt: string; status: EmStatus; rawStatus: string; reason: string | null; category: EmCategory; consent: string;
  from: { address: string; name: string | null }; replyTo: string | null; to: string; subject: string | null; body: string | null;
  customer: { id: string; name: string | null } | null; branch: { id: string; name: string | null } | null;
  links: { appointmentId: string | null; ticketId: string | null; receipts: { number: string; at: string }[] };
  providerReference: string | null; deliveredAt: string | null;
  events: { status: string; code: string | null; applied: boolean; verified: boolean; at: string }[];
  attempts: { id: string; at: string; status: EmStatus; reason: string | null; isThis: boolean }[]; canResend: boolean;
}
export interface EmSendResult { outcome: string; reason: string | null; notificationId: string | null; providerReference: string | null; replayed: boolean }
export interface EmQuery { q?: string; status?: string; category?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }

const qs = (o: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? `?${s}` : ''; };
const withKey = (key: string) => ({ 'Idempotency-Key': key });

export const posEmailCenterApi = {
  settings: () => api.get<EmSettings>('/pos/email-center/settings'),
  summary: (q: { preset?: string; from?: string; to?: string }) => api.get<EmSummary>(`/pos/email-center/summary${qs(q)}`),
  health: () => api.get<EmHealth>('/pos/email-center/health'),
  check: () => api.post<EmHealth>('/pos/email-center/health/check', {}),
  history: (q: EmQuery) => api.get<EmPage>(`/pos/email-center/history${qs(q as Record<string, unknown>)}`),
  detail: (id: string) => api.get<EmDetail>(`/pos/email-center/messages/${encodeURIComponent(id)}`),
  resend: (id: string, key: string) => api.post<{ outcome: string; refusalCode: string | null; newNotificationId: string | null; replayed: boolean }>(`/pos/email-center/messages/${encodeURIComponent(id)}/resend`, { idempotencyKey: key, confirm: true }, withKey(key)),
  test: (to: string, key: string) => api.post<EmSendResult>('/pos/email-center/test', { to, idempotencyKey: key, confirm: true }, withKey(key)),
  compose: (b: { customerId: string; subject: string; body: string }, key: string) => api.post<EmSendResult>('/pos/email-center/compose', { ...b, idempotencyKey: key, confirm: true }, withKey(key)),
};
