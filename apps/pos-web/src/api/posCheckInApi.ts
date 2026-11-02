// posCheckInApi.ts — tenant POS Check-In API client (canonical). Same-origin; tenant/branch/role from session.
import type { CheckInFilters } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';   // the wire contract (Constitution 13 §15)
// Supersedes the earlier six-method stub on mixed paths. Create-customer / walk-in may return 409 with an
// existingCustomerId (duplicate); move/start endpoints are idempotent server-side.
export class ApiError extends Error { constructor(message: string, public status: number, public existingCustomerId?: string) { super(message); this.name = 'ApiError'; } }
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
import { localizedOr } from '../i18n/error-text';
const BASE = apiUrl('/pos/check-in');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => status === 409 ? new ApiError(localizedOr(message, body, t('pos.duplicate_customer')), 409, body?.existingCustomerId) : new ApiError(message, status) });
function qs(f: Record<string, unknown>): string { const p = new URLSearchParams(); Object.keys(f).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (cid: string, action: string, body?: unknown) => http<any>('/' + id(cid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const posCheckInApi = {
  state: (f: CheckInFilters = {}) => http<any>('/state' + qs(f as Record<string, unknown>)),
  kpis: () => http<any>('/kpis'),
  recent: (f: CheckInFilters = {}) => http<any>('/recent' + qs(f as Record<string, unknown>)),
  searchCustomers: (query: string) => http<any[]>('/customers/search' + qs({ query })),
  searchAppointments: (query: string, date?: string) => http<any[]>('/appointments/search' + qs({ query, date })),
  waitEstimate: (serviceIds: string[], technicianId?: string) => http<any>('/wait-estimate' + qs({ serviceIds: serviceIds.join(','), technicianId })),
  detail: (checkInId: string) => http<any>('/' + id(checkInId)),
  // mandate §31: the body's idempotencyKey also rides as the Idempotency-Key header (durable, replica-safe replay)
  walkIn: (body: unknown) => http<any>('/walk-in', { method: 'POST', body: JSON.stringify(body), ...((body as any)?.idempotencyKey ? { headers: { 'Idempotency-Key': String((body as any).idempotencyKey) } } : {}) }),
  appointmentCheckIn: (appointmentId: string) => http<any>('/appointment/' + id(appointmentId), { method: 'POST' }),
  createCustomer: (body: unknown) => http<any>('/create-customer', { method: 'POST', body: JSON.stringify(body) }),
  assignTechnician: (checkInId: string, body: unknown) => post(checkInId, 'assign-technician', body),
  updateWaitEstimate: (checkInId: string, body: unknown) => post(checkInId, 'update-wait-estimate', body),
  moveToQueue: (checkInId: string) => post(checkInId, 'move-to-queue'),
  startService: (checkInId: string) => post(checkInId, 'start-service'),
  cancel: (checkInId: string, body: unknown) => post(checkInId, 'cancel', body),
};
export type { CheckInFilters };
