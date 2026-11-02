// posCustomerAiSettingsApi — AI Center → Customer Profile → Settings (/pos/customer-ai-settings/*). Customer AI Settings guide
// (Nov 1 2026): the effective state with provenance (thresholds, salon / branch / user switches, package + subscription,
// propagation to the evaluations), the salon-level writes (Disable / Enable, thresholds, reset — version-checked, recorded in
// history), a read-only impact preview, change history and the read-only Check Customer AI System.
import { api } from './client';
const enc = encodeURIComponent;
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export type CustomerAiThresholds = Partial<Record<'minVisitsForServicePref' | 'minVisitsForTechPref' | 'minVisitsForCadence' | 'inactiveDays' | 'longTermInactiveDays', number>>;
export const posCustomerAiSettingsApi = {
  state: () => api.get<any>(`/pos/customer-ai-settings/state`),
  setAssistant: (body: { enabled: boolean; expectedVersion: number; reason?: string }) => api.post<any>(`/pos/customer-ai-settings/assistant`, body),
  setThresholds: (body: { values?: CustomerAiThresholds; reset?: boolean; expectedVersion: number; reason?: string }) => api.post<any>(`/pos/customer-ai-settings/thresholds`, body),
  preview: (values: CustomerAiThresholds) => api.post<any>(`/pos/customer-ai-settings/preview`, { values }),
  history: (q: { q?: string; type?: string; preset?: string; from?: string; to?: string; page?: number; pageSize?: number }) => api.get<any>(`/pos/customer-ai-settings/history`, clean(q)),
  event: (id: string) => api.get<any>(`/pos/customer-ai-settings/history/${enc(id)}`),
  check: () => api.post<any>(`/pos/customer-ai-settings/check`, {}),
};
