// posSettlementsApi.ts — Deposits & Settlements mandate (Oct 29 2026): /pos/payments/settlements (read-only; owners / managers,
// pos.reports.view). Every list is paged and filtered on the server; the KPIs are server aggregates over the same filters.
import { api } from "./client";
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
export const posSettlementsApi = {
  list: (q: Q) => api.get<any>(`/pos/payments/settlements`, clean(q)),
  summary: (q: Q) => api.get<any>(`/pos/payments/settlements/summary`, clean(q)),
  detail: (id: string) => api.get<any>(`/pos/payments/settlements/${encodeURIComponent(id)}`),
  transactions: (id: string, q: Q) => api.get<any>(`/pos/payments/settlements/${encodeURIComponent(id)}/transactions`, clean(q)),
  /** CSV through the async export contract (authorized, audited; totals over every filtered record) */
  exportCsv: (q: Q) => api.exportAsync<string>(`/pos/payments/settlements/export`, clean(q), 'text'),
  exportDetail: (id: string) => api.exportAsync<string>(`/pos/payments/settlements/${encodeURIComponent(id)}/export`, undefined, 'text'),
};
