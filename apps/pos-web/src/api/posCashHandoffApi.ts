// posCashHandoffApi.ts — End-of-day tech cash hand-off, POS surface (tech-cash-handoff.pos.controller). Same-origin,
import type { HandoffStatus, CashHandoff, HandoffLine, CashHandoffDetail } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// session cookie; tenant/branch/role derived server-side. The board lists each technician's collected cash so the
// front desk can count it and reconcile (reconciled when exact, discrepancy otherwise).
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { posHttp } from './client';
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
const id = (s: string) => encodeURIComponent(s);
const q = (date?: string) => (date ? `?date=${encodeURIComponent(date)}` : '');

export interface CashHandoffBoard { businessDate: string; technicians: CashHandoff[]; totalExpectedCents: number; totalCountedCents: number; technicianCount: number; reconciledCount: number; openCount: number; }

export const posCashHandoffApi = {
  state: (date?: string) => http<CashHandoffBoard>(`/pos/cash-handoffs${q(date)}`),
  detail: (techId: string, date?: string) => http<CashHandoffDetail>(`/pos/cash-handoffs/${id(techId)}${q(date)}`),
  reconcile: (techId: string, countedCents: number, notes?: string, date?: string) =>
    http<CashHandoffDetail>(`/pos/cash-handoffs/${id(techId)}/reconcile`, { method: 'POST', body: JSON.stringify({ countedCents, ...(notes ? { notes } : {}), ...(date ? { date } : {}) }) }),
};
export type { HandoffStatus };
export type { CashHandoff, HandoffLine, CashHandoffDetail };
