// posAiUsageApi.ts — AI packages: the tenant's AI subscriptions + real usage (from ai_usage_logs).
// Reuses the tenant/ai backend. Read + subscription actions (start trial / cancel) require ai.manage.
import { api } from "./client";
const enc = encodeURIComponent;
// posAiUsageApi.packages / startTrial / cancel were retired Nov 2 2026: every add-on page reads the honest package state from
// posAiUsageScreenApi.detail and uses its audited, idempotent trial / cancel (AI OCR Receipt Scanner guide).


// AI Usage & Limits Complete Build Guide (Oct 30 2026): `/tenant/ai/usage-screen/*` — the honest package states, 8-card
// pages, one-click details, verified monthly cost, 80 / 90 / 100 % alerts, usage history + audited export.
type Q = Record<string, string | number | undefined>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));
const US = '/tenant/ai/usage-screen';
export const posAiUsageScreenApi = {
  summary: () => api.get<any>(`${US}/summary`),
  packages: (q: Q) => api.get<any>(`${US}/packages`, clean(q)),
  detail: (code: string) => api.get<any>(`${US}/packages/${enc(code)}`),
  history: (q: Q) => api.get<any>(`${US}/history`, clean(q)),
  exportHistory: (q: Q) => api.exportAsync<string>(`${US}/history/export`, clean(q), 'text'),
  startTrial: (code: string, b: { idempotencyKey: string; confirm: boolean }) => api.post<any>(`${US}/packages/${enc(code)}/trial`, b),
  cancel: (code: string, b: { idempotencyKey: string; confirm: boolean; expectedStatus?: string | null }) => api.post<any>(`${US}/packages/${enc(code)}/cancel`, b as Record<string, unknown>),
  acknowledge: (id: string) => api.post<any>(`${US}/alerts/${enc(id)}/acknowledge`, {}),
  // Four-Module Completion Guide (Oct 30 2026): AI-02 branch override · AI-01 read-only invoice re-check (never charges)
  setBranch: (code: string, branchId: string, b: { overrideEnabled: boolean | null; settings: Record<string, boolean>; expectedVersion: number; reason?: string | null }) =>
    api.put<any>(`${US}/packages/${enc(code)}/branches/${enc(branchId)}`, b as Record<string, unknown>),
  reconcileInvoices: (b: { idempotencyKey: string }) => api.post<any>(`${US}/billing/reconcile`, b),
};
