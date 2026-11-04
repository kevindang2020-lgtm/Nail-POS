// loyalty.ts — wire contract (Constitution 13 §13, §15). Realm: tenant. Decision 15 rewards catalog (Oct 3 2026): one
// definition for the server (modules/loyalty) and the POS.
export type RewardType = 'amount_off' | 'percent_off';
export interface LoyaltyReward { id: string; title: string; pointsCost: number; active: boolean;
  description?: string; rewardType?: RewardType; valueCents?: number; percent?: number; validDays?: number | null;
  /** Loyalty guide (Nov 4 2026): availability rules — salon-local days, total stock, a per-member limit, the tiers that may redeem */
  startsOn?: string | null; endsOn?: string | null; stockTotal?: number | null; perMemberLimit?: number | null; eligibleTiers?: string[] | null; }
export interface RewardInput { title?: string; description?: string; pointsCost?: number; rewardType?: RewardType; valueCents?: number; percent?: number; validDays?: number | null; active?: boolean;
  startsOn?: string | null; endsOn?: string | null; stockTotal?: number | null; perMemberLimit?: number | null; eligibleTiers?: string[] | null; }
