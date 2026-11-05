// posTurnQueueApi.ts — the technician TURN QUEUE client (Fair Turn Engine, wave 2). Same-origin; tenant / branch / actor
// come from the session cookie, never from the client. Wraps /pos/turn-queue/* (board, health, history, fairness, team
// report, technician summaries, manager actions, turn rules, settings preview), the fair-turn simulation and the turn
// settings save on the ONE versioned settings source (/pos/ai-queue-assignment/settings).
import { apiUrl } from './apiBase';   // API_ORIGIN + /api/v1 + path
import { api } from './client';
import type {
  TurnBoardResponse, TurnHealthResponse, TurnHistoryResponse, TurnFairnessResponse, TurnTeamReportResponse, TurnTechnicianSummaryResponse, TurnSettingsInfo,
  TurnSettingsPreview, TurnRulesResponse, TurnRuleSaveRequest, TurnRuleSaveResult, TurnRuleRetireResult, TurnCommandResult, TurnDayCloseResult, TurnSimulationRequest, TurnSimulationResponse, TurnAssignmentMode,
} from '@aipowersalon/api-contracts/tenant';
import { posHttp } from './client';

export class ApiError extends Error { constructor(message: string, public status: number, public code?: string, public body?: any) { super(message); this.name = 'ApiError'; } }
const BASE = apiUrl('/pos/turn-queue');
// Oct 21 2026: THE shared raw-fetch helper (client.ts posHttp) — X-Client-Type, timing, the 401 announcement; this module's own error mapping
const http = <T,>(path: string, init?: RequestInit) => posHttp<T>(BASE + path, init, { mapError: (status, body, message) => new ApiError(message, status, body && typeof body === 'object' ? body.code : undefined, body) });

const qs = (o: Record<string, string | number | boolean | undefined | null>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v != null && v !== '') p.set(k, String(v)); const s = p.toString(); return s ? '?' + s : ''; };
const id = (s: string) => encodeURIComponent(s);
const json = (b: unknown) => JSON.stringify(b ?? {});

export const posTurnQueueApi = {
  board: () => http<TurnBoardResponse>('/board'),
  /** §169–170 queue health (not the /health probe) */
  health: () => http<TurnHealthResponse>('/floor-health'),
  history: (f: { from?: string; to?: string; technicianId?: string; reasonCode?: string; eventType?: string; assignmentSource?: string; manualOnly?: boolean } = {}) => http<TurnHistoryResponse>(`/history${qs(f)}`),
  fairness: (f: { from?: string; to?: string } = {}) => http<TurnFairnessResponse>(`/fairness${qs(f)}`),
  teamReport: (f: { period?: 'day' | 'week' | 'month'; date?: string } = {}) => http<TurnTeamReportResponse>(`/reports/team${qs(f)}`),
  technicianSummary: (technicianId: string, f: { period?: 'day' | 'week' | 'month'; date?: string } = {}) => http<TurnTechnicianSummaryResponse>(`/technicians/${id(technicianId)}/summary${qs(f)}`),
  hold: (technicianId: string, reason: string) => http<TurnCommandResult>(`/technicians/${id(technicianId)}/hold`, { method: 'POST', body: json({ reason }) }),
  release: (technicianId: string, b: { reason?: string; toBack?: boolean } = {}) => http<TurnCommandResult>(`/technicians/${id(technicianId)}/release`, { method: 'POST', body: json(b) }),
  reorder: (technicianId: string, b: { setNext?: boolean; toBack?: boolean; beforeTechnicianId?: string; reason: string }) => http<TurnCommandResult>(`/technicians/${id(technicianId)}/reorder`, { method: 'POST', body: json(b) }),
  adjust: (technicianId: string, b: { turns: number | string; reason: string; queueItemId?: string }) => http<TurnCommandResult>(`/technicians/${id(technicianId)}/adjust`, { method: 'POST', body: json(b) }),
  join: (technicianId: string, reason?: string) => http<TurnCommandResult>(`/technicians/${id(technicianId)}/join`, { method: 'POST', body: json({ reason: reason ?? null }) }),
  customerDeclined: (b: { queueItemId: string; technicianId: string; reason?: string }) => http<TurnCommandResult>('/guest-declined', { method: 'POST', body: json(b) }),
  closeDay: (businessDate: string, reason?: string) => http<TurnDayCloseResult>('/day/close', { method: 'POST', body: json({ businessDate, reason: reason ?? null }) }),
  settings: () => http<TurnSettingsInfo>('/settings'),
  previewSettings: (b: { scope?: 'salon' | 'branch'; assignmentMode?: TurnAssignmentMode; fairnessMode?: string; turnPolicy?: Record<string, unknown> }) => http<TurnSettingsPreview>('/settings/preview', { method: 'POST', body: json(b) }),
  rules: (includeHistory = false) => http<TurnRulesResponse>(`/rules${qs({ includeHistory: includeHistory || undefined })}`),
  saveRule: (b: TurnRuleSaveRequest) => http<TurnRuleSaveResult>('/rules', { method: 'POST', body: json(b) }),
  retireRule: (ruleKey: string, reason: string) => http<TurnRuleRetireResult>(`/rules/${id(ruleKey)}/retire`, { method: 'POST', body: json({ reason }) }),
  /** the save goes to the ONE versioned settings source (salon or this location) */
  saveSettings: (b: { scope: 'salon' | 'branch'; patch: { assignmentMode?: TurnAssignmentMode; rotationPolicy?: string; turnPolicy?: Record<string, unknown> }; reason?: string }) =>
    api.put<any>(`/pos/ai-queue-assignment/settings`, b as unknown as Record<string, unknown>),
  /** §168: nothing on the floor changes */
  simulate: (b: TurnSimulationRequest) => api.post<TurnSimulationResponse>(`/pos/ai-queue-assignment/fair-turn/simulate`, b as unknown as Record<string, unknown>),
};
