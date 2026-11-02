/**
 * nail-showcase-ranking.service.ts — NailShowcaseRankingService. Owns the engagement score: recomputes a customer's
 * total from their eligible posts on every triggering event, keeps the denormalized summary + snapshot fresh, computes
 * the live leaderboard + "my rank" from a sorted query (never a stale fixed rank), and notifies on Top-10/Top-20
 * milestones. Private/suspended customers are excluded from all rankings.
 */
import type { NailShowcaseSocialPort } from './nail-showcase-social.repository';
import type { PushService } from '@aipowersalon/communications';
import { haversineMiles } from '@aipowersalon/customers';
import {
  nsRankingCustomerScore, type NailShowcaseLeaderboardEntry, type LeaderboardResult, type MyRankView,
  type LeaderboardScope, type LeaderboardPeriod,
} from './nail-showcase-social.dto';

export class NailShowcaseRankingService {
  constructor(private readonly repo: NailShowcaseSocialPort, private readonly push?: PushService) {}

  /** Recompute one customer's score across their eligible posts; refresh denorm + all-time snapshot + rank; notify on
   *  entering or dropping out of the Top-10/Top-20 tiers. No-op when the customer has no social profile row (private). */
  async recomputeCustomer(tenantId: string | null, customerId: string): Promise<void> {
    const profile = await this.repo.getProfile(customerId);
    if (!profile) return; // not enrolled → private by default, nothing to rank
    const posts = await this.repo.eligiblePostsOf(customerId);
    const score = nsRankingCustomerScore(posts);
    const likes = posts.reduce((s, p) => s + p.likeCount, 0);
    const comments = posts.reduce((s, p) => s + p.commentCount, 0);
    const dislikes = posts.reduce((s, p) => s + p.dislikeCount, 0);
    const summary = { score, likes, dislikes, comments, posts: posts.length };
    await this.repo.setScoreSummary(customerId, summary);

    // Live all-time/platform rank (null when private or no eligible posts).
    const prevRank = profile.nail_showcase_rank_all_time;
    const info = profile.is_public_profile
      ? await this.repo.customerRankAndScore({ customerId, scope: 'platform', period: 'all_time', tenantId: null, limit: 0, now: new Date() })
      : null;
    const newRank = info?.rank ?? null;
    await this.repo.setRankAllTime(customerId, newRank);
    await this.repo.upsertSnapshot(customerId, tenantId, 'platform', 'all_time', { ...summary, rank: newRank });

    if (profile.is_public_profile && newRank != null) await this.maybeNotifyRankChange(profile.tenant_id, customerId, prevRank, newRank);
  }

  private async maybeNotifyRankChange(tenantId: string | null, customerId: string, prevRank: number | null, newRank: number): Promise<void> {
    // Significant, low-noise rank events at the two headline tier boundaries (Top 10 / Top 20): notify on entering a
    // tier (climb) and on dropping out of a tier the customer held (slide). Small fluctuations that don't cross a
    // boundary are intentionally silent so the feed isn't spammed.
    const crossedInto = (tier: number) => newRank <= tier && (prevRank == null || prevRank > tier);
    const droppedOutOf = (tier: number) => prevRank != null && prevRank <= tier && newRank > tier;
    let title: string | null = null;
    let body = 'Keep sharing to climb higher.';
    if (crossedInto(10)) title = `You reached the Top 10 — you're #${newRank} on NailShowcase!`;
    else if (crossedInto(20)) title = `You reached the Top 20 — you're #${newRank} on NailShowcase!`;
    else if (droppedOutOf(10)) { title = `Your NailShowcase rank dropped out of the Top 10 — you're now #${newRank}.`; body = 'Share a fresh design to climb back up.'; }
    else if (droppedOutOf(20)) { title = `Your NailShowcase rank dropped out of the Top 20 — you're now #${newRank}.`; body = 'Share a fresh design to climb back up.'; }
    if (!title) return;
    try { await this.repo.notifyUser({ tenantId, userId: customerId, type: 'nail_showcase', title, body, reference: 'leaderboard' }); } catch { /* best-effort */ }
    // also push to the customer's registered devices (best-effort; no-op if they have none or push isn't wired)
    if (this.push) { try { await this.push.dispatchToUser(tenantId, customerId, { title, body, reference: 'leaderboard', category: 'COMMUNITY' }); } catch { /* best-effort */ } }
  }

  async leaderboard(viewerId: string | null, opts: { limit: number; period: LeaderboardPeriod; scope: LeaderboardScope; tenantId: string | null; branchId?: string | null }): Promise<LeaderboardResult> {
    const nearbyBranchIds = opts.scope === 'nearby' ? await this.resolveNearbyBranchIds(opts.branchId ?? null) : undefined;
    const rows = await this.repo.leaderboard({ scope: opts.scope, period: opts.period, tenantId: opts.tenantId, limit: opts.limit, now: new Date(), nearbyBranchIds });
    const ids = rows.map((r) => r.customerId);
    const display = await this.repo.displayInfo(ids);
    const followed = viewerId ? await this.repo.whichFollowed(viewerId, ids) : new Set<string>();
    const entries: NailShowcaseLeaderboardEntry[] = rows.map((r) => {
      const d = display.get(r.customerId);
      return {
        rank: r.rank, customerId: r.customerId, displayName: d?.displayName ?? 'Customer', avatarUrl: d?.avatarUrl ?? null,
        score: r.score, likesCount: r.likes, commentsCount: r.comments, dislikesCount: r.dislikes, postsCount: r.posts,
        followerCount: r.followerCount, isFollowing: followed.has(r.customerId), isMe: viewerId === r.customerId,
      };
    });
    return { scope: opts.scope, period: opts.period, limit: opts.limit, entries };
  }

  // "Nearby" = posts at branches within RADIUS_MILES of the viewer's branch (haversine, service-tier — same approach as
  // the salon directory). Returns undefined when there's no usable anchor; the repo then treats nearby like the
  // platform board, so the scope degrades gracefully instead of erroring or returning nothing.
  private async resolveNearbyBranchIds(anchorBranchId: string | null): Promise<string[] | undefined> {
    const RADIUS_MILES = 50;
    if (!anchorBranchId) return undefined;
    const coords = await this.repo.listBranchCoords();
    const anchor = coords.find((c) => c.branchId === anchorBranchId);
    if (!anchor) return undefined;
    return coords.filter((c) => haversineMiles(anchor.latitude, anchor.longitude, c.latitude, c.longitude) <= RADIUS_MILES).map((c) => c.branchId);
  }

  async myRank(viewerId: string, tenantId: string | null): Promise<MyRankView> {
    const profile = await this.repo.getProfile(viewerId);
    const isPublic = !!profile?.is_public_profile;
    if (!profile || !isPublic) {
      return { ranked: false, rank: null, score: profile?.nail_showcase_score ?? 0, likesCount: profile?.likes_count ?? 0, commentsCount: profile?.comments_count ?? 0, dislikesCount: profile?.dislikes_count ?? 0, postsCount: profile?.posts_count ?? 0, isPublic, reason: 'Make your profile public to appear in NailShowcase rankings.' };
    }
    const info = await this.repo.customerRankAndScore({ customerId: viewerId, scope: 'platform', period: 'all_time', tenantId: null, limit: 0, now: new Date() });
    if (!info) return { ranked: false, rank: null, score: 0, likesCount: 0, commentsCount: 0, dislikesCount: 0, postsCount: 0, isPublic: true, reason: 'Share a public NailShowcase post to join the rankings.' };
    return { ranked: true, rank: info.rank, score: info.score, likesCount: info.likes, commentsCount: info.comments, dislikesCount: info.dislikes, postsCount: info.posts, isPublic: true };
  }
}
