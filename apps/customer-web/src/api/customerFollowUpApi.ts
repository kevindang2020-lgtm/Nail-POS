// customerFollowUpApi.ts — Customer app client for the @Controller('customer/follow-ups') routes. Same-origin, session
// cookie; the server derives the customer from the session and only returns follow-ups that were actually sent to them.
// Reads are server-truth — screens render honest empty states, never mocks.
import type { RebookPreselect } from '@aipowersalon/api-contracts/customer';   // the wire contract (Constitution 13 §15)
import { api } from './client';

// The customer-visible projection of a follow-up's state (Constitution 13 §268) — deliberately NOT the salon's ten-state
// FollowUpStatus workflow. The API does not yet name this projection; when it does, import it from the customer realm.
export type CustomerFollowUpStatus = 'sent' | 'customer_replied' | 'rebooked';

export interface CustomerFollowUp {
  id: string; businessDate: string; status: CustomerFollowUpStatus;
  serviceName: string; serviceId: string | null; ticketId: string; technicianId: string; technicianName: string;
  completedAt: string | null; sentMessage: string | null; suggestedMessage: string; sentAt: string | null;
}

export const customerFollowUpApi = {
  list: () => api.get<CustomerFollowUp[]>('/customer/follow-ups'),
  get: (id: string) => api.get<CustomerFollowUp>(`/customer/follow-ups/${id}`),
  reply: (id: string, text: string) => api.post<CustomerFollowUp>(`/customer/follow-ups/${id}/reply`, { text }),
  rebook: (id: string) => api.post<RebookPreselect>(`/customer/follow-ups/${id}/rebook`, {}),
};
export type { RebookPreselect };
