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
  // Loyalty & Rewards mandate (Oct 29 2026): the one-screen overview + newest-first numbered lists + the desk workflows.
  overview: () => api.get<any>(`/pos/loyalty/overview`),
  rewards: (q: { page: number; pageSize: number; status?: string }) => api.get<any>(`/pos/loyalty/rewards`, q),
  members: (q: { page: number; pageSize: number; tier?: string; q?: string }) => api.get<any>(`/pos/loyalty/members`, q),
  redemptions: (q: { page: number; pageSize: number; status?: string; rewardId?: string; customerId?: string }) => api.get<any>(`/pos/loyalty/redemptions`, q),
  redemption: (id: string) => api.get<any>(`/pos/loyalty/redemptions/${enc(id)}`),
  ledger: (q: { page: number; pageSize: number; entryType?: string; customerId?: string }) => api.get<any>(`/pos/loyalty/ledger`, q),
  enroll: (customerId: string) => api.post<any>(`/pos/loyalty/enroll`, { customerId }),
  adjust: (b: { customerId: string; delta: number; reason: string; idempotencyKey: string }) => api.post<any>(`/pos/loyalty/adjust`, b),
  redeem: (b: { customerId: string; rewardId: string; idempotencyKey: string }) => api.post<any>(`/pos/loyalty/redeem`, b),
  voidRedemption: (id: string, reason: string) => api.post<any>(`/pos/loyalty/redemptions/${enc(id)}/void`, { reason }),
};
