// customerScheduleProposalsApi.ts — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): a salon asks the customer to approve a
// new time / technician for a booked appointment. The original appointment stays exactly as booked until the customer
// approves (and the salon applies it). Routes (customer session — agent B): GET /customer/schedule-proposals,
// POST /customer/schedule-proposals/:id/approve|reject { expectedVersion }. Shapes are the API's own contract.
import { api } from './client';
import type { CustomerScheduleProposal, CustomerScheduleProposalList, CustomerScheduleProposalResponse } from '@aipowersalon/api-contracts/customer';

export type { CustomerScheduleProposal };
/** still waiting for the customer's answer */
export const isPendingProposal = (p: Pick<CustomerScheduleProposal, 'status'>) => p.status === 'proposed' || p.status === 'customer_notified';
const enc = encodeURIComponent;

export const customerScheduleProposalsApi = {
  list: () => api.get<CustomerScheduleProposalList>('/customer/schedule-proposals').then((r) => (Array.isArray(r?.items) ? r.items : [])),
  approve: (id: string, expectedVersion: number) => api.post<CustomerScheduleProposalResponse>(`/customer/schedule-proposals/${enc(id)}/approve`, { expectedVersion }),
  reject: (id: string, expectedVersion: number) => api.post<CustomerScheduleProposalResponse>(`/customer/schedule-proposals/${enc(id)}/reject`, { expectedVersion }),
};
