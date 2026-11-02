// posTransactionsApi.ts — Transactions mandate (Oct 29 2026): POS Payments & Money → Transactions (/pos/payments/transactions*,
// pos.checkout.view; export pos.reports.export). One row per tender from the ledger Checkout writes; the four KPIs over every
// matching tender (never the visible page); the detail with the whole ticket, refunds and the settlement only when linked.
// Refunds, voids and receipt resends go through the existing Checkout routes (posCheckoutApi). Nothing here charges a card.
import { api } from './client';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const B = '/pos/payments/transactions';
export const posTransactionsApi = {
  list: (q: Q) => api.get<any>(`${B}/list`, clean(q)),
  summary: (q: Q) => api.get<any>(`${B}/summary`, clean(q)),
  technicians: () => api.get<{ technicians: { id: string; name: string }[] }>(`${B}/technicians`),
  detail: (paymentId: string) => api.get<any>(`${B}/${encodeURIComponent(paymentId)}`),
  exportCsv: (q: Q) => api.exportAsync<string>(`${B}/export`, clean(q), 'text'),
};
