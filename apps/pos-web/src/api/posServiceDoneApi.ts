// posServiceDoneApi.ts — tenant POS Service Done API client (canonical). Same-origin; tenant/branch/role from session.
import type { ServiceDoneFilters } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// Supersedes the earlier single-method stub. send-to-checkout is idempotent server-side; notify may return
// { configured:false, disabledReason } — surface that and never imply a delivered notification.
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
const BASE = apiUrl('/pos/service-done');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
function qs(f: ServiceDoneFilters): string { const p = new URLSearchParams(); (Object.keys(f) as (keyof ServiceDoneFilters)[]).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (tid: string, action: string, body?: unknown) => http<any>('/tickets/' + id(tid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const posServiceDoneApi = {
  state: (f: ServiceDoneFilters = {}) => http<any>('/state' + qs(f)),
  kpis: () => http<any>('/kpis'),
  technicians: () => http<any[]>('/technicians'),
  tickets: (f: ServiceDoneFilters = {}) => http<any>('/tickets' + qs(f)),
  ticket: (tid: string) => http<any>('/tickets/' + id(tid)),
  qualityCheck: (tid: string, body: unknown) => post(tid, 'quality-check', body),
  updateNotes: (tid: string, body: { notes?: string; customerVisibleNotes?: string }) => post(tid, 'update-notes', body),
  assignTechnician: (tid: string, body: unknown) => post(tid, 'assign-technician', body),
  assignHelper: (tid: string, body: unknown) => post(tid, 'assign-helper', body),
  markReadyForCheckout: (tid: string) => post(tid, 'mark-ready-for-checkout'),
  sendToCheckout: (tid: string) => post(tid, 'send-to-checkout'),
  notifyCustomer: (tid: string, body: unknown) => post(tid, 'notify-customer', body),
  reopenService: (tid: string, body: unknown) => post(tid, 'reopen-service', body),
};
export type { ServiceDoneFilters };
