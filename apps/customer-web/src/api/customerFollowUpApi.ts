// customerFollowUpApi.ts — Customer app client for the @Controller('customer/follow-ups') routes. Same-origin, session
// cookie; the server derives the customer from the session and only returns follow-ups that were actually sent to them.
// Reads are server-truth — screens render honest empty states, never mocks.
import { api } from './client';
import type { RebookPreselect } from '@aipowersalon/api-contracts/customer';
import type { FollowUpStatus } from '@aipowersalon/api-contracts';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { RebookPreselect } from '@aipowersalon/api-contracts/customer';
export type { FollowUpStatus } from '@aipowersalon/api-contracts';

export interface CustomerFollowUp {
  id: string; businessDate: string; status: FollowUpStatus;
  serviceName: string; serviceId: string | null; ticketId: string; technicianId: string; technicianName: string;
  completedAt: string | null; sentMessage: string | null; suggestedMessage: string; sentAt: string | null;
}
export const customerFollowUpApi = {
  list: () => api.get<CustomerFollowUp[]>('/customer/follow-ups'),
  get: (id: string) => api.get<CustomerFollowUp>(`/customer/follow-ups/${id}`),
  reply: (id: string, text: string) => api.post<CustomerFollowUp>(`/customer/follow-ups/${id}/reply`, { text }),
  rebook: (id: string) => api.post<RebookPreselect>(`/customer/follow-ups/${id}/rebook`, {}),
};
