// customerNailShowcaseLeaderboardApi.ts — Customer app client for NailShowcase Rankings
// (/customer/nail-showcase/leaderboard + /me/rank). Private profiles never appear in results.
import type { LeaderboardPeriod, LeaderboardResult, LeaderboardScope, NailShowcaseLeaderboardEntry as LeaderboardEntry } from '@aipowersalon/api-contracts/customer';   // the wire contract (Constitution 13 §15)
import { api } from './client';

export const LEADERBOARD_LIMITS = [10, 20, 30, 50, 100, 500] as const;

export interface MyRank {
  ranked: boolean; rank: number | null; score: number;
  likesCount: number; commentsCount: number; dislikesCount: number; postsCount: number;
  isPublic: boolean; reason?: string;
}

export interface LeaderboardParams { limit?: number; period?: LeaderboardPeriod; scope?: LeaderboardScope; salonId?: string }
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const customerNailShowcaseLeaderboardApi = {
  leaderboard: (p: LeaderboardParams = {}) => api.get<LeaderboardResult>('/customer/nail-showcase/leaderboard', clean(p as Record<string, unknown>)),
  myRank: () => api.get<MyRank>('/customer/nail-showcase/me/rank'),
};
export type { LeaderboardPeriod, LeaderboardResult, LeaderboardScope, LeaderboardEntry };
