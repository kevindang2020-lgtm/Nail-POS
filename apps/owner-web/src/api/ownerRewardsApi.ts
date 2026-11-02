// ownerRewardsApi.ts — Owner App → Rewards (AI PowerSalon Rewards network for the owner's own salon; English only).
import { api } from './client';

export interface OwnerRewardsView {
  generatedAt: string; enrolled: boolean; networkOn: boolean; tokenValueCents: number;
  wallet: { availableCents: number; pendingCents: number; usedThisMonthCents: number; lifetimeFundedCents: number; lifetimeAllocatedCents: number; deficitCents: number; alertLevel: string; purchases: { status: string; count: number; tokenCents: number }[] };
  buyTokens: { state: 'BLOCKED_EXTERNAL' | 'TEST_SANDBOX' | 'NOT_CONFIGURED' };
  issued: { byRule: { source: string; ruleVersionId: string | null; sales: number; points: string; backingCents: number }[]; blockedForTokens: number };
  accepted: { ref: string; ticketId: string; points: string; valueCents: number; status: string; at: string | null }[];
  owed: { totalCents: number; under7dCents: number; d7to30Cents: number; over30Cents: number; onHoldCents: number; items: { id: string; amountCents: number; status: string; holdReason: string | null; accruedAt: string | null; paidAt: string | null; providerRef: string | null }[] };
  payouts: { state: string; settledCents: number };
  alerts: { kind: string; severity: string; title: string; body: string; at: string | null }[];
}
export const ownerRewardsApi = { get: () => api.get<OwnerRewardsView>('/owner/loyalty/rewards') };
