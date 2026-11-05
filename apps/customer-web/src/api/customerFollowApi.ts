// customerFollowApi.ts — Customer app client for the follow graph (/customer/social/follow + follow lists +
// following-feed). Session-scoped; the server enforces privacy (cannot follow a private profile, etc.).
import { api } from './client';

export interface FollowEdge { customerId: string; displayName: string; avatarUrl: string | null; isPublic: boolean; isFollowing: boolean }
export interface FollowList { entries: FollowEdge[]; total: number }
export interface FollowingFeedItem { postId: string; customerId: string; displayName: string; avatarUrl: string | null; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }
export interface BlockedAccount { customerId: string; displayName: string; avatarUrl: string | null }

export const customerFollowApi = {
  follow: (customerId: string) => api.post<{ following: boolean; followerCount: number }>(`/customer/social/follow/${customerId}`),
  unfollow: (customerId: string) => api.del<{ following: boolean; followerCount: number }>(`/customer/social/follow/${customerId}`),
  followers: (customerId: string) => api.get<FollowList>(`/customer/social/profile/${customerId}/followers`),
  following: (customerId: string) => api.get<FollowList>(`/customer/social/profile/${customerId}/following`),
  followingFeed: () => api.get<{ items: FollowingFeedItem[] }>('/customer/social/me/following-feed'),
  block: (customerId: string) => api.post<{ blocked: boolean }>(`/customer/social/block/${customerId}`),
  unblock: (customerId: string) => api.del<{ blocked: boolean }>(`/customer/social/block/${customerId}`),
  blocked: () => api.get<{ entries: BlockedAccount[] }>('/customer/social/me/blocked'),
};
