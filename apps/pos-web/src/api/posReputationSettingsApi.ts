// posReputationSettingsApi — AI Center → AI Review & Reputation → Settings (/pos/reputation-settings/*). Review & Reputation
// Settings guide (Nov 1 2026): the eight controls with their effective values and sources, the assistant's operational state
// (salon / branch switch, package + subscription), what actually runs, Save Changes (salon level, version-checked, recorded in
// history), the change history and the read-only Check Reputation Settings. Replaces the retired GET / PUT
// /pos/ai-review-reputation/settings.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export type ReputationSettingsValues = Partial<{ enabled: boolean; responseTone: string; approvalRequired: boolean; autoResponse: boolean; requestsEnabled: boolean; channel: string; delayMinutes: number; oneReminder: boolean }>;
export const posReputationSettingsApi = {
  state: () => api.get<any>(`/pos/reputation-settings/state`),
  save: (body: { values: ReputationSettingsValues; expectedVersion: number; reason?: string }) => api.post<any>(`/pos/reputation-settings/save`, body),
  history: (q: { q?: string; type?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/reputation-settings/history`, clean(q)),
  event: (id: string) => api.get<any>(`/pos/reputation-settings/history/${enc(id)}`),
  check: () => api.post<any>(`/pos/reputation-settings/check`, {}),
};
