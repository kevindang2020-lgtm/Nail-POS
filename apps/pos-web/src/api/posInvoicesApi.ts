// posInvoicesApi.ts — salon customer invoices (/pos/invoices). Invoices mandate (Oct 29 2026): the one-screen page reads the
// server-paged list + scoped KPIs; money is recorded as payment entries (never a status toggle); void needs a reason.
// Read: pos.checkout.view. New / Send / Record Payment: pos.checkout.process_payment. Edit / Void / Link / Export: pos.checkout.void.
import { api } from "./client";
type Q = Record<string, unknown>;
const clean = (q: Q = {}) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const e = encodeURIComponent;
export const posInvoicesApi = {
  list: (q: Q) => api.get<any>(`/pos/invoices`, clean(q)),
  summary: (q: Q) => api.get<any>(`/pos/invoices/summary`, clean(q)),
  detail: (id: string) => api.get<any>(`/pos/invoices/${e(id)}/detail`),
  lookupCustomers: (search: string) => api.get<any>(`/pos/invoices/customers/lookup`, { search }),
  createInvoice: (b: Q) => api.post<any>(`/pos/invoices/new`, b),
  edit: (id: string, b: Q) => api.post<any>(`/pos/invoices/${e(id)}/edit`, b),
  send: (id: string) => api.post<any>(`/pos/invoices/${e(id)}/send`, {}),
  recordPayment: (id: string, b: { amountCents: number; paidOn: string; method: string; reference?: string; note?: string; idempotencyKey: string }) => api.post<any>(`/pos/invoices/${e(id)}/payments`, b),
  catalog: (search: string) => api.get<any>(`/pos/invoices/catalog`, search ? { search } : {}),
  deliver: (id: string, b: { channel: 'email' | 'sms'; idempotencyKey: string }) => api.post<any>(`/pos/invoices/${e(id)}/deliver`, b),
  void: (id: string, reason: string) => api.post<any>(`/pos/invoices/${e(id)}/void`, { reason }),
  credit: (id: string, b: { amountCents: number; reason: string; refundMethod?: string; refundReference?: string; idempotencyKey: string }) => api.post<any>(`/pos/invoices/${e(id)}/credit`, b),
  linkCustomer: (id: string, customerId: string, updateBillTo = false) => api.post<any>(`/pos/invoices/${e(id)}/link-customer`, { customerId, updateBillTo }),
  /** the invoice PDF (preview / print in the browser's PDF viewer, or a download) */
  pdf: (id: string, disposition: 'inline' | 'attachment' = 'inline') => api.exportAsync<Blob>(`/pos/invoices/${e(id)}/pdf`, { disposition }, 'blob'),
  exportCsv: (q: Q) => api.exportAsync<string>(`/pos/invoices/export`, clean(q), 'text'),
  // older routes
  state: () => api.get<any>(`/pos/invoices/state`),
  create: (body: Record<string, unknown>) => api.post(`/pos/invoices`, body),
  setStatus: (id: string, status: string) => api.post(`/pos/invoices/${e(id)}/status`, { status }),
};
