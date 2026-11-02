// posPaymentsApi.ts — POS Payments client (money surfaces). Reads are permission-gated server-side.
import { api } from "./client";
export const posPaymentsApi = {
  overview: () => api.get(`/pos/payments/overview`),
  reconciliation: (q?: Record<string, unknown>) => api.get(`/pos/payments/reconciliation`, q),
};
