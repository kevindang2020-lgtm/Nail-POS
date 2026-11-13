// posServingApi.ts — tenant POS Serving API client (canonical). Same-origin; tenant/branch/role from session.
import type { ServingFilters, ServingActionReview } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// Supersedes the earlier two-method stub. Timer is server-truth; send-to-service-done is idempotent server-side.
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { apiUrl } from './apiBase';   // BUILD_PLAN Phase 12: API_ORIGIN + /api/v1 + path
import { posHttp } from './client';
const BASE = apiUrl('/pos/serving');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
function qs(f: ServingFilters): string { const p = new URLSearchParams(); (Object.keys(f) as (keyof ServingFilters)[]).forEach((k) => { const v = f[k]; if (v != null && v !== '') p.set(k, String(v)); }); const s = p.toString(); return s ? '?' + s : ''; }
const id = (s: string) => encodeURIComponent(s);
const post = (tid: string, action: string, body?: unknown) => http<any>('/tickets/' + id(tid) + '/' + action, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
export const posServingApi = {
  state: (f: ServingFilters = {}) => http<any>('/state' + qs(f)),
  pendingChangeRequests: () => http<any[]>('/change-requests/pending'),
  decideChangeRequest: (rid: string, decision: 'approve' | 'reject') => http<any>('/change-requests/' + id(rid) + '/decision', { method: 'POST', body: JSON.stringify({ decision }) }),
  kpis: () => http<any>('/kpis'),
  services: () => http<any[]>('/services'),
  technicians: () => http<any[]>('/technicians'),
  tickets: (f: ServingFilters = {}) => http<any>('/tickets' + qs(f)),
  ticket: (tid: string) => http<any>('/tickets/' + id(tid)),
  /** Serving 07: what an impactful action would touch + every conflict its own gates raise — read only */
  actionReview: (tid: string, p: { action: 'mark_ready' | 'assign_technician' | 'add_service'; technicianId?: string; serviceId?: string; priceCents?: number }) => { const q = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v != null && v !== '') q.set(k, String(v)); }); return http<ServingActionReview>('/tickets/' + id(tid) + '/action-review?' + q.toString()); },
  revisions: (tid: string) => http<{ ticketId: string; currentVersion: number; revisions: any[] }>('/tickets/' + id(tid) + '/revisions'),
  start: (tid: string) => post(tid, 'start'),
  pause: (tid: string) => post(tid, 'pause'),
  resume: (tid: string) => post(tid, 'resume'),
  updateNotes: (tid: string, body: unknown) => post(tid, 'update-notes', body),
  // Retail sale (Jul 27, 2026): the picker list and the sale itself. The body names product + quantity only —
  // the server prices the line from the salon catalog.
  retailCatalog: (search?: string) => http<{ products: { productId: string; name: string; retailPriceCents: number }[] }>('/retail-catalog' + (search ? '?search=' + encodeURIComponent(search) : '')),
  addRetail: (tid: string, body: { productId: string; quantity?: number; technicianId?: string; managerPin?: string }) => post(tid, 'add-retail', body),   // B-19: managerPin allows a sale past the counted stock
  editService: (tid: string, serviceLineId: string, body: unknown) => http<any>('/tickets/' + id(tid) + '/services/' + id(serviceLineId), { method: 'PATCH', body: JSON.stringify(body) }),
  assignTechnician: (tid: string, body: unknown) => post(tid, 'assign-technician', body),
  assignHelper: (tid: string, body: unknown) => post(tid, 'assign-helper', body),
  markServiceDone: (tid: string) => post(tid, 'mark-service-done'),
  sendToServiceDone: (tid: string) => post(tid, 'send-to-service-done'),
  // Serving mandate (Oct 28 2026): an add-on SERVICE (priced from the catalog server-side; clientRequestId makes a double
  // tap / a second terminal one line), the guest status update (communications path), staff alert, balance recommendations
  addService: (tid: string, body: { serviceId: string; technicianId?: string; clientRequestId: string }) => post(tid, 'add-service', body),
  notifyCustomer: (tid: string, body: { channel: 'app' | 'sms'; kind: 'status' | 'running_late' | 'almost_done' | 'ready' }) => post(tid, 'notify-customer', body) as Promise<{ channel: string; configured: boolean; delivered: boolean; disabledReason?: string }>,
  staffAlert: (body: { technicianId: string; ticketId?: string; message: string }) => http<{ ok: true; technicianId: string }>('/staff-alert', { method: 'POST', body: JSON.stringify(body) }),
  balanceSuggestions: () => http<{ appliesAutomatically: false; suggestions: { ticketId: string; ticketNumber: string; customerName: string; fromTechnicianId?: string; fromTechnicianName?: string; toTechnicianId: string; toTechnicianName: string; reason: string }[] }>('/balance-suggestions'),
  reportDelay: (tid: string, body: unknown) => post(tid, 'report-delay', body),
  clearDelay: (tid: string, body: unknown) => post(tid, 'clear-delay', body),
};
export type { ServingFilters };
