// customerInvoicesApi.ts — the customer's own invoices (same-origin, session cookie; server derives the
// customer). List returns sent + paid invoices; pay settles a 'sent' one in-app (skip-line style).
import { api } from './client';

export interface CustomerInvoice {
  id: string; invoiceNumber: string; status: string; issueDate: string; dueDate: string | null;
  subtotalCents: number; taxCents: number; totalCents: number; notes: string | null;
}
export interface CustomerInvoicesResponse {
  kpis: { total: number; draft: number; sent: number; paid: number; outstandingCents: number; paidCents: number };
  invoices: CustomerInvoice[];
}
export const customerInvoicesApi = {
  list: () => api.get<CustomerInvoicesResponse>('/customer/invoices'),
  pay: (id: string) => api.post<CustomerInvoice>(`/customer/invoices/${encodeURIComponent(id)}/pay`),
};
