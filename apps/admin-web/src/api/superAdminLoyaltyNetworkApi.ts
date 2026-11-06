// superAdminLoyaltyNetworkApi.ts — Super Admin → Loyalty Network control centre (Global Loyalty & Rewards Network,
// LoyaltyTokens.pdf §4, §7.5, §10.2; LoyaltyRules.pdf §1–§2). Views need super_admin.billing.view; every change needs
// super_admin.billing.manage + a fresh step-up (the client re-prompts on STEP_UP_REQUIRED and retries once).
import { api } from './client';

export interface Rate { spendIncrementCents: number; pointTenthsPerIncrement: number; minEligibleCents: number; perTicketCapTenths: number | null }
export interface GlobalVersion extends Rate { versionId: string; versionNo: number; effectiveFrom: string; status: string; reason: string | null; createdAt: string | null }
export interface Program {
  earnPaused: boolean; redeemPaused: boolean; purchasesPaused: boolean; reimbursementsPaused: boolean;
  pointsPerRedeemBlock: number; redeemBlockValueCents: number; tokenValueCents: number;
  customMinSpendIncrementCents: number; customMaxSpendIncrementCents: number; customMaxPointTenthsPerIncrement: number; customMinEligibleFloorCents: number;
  maxPointTenthsPerTicket: number; lowBalanceCents: number; criticalBalanceCents: number; reservationTtlSeconds: number;
  purchasePresetsTokens: number[]; maxPurchaseTokens: number; termsVersion: string; version: number;
}
export interface Reconciliation {
  generatedAt: string; balances: Record<string, number>; unbalancedEntries: number; walletMismatches: { tenantId: string; walletCents: number; ledgerCents: number }[];
  pointsMismatches: number; rewardsLiabilityCents: number; outstandingPointsValueCents: number; liabilityMatchesPoints: boolean;
  payables: { status: string; count: number; amountCents: number }[]; purchases: { status: string; count: number; tokenCents: number }[]; healthy: boolean;
}
export interface PendingApproval { ok: true; pending: true; approvalId: string; expiresAt: string; message: string }
export const isPendingApproval = (x: unknown): x is PendingApproval => !!x && typeof x === 'object' && (x as { pending?: unknown }).pending === true;
export interface LoyaltyNetOverview { program: Program; globalVersions: GlobalVersion[]; impact: { globalModeTenants: number; customModeTenants: number }; reconciliation: Reconciliation; funding: { provider: string | null; sandbox: boolean } }
interface PreviewRow { eligibleCents: number; pointTenths: number; tokenCostCents: number; globalPointTenths: number; globalTokenCostCents: number; differenceCents: number }
export interface GlobalPreview { proposed: Rate; current: Rate; rows: PreviewRow[]; impact: { globalModeTenants: number; customModeTenants: number } }
export interface Enrollment { tenantId: string; name: string | null; code: string | null; enrollment: string; earningSuspended: boolean; purchasingSuspended: boolean; enrolledAt: string | null; mode: 'GLOBAL' | 'CUSTOM'; availableCents: number; alertLevel: string; deficitCents: number }
export interface Purchase { id: string; tenantId: string; tokenCents: number; amountCents: number; feeCents: number; status: string; pending: boolean; provider: string | null; providerRefLast6: string | null; failureCode: string | null; createdAt: string | null; confirmedAt: string | null; fundedAt: string | null }
export interface LoyaltyNetPaged<T> { total: number; page: number; pageSize: number; pageCount: number; items: T[] }
export type ProgramPatch = Partial<Record<'earn_paused' | 'redeem_paused' | 'purchases_paused' | 'reimbursements_paused', boolean> & Record<'custom_min_spend_increment_cents' | 'custom_max_spend_increment_cents' | 'custom_max_point_tenths_per_increment' | 'custom_min_eligible_floor_cents' | 'max_point_tenths_per_ticket' | 'low_balance_cents' | 'critical_balance_cents' | 'reservation_ttl_seconds' | 'max_purchase_tokens', number>>;

export interface Integrity {
  generatedAt: string; currency: string; tokenValueCents: number;
  funding: { verifiedCents: number; pendingCents: number; failedCount: number; walletAvailableCents: number; consumedCents: number; deficitCents: number; prepaidLiabilityCents: number };
  points: { accounts: number; availableTenths: number; heldTenths: number; redemptionValueCents: number };
  holds: { count: number; pointTenths: number; valueCents: number; pastDeadline: number; expiringSoon: number };
  liability: { journalCents: number; outstandingValueCents: number; deltaCents: number };
  payables: { owedCents: number; pendingPayoutCents: number; byStatus: { status: string; count: number; amountCents: number; aged30Cents: number }[]; journalCents: number };
  payouts: { providerConfigured: boolean; state: string; settledCount: number; settledCents: number };
  books: { lastRun: { id: string; runKey: string; trigger: string; status: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; checks: number; failed: number; warnings: number; attempts: number } | null; lastDaily: { runKey: string; status: string; finishedAt: string | null } | null; nextDailyAt: string };
  discrepancies: { severity: string; open: number; oldestAt: string | null }[]; fraud: { severity: string; open: number }[];
}
export interface BooksRun { id: string; runKey: string; trigger: string; status: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; checks: number; failed: number; warnings: number; attempts: number; error: string | null }
export interface LoyaltyNetFinding { id: string; runId: string; runKey: string; checkType: string; outcome: string; severity: string; tenantId: string | null; salon: string | null; expectedCents: number | null; actualCents: number | null; deltaCents: number | null; affectedIds: string[]; detail: string; recommendedAction: string | null; reviewStatus: string; reviewedAt: string | null; reviewNote: string | null; createdAt: string | null }
export interface Payable { id: string; tenantId: string; salon: string | null; redemptionId: string; ticketId: string | null; amountCents: number; adjustedCents: number; owedCents: number; status: string; holdReason: string | null; providerRef: string | null; paidAt: string | null; createdAt: string | null; pointTenths: number }
export interface FraudAlert { id: string; signal: string; severity: string; confidence: number; customerRef: string | null; hasAccount?: boolean; tenantId: string | null; evidence: Record<string, unknown>; status: string; reviewNote: string | null; reviewedAt: string | null; createdAt: string | null }
export interface Lineage {
  redemption: { id: string; redeemingSalonId: string; ticketId: string; tenderPaymentId: string | null; pointTenths: number; valueCents: number; status: string; heldAt: string | null; confirmedAt: string | null; releasedAt: string | null; reversedCents: number };
  funding: { earnId: string; earningSalonId: string; pointTenths: number; backingCents: number; ruleSource: string; ruleVersionId: string | null; at: string | null }[];
  payable: { id: string; status: string; amountCents: number; adjustedCents: number } | null;
  payouts: { id: string; status: string; provider: string; amountCents: number; settlementRef: string | null; settledAt: string | null }[];
  adjustments: { kind: string; amountCents: number; source: string; at: string | null }[]; journal: { entryType: string; source: string; at: string | null }[];
}

const B = '/super-admin/loyalty-network';
const enc = encodeURIComponent;
export const superAdminLoyaltyNetworkApi = {
  overview: () => api.get<LoyaltyNetOverview>(`${B}/overview`),
  reconciliation: () => api.get<Reconciliation>(`${B}/reconciliation`),
  enrollments: (q: { q?: string; page: number; pageSize: number }) => api.get<LoyaltyNetPaged<Enrollment>>(`${B}/enrollments`, q),
  purchases: (q: { page: number; pageSize: number }) => api.get<LoyaltyNetPaged<Purchase>>(`${B}/purchases`, q),
  previewGlobal: (rate: Rate) => api.post<GlobalPreview>(`${B}/global-rules/preview`, { ...rate }),
  // Batch C decision 1 (Nov 6 2026): with a second Super Admin the change is filed for approval — the answer says pending
  publishGlobal: (b: Rate & { effectiveFrom: string | null; reason: string }) => api.post<PendingApproval | Record<string, unknown>>(`${B}/global-rules`, { ...b }),
  cancelGlobal: (id: string) => api.post<unknown>(`${B}/global-rules/${enc(id)}/cancel`, {}),
  updateProgram: (patch: ProgramPatch, expectedVersion: number, reason?: string) => api.post<Program | PendingApproval>(`${B}/program`, { ...patch, expectedVersion, ...(reason ? { reason } : {}) }),
  setEnrollment: (tenantId: string, b: { status: 'enrolled' | 'suspended' | 'withdrawn'; earningSuspended?: boolean; purchasingSuspended?: boolean; reason: string }) => api.post<unknown>(`${B}/enrollments/${enc(tenantId)}`, { ...b }),
  /** SANDBOX ONLY — stands in for the provider's later answers; the server refuses it for a live provider */
  sandboxAdvance: (id: string, status: string) => api.post<Purchase>(`${B}/purchases/${enc(id)}/sandbox-advance`, { status }),
  // Final Completion guide §07–§09
  integrity: () => api.get<Integrity>(`${B}/integrity`),
  runs: (q: { page: number; pageSize: number }) => api.get<LoyaltyNetPaged<BooksRun>>(`${B}/books-check/runs`, q),
  findings: (q: { runId?: string; outcome?: string; reviewStatus?: string; tenantId?: string; page: number; pageSize: number }) => api.get<LoyaltyNetPaged<LoyaltyNetFinding>>(`${B}/books-check/findings`, q),
  findingsCsv: (runId?: string) => api.exportAsync<string>(`${B}/books-check/findings.csv`, runId ? { runId } : undefined, 'text'),
  runBooksCheck: () => api.post<{ runId: string; status: string; replay: boolean }>(`${B}/books-check/run`, {}),
  reviewFinding: (id: string, to: string, note: string) => api.post<unknown>(`${B}/books-check/findings/${enc(id)}/review`, { to, note }),
  payables: (q: { status?: string; tenantId?: string; page: number; pageSize: number }) => api.get<LoyaltyNetPaged<Payable>>(`${B}/payables`, q),
  lineage: (redemptionId: string) => api.get<Lineage>(`${B}/redemptions/${enc(redemptionId)}/lineage`),
  markEligible: (id: string) => api.post<unknown>(`${B}/payables/${enc(id)}/eligible`, {}),
  holdPayable: (id: string, reason: string) => api.post<unknown>(`${B}/payables/${enc(id)}/hold`, { reason }),
  /** money out: one request key per attempt; no approved provider → PAYOUT_PROVIDER_UNAVAILABLE (the payable stays owed) */
  requestPayout: (id: string, key: string) => api.postOnce<unknown>(`${B}/payables/${enc(id)}/payout`, {}, key),
  fraudAlerts: (q: { status?: string; page: number; pageSize: number }) => api.get<LoyaltyNetPaged<FraudAlert>>(`${B}/fraud-alerts`, q),
  reviewFraud: (id: string, to: string, note: string) => api.post<unknown>(`${B}/fraud-alerts/${enc(id)}/review`, { to, note }),
  /** C1 audit (Nov 4 2026) §4.4: pause / lift the pause on the rewards account the alert is about (step-up, reason) */
  alertAccountStatus: (id: string, status: 'suspended' | 'active', reason: string) => api.post<unknown>(`${B}/fraud-alerts/${enc(id)}/account-status`, { status, reason }),
};
