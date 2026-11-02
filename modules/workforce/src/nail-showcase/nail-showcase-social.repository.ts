/**
 * nail-showcase-social.repository.ts — persistence port for NailShowcase Social Ranking + an erroring stub (the feature
 * requires a database). The Kysely implementation lives in nail-showcase-social.kysely.repository.ts.
 */
import type { LeaderboardScope, LeaderboardPeriod } from './nail-showcase-social.dto';

export interface SocialProfileRow {
  id: string; customer_id: string; tenant_id: string | null;
  public_display_name: string | null; avatar_url: string | null; bio: string | null;
  profile_visibility: string; is_public_profile: boolean;
  show_rank_on_profile: boolean; show_posts_on_profile: boolean; allow_followers: boolean; is_suspended: boolean;
  follower_count: number; following_count: number;
  nail_showcase_score: number; nail_showcase_rank_all_time: number | null;
  likes_count: number; dislikes_count: number; comments_count: number; posts_count: number;
  created_at: string; updated_at: string;
}
export interface DisplayInfo { displayName: string; avatarUrl: string | null; isPublic: boolean; isSuspended: boolean }
export interface LeaderboardRow {
  customerId: string; score: number; likes: number; comments: number; dislikes: number; posts: number; followerCount: number; rank: number;
}
export interface ProfileUpdatePatch {
  publicDisplayName?: string | null; bio?: string | null;
  profileVisibility?: string; isPublicProfile?: boolean;
  showRankOnProfile?: boolean; showPostsOnProfile?: boolean; allowFollowers?: boolean;
}
export interface ScoreSummary { score: number; likes: number; dislikes: number; comments: number; posts: number }
export interface LeaderboardQuery { scope: LeaderboardScope; period: LeaderboardPeriod; tenantId: string | null; limit: number; now: Date; nearbyBranchIds?: string[] }
export interface ReportedProfileRow { customerId: string; reportCount: number; lastReportedAt: string | null }
export interface BranchCoord { branchId: string; latitude: number; longitude: number }

export interface NailShowcaseSocialPort {
  // profiles
  getProfile(customerId: string): Promise<SocialProfileRow | null>;
  ensureProfile(customerId: string, tenantId: string | null): Promise<SocialProfileRow>;
  updateProfile(customerId: string, patch: ProfileUpdatePatch): Promise<SocialProfileRow>;
  setAvatar(customerId: string, url: string): Promise<void>;
  setScoreSummary(customerId: string, s: ScoreSummary): Promise<void>;
  setRankAllTime(customerId: string, rank: number | null): Promise<void>;
  upsertSnapshot(customerId: string, tenantId: string | null, scope: string, period: string, s: ScoreSummary & { rank: number | null }): Promise<void>;

  // identity for rendering (display name prefers profile name, else users first + last initial; avatar from profile)
  displayInfo(customerIds: string[]): Promise<Map<string, DisplayInfo>>;

  // follows
  isFollowing(follower: string, following: string): Promise<boolean>;
  insertFollow(follower: string, following: string, tenantId: string | null, branchId: string | null): Promise<boolean>;
  deleteFollow(follower: string, following: string): Promise<boolean>;
  recountFollows(customerId: string): Promise<{ followerCount: number; followingCount: number }>;
  // ---- customer-to-customer blocks ----
  insertBlock(blocker: string, blocked: string, tenantId: string | null): Promise<void>;
  deleteBlock(blocker: string, blocked: string): Promise<boolean>;
  blockState(viewer: string, target: string): Promise<{ iBlocked: boolean; blockedMe: boolean }>;
  listBlocked(blocker: string): Promise<string[]>;
  /** All user ids in a block relationship with userId, in either direction — used to filter lists + feed. */
  blockedEitherWayIds(userId: string): Promise<Set<string>>;
  followerIds(customerId: string): Promise<string[]>;
  followingIds(customerId: string): Promise<string[]>;
  whichFollowed(viewer: string, candidates: string[]): Promise<Set<string>>;
  likedPostCount(customerId: string): Promise<number>;
  /** Recent eligible posts authored by people the viewer follows (lightweight cards, public-platform, published). */
  followingFeed(viewerId: string, limit: number): Promise<{ postId: string; customerId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }[]>;
  publicPostsOf(customerId: string, limit: number): Promise<{ postId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }[]>;

  // scoring / leaderboard
  eligiblePostsOf(customerId: string): Promise<{ likeCount: number; commentCount: number; dislikeCount: number }[]>;
  leaderboard(q: LeaderboardQuery): Promise<LeaderboardRow[]>;
  customerRankAndScore(q: { customerId: string } & LeaderboardQuery): Promise<{ rank: number; score: number; likes: number; comments: number; dislikes: number; posts: number } | null>;

  // notifications + moderation (reuse existing customer_notifications + nail_showcase_reports)
  notifyUser(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void>;
  addProfileReport(input: { tenantId: string | null; reportedCustomerId: string; reportedByUserId: string; reason: string; details: string | null }): Promise<void>;

  // admin moderation (super-admin): suspend a profile out of the rankings, list reported profiles, audit the action
  setSuspended(customerId: string, suspended: boolean): Promise<void>;
  listReportedProfiles(): Promise<ReportedProfileRow[]>;
  writeAudit(input: { tenantId: string | null; branchId: string | null; userId: string; role: string | null; actionType: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void>;
  /** Branches that have coordinates — used to resolve the "nearby" leaderboard scope (haversine in the service tier). */
  listBranchCoords(): Promise<BranchCoord[]>;
}

const NO = (): never => { throw new Error('NailShowcase social requires a database connection (no DB handle bound).'); };
export class StubNailShowcaseSocialRepository implements NailShowcaseSocialPort {
  getProfile() { return NO(); }
  ensureProfile() { return NO(); }
  updateProfile() { return NO(); }
  setAvatar() { return NO(); }
  setScoreSummary() { return NO(); }
  setRankAllTime() { return NO(); }
  upsertSnapshot() { return NO(); }
  displayInfo() { return NO(); }
  isFollowing() { return NO(); }
  insertFollow() { return NO(); }
  deleteFollow() { return NO(); }
  recountFollows() { return NO(); }
  followerIds() { return NO(); }
  followingIds() { return NO(); }
  whichFollowed() { return NO(); }
  likedPostCount() { return NO(); }
  followingFeed() { return NO(); }
  publicPostsOf() { return NO(); }
  eligiblePostsOf() { return NO(); }
  leaderboard() { return NO(); }
  customerRankAndScore() { return NO(); }
  notifyUser() { return NO(); }
  addProfileReport() { return NO(); }
  setSuspended() { return Promise.resolve(); }
  listReportedProfiles() { return Promise.resolve([]); }
  writeAudit() { return Promise.resolve(); }
  listBranchCoords() { return Promise.resolve([]); }
  insertBlock() { return NO(); }
  deleteBlock() { return NO(); }
  blockState() { return NO(); }
  listBlocked() { return NO(); }
  blockedEitherWayIds() { return NO(); }
}
