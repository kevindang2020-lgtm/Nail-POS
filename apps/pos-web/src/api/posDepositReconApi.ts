// posDepositReconApi.ts — AI Deposit Reconciliation (real /pos/deposit-reconciliation). Settlements are read
// from the existing payment_settlements; the bank layer (accounts + deposits) and matching state come from the
// deposit-reconciliation module. Linking a deposit to a settlement is a human action.
import { api } from "./client";
export const posDepositReconApi = {
  state: () => api.get<any>(`/pos/deposit-reconciliation/state`),
  listBankAccounts: () => api.get<any[]>(`/pos/deposit-reconciliation/bank-accounts`),
  createBankAccount: (b: { nickname: string; bankName?: string; accountType?: string; accountLast4?: string }) => api.post<any>(`/pos/deposit-reconciliation/bank-accounts`, b),
  listDeposits: () => api.get<any[]>(`/pos/deposit-reconciliation/deposits`),
  createDeposit: (b: { bankAccountId: string; amountCents: number; depositDate?: string; reference?: string; externalBankTxnId?: string }) => api.post<any>(`/pos/deposit-reconciliation/deposits`, b),
  linkDeposit: (depositId: string, settlementId: string | null) => api.post<any>(`/pos/deposit-reconciliation/deposits/${encodeURIComponent(depositId)}/link`, { settlementId }),
  // later slices
  feeReconciliation: () => api.get<any>(`/pos/deposit-reconciliation/fee-reconciliation`),
  listExceptions: (status?: string) => api.get<any>(`/pos/deposit-reconciliation/exceptions`, status ? { status } : undefined),
  resolveException: (id: string, note: string) => api.post<any>(`/pos/deposit-reconciliation/exceptions/${encodeURIComponent(id)}/resolve`, { note }),
  assignException: (id: string, assigneeUserId: string) => api.post<any>(`/pos/deposit-reconciliation/exceptions/${encodeURIComponent(id)}/assign`, { assigneeUserId }),
  reportSummary: () => api.get<any>(`/pos/deposit-reconciliation/reports/summary`),
  reportDaily: () => api.get<any>(`/pos/deposit-reconciliation/reports/daily`),
  /** BUILD_PLAN Phase 12: the daily CSV through the async export contract (202 → poll → download), as text. */
  exportDaily: () => api.exportAsync<string>(`/pos/deposit-reconciliation/reports/daily/export`, undefined, 'text'),
};
