// customerRewardsApi.ts — AI PowerSalon Rewards for the signed-in customer (Final Completion guide §10). English only.
import { api } from './client';

export interface GlobalRewardsView {
  state: 'NO_IDENTITY' | 'NOT_VERIFIED' | 'NOT_JOINED' | 'WITHDRAWN' | 'SUSPENDED' | 'ACTIVE';
  program: { available: boolean; pointsPerRedeemBlock: number; redeemBlockValueCents: number };
  terms: { version: string; title: string; summary: string[]; privacyPath: string };
  account: { availablePoints: string; heldPoints: string; availableTenths: number; heldTenths: number; redemptionValueCents: number; lifetimeEarnedPoints: string; lifetimeRedeemedPoints: string; joinedAt: string | null; termsVersion: string; withdrawnAt: string | null; expires: null } | null;
  earned: { ref: string; salon: string; at: string | null; points: string; eligibleCents: number; rate: string; status: string }[];
  redemptions: { ref: string; salon: string; at: string | null; points: string; valueCents: number; status: string; reason: string | null; ticketRef: string }[];
}
export const customerRewardsApi = {
  mine: () => api.get<GlobalRewardsView>('/customer/global-rewards'),
  optIn: (termsVersion: string) => api.post<{ joined: boolean }>('/customer/global-rewards/opt-in', { termsVersion, accept: true }),
  withdraw: (reason?: string) => api.post<{ withdrawn: boolean; keptPoints: string }>('/customer/global-rewards/withdraw', { reason: reason ?? null }),
};
