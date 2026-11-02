// posAiBusinessSetupApi — AI Center → Business Setup (/pos/ai/business-setup/*). AI Business Setup guide (Oct 30 2026): readiness
// read from the canonical tables (raw vs eligible counts with exclusions; UNKNOWN instead of a false zero), the one-click
// non-mutating health check, the FAQ approval workflow (draft → review → approved; pending changes never overwrite live text;
// version + request key on every change), the read-only AI Knowledge Preview, scoped search, history and the Knowledge
// Assistant's suggestions. Tenant / branch come from the session.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export type FaqQuery = { q?: string; status?: string; category?: string; branch?: string; dateBasis?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
export type FaqAction = 'edit' | 'submit' | 'approve' | 'reject' | 'archive' | 'restore';
export const posAiBusinessSetupApi = {
  readiness: () => api.get<any>(`/pos/ai/business-setup/readiness`),
  health: () => api.get<any>(`/pos/ai/business-setup/health`),
  faqs: (q: FaqQuery) => api.get<any>(`/pos/ai/business-setup/faqs`, clean(q)),
  faq: (id: string) => api.get<any>(`/pos/ai/business-setup/faqs/${enc(id)}`),
  createFaq: (b: { question: string; answer: string; category?: string | null; branchScope?: 'all' | 'branch' | null; origin?: 'pos' | 'assistant' | null; idempotencyKey: string }) =>
    api.post<{ id: string; replayed: boolean }>(`/pos/ai/business-setup/faqs`, b),
  act: (id: string, b: { action: FaqAction; expectedVersion: number; question?: string | null; answer?: string | null; category?: string | null; reason?: string | null; idempotencyKey: string }) =>
    api.post<{ id: string; status: string; version: number; replayed: boolean }>(`/pos/ai/business-setup/faqs/${enc(id)}/actions`, b),
  preview: (question: string) => api.post<any>(`/pos/ai/business-setup/preview`, { question }),
  search: (q: { scope: string; q?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/business-setup/search`, clean(q)),
  history: (q: { basis?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/ai/business-setup/history`, clean(q)),
  assistant: () => api.get<any>(`/pos/ai/business-setup/assistant`),
};
