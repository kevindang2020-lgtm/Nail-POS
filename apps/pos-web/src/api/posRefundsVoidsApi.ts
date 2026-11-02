// posRefundsVoidsApi.ts — Refunds & Voids mandate (Oct 29 2026): the READ side of Payments & Money → Refunds & Voids
// (/pos/payments/refunds-voids*, pos.checkout.view; export pos.reports.export). One row per reversal from the authoritative
// ledger; the KPIs over the whole scope; Find Original Payment with each tender's refundable amount and eligibility.
// A refund, a void and settling an unknown refund go through the existing Checkout routes (posCheckoutApi — processor-backed,
// claim-first, idempotent, step-up). The old /pos/refunds-voids/state answers 410.
import { api } from "./client";
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const B = '/pos/payments/refunds-voids';
export const posRefundsVoidsApi = {
  list: (q: Q) => api.get<any>(`${B}/list`, clean(q)),
  summary: (q: Q) => api.get<any>(`${B}/summary`, clean(q)),
  facets: () => api.get<{ processors: string[]; registers: { id: string; name: string }[] }>(`${B}/facets`),
  find: (q: Q) => api.get<any>(`${B}/find`, clean(q)),
  detail: (kind: 'refund' | 'void', id: string) => api.get<any>(`${B}/${kind}/${encodeURIComponent(id)}/detail`),
  exportCsv: (q: Q) => api.exportAsync<string>(`${B}/export`, clean(q), 'text'),
};
