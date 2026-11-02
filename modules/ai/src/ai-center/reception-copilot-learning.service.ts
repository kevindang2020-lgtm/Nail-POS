// reception-copilot-learning.service.ts — the learning loop (spec §36). Turns the feedback rollup (#2) into human-
// reviewable LEARNING SUGGESTIONS, and records manager-approved adjustments as versioned KNOWLEDGE entries. Two safety
// rules are enforced here, not just documented:
//   (1) Tenant isolation — suggestions are generated ONLY from this tenant's own feedback and every read/write is
//       tenant-scoped. One salon's data can never inform another's.
//   (2) No silent production change — generating a suggestion changes nothing; a manager must explicitly approve, which
//       writes an auditable knowledge VERSION. Approval does not mutate live Copilot behavior on its own.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { RECEPTION_COPILOT_LEARNING } from '../ai-lifecycles';
import type { CopilotCtx } from './reception-copilot-context.service';
import { ReceptionCopilotFeedbackService } from './reception-copilot-feedback.service';

const NOT_HELPFUL_THRESHOLD = 0.5;   // fraction of not-helpful ratings that triggers a suggestion
const MIN_SAMPLE = 3;                // minimum ratings before we'll suggest anything

export class CopilotLearningError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

@Injectable()
export class ReceptionCopilotLearningService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly feedback: ReceptionCopilotFeedbackService) {}

  private has(ctx: CopilotCtx, perm: string): boolean { return (ctx.permissions || []).includes(perm); }

  /** Generate learning suggestions from THIS tenant's feedback rollup. Idempotent per kind: won't add a second OPEN
   * suggestion for a kind that already has one. Requires reception_copilot.view_learning. */
  async generateSuggestions(ctx: CopilotCtx, opts: { sinceDays?: number } = {}): Promise<{ created: number; suggestions: any[] }> {
    if (!this.has(ctx, 'reception_copilot.view_learning')) throw new CopilotLearningError('PERMISSION_DENIED', 'You do not have permission to view Copilot learning.');
    if (!this.db) return { created: 0, suggestions: [] };
    const roll = await this.feedback.rollup(ctx.tenantId, opts);   // tenant-scoped aggregation
    let created = 0;
    for (const k of roll.byKind) {
      const total = k.helpful + k.notHelpful;
      if (total < MIN_SAMPLE) continue;
      const rate = k.notHelpful / total;
      if (rate < NOT_HELPFUL_THRESHOLD) continue;
      const existing: any = await sql`SELECT 1 FROM reception_copilot_learning_suggestions WHERE tenant_id = ${ctx.tenantId} AND kind = ${k.kind} AND status = 'open' LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
      if ((existing.rows?.length ?? 0) > 0) continue;   // don't duplicate an open suggestion
      const pct = Math.round(rate * 100);
      const suggestion = `Recommendations of kind "${k.kind}" were rated not-helpful ${pct}% of the time (${total} ratings). Review how the Copilot generates these.`;
      await sql`
        INSERT INTO reception_copilot_learning_suggestions (tenant_id, branch_id, kind, suggestion, evidence)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${k.kind}, ${suggestion}, ${JSON.stringify({ helpful: k.helpful, notHelpful: k.notHelpful, notHelpfulRate: rate })}::jsonb)
      `.execute(this.db).catch(() => undefined);
      created++;
    }
    return { created, suggestions: await this.listSuggestions(ctx, { status: 'open' }) };
  }

  async listSuggestions(ctx: CopilotCtx, opts: { status?: string } = {}): Promise<any[]> {
    if (!this.has(ctx, 'reception_copilot.view_learning')) throw new CopilotLearningError('PERMISSION_DENIED', 'You do not have permission to view Copilot learning.');
    if (!this.db) return [];
    const filter = opts.status ? sql`AND status = ${opts.status}` : sql``;
    const res: any = await sql`
      SELECT id, kind, suggestion, evidence, status, created_at, decided_by, decided_at
      FROM reception_copilot_learning_suggestions WHERE tenant_id = ${ctx.tenantId} ${filter}
      ORDER BY created_at DESC LIMIT 100
    `.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows ?? [];
  }

  /** Approve a suggestion → records a new, versioned knowledge entry (per-tenant monotonic version). Requires
   * reception_copilot.approve_learning. Does NOT auto-change live behavior — it's an auditable, versioned decision. */
  async approveSuggestion(ctx: CopilotCtx, suggestionId: string, content?: unknown): Promise<{ approved: boolean; version: number | null }> {
    if (!this.has(ctx, 'reception_copilot.approve_learning')) throw new CopilotLearningError('PERMISSION_DENIED', 'You do not have permission to approve Copilot learning.');
    if (!this.db) return { approved: false, version: null };
    // Phase 12 (#27): claim the suggestion FIRST with the conditional open → approved move, in one transaction with the
    // knowledge version it produces — of two approvals at once exactly one claims it; the other is told it is no longer
    // open (it used to read the open row, write a version, then flip the status unconditionally: two versions)
    const version = await this.db.transaction().execute(async (trx: any) => {
      const sug: any = await sql`UPDATE reception_copilot_learning_suggestions SET status = 'approved', decided_by = ${ctx.userId}, decided_at = now()
        WHERE id = ${suggestionId} AND tenant_id = ${ctx.tenantId} AND ${canMoveToSql(RECEPTION_COPILOT_LEARNING, 'approved')} RETURNING id, kind, suggestion, evidence`.execute(trx);
      if ((sug.rows?.length ?? 0) === 0) throw new CopilotLearningError('NOT_FOUND', 'No open suggestion with that id.');
      const nextVer: any = await sql`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM reception_copilot_knowledge_versions WHERE tenant_id = ${ctx.tenantId}`.execute(trx);
      const v = nextVer.rows[0].v;
      const body = content ?? { kind: sug.rows[0].kind, note: sug.rows[0].suggestion, evidence: sug.rows[0].evidence };
      await sql`INSERT INTO reception_copilot_knowledge_versions (tenant_id, version, source_suggestion_id, content, created_by) VALUES (${ctx.tenantId}, ${v}, ${suggestionId}, ${JSON.stringify(body)}::jsonb, ${ctx.userId})`.execute(trx);
      return v;
    });
    return { approved: true, version };
  }

  async dismissSuggestion(ctx: CopilotCtx, suggestionId: string): Promise<{ dismissed: boolean }> {
    if (!this.has(ctx, 'reception_copilot.approve_learning')) throw new CopilotLearningError('PERMISSION_DENIED', 'You do not have permission to decide Copilot learning.');
    if (!this.db) return { dismissed: false };
    await sql`UPDATE reception_copilot_learning_suggestions SET status = 'dismissed', decided_by = ${ctx.userId}, decided_at = now() WHERE id = ${suggestionId} AND tenant_id = ${ctx.tenantId} AND ${canMoveToSql(RECEPTION_COPILOT_LEARNING, 'dismissed')}`.execute(this.db).catch(() => undefined);
    return { dismissed: true };
  }

  async listKnowledgeVersions(ctx: CopilotCtx): Promise<any[]> {
    if (!this.has(ctx, 'reception_copilot.view_learning')) throw new CopilotLearningError('PERMISSION_DENIED', 'You do not have permission to view Copilot knowledge.');
    if (!this.db) return [];
    const res: any = await sql`SELECT id, version, source_suggestion_id, content, created_by, created_at, active FROM reception_copilot_knowledge_versions WHERE tenant_id = ${ctx.tenantId} ORDER BY version DESC LIMIT 100`.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows ?? [];
  }
}
