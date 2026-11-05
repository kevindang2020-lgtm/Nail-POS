/**
 * nail-showcase-social.kysely.repository.ts — Postgres/Kysely implementation of the social ranking port. Profiles +
 * follows are straightforward CRUD; the leaderboard and "my rank" are computed LIVE from a sorted aggregation over the
 * existing nail_showcase_posts (per-post score clamped at 0 via GREATEST, summed per author, joined to PUBLIC, non-
 * suspended profiles) so ranks are always fresh and never stale-locked. A denormalized score summary on the profile is
 * also maintained (by the service) for the fast my-rank/profile read and milestone notifications.
 */
import { runAcrossTenants } from '@aipowersalon/database';
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { nsDisplayName } from './nail-showcase.dto';
import type {
  NailShowcaseSocialPort, SocialProfileRow, DisplayInfo, LeaderboardRow, ProfileUpdatePatch, ScoreSummary, LeaderboardQuery, ReportedProfileRow, BranchCoord,
} from './nail-showcase-social.repository';

const EXCLUDED_USER_STATUS = ['suspended', 'banned', 'disabled', 'deleted'];

export class KyselyNailShowcaseSocialRepository implements NailShowcaseSocialPort {
  constructor(private readonly db: Kysely<DB>) {}

  // ---- profiles ----
  async getProfile(customerId: string): Promise<SocialProfileRow | null> {
    const r = await this.db.selectFrom('customer_social_profiles').selectAll().where('customer_id', '=', customerId).executeTakeFirst();
    return (r as any) ?? null;
  }
  async ensureProfile(customerId: string, tenantId: string | null): Promise<SocialProfileRow> {
    const existing = await this.getProfile(customerId);
    if (existing) return existing;
    await this.db.insertInto('customer_social_profiles')
      .values({ customer_id: customerId, tenant_id: tenantId } as any)
      .onConflict((oc) => oc.column('customer_id').doNothing())
      .execute();
    return (await this.getProfile(customerId))!;
  }
  async updateProfile(customerId: string, patch: ProfileUpdatePatch): Promise<SocialProfileRow> {
    const set: any = { updated_at: sql`now()` };
    if (patch.publicDisplayName !== undefined) set.public_display_name = patch.publicDisplayName;
    if (patch.bio !== undefined) set.bio = patch.bio;
    if (patch.profileVisibility !== undefined) set.profile_visibility = patch.profileVisibility;
    if (patch.isPublicProfile !== undefined) set.is_public_profile = patch.isPublicProfile;
    if (patch.showRankOnProfile !== undefined) set.show_rank_on_profile = patch.showRankOnProfile;
    if (patch.showPostsOnProfile !== undefined) set.show_posts_on_profile = patch.showPostsOnProfile;
    if (patch.allowFollowers !== undefined) set.allow_followers = patch.allowFollowers;
    await this.db.updateTable('customer_social_profiles').set(set).where('customer_id', '=', customerId).execute();
    return (await this.getProfile(customerId))!;
  }
  async setAvatar(customerId: string, url: string): Promise<void> {
    await this.db.updateTable('customer_social_profiles').set({ avatar_url: url, updated_at: sql`now()` } as any).where('customer_id', '=', customerId).execute();
  }
  async setScoreSummary(customerId: string, s: ScoreSummary): Promise<void> {
    await this.db.updateTable('customer_social_profiles').set({
      nail_showcase_score: s.score, likes_count: s.likes, dislikes_count: s.dislikes, comments_count: s.comments, posts_count: s.posts, updated_at: sql`now()`,
    } as any).where('customer_id', '=', customerId).execute();
  }
  async setRankAllTime(customerId: string, rank: number | null): Promise<void> {
    await this.db.updateTable('customer_social_profiles').set({ nail_showcase_rank_all_time: rank, updated_at: sql`now()` } as any).where('customer_id', '=', customerId).execute();
  }
  async upsertSnapshot(customerId: string, tenantId: string | null, scope: string, period: string, s: ScoreSummary & { rank: number | null }): Promise<void> {
    await this.db.insertInto('nail_showcase_customer_score_snapshots').values({
      customer_id: customerId, tenant_id: tenantId, scope, period, score: s.score,
      likes_count: s.likes, dislikes_count: s.dislikes, comments_count: s.comments, posts_count: s.posts, rank: s.rank, calculated_at: sql`now()`,
    } as any).onConflict((oc) => oc.columns(['customer_id', 'scope', 'period']).doUpdateSet({
      score: s.score, likes_count: s.likes, dislikes_count: s.dislikes, comments_count: s.comments, posts_count: s.posts, rank: s.rank, calculated_at: sql`now()`, updated_at: sql`now()`,
    } as any)).execute();
  }

  // ---- identity ----
  async displayInfo(customerIds: string[]): Promise<Map<string, DisplayInfo>> {
    const out = new Map<string, DisplayInfo>();
    const ids = [...new Set(customerIds)].filter(Boolean);
    if (!ids.length) return out;
    const rows: any[] = await this.db.selectFrom('users')
      .leftJoin('customer_social_profiles', 'customer_social_profiles.customer_id', 'users.id')
      .select(['users.id as id', 'users.first_name as first_name', 'users.last_name as last_name', 'users.status as status',
        'customer_social_profiles.public_display_name as pdn', 'customer_social_profiles.avatar_url as avatar',
        'customer_social_profiles.is_public_profile as is_public', 'customer_social_profiles.is_suspended as is_suspended'])
      .where('users.id', 'in', ids).execute();
    for (const r of rows) {
      out.set(r.id, {
        displayName: nsDisplayName({ displayName: r.pdn, firstName: r.first_name, lastName: r.last_name }),
        avatarUrl: r.avatar ?? null,
        isPublic: !!r.is_public,
        isSuspended: !!r.is_suspended || EXCLUDED_USER_STATUS.includes((r.status ?? '').toLowerCase()),
      });
    }
    return out;
  }

  // ---- follows ----
  async isFollowing(follower: string, following: string): Promise<boolean> {
    const r = await this.db.selectFrom('customer_follows').select('id').where('follower_customer_id', '=', follower).where('following_customer_id', '=', following).executeTakeFirst();
    return !!r;
  }
  async insertFollow(follower: string, following: string, tenantId: string | null, branchId: string | null): Promise<boolean> {
    const res = await this.db.insertInto('customer_follows')
      .values({ follower_customer_id: follower, following_customer_id: following, tenant_id: tenantId, branch_id: branchId } as any)
      .onConflict((oc) => oc.columns(['follower_customer_id', 'following_customer_id']).doNothing())
      .returning('id').execute();
    return res.length > 0;
  }
  async deleteFollow(follower: string, following: string): Promise<boolean> {
    const res = await this.db.deleteFrom('customer_follows').where('follower_customer_id', '=', follower).where('following_customer_id', '=', following).returning('id').execute();
    return res.length > 0;
  }
  async recountFollows(customerId: string): Promise<{ followerCount: number; followingCount: number }> {
    const fr: any = await this.db.selectFrom('customer_follows').select(this.db.fn.countAll<string>().as('n')).where('following_customer_id', '=', customerId).executeTakeFirst();
    const fg: any = await this.db.selectFrom('customer_follows').select(this.db.fn.countAll<string>().as('n')).where('follower_customer_id', '=', customerId).executeTakeFirst();
    const followerCount = Number(fr?.n) || 0, followingCount = Number(fg?.n) || 0;
    await this.db.updateTable('customer_social_profiles').set({ follower_count: followerCount, following_count: followingCount, updated_at: sql`now()` } as any).where('customer_id', '=', customerId).execute();
    return { followerCount, followingCount };
  }
  async followerIds(customerId: string): Promise<string[]> {
    const rows: any[] = await this.db.selectFrom('customer_follows').select('follower_customer_id').where('following_customer_id', '=', customerId).orderBy('created_at', 'desc').execute();
    return rows.map((r) => r.follower_customer_id);
  }
  async followingIds(customerId: string): Promise<string[]> {
    const rows: any[] = await this.db.selectFrom('customer_follows').select('following_customer_id').where('follower_customer_id', '=', customerId).orderBy('created_at', 'desc').execute();
    return rows.map((r) => r.following_customer_id);
  }
  async whichFollowed(viewer: string, candidates: string[]): Promise<Set<string>> {
    const ids = [...new Set(candidates)].filter(Boolean);
    if (!ids.length || !viewer) return new Set();
    const rows: any[] = await this.db.selectFrom('customer_follows').select('following_customer_id').where('follower_customer_id', '=', viewer).where('following_customer_id', 'in', ids).execute();
    return new Set(rows.map((r) => r.following_customer_id));
  }
  async likedPostCount(customerId: string): Promise<number> {
    const r: any = await this.db.selectFrom('nail_showcase_reactions').select(this.db.fn.countAll<string>().as('n')).where('customer_id', '=', customerId).where('reaction_type', '=', 'like').executeTakeFirst();
    return Number(r?.n) || 0;
  }
  async followingFeed(viewerId: string, limit: number): Promise<{ postId: string; customerId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }[]> {
    const rows: any[] = await this.db.selectFrom('nail_showcase_posts as p')
      .innerJoin('customer_follows as f', (j) => j.onRef('f.following_customer_id', '=', 'p.customer_id').on('f.follower_customer_id', '=', viewerId))
      .innerJoin('customer_social_profiles as sp', 'sp.customer_id', 'p.customer_id')
      .leftJoin('nail_showcase_photos as ph', (j) => j.onRef('ph.post_id', '=', 'p.id').on('ph.sort_order', '=', 0))
      .select(['p.id as id', 'p.customer_id as customer_id', 'p.caption as caption', 'p.like_count as like_count', 'p.comment_count as comment_count', 'p.created_at as created_at', 'ph.thumbnail_url as thumb', 'ph.image_url as image'])
      .where('p.deleted_at', 'is', null).where('p.status', '=', 'published').where('p.visibility', '=', 'public_platform')
      .where('sp.is_public_profile', '=', true).where('sp.is_suspended', '=', false)
      .orderBy('p.created_at', 'desc').limit(limit).execute();
    return rows.map((r) => ({ postId: r.id, customerId: r.customer_id, thumbnailUrl: r.thumb ?? r.image ?? null, caption: r.caption ?? '', likeCount: Number(r.like_count) || 0, commentCount: Number(r.comment_count) || 0, createdAt: String(r.created_at) }));
  }
  async publicPostsOf(customerId: string, limit: number): Promise<{ postId: string; thumbnailUrl: string | null; caption: string; likeCount: number; commentCount: number; createdAt: string }[]> {
    const rows: any[] = await this.db.selectFrom('nail_showcase_posts as p')
      .leftJoin('nail_showcase_photos as ph', (j) => j.onRef('ph.post_id', '=', 'p.id').on('ph.sort_order', '=', 0))
      .select(['p.id as id', 'p.caption as caption', 'p.like_count as like_count', 'p.comment_count as comment_count', 'p.created_at as created_at', 'ph.thumbnail_url as thumb', 'ph.image_url as image'])
      .where('p.customer_id', '=', customerId).where('p.deleted_at', 'is', null).where('p.status', '=', 'published').where('p.visibility', '=', 'public_platform')
      .orderBy('p.created_at', 'desc').limit(limit).execute();
    return rows.map((r) => ({ postId: r.id, thumbnailUrl: r.thumb ?? r.image ?? null, caption: r.caption ?? '', likeCount: Number(r.like_count) || 0, commentCount: Number(r.comment_count) || 0, createdAt: String(r.created_at) }));
  }

  // ---- scoring / leaderboard ----
  async eligiblePostsOf(customerId: string): Promise<{ likeCount: number; commentCount: number; dislikeCount: number }[]> {
    const rows: any[] = await this.db.selectFrom('nail_showcase_posts').select(['like_count', 'comment_count', 'dislike_count'])
      .where('customer_id', '=', customerId).where('deleted_at', 'is', null).where('status', '=', 'published').where('visibility', '=', 'public_platform').execute();
    return rows.map((r) => ({ likeCount: Number(r.like_count) || 0, commentCount: Number(r.comment_count) || 0, dislikeCount: Number(r.dislike_count) || 0 }));
  }

  // Eligibility + scope/period fragments shared by the board + rank queries.
  private sinceFor(period: string, now: Date): string | null {
    if (period === 'weekly') return new Date(now.getTime() - 7 * 86400_000).toISOString();
    if (period === 'monthly') return new Date(now.getTime() - 30 * 86400_000).toISOString();
    return null;
  }
  private visibilityFrag(scope: string) {
    // platform + nearby boards: cross-platform public posts only (salon-only posts aren't for cross-salon discovery).
    // salon/branch boards: that salon's public + salon-only posts.
    return (scope === 'platform' || scope === 'nearby') ? sql`p.visibility = 'public_platform'` : sql`p.visibility IN ('public_platform','salon_only')`;
  }
  private whereFrag(q: LeaderboardQuery) {
    const since = this.sinceFor(q.period, q.now);
    // tenant scoping applies to the salon/branch boards; nearby spans salons (filtered by branch distance instead).
    const tenant = ((q.scope === 'salon' || q.scope === 'branch') && q.tenantId) ? sql`AND p.tenant_id = ${q.tenantId}` : sql``;
    const nearby = (q.scope === 'nearby' && q.nearbyBranchIds && q.nearbyBranchIds.length > 0) ? sql`AND p.branch_id IN (${sql.join(q.nearbyBranchIds)})` : sql``;
    const sinceF = since ? sql`AND p.created_at >= ${since}` : sql``;
    const exclude = sql`AND (u.status IS NULL OR lower(u.status) NOT IN (${sql.join(EXCLUDED_USER_STATUS)}))`;
    return sql`p.deleted_at IS NULL AND p.status = 'published' AND ${this.visibilityFrag(q.scope)}
      AND sp.is_public_profile = true AND sp.is_suspended = false ${exclude} ${tenant} ${nearby} ${sinceF}`;
  }

  async leaderboard(q: LeaderboardQuery): Promise<LeaderboardRow[]> {
    const rows = await sql<{ customer_id: string; score: number; likes: number; comments: number; dislikes: number; posts: number; follower_count: number }>`
      SELECT p.customer_id,
        SUM(GREATEST(0, p.like_count*2 + p.comment_count*3 - p.dislike_count))::int AS score,
        SUM(p.like_count)::int AS likes, SUM(p.comment_count)::int AS comments, SUM(p.dislike_count)::int AS dislikes,
        COUNT(*)::int AS posts, MAX(sp.follower_count)::int AS follower_count
      FROM nail_showcase_posts p
      JOIN customer_social_profiles sp ON sp.customer_id = p.customer_id
      JOIN users u ON u.id = p.customer_id
      WHERE ${this.whereFrag(q)}
      GROUP BY p.customer_id
      ORDER BY score DESC, likes DESC, comments DESC, dislikes ASC, MAX(p.created_at) DESC, MIN(sp.created_at) ASC
      LIMIT ${q.limit}
    `.execute(this.db);
    return rows.rows.map((r, i) => ({
      customerId: r.customer_id, score: Number(r.score) || 0, likes: Number(r.likes) || 0, comments: Number(r.comments) || 0,
      dislikes: Number(r.dislikes) || 0, posts: Number(r.posts) || 0, followerCount: Number(r.follower_count) || 0, rank: i + 1,
    }));
  }

  async customerRankAndScore(q: { customerId: string } & LeaderboardQuery) {
    const res = await sql<{ score: number; likes: number; comments: number; dislikes: number; posts: number; rank: number }>`
      WITH board AS (
        SELECT p.customer_id AS cid,
          SUM(GREATEST(0, p.like_count*2 + p.comment_count*3 - p.dislike_count))::int AS score,
          SUM(p.like_count)::int AS likes, SUM(p.comment_count)::int AS comments, SUM(p.dislike_count)::int AS dislikes,
          COUNT(*)::int AS posts
        FROM nail_showcase_posts p
        JOIN customer_social_profiles sp ON sp.customer_id = p.customer_id
        JOIN users u ON u.id = p.customer_id
        WHERE ${this.whereFrag(q)}
        GROUP BY p.customer_id
      )
      SELECT me.score, me.likes, me.comments, me.dislikes, me.posts,
        ((SELECT COUNT(*) FROM board b WHERE b.score > me.score
            OR (b.score = me.score AND b.likes > me.likes)
            OR (b.score = me.score AND b.likes = me.likes AND b.comments > me.comments))::int + 1) AS rank
      FROM board me WHERE me.cid = ${q.customerId}
    `.execute(this.db);
    const r = res.rows[0];
    if (!r) return null;
    return { rank: Number(r.rank) || 1, score: Number(r.score) || 0, likes: Number(r.likes) || 0, comments: Number(r.comments) || 0, dislikes: Number(r.dislikes) || 0, posts: Number(r.posts) || 0 };
  }

  // ---- notifications + moderation (reuse existing tables) ----
  async notifyUser(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void> {
    // Crosses salons by design (notify a followed customer at THEIR salon when a customer at another salon follows) — run with no tenant on the database session so Postgres row-level
    // security (DB_TENANT_RLS) does not silently drop it.
    return runAcrossTenants("notify a followed customer at THEIR salon when a customer at another salon follows", () => this.__notifyUserUnscoped(input));
  }
  private async __notifyUserUnscoped(input: { tenantId: string | null; userId: string; type: string; title: string; body: string | null; reference: string | null }): Promise<void> {
    // customer_notifications.customer_id is the customers PK, resolved from the user via customers.user_id (matches the
    // existing NailShowcase repo). Skip quietly when there's no tenant or no matching customer — notifications are
    // best-effort and must never break the underlying action (follow / rank recompute).
    if (!input.tenantId) return;
    const c: any = await this.db.selectFrom('customers').select('id').where('user_id', '=', input.userId).where('tenant_id', '=', input.tenantId).executeTakeFirst();
    if (!c) return;
    await this.db.insertInto('customer_notifications').values({
      tenant_id: input.tenantId, customer_id: c.id, type: input.type, title: input.title, body: input.body, reference: input.reference,
    } as any).execute();
  }
  async addProfileReport(input: { tenantId: string | null; reportedCustomerId: string; reportedByUserId: string; reason: string; details: string | null }): Promise<void> {
    await this.db.insertInto('nail_showcase_reports').values({
      post_id: null, comment_id: null, tenant_id: input.tenantId, reported_customer_id: input.reportedCustomerId,
      reported_by_user_id: input.reportedByUserId, reason: input.reason, details: input.details,
    } as any).execute();
  }

  async setSuspended(customerId: string, suspended: boolean): Promise<void> {
    await this.db.updateTable('customer_social_profiles').set({ is_suspended: suspended, updated_at: sql`now()` } as any).where('customer_id', '=', customerId).execute();
  }

  async listReportedProfiles(): Promise<ReportedProfileRow[]> {
    // Open profile reports grouped by the reported creator, most-reported first. Platform-wide (super-admin view).
    const res = await sql<{ customer_id: string; report_count: number; last_at: string }>`
      SELECT reported_customer_id AS customer_id, COUNT(*)::int AS report_count, MAX(created_at) AS last_at
      FROM nail_showcase_reports
      WHERE reported_customer_id IS NOT NULL AND status = 'open'
      GROUP BY reported_customer_id
      ORDER BY COUNT(*) DESC, MAX(created_at) DESC
    `.execute(this.db);
    return res.rows.map((r) => ({ customerId: r.customer_id, reportCount: Number(r.report_count) || 0, lastReportedAt: r.last_at ? String(r.last_at) : null }));
  }

  async writeAudit(input: { tenantId: string | null; branchId: string | null; userId: string; role: string | null; actionType: string; entityType: string; entityId: string; metadata?: unknown }): Promise<void> {
    await this.db.insertInto('audit_logs' as any).values({
      tenant_id: input.tenantId, branch_id: input.branchId, user_id: input.userId, role: input.role,
      action_type: input.actionType, entity_type: input.entityType, entity_id: input.entityId,
      metadata_json: input.metadata != null ? JSON.stringify(input.metadata) : null,
    } as any).execute();
  }

  async listBranchCoords(): Promise<BranchCoord[]> {
    const rows: any[] = await this.db.selectFrom('branches').select(['id', 'latitude', 'longitude'])
      .where('latitude', 'is not', null).where('longitude', 'is not', null).execute();
    return rows.map((r) => ({ branchId: r.id, latitude: Number(r.latitude), longitude: Number(r.longitude) }));
  }

  async insertBlock(blocker: string, blocked: string, tenantId: string | null): Promise<void> {
    await this.db.insertInto('customer_blocks').values({ blocker_user_id: blocker, blocked_user_id: blocked, tenant_id: tenantId } as any)
      .onConflict((oc) => oc.columns(['blocker_user_id', 'blocked_user_id']).doNothing()).execute();
  }
  async deleteBlock(blocker: string, blocked: string): Promise<boolean> {
    const res = await this.db.deleteFrom('customer_blocks').where('blocker_user_id', '=', blocker).where('blocked_user_id', '=', blocked).returning('id').execute();
    return res.length > 0;
  }
  async blockState(viewer: string, target: string): Promise<{ iBlocked: boolean; blockedMe: boolean }> {
    const a: any = await this.db.selectFrom('customer_blocks').select('id').where('blocker_user_id', '=', viewer).where('blocked_user_id', '=', target).executeTakeFirst();
    const b: any = await this.db.selectFrom('customer_blocks').select('id').where('blocker_user_id', '=', target).where('blocked_user_id', '=', viewer).executeTakeFirst();
    return { iBlocked: !!a, blockedMe: !!b };
  }
  async listBlocked(blocker: string): Promise<string[]> {
    const rows: any[] = await this.db.selectFrom('customer_blocks').select('blocked_user_id').where('blocker_user_id', '=', blocker).execute();
    return rows.map((r) => r.blocked_user_id);
  }
  async blockedEitherWayIds(userId: string): Promise<Set<string>> {
    const mine: any[] = await this.db.selectFrom('customer_blocks').select('blocked_user_id').where('blocker_user_id', '=', userId).execute();
    const theirs: any[] = await this.db.selectFrom('customer_blocks').select('blocker_user_id').where('blocked_user_id', '=', userId).execute();
    const s = new Set<string>();
    for (const r of mine) s.add(r.blocked_user_id);
    for (const r of theirs) s.add(r.blocker_user_id);
    return s;
  }
}
