// customerQueueApi.ts — BUILD_PLAN Phase 6 (ai_queue_assignment): the guest agrees to another technician when the one
// they asked for is busy — `POST customer/queue/:queueItemId/accept-alternate { technicianId }` (agent A's route; the
// server records it in the queue history with source 'customer'; 409 when that technician was just taken). The audit's
// UI row "Customer / kiosk: no alternate-technician approval".
//
// GET /customer/queue (CustomerQueueState) carries `requestedTechnician { technicianId, name, busy, availableInMinutes }`
// and `alternates` (only when the requested one is busy). Types are the API's own contract — never re-declared here.
// Only technician names — never another guest.
import { api } from './client';
import type { CustomerQueueState, CustomerAcceptAlternateResponse } from '@aipowersalon/api-contracts/customer';

export type QueueTechnicianChoice = NonNullable<CustomerQueueState['alternates']>[number];
export type { CustomerAcceptAlternateResponse };

export const customerQueueApi = {
  acceptAlternate: (queueItemId: string, technicianId: string) =>
    api.post<CustomerAcceptAlternateResponse>(`/customer/queue/${encodeURIComponent(queueItemId)}/accept-alternate`, { technicianId }),
};
