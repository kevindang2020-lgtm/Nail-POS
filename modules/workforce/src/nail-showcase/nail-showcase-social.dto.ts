// The social wire types are the customer realm contract (Constitution 13 §15).
export type { FollowingFeedItem, LeaderboardPeriod, LeaderboardScope, NailShowcaseLeaderboardEntry, LeaderboardResult, ProfilePostCard, ProfileVisibility } from '@aipowersalon/api-contracts/customer';
import type { FollowingFeedItem, LeaderboardPeriod, LeaderboardScope, NailShowcaseLeaderboardEntry, LeaderboardResult, ProfilePostCard, ProfileVisibility } from '@aipowersalon/api-contracts/customer';
/**
 * nail-showcase-social.dto.ts — NailShowcase Social Ranking contracts + pure helpers (engagement score, leaderboard
 * shaping, privacy copy, validation). No DB/framework deps so it is unit-testable. The score weights match the existing
 * NailShowcase trending base (likes×2 + comments×3 − dislikes) so the gallery and the rankings stay consistent.
 */


export const LEADERBOARD_LIMITS = [10, 20, 30, 50, 100, 500] as const;
export const NS_SOCIAL_MAX_DISPLAY_NAME = 40;
export const NS_SOCIAL_MAX_BIO = 300;

// ---- Scoring (reused weights). Per the spec, a post's score is clamped at 0 so dislikes reduce but never destroy. ----
// score = (likes×2) + (comments×3) − (dislikes×1); finalScore = max(0, score). A customer's score is the sum across
// their eligible (published, public_platform, non-hidden/removed) posts.
export const NS_SCORE_LIKE_WEIGHT = 2;
export const NS_SCORE_COMMENT_WEIGHT = 3;
export const NS_SCORE_DISLIKE_WEIGHT = 1;

export function nsRankingPostScore(likes: number, comments: number, dislikes: number): number {
  const raw = likes * NS_SCORE_LIKE_WEIGHT + comments * NS_SCORE_COMMENT_WEIGHT - dislikes * NS_SCORE_DISLIKE_WEIGHT;
  return Math.max(0, raw);
}
/** Sum of per-post clamped scores → a customer's total never drops below zero. */
export function nsRankingCustomerScore(posts: { likeCount: number; commentCount: number; dislikeCount: number }[]): number {
  return posts.reduce((sum, p) => sum + nsRankingPostScore(p.likeCount, p.commentCount, p.dislikeCount), 0);
}

// ---- Exact privacy copy (used verbatim by the Customer App + tests) ----
export const NS_PUBLIC_PROFILE_WARNING =
  'If your profile is public, other customers can see your avatar, display name, NailShowcase posts, follower count, and your current NailShowcase rank. Your phone number, email, payment information, private appointments, receipts, and personal account details will never be shown.';
export const NS_PUBLIC_CONFIRM_LABEL = 'I understand what will be public.';
export const NS_PRIVATE_PROFILE_NOTICE = 'Your profile is private. Other customers cannot view your profile or see you in public rankings.';
export const NS_PRIVATE_OWN_PROFILE_NOTICE = 'Your profile is private. Make it public to appear in NailShowcase rankings.';
export const NS_PRIVATE_OTHER_PROFILE_NOTICE = 'This profile is private.';

// ---- Views ----
export interface SocialProfileSettings {
  publicDisplayName: string | null;
  bio: string | null;
  profileVisibility: ProfileVisibility;
  isPublicProfile: boolean;
  showRankOnProfile: boolean;
  showPostsOnProfile: boolean;
  allowFollowers: boolean;
}
// Own profile (always fully visible to its owner).
export interface MySocialProfileView extends SocialProfileSettings {
  customerId: string;
  avatarUrl: string | null;
  followerCount: number;
  followingCount: number;
  score: number;
  rank: number | null;            // live all-time rank when public, else null
  likesCount: number; dislikesCount: number; commentsCount: number; postsCount: number;
  isMine: true;
}
// Another customer's profile. When private (and not the owner) only { customerId, isPrivate } is returned.
export interface PublicSocialProfileView {
  customerId: string;
  isPrivate: boolean;
  isMine: boolean;
  isBlockedByMe?: boolean;
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  rank?: number | null;
  score?: number;
  followerCount?: number;
  followingCount?: number;
  likedPostCount?: number;
  isFollowing?: boolean;
  allowFollowers?: boolean;
  showPostsOnProfile?: boolean;
  showRankOnProfile?: boolean;
}
export interface FollowEdgeView { customerId: string; displayName: string; avatarUrl: string | null; isPublic: boolean; isFollowing: boolean }
export interface FollowListResult { entries: FollowEdgeView[]; total: number }
export interface FollowingFeedResult { items: FollowingFeedItem[] }
export interface ProfilePostsResult { posts: ProfilePostCard[] }

export interface MyRankView {
  ranked: boolean;             // false when private or no eligible posts
  rank: number | null;
  score: number;
  likesCount: number; commentsCount: number; dislikesCount: number; postsCount: number;
  isPublic: boolean;
  reason?: string;             // when not ranked
}

export interface UpdateSocialProfileRequest {
  publicDisplayName?: string;
  bio?: string;
  profileVisibility?: ProfileVisibility;
  showRankOnProfile?: boolean;
  showPostsOnProfile?: boolean;
  allowFollowers?: boolean;
}

// ---- Helpers ----
export function nsClampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 10;
  // snap to the nearest allowed tier at or above the request, capped at 500
  const sorted = [...LEADERBOARD_LIMITS];
  for (const tier of sorted) if (n <= tier) return tier;
  return 500;
}
export function nsNormalizeScope(raw: unknown): LeaderboardScope {
  return (['platform', 'salon', 'branch', 'nearby'] as const).includes(raw as LeaderboardScope) ? (raw as LeaderboardScope) : 'platform';
}
export function nsNormalizePeriod(raw: unknown): LeaderboardPeriod {
  return (['all_time', 'weekly', 'monthly'] as const).includes(raw as LeaderboardPeriod) ? (raw as LeaderboardPeriod) : 'all_time';
}

export interface NSSocialValidation { ok: boolean; reason?: string }
export function nsValidateProfileUpdate(p: UpdateSocialProfileRequest): NSSocialValidation {
  if (p.publicDisplayName !== undefined && (p.publicDisplayName ?? '').length > NS_SOCIAL_MAX_DISPLAY_NAME) return { ok: false, reason: `Display name must be ${NS_SOCIAL_MAX_DISPLAY_NAME} characters or fewer.` };
  if (p.bio !== undefined && (p.bio ?? '').length > NS_SOCIAL_MAX_BIO) return { ok: false, reason: `Bio must be ${NS_SOCIAL_MAX_BIO} characters or fewer.` };
  if (p.profileVisibility !== undefined && p.profileVisibility !== 'public' && p.profileVisibility !== 'private') return { ok: false, reason: 'Invalid profile visibility.' };
  return { ok: true };
}

export class NailShowcaseSocialError extends Error {
  constructor(public code: 'not_customer' | 'invalid' | 'not_found' | 'forbidden' | 'conflict' | 'private', message: string) {
    super(message); this.name = 'NailShowcaseSocialError';
  }
}
