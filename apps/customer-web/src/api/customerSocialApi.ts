// customerSocialApi.ts — Customer app client for the NailShowcase social profile surface (/customer/social/*). The
// server derives the customer from the session; reads are server-truth. Avatar upload uses fetch+FormData directly
// because the shared `api` helper is JSON-only.
import { api } from './client';

export type ProfileVisibility = 'public' | 'private';

export interface MySocialProfile {
  customerId: string; publicDisplayName: string | null; avatarUrl: string | null; bio: string | null;
  profileVisibility: ProfileVisibility; isPublicProfile: boolean;
  showRankOnProfile: boolean; showPostsOnProfile: boolean; allowFollowers: boolean;
  followerCount: number; followingCount: number; score: number; rank: number | null;
  likesCount: number; dislikesCount: number; commentsCount: number; postsCount: number; isMine: true;
}
export interface PublicSocialProfile {
  customerId: string; isPrivate: boolean; isMine: boolean; isBlockedByMe?: boolean;
  displayName?: string; avatarUrl?: string | null; bio?: string | null;
  rank?: number | null; score?: number; followerCount?: number; followingCount?: number; likedPostCount?: number;
  isFollowing?: boolean; allowFollowers?: boolean; showPostsOnProfile?: boolean; showRankOnProfile?: boolean;
}
export interface UpdateSocialProfileBody {
  publicDisplayName?: string; bio?: string; profileVisibility?: ProfileVisibility;
  showRankOnProfile?: boolean; showPostsOnProfile?: boolean; allowFollowers?: boolean;
}
export interface ProfilePostCard { postId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }

// Exact privacy copy shown before a customer makes their profile public (kept in sync with the backend dto).
export const NS_PUBLIC_PROFILE_WARNING =
  'If your profile is public, other customers can see your avatar, display name, NailShowcase posts, follower count, and your current NailShowcase rank. Your phone number, email, payment information, private appointments, receipts, and personal account details will never be shown.';
export const NS_PUBLIC_CONFIRM_LABEL = 'I understand what will be public.';
export const NS_PRIVATE_PROFILE_NOTICE = 'Your profile is private. Other customers cannot view your profile or see you in public rankings.';
export const NS_PRIVATE_OWN_PROFILE_NOTICE = 'Your profile is private. Make it public to appear in NailShowcase rankings.';
export const NS_PRIVATE_OTHER_PROFILE_NOTICE = 'This profile is private.';

export const customerSocialApi = {
  myProfile: () => api.get<MySocialProfile>('/customer/social/me/profile'),
  updateMyProfile: (b: UpdateSocialProfileBody) => api.patch<MySocialProfile>('/customer/social/me/profile', b as Record<string, unknown>),
  profile: (customerId: string) => api.get<PublicSocialProfile>(`/customer/social/profile/${customerId}`),
  profilePosts: (customerId: string) => api.get<{ posts: ProfilePostCard[] }>(`/customer/social/profile/${customerId}/posts`),
  report: (customerId: string, reason: string, details?: string) => api.post<{ ok: true }>(`/customer/social/profile/${customerId}/report`, { reason, details }),
  async uploadAvatar(file: File): Promise<{ avatarUrl: string }> {
    const { apiBase } = await import('./client');
    const { authHeader } = await import('../auth/native-auth');
    const fd = new FormData();
    fd.append('file', file);
    const bearer = await authHeader();
    const res = await fetch(`${apiBase()}/customer/social/me/avatar`, {
      method: 'POST',
      body: fd,
      credentials: 'include',
      headers: { ...bearer },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Could not upload avatar.');
    return res.json();
  },
};
