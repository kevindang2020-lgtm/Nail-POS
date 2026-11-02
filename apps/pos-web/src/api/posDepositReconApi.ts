// posDepositReconApi.ts — AI Deposit Reconciliation (real /pos/deposit-reconciliation). Settlements are read from the
// existing payment_settlements; the bank layer (accounts + deposits) and the matching (allocations) come from the
// deposit-reconciliation module. Matching is a human action; nothing here moves money.
import { api } from "./client";
type Q = Record<string, unknown>;
const clean = (q: Q = {}) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const W = `/pos/deposit-reconciliation/workspace`;
const e = encodeURIComponent;
export const posDepositReconApi = {
  // ── the Oct 29 2026 one-screen page (workspace) ──
  kpis: (q: Q) => api.get<any>(`${W}/kpis`, clean(q)),
  settlements: (q: Q) => api.get<any>(`${W}/settlements`, clean(q)),
  settlement: (id: string) => api.get<any>(`${W}/settlements/${e(id)}`),
  deposits: (q: Q) => api.get<any>(`${W}/deposits`, clean(q)),
  deposit: (id: string) => api.get<any>(`${W}/deposits/${e(id)}`),
  suggestions: (id: string) => api.get<any>(`${W}/deposits/${e(id)}/suggestions`),
  search: (search: string) => api.get<any>(`${W}/search`, { search }),
  allocate: (b: { settlementId: string; depositId: string; amountCents: number; reviewed: boolean; note?: string; idempotencyKey: string; basis?: string }) => api.post<any>(`${W}/allocations`, b),
  unmatch: (id: string, reason: string) => api.post<any>(`${W}/allocations/${e(id)}/unmatch`, { reason }),
  bankAccounts: () => api.get<any>(`${W}/bank-accounts`),
  addBankAccount: (b: { nickname: string; bankName?: string; accountType?: string; accountLast4?: string }) => api.post<any>(`${W}/bank-accounts`, b),
  updateBankAccount: (id: string, b: { nickname?: string; makeDefault?: boolean; deactivate?: boolean }) => api.post<any>(`${W}/bank-accounts/${e(id)}`, b),
  recordDeposit: (b: { bankAccountId: string; amountCents: number; depositDate: string; reference?: string; notes?: string; idempotencyKey: string; allowDuplicateReference?: boolean }) => api.post<any>(`${W}/deposits`, b),
  addNote: (b: { targetType: 'settlement' | 'deposit' | 'exception'; targetId: string; body: string }) => api.post<any>(`${W}/notes`, b),
  fees: (q: Q) => api.get<any>(`${W}/fees`, clean(q)),
  exceptions: (q: Q) => api.get<any>(`${W}/exceptions`, clean(q)),
  exception: (id: string) => api.get<any>(`${W}/exceptions/${e(id)}`),
  reviewers: () => api.get<any>(`${W}/reviewers`),
  raise: (b: { targetType: 'settlement' | 'deposit'; targetId: string; kind: string; note?: string }) => api.post<any>(`${W}/exceptions`, b),
  assign: (id: string, assigneeUserId: string | null) => api.post<any>(`${W}/exceptions/${e(id)}/assign`, { assigneeUserId }),
  review: (id: string) => api.post<any>(`${W}/exceptions/${e(id)}/review`, {}),
  resolve: (id: string, reason: string) => api.post<any>(`${W}/exceptions/${e(id)}/resolve`, { reason }),
  reopen: (id: string) => api.post<any>(`${W}/exceptions/${e(id)}/reopen`, {}),
  report: (type: string, q: Q) => api.get<any>(`${W}/reports/${e(type)}`, clean(q)),
  reportCsv: (type: string, q: Q) => api.exportAsync<string>(`${W}/reports/${e(type)}/export`, clean(q), 'text'),
  reportPdf: (type: string, q: Q) => api.exportAsync<Blob>(`${W}/reports/${e(type)}/export-pdf`, clean(q), 'blob'),
};
