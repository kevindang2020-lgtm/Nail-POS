// posSkipLineApi.ts — Skip-the-Line Checkout, POS surface (pos-skip-line.controller). Same-origin, /pos-direct,
// tenant/branch/role from session. Lets the front desk monitor app/cash payments and resend/cancel/move-to-front-desk.
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; } }
import { posHttp } from './client';
import type { AppPaymentVerifyResponse } from '@aipowersalon/api-contracts/tenant';
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(path, init, { mapError: (status, _body, message) => new ApiError(message, status) });
const id = (s: string) => encodeURIComponent(s);
const tPost = (tid: string, action: string) => http<any>(`/pos/tickets/${id(tid)}/${action}`, { method: 'POST', body: JSON.stringify({}) });

export interface SkipLineStateItem { intentId: string; ticketId: string; ticketNumber: string; customerName: string; method: string; status: string; amountCents: number;
  /** B-80 (Oct 23 2026): the card WAS sent to the processor and its answer is not back — offer Verify, never "pay again" */
  unsettled?: boolean; chargeStartedAt?: string | null; failureReason?: string | null; }

export const posSkipLineApi = {
  state: () => http<{ items: SkipLineStateItem[] }>(`/pos/checkout/skip-line/state`),
  paymentStatus: (tid: string) => http<any>(`/pos/tickets/${id(tid)}/payment-status`),
  sendAppPayment: (tid: string) => tPost(tid, 'send-app-payment'),
  cancelAppPayment: (tid: string) => tPost(tid, 'cancel-app-payment'),
  moveToFrontDesk: (tid: string) => tPost(tid, 'move-to-front-desk-checkout'),
  /** asks the salon's processor for its record of the app charge and settles it — never charges the card */
  verifyAppPayment: (tid: string) => http<AppPaymentVerifyResponse>(`/pos/tickets/${id(tid)}/verify-app-payment`, { method: 'POST', body: JSON.stringify({}) }),
};
