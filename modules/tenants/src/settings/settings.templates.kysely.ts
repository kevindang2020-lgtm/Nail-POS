// settings.templates.kysely.ts — the salon's reusable SMS / email message templates (POS → Settings → Message Templates,
// GET/POST pos/settings/notifications-reminders/templates), stored in pos_message_templates (migration 017a; tenant_id
// uuid since 539). Gap sweep (Oct 30 2026): the route used to keep them in a process-memory Map — a template vanished on
// every restart, another API instance never saw it, and the Communications overview's template count (which reads this
// table) never moved. Tenant from the session only; an id that is not this salon's is "not found", never another salon's.
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { MessageTemplate } from '@aipowersalon/api-contracts/tenant';
import type { SettingsContext } from './settings.dto';

export interface MessageTemplateStorePort {
  list(ctx: SettingsContext): Promise<MessageTemplate[]>;
  /** create (no id) or update (id of THIS salon's template); null when the id is not this salon's */
  upsert(ctx: SettingsContext, t: { id?: string; channel: 'sms' | 'email'; name: string; body: string }): Promise<MessageTemplate | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toTemplate = (r: { id: string; channel: string; name: string; body: string }): MessageTemplate =>
  ({ id: String(r.id), channel: r.channel === 'email' ? 'email' : 'sms', name: String(r.name), body: String(r.body) });

export class KyselyMessageTemplateStore implements MessageTemplateStorePort {
  constructor(private readonly db: AppDatabase) {}

  async list(ctx: SettingsContext): Promise<MessageTemplate[]> {
    // 740: archived templates are history, not part of the working list (the Message Templates screen shows them on request)
    const r = await sql<{ id: string; channel: string; name: string; body: string }>`SELECT t.id, t.channel, t.name, t.body
      FROM pos_message_templates t WHERE t.tenant_id = ${ctx.tenantId}::uuid AND t.status <> 'archived' ORDER BY lower(t.name), t.id LIMIT 500`.execute(this.db);
    return r.rows.map(toTemplate);
  }

  async upsert(ctx: SettingsContext, t: { id?: string; channel: 'sms' | 'email'; name: string; body: string }): Promise<MessageTemplate | null> {
    // 740: the same rows the Message Templates screen versions — every content change here is a new version too, and an
    // archived template is not edited through this older route (restore it on the Message Templates screen first).
    const actor = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx: any) => {
      if (t.id) {
        const r = await sql<{ id: string; channel: string; name: string; body: string; current_version: number }>`UPDATE pos_message_templates t
          SET channel = ${t.channel}, name = ${t.name}, body = ${t.body}, subject = CASE WHEN ${t.channel} = 'sms' THEN NULL ELSE t.subject END,
              current_version = t.current_version + CASE WHEN (t.channel, t.name, t.body) IS DISTINCT FROM (${t.channel}, ${t.name}, ${t.body}) THEN 1 ELSE 0 END,
              record_version = t.record_version + 1, updated_by = ${actor}::uuid, updated_at = now()
          WHERE t.tenant_id = ${ctx.tenantId}::uuid AND t.id = ${t.id} AND t.status <> 'archived' RETURNING t.id, t.channel, t.name, t.body, t.current_version`.execute(trx);
        const row = r.rows[0];
        if (!row) return null;
        await sql`INSERT INTO pos_message_template_versions (tenant_id, template_id, version, name, channel, category, subject, body, created_by)
          SELECT t.tenant_id, t.id, t.current_version, t.name, t.channel, t.category, t.subject, t.body, ${actor}::uuid FROM pos_message_templates t
          WHERE t.tenant_id = ${ctx.tenantId}::uuid AND t.id = ${t.id} ON CONFLICT (tenant_id, template_id, version) DO NOTHING`.execute(trx);
        return toTemplate(row);
      }
      const id = `tpl_${randomUUID()}`;
      const r = await sql<{ id: string; channel: string; name: string; body: string }>`INSERT INTO pos_message_templates (id, tenant_id, channel, name, body, status, current_version, record_version, created_by, updated_by, created_at, updated_at)
        VALUES (${id}, ${ctx.tenantId}::uuid, ${t.channel}, ${t.name}, ${t.body}, 'active', 1, 1, ${actor}::uuid, ${actor}::uuid, now(), now()) RETURNING id, channel, name, body`.execute(trx);
      await sql`INSERT INTO pos_message_template_versions (tenant_id, template_id, version, name, channel, body, created_by) VALUES (${ctx.tenantId}::uuid, ${id}, 1, ${t.name}, ${t.channel}, ${t.body}, ${actor}::uuid)`.execute(trx);
      return toTemplate(r.rows[0]);
    });
  }
}
