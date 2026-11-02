// help.service.ts — Help Center knowledge base reads. Platform-global article content gated by per-reader
// applicability (role/plan/platform). Raw SQL, each query fail-soft to [] / null so a missing table or an
// empty corpus never breaks the Help Center — it shows an honest empty state instead. Tenant/user come from
// the session (HelpCtx), never the client. View-count increment, feedback writes and the video library land
// in later sub-phases; this is the read foundation.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/tenant (Constitution 13 §15).
export type { HelpArticleSummary } from '@aipowersalon/api-contracts/tenant';
import type { HelpArticleSummary } from '@aipowersalon/api-contracts/tenant';

export interface HelpCtx { tenantId: string; branchId: string; userId?: string; role: string; permissions: string[]; }

export type HelpCategory = { id: string; slug: string; label: string; description: string | null; sortOrder: number };
export type HelpArticle = HelpArticleSummary & {
  body: string | null; author: string | null; reviewer: string | null; appVersion: string | null; lastReviewedAt: string | null;
};

export type VideoSummary = {
  id: string; slug: string; title: string; description: string | null;
  categoryLabel: string | null; durationSeconds: number; thumbnailUrl: string | null; viewCount: number;
};
export type VideoDetail = VideoSummary & { videoUrl: string | null; captionsUrl: string | null; transcript: string | null; resumeSeconds: number };

/** Visible if the article targets no specific roles (empty = everyone) or includes the reader's role. Case-insensitive. */
export function articleVisibleToRole(articleRoles: string[] | null | undefined, role: string): boolean {
  if (!articleRoles || articleRoles.length === 0) return true;
  const r = (role || '').toLowerCase();
  return articleRoles.some((x) => (x || '').toLowerCase() === r);
}

/** Most-viewed first, then most-recently-updated, then title — deterministic ordering for "Popular Articles". */
export function rankPopular<T extends { viewCount: number; lastUpdatedAt: string | null; title: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (b.viewCount - a.viewCount)
    || (b.lastUpdatedAt || '').localeCompare(a.lastUpdatedAt || '')
    || a.title.localeCompare(b.title));
}

/** Trim, cap to 2000 chars, and collapse empties to null — keeps feedback comments bounded and clean. */
export function sanitizeComment(comment: string | null | undefined): string | null {
  if (typeof comment !== 'string') return null;
  const t = comment.trim();
  return t ? t.slice(0, 2000) : null;
}

/** Clamp a playback position to a non-negative integer second count. */
export function clampSeconds(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export class HelpService {
  constructor(private readonly db: Kysely<DB> | null) {}

  private async query<T>(text: ReturnType<typeof sql>): Promise<T[]> {
    if (!this.db) return [];
    try { const r = await text.execute(this.db); return ((r as any).rows || []) as T[]; }
    catch { return []; }
  }

  async categories(): Promise<HelpCategory[]> {
    const rows = await this.query<any>(sql`
      SELECT id, slug, label, description, sort_order
      FROM help_categories ORDER BY sort_order ASC, label ASC`);
    return rows.map((x) => ({ id: x.id, slug: x.slug, label: x.label, description: x.description ?? null, sortOrder: Number(x.sort_order || 0) }));
  }

  /** Published, role-applicable article summaries. Optional category slug + free-text filter. Popular-ranked. */
  async articles(ctx: HelpCtx, opts: { category?: string; q?: string; limit?: number } = {}): Promise<HelpArticleSummary[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = await this.query<any>(sql`
      SELECT a.id, a.slug, a.title, a.summary, a.roles, a.view_count, a.reading_minutes, a.last_updated_at,
             c.slug AS category_slug, c.label AS category_label
      FROM help_articles a
      LEFT JOIN help_categories c ON c.id = a.category_id
      WHERE a.status = 'published'
        ${opts.category ? sql`AND c.slug = ${opts.category}` : sql``}
        ${opts.q ? sql`AND (a.title ILIKE ${'%' + opts.q + '%'} OR a.summary ILIKE ${'%' + opts.q + '%'} OR a.body ILIKE ${'%' + opts.q + '%'})` : sql``}
      ORDER BY a.view_count DESC, a.last_updated_at DESC NULLS LAST
      LIMIT ${limit}`);
    return rows
      .filter((x) => articleVisibleToRole(x.roles, ctx.role))
      .map((x) => ({
        id: x.id, slug: x.slug, title: x.title, summary: x.summary ?? null,
        categorySlug: x.category_slug ?? null, categoryLabel: x.category_label ?? null,
        viewCount: Number(x.view_count || 0), readingMinutes: Number(x.reading_minutes || 0),
        lastUpdatedAt: x.last_updated_at ? new Date(x.last_updated_at).toISOString() : null,
      }));
  }

  /** One published, role-applicable article by id or slug, or null when absent/not permitted. */
  async article(ctx: HelpCtx, idOrSlug: string): Promise<HelpArticle | null> {
    const rows = await this.query<any>(sql`
      SELECT a.id, a.slug, a.title, a.summary, a.body, a.roles, a.view_count, a.reading_minutes,
             a.author, a.reviewer, a.app_version, a.last_reviewed_at, a.last_updated_at,
             c.slug AS category_slug, c.label AS category_label
      FROM help_articles a
      LEFT JOIN help_categories c ON c.id = a.category_id
      WHERE a.status = 'published' AND (a.id::text = ${idOrSlug} OR a.slug = ${idOrSlug})
      LIMIT 1`);
    const x = rows[0];
    if (!x || !articleVisibleToRole(x.roles, ctx.role)) return null;
    return {
      id: x.id, slug: x.slug, title: x.title, summary: x.summary ?? null, body: x.body ?? null,
      categorySlug: x.category_slug ?? null, categoryLabel: x.category_label ?? null,
      viewCount: Number(x.view_count || 0), readingMinutes: Number(x.reading_minutes || 0),
      author: x.author ?? null, reviewer: x.reviewer ?? null, appVersion: x.app_version ?? null,
      lastReviewedAt: x.last_reviewed_at ? new Date(x.last_reviewed_at).toISOString() : null,
      lastUpdatedAt: x.last_updated_at ? new Date(x.last_updated_at).toISOString() : null,
    };
  }

  /** Published, role-applicable video summaries (popular-ranked), optionally by category. */
  async videos(ctx: HelpCtx, opts: { category?: string; limit?: number } = {}): Promise<VideoSummary[]> {
    const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100);
    const rows = await this.query<any>(sql`
      SELECT v.id, v.slug, v.title, v.description, v.roles, v.duration_seconds, v.thumbnail_url, v.view_count,
             c.label AS category_label
      FROM video_tutorials v
      LEFT JOIN help_categories c ON c.id = v.category_id
      WHERE v.status = 'published'
        ${opts.category ? sql`AND c.slug = ${opts.category}` : sql``}
      ORDER BY v.view_count DESC, v.published_at DESC NULLS LAST
      LIMIT ${limit}`);
    return rows
      .filter((x) => articleVisibleToRole(x.roles, ctx.role))
      .map((x) => ({
        id: x.id, slug: x.slug, title: x.title, description: x.description ?? null,
        categoryLabel: x.category_label ?? null, durationSeconds: Number(x.duration_seconds || 0),
        thumbnailUrl: x.thumbnail_url ?? null, viewCount: Number(x.view_count || 0),
      }));
  }

  /** One published, role-applicable video by id or slug (with playback + caption + transcript sources), or null. */
  async video(ctx: HelpCtx, idOrSlug: string): Promise<VideoDetail | null> {
    const rows = await this.query<any>(sql`
      SELECT v.id, v.slug, v.title, v.description, v.roles, v.duration_seconds, v.thumbnail_url, v.view_count,
             v.video_url, v.captions_url, v.transcript, c.label AS category_label,
             vp.position_seconds AS resume_seconds
      FROM video_tutorials v
      LEFT JOIN help_categories c ON c.id = v.category_id
      LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.tenant_id = ${ctx.tenantId} AND vp.user_id = ${ctx.userId ?? null}
      WHERE v.status = 'published' AND (v.id::text = ${idOrSlug} OR v.slug = ${idOrSlug})
      LIMIT 1`);
    const x = rows[0];
    if (!x || !articleVisibleToRole(x.roles, ctx.role)) return null;
    return {
      id: x.id, slug: x.slug, title: x.title, description: x.description ?? null,
      categoryLabel: x.category_label ?? null, durationSeconds: Number(x.duration_seconds || 0),
      thumbnailUrl: x.thumbnail_url ?? null, viewCount: Number(x.view_count || 0),
      videoUrl: x.video_url ?? null, captionsUrl: x.captions_url ?? null, transcript: x.transcript ?? null,
      resumeSeconds: Number(x.resume_seconds || 0),
    };
  }

  /** Record an article view, deduped per (article, tenant, user, day): only the first view of the day
   * increments view_count (spec §41). Returns whether this call counted a new view. Fail-soft. */
  async recordArticleView(ctx: HelpCtx, articleId: string): Promise<{ counted: boolean }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { counted: false };
    try {
      const r = await sql`
        INSERT INTO help_article_views (article_id, tenant_id, user_id, viewed_on)
        VALUES (${articleId}, ${ctx.tenantId}, ${ctx.userId}, CURRENT_DATE)
        ON CONFLICT (article_id, tenant_id, user_id, viewed_on) DO NOTHING
        RETURNING id`.execute(this.db);
      const counted = ((r as any).rows?.length || 0) > 0;
      if (counted) await sql`UPDATE help_articles SET view_count = view_count + 1 WHERE id = ${articleId}`.execute(this.db);
      return { counted };
    } catch { return { counted: false }; }
  }

  /** Upsert a reader's "was this helpful" vote — one vote per (article, tenant, user); re-vote replaces. Fail-soft. */
  async submitArticleFeedback(ctx: HelpCtx, articleId: string, helpful: boolean, comment?: string | null): Promise<{ saved: boolean }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { saved: false };
    const c = sanitizeComment(comment);
    try {
      await sql`
        INSERT INTO help_article_feedback (article_id, tenant_id, user_id, helpful, comment)
        VALUES (${articleId}, ${ctx.tenantId}, ${ctx.userId}, ${!!helpful}, ${c})
        ON CONFLICT (article_id, tenant_id, user_id)
        DO UPDATE SET helpful = EXCLUDED.helpful, comment = EXCLUDED.comment, created_at = now()`.execute(this.db);
      return { saved: true };
    } catch { return { saved: false }; }
  }

  /** Upsert a viewer's resume position for a video — one row per (video, tenant, user). `completed` latches true. Fail-soft. */
  async recordVideoProgress(ctx: HelpCtx, videoId: string, positionSeconds: number, completed: boolean): Promise<{ saved: boolean }> {
    if (!this.db || !ctx.userId || !ctx.tenantId) return { saved: false };
    const pos = clampSeconds(positionSeconds);
    try {
      await sql`
        INSERT INTO video_progress (video_id, tenant_id, user_id, position_seconds, completed, updated_at)
        VALUES (${videoId}, ${ctx.tenantId}, ${ctx.userId}, ${pos}, ${!!completed}, now())
        ON CONFLICT (video_id, tenant_id, user_id)
        DO UPDATE SET position_seconds = EXCLUDED.position_seconds,
                      completed = video_progress.completed OR EXCLUDED.completed,
                      updated_at = now()`.execute(this.db);
      return { saved: true };
    } catch { return { saved: false }; }
  }
}
