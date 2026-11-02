// posFollowUpApi.ts — manager/POS client for the real @Controller('pos/follow-ups') routes (all gated by customers.edit
// and scoped to the manager's own tenant + branch server-side). Shared cookie `api` client; the backend resolves
// tenant/branch from the session — the client never sends them.
import type { FollowUpSettings, FollowUpStatus, FollowUpTaskView, GenerateResult, TechStats } from '@aipowersalon/api-contracts/tenant';
export type { FollowUpSettings, FollowUpStatus, FollowUpTaskView, GenerateResult, TechStats };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';


export interface FollowUpListResult { tasks: FollowUpTaskView[]; stats: TechStats }

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const posFollowUpApi = {
  list: (params: { date?: string; technicianId?: string; status?: string } = {}) =>
    api.get<FollowUpListResult>('/pos/follow-ups', clean({ date: params.date, technicianId: params.technicianId, status: params.status })),
  generateNow: () => api.post<GenerateResult>('/pos/follow-ups/generate-now', {}),
  send: (id: string, message?: string) => api.post<FollowUpTaskView>(`/pos/follow-ups/${id}/send`, clean({ message })),
  approve: (id: string, message?: string) => api.post<FollowUpTaskView>(`/pos/follow-ups/${id}/approve`, clean({ message })),
  skip: (id: string, reason?: string) => api.post<FollowUpTaskView>(`/pos/follow-ups/${id}/skip`, clean({ reason })),
  getSettings: () => api.get<FollowUpSettings>('/pos/follow-ups/settings'),
  saveSettings: (patch: Partial<FollowUpSettings>) => api.patch<FollowUpSettings>('/pos/follow-ups/settings', patch as Record<string, unknown>),
};
