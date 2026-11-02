// posInventoryAlertsApi.ts — Stock Alerts + Technician Product Usage mandate (Oct 29 2026): POS Inventory → Stock Alerts
// (/tenant/inventory/stock-alerts*). The alert SET is the canonical live state the sidebar badge counts too; the usage
// ledger answers "Last Used By" (latest effective use by when it happened, never updated_at) and "every technician who used
// it". Recording a use is one idempotent request (Idempotency-Key per intent — a double tap or a retry records once); a
// correction is a signed adjustment with a reason (inventory.stock.adjust), never an edit.
import { api, posHttp } from './client';
type Q = Record<string, unknown>;
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string, public body?: any) { super(message); this.name = 'ApiError'; } }
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, body, message) => new ApiError(message, status, (body as { code?: string; error?: { code?: string } } | null)?.error?.code ?? (body as { code?: string } | null)?.code, body) });
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const enc = encodeURIComponent;
const B = '/tenant/inventory/stock-alerts';
export interface UsageInput { productId: string; quantity: string; technicianId?: string | null; occurredAt?: string | null; unitId?: string | null; serviceTicketId?: string | null; note?: string | null; onBehalfReason?: string | null; source?: 'front_desk' | 'scan' }
export const posInventoryAlertsApi = {
  summary: () => api.get<any>(`${B}/summary`),
  active: (q: Q) => api.get<any>(`${B}/active`, clean(q)),
  history: (q: Q) => api.get<any>(`${B}/history`, clean(q)),
  usage: (q: Q) => api.get<any>(`${B}/usage`, clean(q)),
  ledger: (productId: string, q: Q) => api.get<any>(`${B}/usage/products/${enc(productId)}`, clean(q)),
  technicians: (q: Q) => api.get<any>(`${B}/technicians`, clean(q)),
  pickers: (search?: string) => api.get<any>(`${B}/pickers`, clean({ search })),
  event: (eventId: string) => api.get<any>(`${B}/events/${enc(eventId)}`),
  acknowledge: (productId: string, note?: string | null) => api.post<any>(`${B}/active/${enc(productId)}/acknowledge`, note ? { note } : {}),
  record: (input: UsageInput, idempotencyKey: string) =>
    http<any>(`${B}/usage`, { method: 'POST', body: JSON.stringify(clean(input as unknown as Q)), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } }),
  adjust: (eventId: string, input: { delta: string; reason: string }, idempotencyKey: string) =>
    http<any>(`${B}/usage/${enc(eventId)}/adjustments`, { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } }),
  exportCsv: (q: Q) => api.exportAsync<string>(`${B}/export`, clean(q), 'text'),
};
