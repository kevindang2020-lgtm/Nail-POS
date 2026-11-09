// posPaymentChannelsApi — Three Ways to Pay (Nov 9 2026): the three channels of this location and the open ticket's
// payment status (GET /pos/payment-channels), and the read-only Check Three Payment Channels. Nothing here takes money:
// the pay actions are the existing ones (Clover Compact via the workspace's card button, send-to-phone, send-app-payment).
import { api } from './client';
import type { PcResponse, PcCheckResponse } from '@aipowersalon/api-contracts/tenant';

export const posPaymentChannelsApi = {
  channels: (ticketId?: string | null) => api.get<PcResponse>('/pos/payment-channels', ticketId ? { ticketId } : {}),
  check: () => api.post<PcCheckResponse>('/pos/payment-channels/check', {}),
};
