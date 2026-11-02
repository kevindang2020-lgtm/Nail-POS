// posAiFrontDeskApi — AI Center → AI Front Desk (/pos/ai/front-desk/*). AI Front Desk guide (Oct 31 2026): the agent directory
// (server search / filters / salon-local From–To / numbered pages, newest first), the persisted 8-step Create Agent wizard
// (version-checked Save Draft), the agent profile overlay, owner-approved activation with a preflight, pause / resume /
// archive / restore / rollback, the read-only checks and the live routing monitor. Tenant / branch come from the session.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export type FdAgentsQuery = { status?: string; q?: string; branchId?: string; dateBasis?: string; period?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
export type FdSave = { expectedVersion: number; step: number; markDone?: boolean; name?: string; description?: string | null; branchId?: string | null; greeting?: string; behavior?: string;
  useCase?: string; callType?: string; bookingMode?: 'handoff_only' | 'eligible'; handoffDestination?: string | null; afterHoursMessage?: string | null };
export type FdAction = { expectedVersion: number; reason?: string | null; idempotencyKey: string; confirm?: boolean };
export const posAiFrontDeskApi = {
  summary: () => api.get<any>(`/pos/ai/front-desk/summary`),
  agents: (q: FdAgentsQuery) => api.get<any>(`/pos/ai/front-desk/agents`, clean(q)),
  create: (b: { name: string; description?: string | null; branchId?: string | null; idempotencyKey: string }) => api.post<any>(`/pos/ai/front-desk/agents`, b),
  detail: (id: string) => api.get<any>(`/pos/ai/front-desk/agents/${enc(id)}`),
  wizard: (id: string) => api.get<any>(`/pos/ai/front-desk/agents/${enc(id)}/wizard`),
  save: (id: string, b: FdSave) => api.patch<any>(`/pos/ai/front-desk/agents/${enc(id)}`, b),
  duplicate: (id: string, idempotencyKey: string) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/duplicate`, { idempotencyKey }),
  calls: (id: string, q: { q?: string; period?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/front-desk/agents/${enc(id)}/calls`, clean(q)),
  preview: (id: string) => api.get<any>(`/pos/ai/front-desk/agents/${enc(id)}/activation/preview`),
  activate: (id: string, b: FdAction) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/activate`, b),
  pause: (id: string, b: FdAction) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/pause`, b),
  resume: (id: string, b: FdAction) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/resume`, b),
  archive: (id: string, b: FdAction) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/archive`, b),
  restore: (id: string, b: FdAction) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/restore`, b),
  rollback: (id: string, b: FdAction) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/rollback`, b),
  agentHealth: (id: string) => api.post<any>(`/pos/ai/front-desk/agents/${enc(id)}/health`, {}),
  health: () => api.post<any>(`/pos/ai/front-desk/health`, {}),
  monitor: () => api.get<any>(`/pos/ai/front-desk/monitor`),
  events: (q: { agentId?: string; action?: string; period?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/front-desk/events`, clean(q)),
};
