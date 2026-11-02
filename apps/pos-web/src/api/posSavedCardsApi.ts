// posSavedCardsApi.ts — POS-staff read-only view of a customer's saved cards (pos.customers.view).
import { api } from "./client";
import type { TopUpIntentList, TopUpIntentView, TopUpResult } from "@aipowersalon/api-contracts/customer";
const enc = encodeURIComponent;
export const posSavedCardsApi = {
  forCustomer: (customerId: string) => api.get<any>(`/pos/customers/${enc(customerId)}/payment-methods`),
  /** B-79 (Oct 23 2026): the customer's wallet top-ups — an UNKNOWN / PROCESSING one is a charge the processor did not confirm */
  topUps: (customerId: string) => api.get<TopUpIntentList>(`/pos/customers/${enc(customerId)}/wallet/top-ups`),
  /** asks the salon's processor for its record of the top-up and settles it — never charges the card */
  verifyTopUp: (customerId: string, intentId: string) => api.post<TopUpResult>(`/pos/customers/${enc(customerId)}/wallet/top-ups/${enc(intentId)}/verify`, {}),
};
export type WalletTopUp = TopUpIntentView;
