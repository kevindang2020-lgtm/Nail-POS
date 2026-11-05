// posRefundsVoidsApi.ts — money-reversal visibility (refunds + voids). pos.checkout.view.
import { api } from "./client";
export const posRefundsVoidsApi = {
  state: () => api.get(`/pos/refunds-voids/state`),
};
