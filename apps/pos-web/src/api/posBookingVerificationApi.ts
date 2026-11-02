// posBookingVerificationApi.ts — Communications → Booking Phone Verification operations center (Booking Phone Verification
// Complete Build Guide, Oct 30 2026). READ routes + one write (an authorized resend to the number on the customer's record).
// Settings stay on /pos/settings/booking-phone-verification and the manager override on /pos/booking/verification-override.
import { api } from './client';

export type BvHealthState = 'ready' | 'needs_setup' | 'pending_provider_action' | 'degraded' | 'failed' | 'unknown';
export type BvStatus = 'pending' | 'verified' | 'failed' | 'expired' | 'cancelled' | 'provider_error';
export interface BvSummary {
  generatedAt: string; timezone: string; lastActivityAt: string | null;
  cards: {
    pending: { value: number; definition: string }; verifiedToday: { value: number; definition: string }; failedToday: { value: number; definition: string };
    activeHolds: { value: number; expiringSoon: number; definition: string };
    smsHealth: { state: BvHealthState; providerErrors24h: number; codesSent24h: number; definition: string };
    successRate: { value: number | null; numerator: number; denominator: number; definition: string };
  };
}
export interface BvHealth { checkedAt: string; overall: BvHealthState; items: Array<{ key: string; state: BvHealthState; message: string; evidence: string; nextAction: string | null; checkedAt: string }> }
export interface BvRow {
  id: string; branchId: string | null; branchName: string | null; bookingSessionId: string; customerId: string | null; customerName: string | null; maskedPhone: string;
  channel: string; status: BvStatus; codeState: string; attempts: number; resends: number; expiresAt: string | null; requestedAt: string | null; verifiedAt: string | null;
  lastSentAt: string | null; updatedAt: string | null; appointmentId: string | null; staffOverride: boolean; whyRequired: string | null; failure: string | null;
  hold: { holdId: string; status: string; expiresAt: string | null; startsAt: string | null; endsAt: string | null; technicianName: string | null } | null;
}
export interface BvPage<T> { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number; period?: { preset: string; from: string | null; to: string | null; tz: string; today: string }; serverNow?: string }
export interface BvDetail extends BvRow {
  services: string[];
  policy: { version: string | null; tenantVersion: number | null; branchVersion: number | null; providerVersion: number | null; reason: string | null; why: string | null };
  provider: { kind: string; reference: string | null };
  override: { at: string | null; reason: string | null; contactMethod: string | null } | null;
  canResend: boolean; timeline: Array<{ at: string; event: string }>;
}
export type BvQuery = Record<string, string | number | undefined>;
const enc = encodeURIComponent;
const clean = (q: BvQuery) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export const posBookingVerificationApi = {
  summary: () => api.get<BvSummary>('/pos/booking-verification-center/summary'),
  health: () => api.get<BvHealth>('/pos/booking-verification-center/health'),
  live: (q: BvQuery) => api.get<BvPage<BvRow>>('/pos/booking-verification-center/live', clean(q)),
  history: (q: BvQuery) => api.get<BvPage<BvRow>>('/pos/booking-verification-center/history', clean(q)),
  detail: (id: string) => api.get<BvDetail>(`/pos/booking-verification-center/history/${enc(id)}`),
  resend: (id: string) => api.post<{ status: string; message: string | null }>(`/pos/booking-verification-center/history/${enc(id)}/resend`, {}),
};
