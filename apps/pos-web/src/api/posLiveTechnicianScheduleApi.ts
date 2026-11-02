// posLiveTechnicianScheduleApi.ts — tenant POS Live Technician Schedule client. Same-origin; tenant/branch/role come
import type { LiveScheduleFilters, LiveScheduleWeek } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';   // the wire contract (Constitution 13 §15)
// from the session cookie (never sent from the client). Reads /pos/technicians/live-schedule/*; actions hit the
// per-technician routes. Aggregation-only: the appointment/shift/status data is the same records the Booking, Tech
// Appointments, Queue and Technician App use — no duplicate source.
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
import { localizedOr } from '../i18n/error-text';
const BASE = apiUrl('/pos/technicians');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => new ApiError(status === 409 ? localizedOr(message, body, t('pos.this_technician_is_in_an_active_2bpg')) : message, status) });
function qs(f: Record<string, unknown>): string { const p = new URLSearchParams(); Object.keys(f).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);


export const posLiveTechnicianScheduleApi = {
  state: (f: LiveScheduleFilters = {}) => http<any>('/live-schedule/state' + qs(f as Record<string, unknown>)),
  kpis: (date?: string) => http<any>('/live-schedule/kpis' + qs({ date })),
  board: (f: LiveScheduleFilters = {}) => http<any>('/live-schedule/board' + qs(f as Record<string, unknown>)),
  // Week view (merge Oct 12): Monday..Sunday of the week containing `date`, one day board each (salon-local dates).
  week: (f: LiveScheduleFilters = {}) => http<LiveScheduleWeek<any>>('/live-schedule/week' + qs(f as Record<string, unknown>)),
  detail: (technicianId: string, date?: string) => http<any>('/' + id(technicianId) + '/live-detail' + qs({ date })),
  blockTime: (technicianId: string, body: { date?: string; startTime: string; endTime: string; reason?: string; note?: string }) => http<any>('/' + id(technicianId) + '/block-time', { method: 'POST', body: JSON.stringify(body) }),
  startBreak: (technicianId: string, body: { reason?: string; managerOverride?: boolean } = {}) => http<any>('/' + id(technicianId) + '/start-break', { method: 'POST', body: JSON.stringify(body) }),
  endBreak: (technicianId: string) => http<any>('/' + id(technicianId) + '/end-break', { method: 'POST', body: JSON.stringify({}) }),
  bookOpenSlot: (slotId: string, body: { customerName?: string; serviceIds?: string[]; durationMinutes?: number; serviceSummary?: string } = {}) => http<any>('/live-schedule/open-slots/' + id(slotId) + '/book', { method: 'POST', body: JSON.stringify(body) }),
};
export type { LiveScheduleFilters };
