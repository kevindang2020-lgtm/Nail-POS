// posBirthdaysApi — Marketing & Growth → Birthday Campaigns (/pos/birthdays/*). Birthday Campaigns guide (Oct 31 2026):
// server-side KPIs, the birthday table (scope / range / basis / search / eligibility / sort / pages), the Missing Birthdays
// Center (read-only), the authorized overlay, the role-gated birthday edit, the Feb 29 policy, the message history and the
// Smart Birthday Campaign Assistant (an UNSENT draft in Campaign Center — nothing here sends). Tenant/branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type BirthdayQuery = { scope?: string; preset?: string; month?: number; from?: string; to?: string; basis?: string; q?: string; eligibility?: string; tier?: string; sort?: string; page?: number; pageSize?: number; activity?: string; source?: string };
export type AssistantInput = { objective: 'greeting' | 'service_promotion' | 'loyalty_reward'; channel: 'sms' | 'email'; preset?: string; month?: number; from?: string; to?: string; dealId?: string | null; templateId?: string | null };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posBirthdaysApi = {
  summary: (q: Pick<BirthdayQuery, 'preset' | 'month' | 'from' | 'to'>) => api.get<any>(`/pos/birthdays/summary`, clean(q)),
  customers: (q: BirthdayQuery) => api.get<any>(`/pos/birthdays/customers`, clean(q)),
  missing: () => api.get<any>(`/pos/birthdays/missing`),
  history: (q: { q?: string; page?: number; pageSize?: number; year?: number; from?: string; to?: string }) => api.get<any>(`/pos/birthdays/history`, clean(q)),
  settings: () => api.get<any>(`/pos/birthdays/settings`),
  saveSettings: (b: { feb29Policy: 'feb28' | 'mar1'; expectedVersion: number }) => api.put<any>(`/pos/birthdays/settings`, b),
  customer: (id: string) => api.get<any>(`/pos/birthdays/customers/${enc(id)}`),
  updateBirthday: (id: string, b: { birthday: string | null; expectedVersion: number }) => api.put<any>(`/pos/birthdays/customers/${enc(id)}/birthday`, b),
  plan: (b: AssistantInput) => api.post<any>(`/pos/birthdays/assistant/plan`, clean(b)),
  save: (b: AssistantInput & { name?: string; message?: string; emailSubject?: string; idempotencyKey: string }) => api.post<any>(`/pos/birthdays/assistant/save`, clean(b)),
};
