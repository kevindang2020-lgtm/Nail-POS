// customerNailShowcaseLeaderboardApi.ts — Customer app client for NailShowcase Rankings
// (/customer/nail-showcase/leaderboard + /me/rank). Private profiles never appear in results.
import { api } from './client';
import type { LeaderboardPeriod, LeaderboardResult, LeaderboardScope } from '@aipowersalon/api-contracts/customer';
// API contract types (§15): one definition in @aipowersalon/api-contracts, re-exported here so screens keep their imports.
export type { LeaderboardPeriod, LeaderboardResult, LeaderboardScope } from '@aipowersalon/api-contracts/customer';

export const LEADERBOARD_LIMITS = [10, 20, 30, 50, 100, 500] as const;

export interface LeaderboardEntry {
  rank: number; customerId: string; displayName: string; avatarUrl?: string | null;
  score: number; likesCount: number; commentsCount: number; dislikesCount: number; postsCount: number;
  followerCount: number; isFollowing?: boolean; isMe?: boolean;
}
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
