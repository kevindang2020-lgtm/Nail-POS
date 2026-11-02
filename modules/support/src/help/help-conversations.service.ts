// help-conversations.service.ts — persistence for AI Support Assistant turns (spec §14). Implements the
// AssistantConversationStore port the assistant calls after each turn. Tenant-scoped and fail-soft: a storage
// failure never blocks an answer. Stores only question/answer/grounding/sources — never prompts or secrets.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { HelpCtx } from './help.service';
import type { AssistantConversationStore, AssistantAnswer } from './help-assistant.service';

export class HelpConversationsService implements AssistantConversationStore {
  constructor(private readonly db: Kysely<DB> | null) {}

  async saveTurn(ctx: HelpCtx, turn: { conversationId: string | null; question: string; answer: AssistantAnswer }): Promise<string | null> {
    if (!this.db || !ctx.tenantId) return null;
    try {
      let cid = turn.conversationId;
      if (cid) {
        const owns = await sql<{ id: string }>`SELECT id FROM ai_support_conversations WHERE id = ${cid} AND tenant_id = ${ctx.tenantId} LIMIT 1`.execute(this.db);
        if (!owns.rows[0]) cid = null; // ignore a conversation id that isn't this tenant's
      }
      if (!cid) {
        const created = await sql<{ id: string }>`INSERT INTO ai_support_conversations (tenant_id, user_id) VALUES (${ctx.tenantId}, ${ctx.userId ?? null}) RETURNING id`.execute(this.db);
        cid = created.rows[0]?.id ?? null;
      }
      if (!cid) return null;
      const a = turn.answer;
      await sql`INSERT INTO ai_support_messages (conversation_id, tenant_id, user_id, question, answer, grounded, confidence, sources)
        VALUES (${cid}, ${ctx.tenantId}, ${ctx.userId ?? null}, ${turn.question}, ${a.answer}, ${a.grounded}, ${a.confidence}, ${JSON.stringify(a.sources ?? [])}::jsonb)`.execute(this.db);
      await sql`UPDATE ai_support_conversations SET turn_count = turn_count + 1, last_grounded = ${a.grounded}, updated_at = now() WHERE id = ${cid} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
      return cid;
    } catch { return null; }
  }

  /** Link a conversation to the ticket it was escalated into (best-effort). */
  async linkTicket(ctx: HelpCtx, conversationId: string, ticketId: string): Promise<void> {
    if (!this.db || !ctx.tenantId) return;
    try {
      await sql`UPDATE ai_support_conversations SET escalated_ticket_id = ${ticketId}, updated_at = now() WHERE id = ${conversationId} AND tenant_id = ${ctx.tenantId}`.execute(this.db);
    } catch { /* best-effort */ }
  }
}
