// posSplitPaymentsApi.ts — Split Payments mandate (Oct 29 2026): the READ side of Payments & Money → Split Payments
// (/pos/payments/split-payments*, pos.checkout.view; export pos.reports.export). One row per ticket, its tender breakdown
// on the row; the KPIs over the whole scope; server paging. Refunds stay on their Checkout routes (posCheckoutApi).
import { api } from "./client";
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const B = '/pos/payments/split-payments';
export const posSplitPaymentsApi = {
  list: (q: Q) => api.get<any>(`${B}/list`, clean(q)),
  summary: (q: Q) => api.get<any>(`${B}/summary`, clean(q)),
  registers: () => api.get<{ id: string; name: string }[]>(`${B}/registers`),
  detail: (ticketId: string) => api.get<any>(`${B}/${encodeURIComponent(ticketId)}/detail`),
  exportCsv: (q: Q) => api.exportAsync<string>(`${B}/export`, clean(q), 'text'),
};
