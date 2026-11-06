// posAiReceptionistCenterApi — AI Center → AI Receptionist (/pos/ai/receptionist-center/*). AI Receptionist guide (Oct 31 2026):
// evidence-based readiness (a saved credential is never "connected"), the read-only Check AI Receptionist System, the five
// original KPI cards with a period, server-side call history / scoped search with salon-local From/To and numbered pages,
// the call overlay, the priority worklist (prepare → owner/manager confirm) and the per-salon controls (arm booking,
// verify the test call, activate) — every change version-checked with a request key. Tenant / branch come from the session.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export type RcCallsQuery = { q?: string; status?: string; outcome?: string; dateBasis?: string; period?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number;
  agent?: string; service?: string; direction?: string; minSeconds?: number; maxSeconds?: number };
export type RcControlAction = 'arm_booking' | 'disarm_booking' | 'verify_test_call' | 'clear_test_call' | 'activate' | 'deactivate';
export const posAiReceptionistCenterApi = {
  readiness: () => api.get<any>(`/pos/ai/receptionist-center/readiness`),
  health: () => api.post<any>(`/pos/ai/receptionist-center/health`, {}),
  lastHealth: () => api.get<any>(`/pos/ai/receptionist-center/health/last`),
  kpis: (q: { period?: string; from?: string; to?: string }) => api.get<any>(`/pos/ai/receptionist-center/kpis`, clean(q)),
  calls: (q: RcCallsQuery) => api.get<any>(`/pos/ai/receptionist-center/calls`, clean(q)),
  search: (q: { scope: string; q?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/receptionist-center/search`, clean(q)),
  call: (ref: string) => api.get<any>(`/pos/ai/receptionist-center/calls/${enc(ref)}`),
  priority: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/receptionist-center/priority`, clean(q)),
  prepare: (b: { sourceType: 'call' | 'handoff'; sourceRef: string; kind: 'create_follow_up'; reason?: string | null; idempotencyKey: string }) => api.post<any>(`/pos/ai/receptionist-center/actions`, b),
  decide: (id: string, b: { decision: 'confirm' | 'cancel'; expectedVersion: number; reason?: string | null }) => api.post<any>(`/pos/ai/receptionist-center/actions/${enc(id)}/decision`, b),
  control: (b: { action: RcControlAction; expectedVersion: number; reason?: string | null; providerCallRef?: string | null; idempotencyKey: string }) => api.post<any>(`/pos/ai/receptionist-center/control`, b),
  controlHistory: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/receptionist-center/control/history`, clean(q)),
};
