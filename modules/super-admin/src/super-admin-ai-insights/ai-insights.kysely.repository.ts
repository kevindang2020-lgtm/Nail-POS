// Kysely (Postgres) AI-insights repo. All reads enforce tenant/branch scope. Status updates audit the review action
// and NEVER touch operational tables — acting on a recommendation happens in the relevant module by a human.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { InsightRepo, InsightRow, InsightFilters, InsightFeedbackRow } from './ai-insights.repository';
import { canMoveToSql } from '@aipowersalon/database';
import { AI_INSIGHT } from '../lifecycles';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const map = (r: any): InsightRow => ({
  id: r.id, insightReference: r.insight_reference, tenantId: r.tenant_id, tenantName: r.tenant_name, branchId: r.branch_id, branchName: r.branch_name,
  category: r.category, title: r.title, summary: r.summary, recommendation: r.recommendation, severity: r.severity,
  confidence: num(r.confidence), confidenceMethod: r.confidence_method, status: r.status, generatedAt: iso(r.generated_at) as string,
  lastEvaluatedAt: iso(r.last_evaluated_at) as string, freshness: r.freshness, churnRiskScore: num(r.churn_risk_score),
  flaggedAmountCents: num(r.flagged_amount_cents), modelProvider: r.model_provider, modelName: r.model_name,
  modelVersion: r.model_version, promptVersion: r.prompt_version,
});

export class KyselyInsightRepo implements InsightRepo {
  constructor(private readonly db: Kysely<DB>) {}

  submitFeedback(input: { insightId: string; verdict: 'helpful' | 'not_helpful' | 'incorrect'; comment?: string | null; submittedByUserId?: string | null }) { return submitInsightFeedback(this.db, input); }
  recentFeedback(limit = 20) { return recentInsightFeedback(this.db, limit); }

  private scope(f: { tenantId?: string; branchId?: string }) {
    const t = f.tenantId ? sql`AND tenant_id = ${f.tenantId}` : sql``;
    const b = f.branchId ? sql`AND branch_id = ${f.branchId}` : sql``;
    return { t, b };
  }
  async listAll(f: { tenantId?: string; branchId?: string }): Promise<InsightRow[]> {
    const { t, b } = this.scope(f);
    try { const r = await sql<any>`SELECT * FROM ai_insights WHERE 1=1 ${t} ${b} ORDER BY generated_at DESC LIMIT 2000`.execute(this.db); return r.rows.map(map); } catch { return []; }
  }
  async listDirectory(f: InsightFilters): Promise<{ items: InsightRow[]; total: number }> {
    const { t, b } = this.scope(f);
    const sev = f.severity ? sql`AND severity = ${f.severity}` : sql``;
    const cat = f.category ? sql`AND category = ${f.category}` : sql``;
    const st = f.status ? sql`AND status = ${f.status}` : sql``;
    const search = f.search ? sql`AND (lower(title) LIKE ${'%' + f.search.toLowerCase() + '%'} OR lower(insight_reference) LIKE ${'%' + f.search.toLowerCase() + '%'})` : sql``;
    const page = Math.max(1, f.page ?? 1), pageSize = Math.max(1, Math.min(100, f.pageSize ?? 10));
    try {
      const total = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ai_insights WHERE 1=1 ${t} ${b} ${sev} ${cat} ${st} ${search}`.execute(this.db);
      const rows = await sql<any>`SELECT * FROM ai_insights WHERE 1=1 ${t} ${b} ${sev} ${cat} ${st} ${search} ORDER BY generated_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(this.db);
      return { items: rows.rows.map(map), total: Number(total.rows[0]?.n ?? 0) };
    } catch { return { items: [], total: 0 }; }
  }
  async get(id: string): Promise<InsightRow | null> {
    try { const r = await sql<any>`SELECT * FROM ai_insights WHERE id = ${id} LIMIT 1`.execute(this.db); return r.rows[0] ? map(r.rows[0]) : null; } catch { return null; }
  }
  async updateStatus(id: string, patch: { status?: string; reviewedByUserId?: string | null; assignedToUserId?: string | null; dismissedReason?: string | null }): Promise<InsightRow | null> {
    const reviewed = patch.status === 'in_review' ? sql`, reviewed_at = now(), reviewed_by_user_id = ${patch.reviewedByUserId ?? null}` : sql``;
    const assigned = patch.assignedToUserId != null ? sql`, assigned_to_user_id = ${patch.assignedToUserId}` : sql``;
    const dismissed = patch.status === 'dismissed' ? sql`, dismissed_at = now()` : sql``;
    const r = await sql<any>`UPDATE ai_insights SET status = COALESCE(${patch.status ?? null}, status), last_evaluated_at = now(), updated_at = now() ${reviewed} ${assigned} ${dismissed} WHERE id = ${id} AND ${patch.status ? canMoveToSql(AI_INSIGHT, patch.status) : sql`true`} RETURNING *`.execute(this.db);
    if (!r.rows[0]) return null;
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, user_id, created_at) VALUES (${'ai_insight_' + (patch.status || 'updated')}, 'ai_insight', ${id}, ${patch.reviewedByUserId ?? patch.assignedToUserId ?? null}, now())`.execute(this.db); } catch { /* best-effort */ }
    return map(r.rows[0]);
  }
}

// ── Feedback (424): human-review-only; the row snapshots what the reviewer saw ────────────────────────────────
export interface FeedbackInput { insightId: string; verdict: 'helpful' | 'not_helpful' | 'incorrect'; comment?: string | null; submittedByUserId?: string | null; }
export interface FeedbackRow { id: string; insightId: string; insightReference: string | null; insightTitle: string | null; verdict: string; comment: string | null; modelVersion: string | null; promptVersion: string | null; createdAt: string; }

export async function submitInsightFeedback(db: Kysely<DB>, input: FeedbackInput): Promise<FeedbackRow | null> {
  const ins = await db.selectFrom('ai_insights')
    .select(['id', 'insight_reference', 'title', 'tenant_id', 'model_version', 'prompt_version'])
    .where('id', '=', input.insightId).executeTakeFirst();
  if (!ins) return null;                                     // feedback must point at a real insight
  const row = await db.insertInto('ai_insight_feedback').values({
    insight_id: ins.id,
    insight_reference: ins.insight_reference ?? null,
    insight_title: ins.title ?? null,
    tenant_id: ins.tenant_id ?? null,
    verdict: input.verdict,
    comment: (input.comment ?? '').trim() || null,
    model_version: ins.model_version ?? null,               // snapshot — a regeneration cannot rewrite this
    prompt_version: ins.prompt_version ?? null,
    submitted_by_user_id: input.submittedByUserId ?? null,
  }).returning(['id', 'insight_id', 'insight_reference', 'insight_title', 'verdict', 'comment', 'model_version', 'prompt_version', 'created_at']).executeTakeFirst();
  if (!row) return null;
  return { id: row.id, insightId: row.insight_id, insightReference: row.insight_reference, insightTitle: row.insight_title, verdict: row.verdict, comment: row.comment, modelVersion: row.model_version, promptVersion: row.prompt_version, createdAt: String(row.created_at) };
}

export async function recentInsightFeedback(db: Kysely<DB>, limit = 20): Promise<FeedbackRow[]> {
  const rows = await db.selectFrom('ai_insight_feedback')
    .select(['id', 'insight_id', 'insight_reference', 'insight_title', 'verdict', 'comment', 'model_version', 'prompt_version', 'created_at'])
    .orderBy('created_at', 'desc').limit(Math.min(100, Math.max(1, limit))).execute();
  return rows.map((r) => ({ id: r.id, insightId: r.insight_id, insightReference: r.insight_reference, insightTitle: r.insight_title, verdict: r.verdict, comment: r.comment, modelVersion: r.model_version, promptVersion: r.prompt_version, createdAt: String(r.created_at) }));
}
