// posAiBookingCenterApi.ts — A7 AI Booking Assistant guide (Nov 4 2026): the salon's operations center (pos/ai-booking):
// overview counts, request activity (search / filters / numbered pages), request detail, recovery cases, Check AI Booking
// System. Same-origin session; tenant / location / role come from the server.
import type { AibOverview, AibActivityPage, AibActivityRow, AibRequestDetail, AibRecoveryList, AibRecoveryCase, AibHealthRun, AibHealthCheck, AibHealthStatus, AibAlternatives } from '@aipowersalon/api-contracts/tenant';
import { posHttp } from './client';
export type { AibOverview, AibActivityPage, AibActivityRow, AibRequestDetail, AibRecoveryList, AibRecoveryCase, AibHealthRun, AibHealthCheck, AibHealthStatus, AibAlternatives };
export class ApiError extends Error { constructor(message: string, public status: number, public code?: string) { super(message); this.name = 'ApiError'; } }
const BASE = '/pos/ai-booking';
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => new ApiError(message, status, (body as { code?: string } | null)?.code) });
const qs = (f: Record<string, unknown>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
export interface AibActivityQuery { q?: string; status?: string; source?: string; technicianId?: string; basis?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }
const key = () => globalThis.crypto?.randomUUID?.() ?? `aib-${Date.now()}-${Math.random()}`;

export const posAiBookingCenterApi = {
  overview: (f: { preset?: string; from?: string; to?: string }) => http<AibOverview>('/overview' + qs(f)),
  activity: (f: AibActivityQuery) => http<AibActivityPage>('/activity' + qs(f as Record<string, unknown>)),
  detail: (requestId: string) => http<AibRequestDetail>('/requests/' + encodeURIComponent(requestId)),
  recovery: () => http<AibRecoveryList>('/recovery'),
  /** round 10 (AI Booking 14): audit the Support report download on the server (the file is handed out only after this) */
  recordSupportReport: (requestId: string) => http<{ recorded: boolean; requestId: string; at: string }>('/requests/' + encodeURIComponent(requestId) + '/support-report', { method: 'POST', headers: { 'Idempotency-Key': key() } }),
  dismiss: (caseKey: string, reason: string) => http<{ dismissed: boolean; key: string }>('/recovery/' + encodeURIComponent(caseKey) + '/dismiss', { method: 'POST', body: JSON.stringify({ reason }), headers: { 'Idempotency-Key': key() } }),
  /** guide §10 Review Alternative: POS Booking's real open times for the case day (nothing is held) */
  alternatives: (caseKey: string) => http<AibAlternatives>('/recovery/' + encodeURIComponent(caseKey) + '/alternatives'),
  /** guide §10 Request Manager Approval: one live request per case in POS Approvals */
  requestApproval: (caseKey: string, reason: string) => http<{ key: string; approval: unknown }>('/recovery/' + encodeURIComponent(caseKey) + '/request-approval', { method: 'POST', body: JSON.stringify({ reason }), headers: { 'Idempotency-Key': key() } }),
  lastHealth: () => http<{ run: AibHealthRun | null }>('/health'),
  runHealth: () => http<AibHealthRun>('/health/run', { method: 'POST' }),
};
