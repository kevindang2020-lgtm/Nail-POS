// posLoyaltyApi.ts — tenant loyalty program: overview (pos.customers.view) and, since Oct 2 2026, the rewards catalog
// (create / edit / archive — owners and managers, pos.settings.edit). Decision 15: every reward is worth something.
import { api } from "./client";
import type { RewardType, RewardInput } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export type { RewardType, RewardInput };
export interface LoyaltyRewardRow { id: string; title: string; description?: string; pointsCost: number; active: boolean; rewardType?: RewardType; valueCents?: number; percent?: number; validDays?: number | null }
const enc = encodeURIComponent;
export const posLoyaltyApi = {
  state: () => api.get(`/pos/loyalty/state`),
  createReward: (body: RewardInput) => api.post<LoyaltyRewardRow>(`/pos/loyalty/rewards`, body as Record<string, unknown>),
  updateReward: (rewardId: string, body: RewardInput) => api.patch<LoyaltyRewardRow>(`/pos/loyalty/rewards/${enc(rewardId)}`, body as Record<string, unknown>),
};
