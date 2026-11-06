// posAiCallsCenterApi — AI Center → AI Calls (/pos/ai/calls-center/*). AI Calls guide (Oct 31 2026): honest summary strip,
// server-side call history (search, status / outcome, salon-local From/To with a date basis, numbered pages, newest first),
// scoped search, the call overlay (opening it is audited), the read-only Check AI Calls System, reconciliation and the
// missed-call / unresolved assistant. Tenant / branch come from the session; nothing here sends, books or calls.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export type AicCallsQuery = { q?: string; status?: string; outcome?: string; dateBasis?: string; period?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number;
  agent?: string; direction?: string; minSeconds?: number; maxSeconds?: number };
export const posAiCallsCenterApi = {
  kpis: (q: { period?: string; from?: string; to?: string }) => api.get<any>(`/pos/ai/calls-center/kpis`, clean(q)),
  calls: (q: AicCallsQuery) => api.get<any>(`/pos/ai/calls-center/calls`, clean(q)),
  search: (q: { scope: string; q?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/calls-center/search`, clean(q)),
  call: (ref: string) => api.get<any>(`/pos/ai/calls-center/calls/${enc(ref)}`),
  health: () => api.post<any>(`/pos/ai/calls-center/health`, {}),
  lastHealth: () => api.get<any>(`/pos/ai/calls-center/health/last`),
  reconciliation: () => api.get<any>(`/pos/ai/calls-center/reconciliation`),
  assistant: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/calls-center/assistant`, clean(q)),
};
