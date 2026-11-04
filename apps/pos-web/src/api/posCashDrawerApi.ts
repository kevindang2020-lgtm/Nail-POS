// posCashDrawerApi.ts — Front-desk cash drawer (register) reconciliation, POS surface (cash-drawer.pos.controller).
import type { DrawerState, DrawerStatus } from '@aipowersalon/api-contracts/tenant';
export type { DrawerState, DrawerStatus };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import type { CashMovement, MovementList } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
// Same-origin, session cookie; the drawer's branch is derived server-side from the session. Register cash excludes the
// Skip-the-Line cash-to-technician payments (those reconcile in End-of-Day Cash).
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { posHttp } from './client';
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
const idem = (key?: string) => (key ? { headers: { 'Idempotency-Key': key } } : {});
const q = (date?: string) => (date ? `?date=${encodeURIComponent(date)}` : '');



export const posCashDrawerApi = {
  state: (date?: string) => http<DrawerState>(`/pos/cash-drawer${q(date)}`),
  open: (openingFloatCents: number, date?: string, idempotencyKey?: string) => http<DrawerState>('/pos/cash-drawer/open', { method: 'POST', body: JSON.stringify({ openingFloatCents, ...(date ? { date } : {}) }), ...idem(idempotencyKey) }),
  reconcile: (countedCents: number, notes?: string, date?: string, idempotencyKey?: string) => http<DrawerState>('/pos/cash-drawer/reconcile', { method: 'POST', body: JSON.stringify({ countedCents, ...(notes ? { notes } : {}), ...(date ? { date } : {}) }), ...idem(idempotencyKey) }),
  movement: (direction: 'in' | 'out', amountCents: number, reason?: string, note?: string, date?: string, idempotencyKey?: string) => http<DrawerState>('/pos/cash-drawer/movement', { method: 'POST', body: JSON.stringify({ direction, amountCents, ...(reason ? { reason } : {}), ...(note ? { note } : {}), ...(date ? { date } : {}) }), ...idem(idempotencyKey) }),
  movements: (date?: string) => http<MovementList>(`/pos/cash-drawer/movements${q(date)}`),
  voidMovement: (movementId: string, date?: string) => http<DrawerState>('/pos/cash-drawer/movement/void', { method: 'POST', body: JSON.stringify({ movementId, ...(date ? { date } : {}) }) }),
};
export type { CashMovement, MovementList };
