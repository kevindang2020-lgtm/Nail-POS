// posPaymentGatewayApi.ts — read the tenant's payment-processor connection status (real, masked).
// Reuses GET /pos/payment-gateway/status (settings.view). Full credentials never leave the backend.
import { api } from "./client";
import type { MaskedPaymentGateway } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export const posPaymentGatewayApi = {
  status: () => api.get<MaskedPaymentGateway>(`/pos/payment-gateway/status`),
};
export type { MaskedPaymentGateway };
