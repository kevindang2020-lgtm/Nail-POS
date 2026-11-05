// techFollowUpApi.ts — Technician client for the real @Controller('tech/follow-ups') routes. Same-origin, session
// cookie; the server derives the technician from the session (no ids sent from the client) and only ever returns this
// tech's own follow-ups. Reads are server-truth; the suggested message is a deterministic template the tech can edit.
import { api } from './client';
import type { FollowUpTaskView, FollowUpTemplateOption, TechStats } from '@aipowersalon/api-contracts/tenant';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { FollowUpStatus, FollowUpTaskView, FollowUpTemplateOption, TechStats } from '@aipowersalon/api-contracts/tenant';

export interface FollowUpListResult { tasks: FollowUpTaskView[]; stats: TechStats }

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const techFollowUpApi = {
  list: (params: { date?: string; status?: string } = {}) =>
    api.get<FollowUpListResult>('/tech/follow-ups', clean({ date: params.date, status: params.status })),
  today: () => api.get<FollowUpListResult>('/tech/follow-ups/today'),
  templates: () => api.get<FollowUpTemplateOption[]>('/tech/follow-ups/templates'),
  preview: (id: string, templateKey: string) => api.post<{ message: string; templateKey: string }>(`/tech/follow-ups/${id}/custom-message-preview`, { templateKey }),
  send: (id: string, message?: string) => api.post<FollowUpTaskView>(`/tech/follow-ups/${id}/send`, clean({ message })),
  skip: (id: string, reason?: string) => api.post<FollowUpTaskView>(`/tech/follow-ups/${id}/skip`, clean({ reason })),
  dismiss: (id: string) => api.post<FollowUpTaskView>(`/tech/follow-ups/${id}/dismiss`, {}),
  editMessage: (id: string, message: string) => api.patch<FollowUpTaskView>(`/tech/follow-ups/${id}/message`, { message }),
};
