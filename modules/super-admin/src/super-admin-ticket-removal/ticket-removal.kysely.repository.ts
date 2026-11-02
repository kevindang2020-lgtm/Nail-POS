// ticket-removal.kysely.repository.ts — persistence for the deletion-code + logical-removal flow. The remove() call is a
// single transaction: it stamps removed_at/by/reason, bumps tickets.version, appends a ticket_removed revision to the
// permanent timeline, and marks the code row used. It does NOT delete anything — financial/audit rows are untouched.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TicketRemovalRepo } from './ticket-removal.service';

const isoOrNull = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

export class TicketRemovalKyselyRepository implements TicketRemovalRepo {
  constructor(private readonly db: Kysely<DB> | null) {}

  async ticket(ticketId: string): Promise<{ tenantId: string; removedAt: string | null } | null> {
    if (!this.db) return null;
    const r: any = await this.db.selectFrom('tickets').where('id', '=', ticketId).select(['tenant_id', 'removed_at']).executeTakeFirst().catch(() => undefined);
    return r ? { tenantId: r.tenant_id, removedAt: isoOrNull(r.removed_at) } : null;
  }

  async codeRow(ticketId: string): Promise<{ codeEnc: string } | null> {
    if (!this.db) return null;
    const r: any = await this.db.selectFrom('ticket_deletion_codes').where('ticket_id', '=', ticketId).select(['code_enc']).executeTakeFirst().catch(() => undefined);
    return r ? { codeEnc: r.code_enc } : null;
  }

  async upsertCode(input: { ticketId: string; tenantId: string; codeEnc: string; byUserId?: string }): Promise<void> {
    if (!this.db) return;
    const existing: any = await this.db.selectFrom('ticket_deletion_codes').where('ticket_id', '=', input.ticketId).select(['id']).executeTakeFirst().catch(() => undefined);
    if (existing) {
      await this.db.updateTable('ticket_deletion_codes').set({ code_enc: input.codeEnc, generated_by_user_id: input.byUserId ?? null, generated_at: sql`now()`, revealed_at: null, revealed_by_user_id: null, reveal_count: 0, used_at: null, updated_at: sql`now()` }).where('ticket_id', '=', input.ticketId).execute().catch(() => undefined);
    } else {
      await this.db.insertInto('ticket_deletion_codes').values({ ticket_id: input.ticketId, tenant_id: input.tenantId, code_enc: input.codeEnc, generated_by_user_id: input.byUserId ?? null }).execute().catch(() => undefined);
    }
  }

  async markRevealed(ticketId: string, byUserId?: string): Promise<void> {
    if (!this.db) return;
    await this.db.updateTable('ticket_deletion_codes').set({ revealed_at: sql`now()`, revealed_by_user_id: byUserId ?? null, reveal_count: sql`reveal_count + 1`, updated_at: sql`now()` }).where('ticket_id', '=', ticketId).execute().catch(() => undefined);
  }

  async remove(input: { ticketId: string; tenantId: string; byUserId?: string; reason: string }): Promise<void> {
    if (!this.db) return;
    await this.db.transaction().execute(async (trx) => {
      const upd: any = await trx.updateTable('tickets').set({ removed_at: sql`now()`, removed_by_user_id: input.byUserId ?? null, removal_reason: input.reason, version: sql`version + 1`, updated_at: sql`now()` })
        .where('id', '=', input.ticketId).where('tenant_id', '=', input.tenantId).returning(['version']).executeTakeFirst();
      const version = Number(upd?.version ?? 0);
      await trx.insertInto('ticket_revisions').values({
        ticket_id: input.ticketId, tenant_id: input.tenantId, branch_id: null, version, action: 'ticket_removed',
        service_line_id: null, actor_user_id: input.byUserId ?? null, actor_role: 'SUPER_ADMIN', before: null,
        after: JSON.stringify({ reason: input.reason }), summary: `Ticket removed from active workflows: ${input.reason}`,
      }).execute();
      await trx.updateTable('ticket_deletion_codes').set({ used_at: sql`now()`, updated_at: sql`now()` }).where('ticket_id', '=', input.ticketId).execute();
    });
  }
}
