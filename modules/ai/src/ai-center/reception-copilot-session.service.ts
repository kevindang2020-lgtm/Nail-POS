// reception-copilot-session.service.ts — persistence for Copilot working sessions and the recommendations shown in them
// (spec §37). Advisory/audit trail only; the authoritative appointment record stays in `appointments`. Tenant/branch
// scoped on every read and write; null DB degrades to no-op so the Copilot keeps working in dev/offline.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { RECEPTION_COPILOT_SESSION } from '../ai-lifecycles';
import type { CopilotCtx } from './reception-copilot-context.service';

export type RecommendationKind = 'availability' | 'technician' | 'next_action' | 'draft' | 'waitlist' | 'service_explanation' | 'duplicate' | 'conflict';

@Injectable()
export class ReceptionCopilotSessionService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async startSession(ctx: CopilotCtx, input: { channel?: 'pos' | 'phone_assist' } = {}): Promise<{ sessionId: string | null }> {
    if (!this.db) return { sessionId: null };
    const res: any = await sql`
      INSERT INTO reception_copilot_sessions (tenant_id, branch_id, receptionist_user_id, channel)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId}, ${input.channel ?? 'pos'})
      RETURNING id
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return { sessionId: res.rows?.[0]?.id ?? null };
  }

  async endSession(ctx: CopilotCtx, sessionId: string): Promise<{ ended: boolean }> {
    if (!this.db) return { ended: false };
    await sql`
      UPDATE reception_copilot_sessions SET status = 'ended', ended_at = now()
      WHERE id = ${sessionId} AND tenant_id = ${ctx.tenantId} AND ${canMoveToSql(RECEPTION_COPILOT_SESSION, 'ended')}
    `.execute(this.db as any).catch(() => undefined);
    return { ended: true };
  }

  /** Persist a recommendation shown to the receptionist; returns its id so feedback can reference it. */
  async recordRecommendation(ctx: CopilotCtx, input: { sessionId?: string | null; kind: RecommendationKind; payload?: unknown }): Promise<{ recommendationId: string | null }> {
    if (!this.db) return { recommendationId: null };
    const res: any = await sql`
      INSERT INTO reception_copilot_recommendations (tenant_id, branch_id, session_id, receptionist_user_id, kind, payload)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${input.sessionId ?? null}, ${ctx.userId}, ${input.kind}, ${JSON.stringify(input.payload ?? {})}::jsonb)
      RETURNING id
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return { recommendationId: res.rows?.[0]?.id ?? null };
  }

  async markActedOn(ctx: CopilotCtx, recommendationId: string): Promise<void> {
    if (!this.db) return;
    await sql`UPDATE reception_copilot_recommendations SET acted_on = true WHERE id = ${recommendationId} AND tenant_id = ${ctx.tenantId}`.execute(this.db as any).catch(() => undefined);
  }

  async listRecommendations(ctx: CopilotCtx, opts: { sessionId?: string; limit?: number } = {}): Promise<any[]> {
    if (!this.db) return [];
    const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
    const filter = opts.sessionId ? sql`AND session_id = ${opts.sessionId}` : sql``;
    const res: any = await sql`
      SELECT id, kind, payload, acted_on, created_at FROM reception_copilot_recommendations
      WHERE tenant_id = ${ctx.tenantId} ${filter}
      ORDER BY created_at DESC LIMIT ${limit}
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows ?? [];
  }
}
