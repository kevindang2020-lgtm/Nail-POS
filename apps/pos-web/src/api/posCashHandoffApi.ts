// posCashHandoffApi.ts — End-of-day tech cash hand-off, POS surface (tech-cash-handoff.pos.controller). Same-origin,
import type { HandoffStatus, CashHandoff, HandoffLine, CashHandoffDetail } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// session cookie; tenant/branch/role derived server-side. The board lists each technician's collected cash so the
// front desk can count it and reconcile (reconciled when exact, discrepancy otherwise).
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; } }
import { posHttp, api } from './client';
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, body, message) => new ApiError(message, status, (body as { code?: string } | null)?.code) });
const id = (s: string) => encodeURIComponent(s);
const q = (date?: string) => (date ? `?date=${encodeURIComponent(date)}` : '');

export interface CashHandoffBoard { businessDate: string; technicians: CashHandoff[]; totalExpectedCents: number; totalCountedCents: number; technicianCount: number; reconciledCount: number; openCount: number; }

type Q = Record<string, unknown>;
const qs = (q: Q) => { const e = Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''); return e.length ? '?' + e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : ''; };
const B = '/pos/payments/cash-handoffs';
/** End-of-Day Cash (Oct 29 2026): one count — the whole unit, or (mode 'add') one partial hand-off; the version the counter saw
 *  (a stale one is refused, 409 HANDOFF_VERSION_CONFLICT); one idempotency key per submission (a double tap is one count). */
export interface CashCountInput { countedCents: number; notes?: string; date?: string; mode?: 'replace' | 'add'; denominations?: { denominationCents: number; quantity: number }[] | null; expectedVersion?: number | null; idempotencyKey?: string; transferToDrawer?: boolean; registerId?: string }

export const posCashHandoffApi = {
  /** the legacy one-day board (kept for the shell's client-type check; the screen reads the paged routes below) */
  state: (date?: string) => http<CashHandoffBoard>(`/pos/cash-handoffs${q(date)}`),
  detail: (techId: string, date?: string) => http<CashHandoffDetail>(`/pos/cash-handoffs/${id(techId)}${q(date)}`),
  // the End-of-Day Cash read model (pos.checkout.view; export pos.reports.export)
  list: (query: Q) => http<any>(`${B}/list${qs(query)}`),
  summary: (query: Q) => http<any>(`${B}/summary${qs(query)}`),
  technicians: () => http<{ id: string; name: string; active: boolean }[]>(`${B}/technicians`),
  unit: (techId: string, businessDate: string) => http<any>(`${B}/${id(techId)}/${id(businessDate)}/detail`),
  exportCsv: (query: Q) => api.exportAsync<string>(`${B}/export`, Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')), 'text'),
  // writes (workforce routes): count / partial / recount, and a manager's resolution of a difference
  reconcile: (techId: string, input: CashCountInput) =>
    http<CashHandoffDetail & { result: { status: HandoffStatus; varianceCents: number; version: number; eventId: string | null; drawerMovementId: string | null; replayed: boolean } }>(`/pos/cash-handoffs/${id(techId)}/reconcile`, { method: 'POST', body: JSON.stringify(input), headers: input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {} }),
  /** End-of-Day Cash 17: reopen a closed (reconciled) count with a reason — owner / manager (cash_handoff.reopen); figures kept */
  reopen: (techId: string, body: { reason: string; date: string; expectedVersion?: number | null }, idempotencyKey?: string) =>
    http<CashHandoffDetail>(`/pos/cash-handoffs/${id(techId)}/reopen`, { method: 'POST', body: JSON.stringify(body), headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
  resolve: (techId: string, body: { reason: string; date: string; expectedVersion?: number | null }, idempotencyKey?: string) =>
    http<CashHandoffDetail>(`/pos/cash-handoffs/${id(techId)}/resolve`, { method: 'POST', body: JSON.stringify(body), headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }),
};
export type { HandoffStatus };
export type { CashHandoff, HandoffLine, CashHandoffDetail };
