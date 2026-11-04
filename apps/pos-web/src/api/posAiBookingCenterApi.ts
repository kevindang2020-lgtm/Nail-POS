// posAiBookingCenterApi.ts — A7 AI Booking Assistant guide (Nov 4 2026): the salon's operations center (pos/ai-booking):
// overview counts, request activity (search / filters / numbered pages), request detail, recovery cases, Check AI Booking
// System. Same-origin session; tenant / location / role come from the server.
import type { AibOverview, AibActivityPage, AibActivityRow, AibRequestDetail, AibRecoveryList, AibRecoveryCase, AibHealthRun, AibHealthCheck, AibHealthStatus } from '@aipowersalon/api-contracts/tenant';
import { posHttp } from './client';
export type { AibOverview, AibActivityPage, AibActivityRow, AibRequestDetail, AibRecoveryList, AibRecoveryCase, AibHealthRun, AibHealthCheck, AibHealthStatus };
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; } }
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>('/pos/ai-booking' + path, init, { mapError: (status, body, message) => new ApiError(message, status, (body as { code?: string } | null)?.code) });
const qs = (f: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
export interface AibActivityQuery { q?: string; status?: string; source?: string; technicianId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }
const key = () => globalThis.crypto?.randomUUID?.() ?? `aib-${Date.now()}-${Math.random()}`;

export const posAiBookingCenterApi = {
  overview: (f: { preset?: string; from?: string; to?: string }) => http<AibOverview>('/overview' + qs(f)),
  activity: (f: AibActivityQuery) => http<AibActivityPage>('/activity' + qs(f as Record<string, unknown>)),
  detail: (requestId: string) => http<AibRequestDetail>('/requests/' + encodeURIComponent(requestId)),
  recovery: () => http<AibRecoveryList>('/recovery'),
  dismiss: (caseKey: string, reason: string) => http<{ dismissed: boolean; key: string }>('/recovery/' + encodeURIComponent(caseKey) + '/dismiss', { method: 'POST', body: JSON.stringify({ reason }), headers: { 'Idempotency-Key': key() } }),
  lastHealth: () => http<{ run: AibHealthRun | null }>('/health'),
  runHealth: () => http<AibHealthRun>('/health/run', { method: 'POST' }),
};
