// posInvoicesApi.ts — salon customer invoices. Read: pos.checkout.view. Write: pos.checkout.process_payment.
import { api } from "./client";
export const posInvoicesApi = {
  state: () => api.get<any>(`/pos/invoices/state`),
  create: (body: Record<string, unknown>) => api.post(`/pos/invoices`, body),
  setStatus: (id: string, status: string) => api.post(`/pos/invoices/${encodeURIComponent(id)}/status`, { status }),
};
