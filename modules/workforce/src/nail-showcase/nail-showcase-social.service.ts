/**
 * nail-showcase-social.service.ts — NailShowcaseSocialService. Owns customer social profiles (public/private + settings),
 * the follow graph, profile reports, and avatar. Enforces the privacy rules: a private profile is hidden from other
 * customers and excluded from rankings; you cannot follow a private profile or yourself; duplicate follows are rejected.
 * Delegates score/rank reads + recomputation to NailShowcaseRankingService.
 */
import type { NailShowcaseContext } from './nail-showcase.repository';
import type { PushService } from '@aipowersalon/communications';
import type { NailShowcaseSocialPort } from './nail-showcase-social.repository';
import { NailShowcaseRankingService } from './nail-showcase-ranking.service';
import {
  NailShowcaseSocialError, nsValidateProfileUpdate, NS_PRIVATE_OTHER_PROFILE_NOTICE,
  type MySocialProfileView, type PublicSocialProfileView, type UpdateSocialProfileRequest,
  type FollowEdgeView, type FollowListResult, type FollowingFeedResult,
} from './nail-showcase-social.dto';
import { buildMediaUrl } from '@aipowersalon/media';

export class NailShowcaseSocialService {
  constructor(private readonly repo: NailShowcaseSocialPort, private readonly ranking: NailShowcaseRankingService, private readonly push?: PushService) {}

  private customer(ctx: NailShowcaseContext): string {
    if (!ctx?.userId) throw new NailShowcaseSocialError('not_customer', 'You must be signed in as a customer.');
    return ctx.userId;
  }
  private async liveRank(customerId: string, isPublic: boolean): Promise<number | null> {
    if (!isPublic) return null;
    const info = await this.repo.customerRankAndScore({ customerId, scope: 'platform', period: 'all_time', tenantId: null, limit: 0, now: new Date() });
    return info?.rank ?? null;
  }

  // ---- my profile ----
  async getMyProfile(ctx: NailShowcaseContext): Promise<MySocialProfileView> {
    const customerId = this.customer(ctx);
    const p = await this.repo.ensureProfile(customerId, ctx.tenantId ?? null);
    const rank = await this.liveRank(customerId, p.is_public_profile);
    return this.toMyView(p, rank);
  }

  async updateMyProfile(ctx: NailShowcaseContext, patch: UpdateSocialProfileRequest): Promise<MySocialProfileView> {
    const customerId = this.customer(ctx);
    const v = nsValidateProfileUpdate(patch);
    if (!v.ok) throw new NailShowcaseSocialError('invalid', v.reason!);
    const before = await this.repo.ensureProfile(customerId, ctx.tenantId ?? null);

    const update: any = {};
    if (patch.publicDisplayName !== undefined) update.publicDisplayName = patch.publicDisplayName.trim().slice(0, 40) || null;
    if (patch.bio !== undefined) update.bio = patch.bio.trim().slice(0, 300) || null;
    if (patch.showRankOnProfile !== undefined) update.showRankOnProfile = patch.showRankOnProfile;
    if (patch.showPostsOnProfile !== undefined) update.showPostsOnProfile = patch.showPostsOnProfile;
    if (patch.allowFollowers !== undefined) update.allowFollowers = patch.allowFollowers;
    let visibilityChanged = false;
    if (patch.profileVisibility !== undefined) {
      const makePublic = patch.profileVisibility === 'public';
      update.profileVisibility = makePublic ? 'public' : 'private';
      update.isPublicProfile = makePublic;
      visibilityChanged = makePublic !== before.is_public_profile;
    }
    const after = await this.repo.updateProfile(customerId, update);
    // Entering/leaving public changes ranking eligibility → recompute (clears or computes rank, refreshes leaderboard membership).
    if (visibilityChanged) await this.ranking.recomputeCustomer(after.tenant_id, customerId);
    const fresh = await this.repo.getProfile(customerId) ?? after;
    const rank = await this.liveRank(customerId, fresh.is_public_profile);
    return this.toMyView(fresh, rank);
  }

  async setAvatar(ctx: NailShowcaseContext, url: string): Promise<{ avatarUrl: string }> {
    const customerId = this.customer(ctx);
    await this.repo.ensureProfile(customerId, ctx.tenantId ?? null);
    await this.repo.setAvatar(customerId, url);
    return { avatarUrl: buildMediaUrl(url) || '' };
  }

  // ---- another customer's profile ----
  async getPublicProfile(ctx: NailShowcaseContext, targetId: string): Promise<PublicSocialProfileView> {
    const viewer = this.customer(ctx);
    const isMine = viewer === targetId;
    const p = await this.repo.getProfile(targetId);
    if (isMine) {
      if (!p) { const created = await this.repo.ensureProfile(targetId, ctx.tenantId ?? null); return this.toPublicView(created, true, false, null); }
      const rank = await this.liveRank(targetId, p.is_public_profile);
      return this.toPublicView(p, true, await this.repo.isFollowing(viewer, targetId), rank);
    }
    const bs = await this.repo.blockState(viewer, targetId);
    if (bs.blockedMe) return { customerId: targetId, isPrivate: true, isMine: false }; // they blocked you → not viewable
    if (!p || !p.is_public_profile) return { customerId: targetId, isPrivate: true, isMine: false };
    const rank = p.show_rank_on_profile ? await this.liveRank(targetId, true) : null;
    const view = await this.toPublicView(p, false, await this.repo.isFollowing(viewer, targetId), rank);
    return { ...view, isBlockedByMe: bs.iBlocked };
  }

  // ---- follow / unfollow ----
  async follow(ctx: NailShowcaseContext, targetId: string): Promise<{ following: boolean; followerCount: number }> {
    const follower = this.customer(ctx);
    if (follower === targetId) throw new NailShowcaseSocialError('invalid', "You can't follow yourself.");
    const bs = await this.repo.blockState(follower, targetId);
    if (bs.iBlocked || bs.blockedMe) throw new NailShowcaseSocialError('forbidden', "You can't follow this customer.");
    const target = await this.repo.getProfile(targetId);
    if (!target || !target.is_public_profile) throw new NailShowcaseSocialError('forbidden', NS_PRIVATE_OTHER_PROFILE_NOTICE);
    if (!target.allow_followers) throw new NailShowcaseSocialError('forbidden', "This customer isn't accepting followers.");
    await this.repo.ensureProfile(follower, ctx.tenantId ?? null);
    const inserted = await this.repo.insertFollow(follower, targetId, ctx.tenantId ?? null, ctx.branchId || null);
    if (!inserted) throw new NailShowcaseSocialError('conflict', 'You already follow this customer.');
    const counts = await this.repo.recountFollows(targetId);
    await this.repo.recountFollows(follower);
    try {
      const who = (await this.repo.displayInfo([follower])).get(follower);
      const followTitle = `${who?.displayName ?? 'A customer'} started following you`;
      await this.repo.notifyUser({ tenantId: target.tenant_id, userId: targetId, type: 'nail_showcase', title: followTitle, body: null, reference: 'follow' });
      if (this.push) { try { await this.push.dispatchToUser(target.tenant_id, targetId, { title: 'A customer started following you', reference: 'follow', category: 'COMMUNITY' }); /* §61 (Phase 13 D): the follower's name stays in the in-app feed, never on a lock screen */ } catch { /* best-effort */ } }
    } catch { /* best-effort */ }
    return { following: true, followerCount: counts.followerCount };
  }
  async unfollow(ctx: NailShowcaseContext, targetId: string): Promise<{ following: boolean; followerCount: number }> {
    const follower = this.customer(ctx);
    await this.repo.deleteFollow(follower, targetId);
    const counts = await this.repo.recountFollows(targetId);
    await this.repo.recountFollows(follower);
    return { following: false, followerCount: counts.followerCount };
  }

  // ---- follow lists (own always allowed; others only if the target is public) ----
  async followers(ctx: NailShowcaseContext, targetId: string): Promise<FollowListResult> {
    return this.followList(ctx, targetId, () => this.repo.followerIds(targetId));
  }
  async following(ctx: NailShowcaseContext, targetId: string): Promise<FollowListResult> {
    return this.followList(ctx, targetId, () => this.repo.followingIds(targetId));
  }
  private async followList(ctx: NailShowcaseContext, targetId: string, idsFn: () => Promise<string[]>): Promise<FollowListResult> {
    const viewer = this.customer(ctx);
    if (viewer !== targetId) {
      const target = await this.repo.getProfile(targetId);
      if (!target || !target.is_public_profile) throw new NailShowcaseSocialError('private', NS_PRIVATE_OTHER_PROFILE_NOTICE);
    }
    const ids = await idsFn();
    const blocked = await this.repo.blockedEitherWayIds(viewer);
    const visibleIds = ids.filter((id) => !blocked.has(id));
    const display = await this.repo.displayInfo(visibleIds);
    const followed = await this.repo.whichFollowed(viewer, visibleIds);
    const entries: FollowEdgeView[] = visibleIds.map((id) => {
      const d = display.get(id);
      return { customerId: id, displayName: d?.displayName ?? 'Customer', avatarUrl: buildMediaUrl(d?.avatarUrl ?? null), isPublic: !!d?.isPublic, isFollowing: followed.has(id) };
    });
    return { entries, total: entries.length };
  }

  async followingFeed(ctx: NailShowcaseContext, limit = 30): Promise<FollowingFeedResult> {
    const viewer = this.customer(ctx);
    const rows = await this.repo.followingFeed(viewer, Math.min(Math.max(1, limit), 100));
    const blocked = await this.repo.blockedEitherWayIds(viewer);
    const visible = rows.filter((r) => !blocked.has(r.customerId));
    const display = await this.repo.displayInfo(visible.map((r) => r.customerId));
    return {
      items: visible.map((r) => {
        const d = display.get(r.customerId);
        return { postId: r.postId, customerId: r.customerId, displayName: d?.displayName ?? 'Customer', avatarUrl: buildMediaUrl(d?.avatarUrl ?? null), thumbnailUrl: r.thumbnailUrl, caption: r.caption, likeCount: r.likeCount, commentCount: r.commentCount, createdAt: r.createdAt };
      }),
    };
  }

  // ---- blocking: hides each party from the other and ends any follow relationship in both directions ----
  async block(ctx: NailShowcaseContext, targetId: string): Promise<{ blocked: boolean }> {
    const blocker = this.customer(ctx);
    if (blocker === targetId) throw new NailShowcaseSocialError('invalid', "You can't block yourself.");
    await this.repo.insertBlock(blocker, targetId, ctx.tenantId ?? null);
    await this.repo.deleteFollow(blocker, targetId);
    await this.repo.deleteFollow(targetId, blocker);
    await this.repo.recountFollows(blocker);
    await this.repo.recountFollows(targetId);
    return { blocked: true };
  }
  async unblock(ctx: NailShowcaseContext, targetId: string): Promise<{ blocked: boolean }> {
    const blocker = this.customer(ctx);
    await this.repo.deleteBlock(blocker, targetId);
    return { blocked: false };
  }
  async listBlocked(ctx: NailShowcaseContext): Promise<{ entries: { customerId: string; displayName: string; avatarUrl: string | null }[] }> {
    const blocker = this.customer(ctx);
    const ids = await this.repo.listBlocked(blocker);
    const display = await this.repo.displayInfo(ids);
    return { entries: ids.map((id) => { const d = display.get(id); return { customerId: id, displayName: d?.displayName ?? 'Customer', avatarUrl: buildMediaUrl(d?.avatarUrl ?? null) }; }) };
  }

  // ---- moderation ----
  async reportProfile(ctx: NailShowcaseContext, targetId: string, reason: string, details?: string): Promise<{ ok: true }> {
    const reporter = this.customer(ctx);
    if (reporter === targetId) throw new NailShowcaseSocialError('invalid', "You can't report your own profile.");
    await this.repo.addProfileReport({ tenantId: ctx.tenantId ?? null, reportedCustomerId: targetId, reportedByUserId: reporter, reason: (reason ?? 'other').slice(0, 80), details: details?.slice(0, 1000) ?? null });
    return { ok: true };
  }

  // ---- a customer's public posts (own always; others only when public + posts shown) ----
  async getProfilePosts(ctx: NailShowcaseContext, targetId: string, limit = 30): Promise<{ posts: { postId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }[] }> {
    const viewer = this.customer(ctx);
    if (viewer !== targetId) {
      const p = await this.repo.getProfile(targetId);
      if (!p || !p.is_public_profile || !p.show_posts_on_profile) throw new NailShowcaseSocialError('private', NS_PRIVATE_OTHER_PROFILE_NOTICE);
    }
    const posts = await this.repo.publicPostsOf(targetId, Math.min(Math.max(1, limit), 100));
    return { posts };
  }

  // ---- view mappers ----
  private toMyView(p: any, rank: number | null): MySocialProfileView {
    return {
      customerId: p.customer_id, publicDisplayName: p.public_display_name ?? null, avatarUrl: buildMediaUrl(p.avatar_url), bio: p.bio ?? null,
      profileVisibility: p.is_public_profile ? 'public' : 'private', isPublicProfile: !!p.is_public_profile,
      showRankOnProfile: !!p.show_rank_on_profile, showPostsOnProfile: !!p.show_posts_on_profile, allowFollowers: !!p.allow_followers,
      followerCount: Number(p.follower_count) || 0, followingCount: Number(p.following_count) || 0,
      score: Number(p.nail_showcase_score) || 0, rank,
      likesCount: Number(p.likes_count) || 0, dislikesCount: Number(p.dislikes_count) || 0, commentsCount: Number(p.comments_count) || 0, postsCount: Number(p.posts_count) || 0,
      isMine: true,
    };
  }
  // ---- admin moderation (super-admin): suspend a creator out of the rankings + the reported-creators queue ----
  async suspendProfile(ctx: NailShowcaseContext, targetCustomerId: string, suspended: boolean): Promise<{ customerId: string; suspended: boolean; rank: number | null; displayName: string }> {
    const profile = await this.repo.getProfile(targetCustomerId);
    if (!profile) throw new NailShowcaseSocialError('not_found', 'No NailShowcase profile for that customer.');
    await this.repo.setSuspended(targetCustomerId, suspended);
    // Recompute clears the rank (suspended → excluded from every board) or restores it (unsuspended).
    await this.ranking.recomputeCustomer(profile.tenant_id, targetCustomerId);
    await this.repo.writeAudit({
      tenantId: profile.tenant_id, branchId: null, userId: ctx.userId, role: ctx.role ?? null,
      actionType: suspended ? 'nail_showcase_profile_suspended' : 'nail_showcase_profile_unsuspended',
      entityType: 'customer_social_profile', entityId: targetCustomerId, metadata: { suspended },
    }).catch(() => {});
    const after = await this.repo.getProfile(targetCustomerId);
    const d = (await this.repo.displayInfo([targetCustomerId])).get(targetCustomerId);
    return { customerId: targetCustomerId, suspended, rank: after?.nail_showcase_rank_all_time ?? null, displayName: d?.displayName ?? 'Customer' };
  }

  async listReportedProfiles(_ctx: NailShowcaseContext): Promise<{ customerId: string; displayName: string; avatarUrl: string | null; reportCount: number; lastReportedAt: string | null; isSuspended: boolean; isPublic: boolean; rank: number | null; score: number }[]> {
    const rows = await this.repo.listReportedProfiles();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.customerId);
    const display = await this.repo.displayInfo(ids);
    const profiles = await Promise.all(ids.map((id) => this.repo.getProfile(id)));
    const byId = new Map(profiles.filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.customer_id, p]));
    return rows.map((r) => {
      const p = byId.get(r.customerId);
      const d = display.get(r.customerId);
      return {
        customerId: r.customerId, displayName: d?.displayName ?? 'Customer', avatarUrl: buildMediaUrl(p?.avatar_url ?? null),
        reportCount: r.reportCount, lastReportedAt: r.lastReportedAt,
        isSuspended: !!p?.is_suspended, isPublic: !!p?.is_public_profile,
        rank: p?.nail_showcase_rank_all_time ?? null, score: Number(p?.nail_showcase_score) || 0,
      };
    });
  }

  private async toPublicView(p: any, isMine: boolean, isFollowing: boolean, rank: number | null): Promise<PublicSocialProfileView> {
    const d = (await this.repo.displayInfo([p.customer_id])).get(p.customer_id);
    return {
      customerId: p.customer_id, isPrivate: !p.is_public_profile, isMine,
      displayName: d?.displayName ?? 'Customer', avatarUrl: buildMediaUrl(p.avatar_url), bio: p.bio ?? null,
      rank, score: Number(p.nail_showcase_score) || 0,
      followerCount: Number(p.follower_count) || 0, followingCount: Number(p.following_count) || 0,
      likedPostCount: await this.repo.likedPostCount(p.customer_id),
      isFollowing, allowFollowers: !!p.allow_followers, showPostsOnProfile: !!p.show_posts_on_profile, showRankOnProfile: !!p.show_rank_on_profile,
    };
  }
}
