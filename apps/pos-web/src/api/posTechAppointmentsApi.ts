import type { TechApptFilters } from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';   // the wire contract (Constitution 13 §15)
// posTechAppointmentsApi.ts — tenant POS Tech Appointments API client (canonical). Same-origin; tenant/branch/role
// from session. Supersedes the earlier three-method stub. Create/reschedule may return 409 with a conflict payload;
// move/start endpoints are idempotent server-side.
export class ApiError extends Error {
  constructor(message: string, public status: number, public conflictingAppointmentId?: string,
              /** Smooth Refresh §12/§14 (merge Oct 12): APPOINTMENT_CONFLICT | VERSION_CONFLICT — the server's stable 409 `code` */
              public code?: string, public currentVersion?: number) { super(message); this.name = 'ApiError'; }
}
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
import { localizedOr } from '../i18n/error-text';
const BASE = apiUrl('/pos/tech-appointments');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => status === 409 ? new ApiError(localizedOr(message, body, t('pos.scheduling_conflict')), 409, body?.conflictingAppointmentId, body?.code, typeof body?.currentVersion === 'number' ? body.currentVersion : undefined) : new ApiError(message, status) });
function qs(f: TechApptFilters): string { const p = new URLSearchParams(); (Object.keys(f) as (keyof TechApptFilters)[]).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (aid: string, action: string, body?: unknown) => http<any>('/appointments/' + id(aid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const posTechAppointmentsApi = {
  state: (f: TechApptFilters = {}) => http<any>('/state' + qs(f)),
  kpis: () => http<any>('/kpis'),
  technicians: () => http<any[]>('/technicians'),
  appointments: (f: TechApptFilters = {}) => http<any[]>('/appointments' + qs(f)),
  appointment: (aid: string) => http<any>('/appointments/' + id(aid)),
  create: (body: unknown) => http<any>('/appointments', { method: 'POST', body: JSON.stringify(body) }),
  update: (aid: string, body: unknown) => http<any>('/appointments/' + id(aid), { method: 'PATCH', body: JSON.stringify(body) }),
  checkConflict: (body: unknown) => http<any>('/conflicts/check', { method: 'POST', body: JSON.stringify(body) }),
  reschedule: (aid: string, body: unknown) => post(aid, 'reschedule', body),
  cancel: (aid: string, body: unknown) => post(aid, 'cancel', body),
  noShow: (aid: string) => post(aid, 'no-show'),
  assignTechnician: (aid: string, body: unknown) => post(aid, 'assign-technician', body),
  moveToQueue: (aid: string) => post(aid, 'move-to-queue'),
  startService: (aid: string) => post(aid, 'start-service'),
};
export type { TechApptFilters };
