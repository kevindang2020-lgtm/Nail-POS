import type { TechQueueFilters } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// posTechQueueApi.ts — tenant POS Tech Queue API client (canonical, new). Same-origin; tenant/branch/role from session.
// move-to-serving is idempotent server-side; notify endpoints may return { configured:false, disabledReason } — surface
// that and never imply a delivered notification.
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
const BASE = apiUrl('/pos/tech-queue');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
function qs(f: TechQueueFilters): string { const p = new URLSearchParams(); (Object.keys(f) as (keyof TechQueueFilters)[]).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (tid: string, action: string, body?: unknown) => http<any>('/tickets/' + id(tid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const posTechQueueApi = {
  state: (f: TechQueueFilters = {}) => http<any>('/state' + qs(f)),
  kpis: () => http<any>('/kpis'),
  technicianLanes: () => http<any[]>('/technician-lanes'),
  tickets: (f: TechQueueFilters = {}) => http<any>('/tickets' + qs(f)),
  ticket: (tid: string) => http<any>('/tickets/' + id(tid)),
  accept: (tid: string, body?: unknown) => post(tid, 'accept', body),
  decline: (tid: string, body: unknown) => post(tid, 'decline', body),
  reassignTechnician: (tid: string, body: unknown) => post(tid, 'reassign-technician', body),
  updatePriority: (tid: string, body: unknown) => post(tid, 'update-priority', body),
  notifyCustomer: (tid: string, body: unknown) => post(tid, 'notify-customer', body),
  reportDelay: (tid: string, body: unknown) => post(tid, 'report-delay', body),
  clearDelay: (tid: string, body: unknown) => post(tid, 'clear-delay', body),
  startService: (tid: string, body?: unknown) => post(tid, 'start-service', body),
  moveToServing: (tid: string, body?: unknown) => post(tid, 'move-to-serving', body),
  cancel: (tid: string, body: unknown) => post(tid, 'cancel', body),
};
export type { TechQueueFilters };
