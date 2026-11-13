// loyalty.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Decision 15 rewards catalog (Oct 3 2026): one
// definition for the server (modules/loyalty) and the POS.
export type RewardType = 'amount_off' | 'percent_off';
export interface LoyaltyReward { id: string; title: string; pointsCost: number; active: boolean;
  description?: string; rewardType?: RewardType; valueCents?: number; percent?: number; validDays?: number | null;
  /** Loyalty guide (Nov 4 2026): availability rules — salon-local days, total stock, a per-member limit, the tiers that may redeem */
  startsOn?: string | null; endsOn?: string | null; stockTotal?: number | null; perMemberLimit?: number | null; eligibleTiers?: string[] | null; }
export interface RewardInput { title?: string; description?: string; pointsCost?: number; rewardType?: RewardType; valueCents?: number; percent?: number; validDays?: number | null; active?: boolean;
  startsOn?: string | null; endsOn?: string | null; stockTotal?: number | null; perMemberLimit?: number | null; eligibleTiers?: string[] | null; }

/** GET pos/loyalty/network/reimbursements — what the rewards network owes THIS salon, with provider + journal evidence
 *  (extras GLOBAL LOYALTY REWARDS 07 reimbursement drill-down + 10 stale-provider indicator). Read-only. */
export type RewardsPayableStage = 'PAYABLE' | 'PROCESSING' | 'PAID' | 'EXCEPTION' | 'CLOSED';
export interface RewardsSalonPayables {
  provider: { connected: boolean; state: 'CONNECTED' | 'BLOCKED_EXTERNAL' };
  settlement: { lastVerifiedAt: string | null; waitingOnProvider: number; oldestWaitingSince: string | null; unknownAnswer: number; oldestUnknownSince: string | null };
  totals: Array<{ status: string; stage: RewardsPayableStage; count: number; owedCents: number }>;
  total: number; page: number; pageSize: number; pageCount: number;
  items: Array<{
    id: string; redemptionId: string; ticketId: string | null; amountCents: number; adjustedCents: number; owedCents: number;
    status: string; stage: RewardsPayableStage; why: string; holdReason: string | null; settlementRef: string | null;
    paidAt: string | null; eligibleAt: string | null; createdAt: string | null;
    attempts: Array<{ id: string; status: string; provider: string; amountCents: number; settlementRef: string | null; signatureVerified: boolean; settledAt: string | null; failureCode: string | null; requestedAt: string | null }>;
    adjustments: Array<{ kind: string; amountCents: number; at: string | null }>;
    journal: Array<{ entryType: string; account: string; debitCents: number; creditCents: number; at: string | null }>;
  }>;
}
