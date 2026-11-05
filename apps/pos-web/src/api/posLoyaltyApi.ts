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
  members: (q: { page: number; pageSize: number; tier?: string; q?: string; status?: string; sort?: string }) => api.get<any>(`/pos/loyalty/members`, q),
  redemptions: (q: { page: number; pageSize: number; status?: string; rewardId?: string; customerId?: string }) => api.get<any>(`/pos/loyalty/redemptions`, q),
  redemption: (id: string) => api.get<any>(`/pos/loyalty/redemptions/${enc(id)}`),
  ledger: (q: { page: number; pageSize: number; entryType?: string; customerId?: string }) => api.get<any>(`/pos/loyalty/ledger`, q),
  enroll: (customerId: string) => api.post<any>(`/pos/loyalty/enroll`, { customerId }),
  // Customer Profile & Global Loyalty Protection (Nov 4 2026): points are never set or lowered by hand — a manager asks
  // for a POSITIVE bonus, the owner approves it in the Owner App (the old /adjust route now refuses every change)
  bonusPreview: (customerId: string, points: number) => api.get<BonusPreview>(`/pos/loyalty/bonus-requests/preview`, { customerId, points }),
  bonusRequest: (b: { customerId: string; points: number; reason: string }) => api.post<any>(`/pos/loyalty/bonus-requests`, b),
  bonusRequests: (q: { customerId?: string; status?: string; page?: number; pageSize?: number }) => api.get<{ items: BonusRequestRow[]; total: number; page: number; pageSize: number }>(`/pos/loyalty/bonus-requests`, q),
  bonusHealth: () => api.get<{ checkedAt: string; checks: { key: string; result: 'passed' | 'warning' | 'failed'; detail: string; affected: string[] }[] }>(`/pos/loyalty/bonus-requests/health`),
  redeem: (b: { customerId: string; rewardId: string; idempotencyKey: string }) => api.post<any>(`/pos/loyalty/redeem`, b),
  voidRedemption: (id: string, reason: string) => api.post<any>(`/pos/loyalty/redemptions/${enc(id)}/void`, { reason }),
  // Manage Tiers (Loyalty guide Nov 4 2026): the salon's own tiers; owners / managers edit them and move a member
  tiers: () => api.get<any>(`/pos/loyalty/tiers`),
  createTier: (b: TierInput) => api.post<any>(`/pos/loyalty/tiers`, b as unknown as Record<string, unknown>),
  updateTier: (tierId: string, b: TierInput) => api.post<any>(`/pos/loyalty/tiers/${enc(tierId)}`, b as unknown as Record<string, unknown>),
  setMemberTier: (customerId: string, b: { tier: string; reason: string }) => api.post<any>(`/pos/loyalty/members/${enc(customerId)}/tier`, b),
};
export type TierInput = { name: string; rank: number | null; minPoints: number | null; benefits: string | null; active: boolean | null };
export interface BonusPreview { customerId: string; customerName: string; target: 'global' | 'salon'; currentPoints: number; points: number; pointsAfter: number; tokenCostCents: number | null; walletAvailableCents: number | null }
export interface BonusRequestRow { id: string; status: string; customerId: string | null; customerName: string | null; points: number; target: 'global' | 'salon' | null; tokenCostCents: number | null; reason: string;
  requestedByName: string | null; decidedByName: string | null; decisionNote: string | null; createdAt: string; decidedAt: string | null; expiresAt: string | null; failureCode: string | null; failure: string | null }
