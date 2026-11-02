// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: customer. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type NSVisibility = 'public_platform' | 'salon_only' | 'private';

export type NSPostType = 'verified_service' | 'manual_upload';

export type NSPostStatus = 'draft' | 'pending_review' | 'published' | 'hidden' | 'removed' | 'reported';

export type NSCommentStatus = 'published' | 'hidden' | 'removed' | 'reported';

export type NSReactionType = 'like' | 'dislike';

export type NSFeedSort = 'newest' | 'most_liked' | 'most_commented' | 'trending';

export type NSFeedScope = 'for_you' | 'salon' | 'public' | 'mine';

export interface NSPhotoView { id: string; imageUrl: string; thumbnailUrl: string | null; sortOrder: number; caption: string | null }

export interface NSPostView {
  id: string; caption: string; tags: string[]; visibility: NSVisibility; postType: NSPostType; status: NSPostStatus;
  isVerifiedService: boolean; allowComments: boolean; displayName: string;
  salonTenantId: string | null; branchId: string | null; technicianId: string | null; serviceId: string | null;
  salonName: string | null; technicianName: string | null; serviceName: string | null;
  likeCount: number; dislikeCount: number; commentCount: number; reportCount: number;
  myReaction: NSReactionType | null; isMine: boolean; photos: NSPhotoView[]; createdAt: string;
}

export interface NSFeedResult { posts: NSPostView[]; nextCursor: string | null }

export interface NSEligibility { eligible: boolean; reason?: string; ticketId?: string; appointmentId?: string | null; technicianId?: string | null; serviceId?: string | null; alreadyPosted?: boolean }

// ── Social: following feed, leaderboard, profile cards, photo consent (Constitution 13 §15: the wire shapes, defined once) ──
export interface FollowingFeedItem { postId: string; customerId: string; displayName: string; avatarUrl: string | null; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }
export type LeaderboardPeriod = 'all_time' | 'weekly' | 'monthly';
export type LeaderboardScope = 'platform' | 'salon' | 'branch' | 'nearby';
export interface NailShowcaseLeaderboardEntry {
  rank: number;
  customerId: string;
  displayName: string;
  avatarUrl?: string | null;
  score: number;
  likesCount: number;
  commentsCount: number;
  dislikesCount: number;
  postsCount: number;
  followerCount: number;
  isFollowing?: boolean;
  isMe?: boolean;
}
export interface LeaderboardResult {
  scope: LeaderboardScope; period: LeaderboardPeriod; limit: number;
  entries: NailShowcaseLeaderboardEntry[];
}
export interface ProfilePostCard { postId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }
export type ProfileVisibility = 'public' | 'private';
export interface MyConsentedPhoto {
  photoId: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  approvedUses: string[];
  publicBlocked: boolean;
  consentedAt: string;
}
