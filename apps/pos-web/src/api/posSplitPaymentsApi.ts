// posSplitPaymentsApi.ts — split-tender payments (tickets settled with 2+ tenders). pos.checkout.view.
import { api } from "./client";
export const posSplitPaymentsApi = {
  state: () => api.get(`/pos/payments/split-payments/state`),
};
