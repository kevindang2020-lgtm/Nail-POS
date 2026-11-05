// posMeAccessRequestsApi.ts — tenant self-service for the access-request workflow (§26). Calls the authenticated
// /me/access-requests endpoints; identity is derived server-side from the session, so nothing here sends a user id.
import { api } from './client';

export const posMeAccessRequestsApi = {
  listMine: () => api.get<{ rows: any[]; total: number }>('/me/access-requests'),
  create: (b: { requestedRole: string; reason: string; requestedDurationDays?: number | null }) =>
    api.post<{ id: string; status: string; highRisk: boolean }>('/me/access-requests', b),
  cancel: (id: string) => api.post<{ id: string; status: string }>(`/me/access-requests/${encodeURIComponent(id)}/cancel`, {}),
};
