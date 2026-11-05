// customerAppApi.ts — STEP 2 module client (pattern: posCheckoutApi). No mock data; use isEmptyState() for empties.
import { api } from "./client";
export const customerAppApi = {
  appointments: () => api.get(`/customer/appointments`),
  receipts: () => api.get(`/customer/receipts`),
  loyalty: () => api.get(`/customer/loyalty`),
};
