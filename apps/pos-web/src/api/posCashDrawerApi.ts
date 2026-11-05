// posCashDrawerApi.ts — Front-desk cash drawer (register) reconciliation, POS surface (cash-drawer.pos.controller).
import type { DrawerState, DrawerStatus } from '@aipowersalon/api-contracts/tenant';
export type { DrawerState, DrawerStatus };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import type { CashMovement, MovementList, DrawerRegister, DrawerRegisterList } from '@aipowersalon/api-contracts/tenant';
export type { DrawerRegister };   // the wire contract (Constitution 13 §15)
// Same-origin, session cookie; the drawer's branch is derived server-side from the session. Register cash excludes the
// Skip-the-Line cash-to-technician payments (those reconcile in End-of-Day Cash).
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { posHttp } from './client';
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
const idem = (key?: string) => (key ? { headers: { 'Idempotency-Key': key } } : {});



// D15 (Nov 4 2026): every call names its register ('main' = cash with no register); omitted = 'main'.
const rq = (date?: string, registerId?: string) => { const p = new URLSearchParams(); if (date) p.set('date', date); if (registerId && registerId !== 'main') p.set('registerId', registerId); const s = p.toString(); return s ? `?${s}` : ''; };
const reg = (registerId?: string) => (registerId && registerId !== 'main' ? { registerId } : {});

export const posCashDrawerApi = {
  registers: () => http<DrawerRegisterList>('/pos/cash-drawer/registers'),
  state: (date?: string, registerId?: string) => http<DrawerState>(`/pos/cash-drawer${rq(date, registerId)}`),
  open: (openingFloatCents: number, date?: string, idempotencyKey?: string, registerId?: string) => http<DrawerState>('/pos/cash-drawer/open', { method: 'POST', body: JSON.stringify({ openingFloatCents, ...(date ? { date } : {}), ...reg(registerId) }), ...idem(idempotencyKey) }),
  // D15 gaps (Nov 5 2026): `extra` carries the expected cash the counter was shown (version check) and the bill / coin breakdown
  reconcile: (countedCents: number, notes?: string, date?: string, idempotencyKey?: string, registerId?: string, extra: { expectedCashCents?: number; denominations?: Record<string, number> } = {}) => http<DrawerState>('/pos/cash-drawer/reconcile', { method: 'POST', body: JSON.stringify({ countedCents, ...(notes ? { notes } : {}), ...(date ? { date } : {}), ...reg(registerId), ...(extra.expectedCashCents != null ? { expectedCashCents: extra.expectedCashCents } : {}), ...(extra.denominations ? { denominations: extra.denominations } : {}) }), ...idem(idempotencyKey) }),
  approve: (note: string, date?: string, idempotencyKey?: string, registerId?: string) => http<DrawerState>('/pos/cash-drawer/approve', { method: 'POST', body: JSON.stringify({ note, ...(date ? { date } : {}), ...reg(registerId) }), ...idem(idempotencyKey) }),
  history: (q: { from?: string; to?: string; status?: string; q?: string; registerId?: string; page?: number; pageSize?: number }) => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && !(k === 'registerId' && v === 'main')) p.set(k, String(v));
    return http<DrawerHistory>(`/pos/cash-drawer/history${p.toString() ? '?' + p.toString() : ''}`);
  },
  movement: (direction: 'in' | 'out', amountCents: number, reason?: string, note?: string, date?: string, idempotencyKey?: string, registerId?: string) => http<DrawerState>('/pos/cash-drawer/movement', { method: 'POST', body: JSON.stringify({ direction, amountCents, ...(reason ? { reason } : {}), ...(note ? { note } : {}), ...(date ? { date } : {}), ...reg(registerId) }), ...idem(idempotencyKey) }),
  movements: (date?: string, registerId?: string) => http<MovementList>(`/pos/cash-drawer/movements${rq(date, registerId)}`),
  voidMovement: (movementId: string, date?: string, registerId?: string) => http<DrawerState>('/pos/cash-drawer/movement/void', { method: 'POST', body: JSON.stringify({ movementId, ...(date ? { date } : {}), ...reg(registerId) }) }),
};
export type { CashMovement, MovementList };
export interface DrawerHistoryRow { businessDate: string; registerId: string; register: string | null; status: string; openingFloatCents: number; expectedCashCents: number | null; countedCents: number | null; varianceCents: number | null;
  countedAt: string | null; countedBy: string | null; notes: string | null; approvalRequired: boolean; approvedAt: string | null; approvedBy: string | null; approvalNote: string | null; denominations: Record<string, number> | null }
export interface DrawerHistory { items: DrawerHistoryRow[]; total: number; page: number; pageSize: number; pages: number }
