// posRewardsNetworkApi.ts — the AI PowerSalon Global Loyalty & Rewards Network, salon side (LoyaltyTokens.pdf §10.2,
// LoyaltyRules.pdf §4.2–§4.3). Tenant, branch and actor come from the session; nothing here sends a tenant id.
// Buy Tokens carries ONE Idempotency-Key per logical purchase: a retry (lost answer, Verification Pending) re-sends the
// SAME key, so the server returns the same purchase and never submits a second charge.
import { api } from './client';

export interface EarningRate { spendIncrementCents: number; pointTenthsPerIncrement: number; minEligibleCents: number; perTicketCapTenths: number | null; roundingMode?: string }
export interface RateInput { spendIncrementCents: number; pointTenthsPerIncrement: number; minEligibleCents: number; perTicketCapTenths: number | null }
export interface VersionLite { id: string; versionNo: number; mode: 'GLOBAL' | 'CUSTOM'; effectiveFrom: string | null; rate: EarningRate | null; rateLabel: string | null }
export interface WalletSummary {
  exists: boolean; availableCents: number; pendingCents: number; pendingPurchases: number; usedThisMonthCents: number;
  lifetimeFundedCents: number; lifetimeAllocatedCents: number; deficitCents: number; status: string; alertLevel: 'ok' | 'low' | 'critical' | 'empty' | string; tokenValueCents: number; updatedAt: string | null;
  /** C1 audit (Nov 4 2026) §5.6: the warning levels in force (the salon's own when set) and the platform defaults */
  lowBalanceCents?: number; criticalBalanceCents?: number; levelsOwn?: boolean; platformLowBalanceCents?: number; platformCriticalBalanceCents?: number;
}
export interface NetworkState {
  generatedAt: string; mode: 'GLOBAL' | 'CUSTOM';
  effective: (EarningRate & { source: 'GLOBAL_DEFAULT' | 'TENANT_OVERRIDE' | string; versionId?: string; versionNo?: number; effectiveFrom?: string | null }) | null;
  globalNow: (EarningRate & { versionNo?: number; effectiveFrom?: string }) | null;
  globalNext: (EarningRate & { versionNo?: number; effectiveFrom?: string }) | null;
  scheduled: VersionLite[]; drafts: VersionLite[];
  program: { pointsPerRedeemBlock: number; redeemBlockValueCents: number; tokenValueCents: number;
    limits: { minSpendIncrementCents: number; maxSpendIncrementCents: number; maxPointTenthsPerIncrement: number; minEligibleFloorCents: number; maxPointTenthsPerTicket: number };
    earnPaused: boolean; redeemPaused: boolean; purchasesPaused: boolean; purchasePresetsTokens: number[]; maxPurchaseTokens: number; termsVersion: string | null };
  enrollment: { status: string; earningSuspended?: boolean; purchasingSuspended?: boolean };
  wallet: WalletSummary;
  flags: { engine: boolean; earn: boolean; redemption: boolean; purchases: boolean; customEarning: boolean };
  permissions: { canEdit: boolean; canActivate: boolean; canBuyTokens: boolean };
  funding: { provider: string | null; sandbox: boolean; available: boolean };
}
export interface PreviewRow { eligibleCents: number; pointTenths: number; tokenCostCents: number; globalPointTenths: number; globalTokenCostCents: number; differenceCents: number }
export interface Preview { proposed: EarningRate; global: EarningRate; rows: PreviewRow[] }
export interface HistoryItem { id: string; versionNo: number; mode: 'GLOBAL' | 'CUSTOM'; state: 'DRAFT' | 'DISCARDED' | 'CANCELED' | 'SCHEDULED' | 'ACTIVE' | 'SUPERSEDED'; effectiveFrom: string | null; rate: EarningRate | null; reason: string | null; activatedAt: string | null; createdAt: string | null }
export interface LedgerRow { id: string; entryType: string; deltaCents: number; balanceAfterCents: number; sourceTable: string | null; sourceId: string; reason: string | null; at: string | null }
export interface Purchase { id: string; tokenCents: number; amountCents: number; feeCents: number; status: string; pending: boolean; provider: string | null; providerRefLast6: string | null; failureCode: string | null; createdAt: string | null; confirmedAt: string | null; fundedAt: string | null; created?: boolean }
export interface PurchaseEvent { from: string | null; to: string; source: string; at: string | null }
export interface Paged<T> { total: number; page: number; pageSize: number; pageCount: number; totalItems: number; totalPages: number; items: T[] }

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
  ledger: (q: { page: number; pageSize: number }) => api.get<Paged<LedgerRow>>(`${B}/wallet/ledger`, q),
  purchases: (q: { page: number; pageSize: number }) => api.get<Paged<Purchase>>(`${B}/purchases`, q),
  purchase: (id: string) => api.get<Purchase & { events?: PurchaseEvent[] }>(`${B}/purchases/${enc(id)}`),
  /** step-up route + REQUIRED Idempotency-Key: the same key for every retry of one purchase */
  buyTokens: (tokens: number, idempotencyKey: string) => api.post<Purchase>(`${B}/purchases`, { tokens }, { 'Idempotency-Key': idempotencyKey }),
};
