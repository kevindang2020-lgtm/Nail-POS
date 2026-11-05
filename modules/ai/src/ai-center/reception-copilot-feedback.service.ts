// reception-copilot-feedback.service.ts — captures receptionist feedback on Copilot recommendations (§44) and rolls it
// up (the input to the learning loop, #4). Recording requires the `reception_copilot.give_feedback` permission; the
// summary requires a management view permission. Tenant/branch-scoped; upsert keeps one latest rating per recommendation.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import type { CopilotCtx } from './reception-copilot-context.service';

export type FeedbackRating = 'helpful' | 'not_helpful' | 'dismissed';
const RATINGS: FeedbackRating[] = ['helpful', 'not_helpful', 'dismissed'];

export class CopilotFeedbackError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

@Injectable()
export class ReceptionCopilotFeedbackService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  private has(ctx: CopilotCtx, perm: string): boolean { return (ctx.permissions || []).includes(perm); }

  /** Record (or update) feedback on a recommendation. Requires reception_copilot.give_feedback. */
  async recordFeedback(ctx: CopilotCtx, input: { recommendationId?: string | null; sessionId?: string | null; rating: string; reason?: string }): Promise<{ ok: boolean }> {
    if (!this.has(ctx, 'reception_copilot.give_feedback')) throw new CopilotFeedbackError('PERMISSION_DENIED', 'You do not have permission to give Copilot feedback.');
    if (!RATINGS.includes(input.rating as FeedbackRating)) throw new CopilotFeedbackError('VALIDATION_ERROR', 'rating must be helpful | not_helpful | dismissed.');
    if (!this.db) return { ok: false };
    const reason = input.reason ? String(input.reason).slice(0, 500) : null;
    if (input.recommendationId) {
      await sql`
        INSERT INTO reception_copilot_feedback (tenant_id, branch_id, recommendation_id, session_id, receptionist_user_id, rating, reason)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${input.recommendationId}, ${input.sessionId ?? null}, ${ctx.userId}, ${input.rating}, ${reason})
        ON CONFLICT (tenant_id, recommendation_id) DO UPDATE SET rating = EXCLUDED.rating, reason = EXCLUDED.reason, updated_at = now()
      `.execute(this.db as any).catch(() => undefined);
    } else {
      await sql`
        INSERT INTO reception_copilot_feedback (tenant_id, branch_id, session_id, receptionist_user_id, rating, reason)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${input.sessionId ?? null}, ${ctx.userId}, ${input.rating}, ${reason})
      `.execute(this.db as any).catch(() => undefined);
    }
    return { ok: true };
  }

  /** Permission-gated feedback rollup (§46). Wraps the internal aggregation with a management-view check. */
  async summary(ctx: CopilotCtx, opts: { sinceDays?: number } = {}): Promise<{ helpful: number; notHelpful: number; dismissed: number; helpfulRate: number; byKind: { kind: string; helpful: number; notHelpful: number }[] }> {
    if (!this.has(ctx, 'reception_copilot.view_usage') && !this.has(ctx, 'reception_copilot.manage_settings')) {
      throw new CopilotFeedbackError('PERMISSION_DENIED', 'You do not have permission to view Copilot feedback.');
    }
    return this.rollup(ctx.tenantId, opts);
  }

  /** Internal aggregation (no permission check) — tenant-scoped; reused by the learning loop (§36). */
  async rollup(tenantId: string, opts: { sinceDays?: number } = {}): Promise<{ helpful: number; notHelpful: number; dismissed: number; helpfulRate: number; byKind: { kind: string; helpful: number; notHelpful: number }[] }> {
    const empty = { helpful: 0, notHelpful: 0, dismissed: 0, helpfulRate: 0, byKind: [] as { kind: string; helpful: number; notHelpful: number }[] };
    if (!this.db) return empty;
    const days = Math.min(365, Math.max(1, opts.sinceDays ?? 30));
    const totals: any = await sql`
      SELECT rating, count(*)::int AS n FROM reception_copilot_feedback
      WHERE tenant_id = ${tenantId} AND created_at >= now() - (${days} || ' days')::interval
      GROUP BY rating
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    const map = Object.fromEntries((totals.rows ?? []).map((r: any) => [r.rating, r.n]));
    const helpful = map.helpful ?? 0, notHelpful = map.not_helpful ?? 0, dismissed = map.dismissed ?? 0;
    const byKindRes: any = await sql`
      SELECT r.kind, f.rating, count(*)::int AS n
      FROM reception_copilot_feedback f JOIN reception_copilot_recommendations r ON r.id = f.recommendation_id AND r.tenant_id = f.tenant_id
      WHERE f.tenant_id = ${tenantId} AND f.created_at >= now() - (${days} || ' days')::interval
      GROUP BY r.kind, f.rating
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    const byKindMap = new Map<string, { kind: string; helpful: number; notHelpful: number }>();
    for (const row of byKindRes.rows ?? []) {
      const e = byKindMap.get(row.kind) ?? { kind: row.kind, helpful: 0, notHelpful: 0 };
      if (row.rating === 'helpful') e.helpful += row.n; else if (row.rating === 'not_helpful') e.notHelpful += row.n;
      byKindMap.set(row.kind, e);
    }
    return { helpful, notHelpful, dismissed, helpfulRate: Math.round((helpful / Math.max(1, helpful + notHelpful)) * 10000) / 10000, byKind: [...byKindMap.values()] };
  }
}
