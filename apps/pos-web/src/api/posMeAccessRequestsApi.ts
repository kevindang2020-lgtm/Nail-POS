// posMeAccessRequestsApi.ts — tenant self-service for the access-request workflow (§26). Calls the authenticated
// /me/access-requests endpoints; identity is derived server-side from the session, so nothing here sends a user id.
import { api } from './client';

import type { RequestableRolesResponse } from '@aipowersalon/api-contracts/tenant';
export type { RequestableRolesResponse };

export const posMeAccessRequestsApi = {
  listMine: () => api.get<{ rows: any[]; total: number }>('/me/access-requests'),
  /** batch 8 decision 6: the roles this user may request (server policy) */
  roles: () => api.get<RequestableRolesResponse>('/me/access-requests/roles'),
  create: (b: { requestedRole: string; reason: string; requestedDurationDays?: number | null }) =>
    api.post<{ id: string; status: string; highRisk: boolean }>('/me/access-requests', b),
  cancel: (id: string) => api.post<{ id: string; status: string }>(`/me/access-requests/${encodeURIComponent(id)}/cancel`, {}),
};
