// posMoneyOverviewApi.ts — Payments & Money mandate (Oct 29 2026): POS Payments & Money → Overview (/pos/payments/money/*,
// pos.reports.view). Every figure carries its scope (the chosen period · as of now · all time) and definition; the Transactions
// workspace reads posTransactionsApi. Rendering never moves money — the Quick Actions open their own guarded workflows.
import { api } from './client';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const B = '/pos/payments/money';
export const posMoneyOverviewApi = {
  overview: (q: Q) => api.get<any>(`${B}/overview`, clean(q)),
  services: (q: Q) => api.get<any>(`${B}/services`, clean(q)),
  payouts: (q: Q) => api.get<any>(`${B}/payouts`, clean(q)),
  search: (q: Q) => api.get<any>(`${B}/search`, clean(q)),
};
