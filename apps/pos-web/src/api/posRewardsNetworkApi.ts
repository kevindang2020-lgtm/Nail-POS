// posRewardsNetworkApi.ts — the AI PowerSalon Global Loyalty & Rewards Network, salon side (LoyaltyTokens.pdf §10.2,
// LoyaltyRules.pdf §4.2–§4.3). Tenant, branch and actor come from the session; nothing here sends a tenant id.
// Buy Tokens carries ONE Idempotency-Key per logical purchase: a retry (lost answer, Verification Pending) re-sends the
// SAME key, so the server returns the same purchase and never submits a second charge.
import { api } from './client';

export interface RewardsNetEarningRate { spendIncrementCents: number; pointTenthsPerIncrement: number; minEligibleCents: number; perTicketCapTenths: number | null; roundingMode?: string }
export interface RateInput { spendIncrementCents: number; pointTenthsPerIncrement: number; minEligibleCents: number; perTicketCapTenths: number | null }
export interface VersionLite { id: string; versionNo: number; mode: 'GLOBAL' | 'CUSTOM'; effectiveFrom: string | null; rate: RewardsNetEarningRate | null; rateLabel: string | null }
export interface WalletSummary {
  exists: boolean; availableCents: number; pendingCents: number; pendingPurchases: number; usedThisMonthCents: number;
  lifetimeFundedCents: number; lifetimeAllocatedCents: number; deficitCents: number; status: string; alertLevel: 'ok' | 'low' | 'critical' | 'empty' | string; tokenValueCents: number; updatedAt: string | null;
  /** C1 audit (Nov 4 2026) §5.6: the warning levels in force (the salon's own when set) and the platform defaults */
  lowBalanceCents?: number; criticalBalanceCents?: number; levelsOwn?: boolean; platformLowBalanceCents?: number; platformCriticalBalanceCents?: number;
  /** extras GLOBAL LOYALTY REWARDS 13: this salon month's earning / redemptions per branch from the ONE wallet (server-computed) */
  branchUsage?: RewardsNetBranchSplit;
  /** extras GLOBAL LOYALTY REWARDS 03: the server's funding forecast from the last 30 days of verified wallet use (null fields = no estimate) */
  /** extras GLOBAL LOYALTY REWARDS 06: funding vs liability — each from its own ledger, never combined (server-computed) */
  fundingVsLiability?: { backedFundingCents: number; pointsEarnedHereTenths: number; earnBackingCents: number; heldRedemptions: number; heldPointTenths: number; heldValueCents: number; salonPayablesOpen: number; salonPayablesOwedCents: number; combined: false };
  forecast?: { basisDays: number; usedCents: number; dailyCents: number | null; daysLeft: number | null; daysToLow: number | null; fundingNeededCents: number | null; automaticPurchase: false };
}
export interface RewardsNetBranchSplit {
  since: string; totalFundedCents: number; walletUsedCents: number; matchesWallet: boolean; doubleFunded: number;
  rows: { branchId: string | null; branchName: string | null; earnings: number; pointTenths: number; fundedCents: number; redemptions: number; redeemedValueCents: number }[];
}
export interface NetworkState {
  generatedAt: string; mode: 'GLOBAL' | 'CUSTOM';
  effective: (RewardsNetEarningRate & { source: 'GLOBAL_DEFAULT' | 'TENANT_OVERRIDE' | string; versionId?: string; versionNo?: number; effectiveFrom?: string | null }) | null;
  globalNow: (RewardsNetEarningRate & { versionNo?: number; effectiveFrom?: string }) | null;
  globalNext: (RewardsNetEarningRate & { versionNo?: number; effectiveFrom?: string }) | null;
  scheduled: VersionLite[]; drafts: VersionLite[];
  program: { pointsPerRedeemBlock: number; redeemBlockValueCents: number; tokenValueCents: number;
    limits: { minSpendIncrementCents: number; maxSpendIncrementCents: number; maxPointTenthsPerIncrement: number; minEligibleFloorCents: number; maxPointTenthsPerTicket: number };
    earnPaused: boolean; redeemPaused: boolean; purchasesPaused: boolean; purchasePresetsTokens: number[]; maxPurchaseTokens: number; termsVersion: string | null };
  enrollment: { status: string; earningSuspended?: boolean; purchasingSuspended?: boolean };
  wallet: WalletSummary;
  flags: { engine: boolean; earn: boolean; redemption: boolean; purchases: boolean; customEarning: boolean };
  permissions: { canEdit: boolean; canActivate: boolean; canBuyTokens: boolean };
  funding: { provider: string | null; sandbox: boolean; available: boolean };
  /** extras GLOBAL LOYALTY REWARDS 14: per-feature readiness (server-computed from flags, pauses, enrollment, providers) */
  readiness?: { feature: string; state: 'CODE_READY' | 'SANDBOX_READY' | 'PRODUCTION_READY' | 'BLOCKED_EXTERNAL'; evidence: string[] }[];
}
interface PreviewRow { eligibleCents: number; pointTenths: number; tokenCostCents: number; globalPointTenths: number; globalTokenCostCents: number; differenceCents: number }
export interface Preview { proposed: RewardsNetEarningRate; global: RewardsNetEarningRate; rows: PreviewRow[];
  /** extras GLOBAL LOYALTY REWARDS 04: scope, expected effect on the salon's own last-30-days earnings, approval (server-computed) */
  scope?: { appliesTo: 'all_branches'; branches: { id: string; name: string | null }[]; wallet: 'one_salon_wallet' };
  expected?: { basisDays: number; earnings: number; actualBackingCents: number | null; proposedBackingCents: number | null; globalBackingCents: number | null; differenceVsActualCents: number | null };
  approval?: { permission: string; stepUp: boolean; canActivate: boolean; historyImmutable: boolean } }
export interface HistoryItem { id: string; versionNo: number; mode: 'GLOBAL' | 'CUSTOM'; state: 'DRAFT' | 'DISCARDED' | 'CANCELED' | 'SCHEDULED' | 'ACTIVE' | 'SUPERSEDED'; effectiveFrom: string | null; rate: RewardsNetEarningRate | null; reason: string | null; activatedAt: string | null; createdAt: string | null }
export interface RewardsNetLedgerRow { id: string; entryType: string; deltaCents: number; balanceAfterCents: number; sourceTable: string | null; sourceId: string; reason: string | null; at: string | null }
export interface Purchase { id: string; tokenCents: number; amountCents: number; feeCents: number; status: string; pending: boolean; provider: string | null; providerRefLast6: string | null; failureCode: string | null; createdAt: string | null; confirmedAt: string | null; fundedAt: string | null; created?: boolean }
export interface PurchaseEvent { from: string | null; to: string; source: string; at: string | null }
export interface RewardsNetPaged<T> { total: number; page: number; pageSize: number; pageCount: number; totalItems: number; totalPages: number; items: T[] }
/** extras GLOBAL LOYALTY REWARDS 07 / 10: what the network owes this salon — stage, why, provider attempts, journal lines (server-built) */
export type RewardsNetPayableStage = 'PAYABLE' | 'PROCESSING' | 'PAID' | 'EXCEPTION' | 'CLOSED';
export interface RewardsNetPayableRow {
  id: string; redemptionId: string; ticketId: string | null; amountCents: number; adjustedCents: number; owedCents: number;
  status: string; stage: RewardsNetPayableStage; why: string; holdReason: string | null; settlementRef: string | null; paidAt: string | null; eligibleAt: string | null; createdAt: string | null;
  attempts: { id: string; status: string; provider: string; amountCents: number; settlementRef: string | null; signatureVerified: boolean; settledAt: string | null; failureCode: string | null; requestedAt: string | null }[];
  adjustments: { kind: string; amountCents: number; at: string | null }[];
  journal: { entryType: string; account: string; debitCents: number; creditCents: number; at: string | null }[];
}
export interface RewardsNetPayables {
  exceptionQueue: {
    expiredHolds: { count: number; items: { redemptionId: string; ticketId: string; valueCents: number; at: string | null }[] };
    unreconciledPaid: { count: number; items: { redemptionId: string; ticketId: string; valueCents: number; at: string | null }[] };
    disputedReversals: { count: number; items: { payableId: string; status: string; ticketId: string | null; reversedCents: number; holdReason: string | null; at: string | null }[] };
  };
  provider: { connected: boolean; state: 'CONNECTED' | 'BLOCKED_EXTERNAL' };
  settlement: { lastVerifiedAt: string | null; waitingOnProvider: number; oldestWaitingSince: string | null; unknownAnswer: number; oldestUnknownSince: string | null };
  totals: { status: string; stage: RewardsNetPayableStage; count: number; owedCents: number }[];
  total: number; page: number; pageSize: number; pageCount: number; items: RewardsNetPayableRow[];
}
/** extras GLOBAL LOYALTY REWARDS 16: the owner's finance audit trail (server-built, audited CSV) */
export interface RewardsNetFinanceExport { format: 'csv'; filename: string; csv: string; rows: number; counts: { purchases: number; allocations: number; payables: number; exceptions: number } }

const enc = encodeURIComponent;
const B = '/pos/loyalty/network';
export const posRewardsNetworkApi = {
  state: () => api.get<NetworkState>(`${B}/state`),
  history: () => api.get<{ items: HistoryItem[] }>(`${B}/earning/history`),
  preview: (rate: RateInput) => api.post<Preview>(`${B}/earning/preview`, { ...rate }),
  saveDraft: (rate: RateInput, draftId?: string) => api.post<{ draftId: string; versionNo: number }>(`${B}/earning/drafts`, { ...rate, ...(draftId ? { draftId } : {}) }),
  discardDraft: (id: string) => api.post<{ discarded: string }>(`${B}/earning/drafts/${enc(id)}/discard`, {}),
  /** step-up route: wrap in useStepUp().run */
  activate: (b: { draftId?: string; effectiveFrom?: string | null; reason?: string | null } & Partial<RateInput>) => api.post<{ effectiveFrom: string; scheduled: boolean }>(`${B}/earning/activate`, { ...b }),
  useGlobal: (b: { effectiveFrom?: string | null; reason?: string | null }) => api.post<{ effectiveFrom: string; scheduled: boolean }>(`${B}/earning/use-global`, { ...b, confirm: true }),
  cancelScheduled: (id: string) => api.post<unknown>(`${B}/earning/versions/${enc(id)}/cancel`, {}),
  wallet: () => api.get<WalletSummary>(`${B}/wallet`),
  setWalletLevels: (b: { lowBalanceCents: number | null; criticalBalanceCents: number | null }) => api.post<unknown>(`${B}/wallet/levels`, b),
  ledger: (q: { page: number; pageSize: number; entryType?: string; branchId?: string; from?: string; to?: string }) => api.get<RewardsNetPaged<RewardsNetLedgerRow>>(`${B}/wallet/ledger`, q),
  purchases: (q: { page: number; pageSize: number; status?: string; from?: string; to?: string }) => api.get<RewardsNetPaged<Purchase>>(`${B}/purchases`, q),
  reimbursements: (q: { page: number; pageSize: number; status?: string | null }) => api.get<RewardsNetPayables>(`${B}/reimbursements`, { page: q.page, pageSize: q.pageSize, ...(q.status ? { status: q.status } : {}) }),
  financeExport: (from: string, to: string) => api.exportAsync<RewardsNetFinanceExport>(`${B}/finance-export`, { from, to }),
  purchase: (id: string) => api.get<Purchase & { events?: PurchaseEvent[] }>(`${B}/purchases/${enc(id)}`),
  /** step-up route + REQUIRED Idempotency-Key: the same key for every retry of one purchase */
  buyTokens: (tokens: number, idempotencyKey: string) => api.post<Purchase>(`${B}/purchases`, { tokens }, { 'Idempotency-Key': idempotencyKey }),
};
