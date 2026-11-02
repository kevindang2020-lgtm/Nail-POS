// communications-templates.kysely.repository.ts — persistence for versioned message templates (§25). Writes are
// non-swallowing. Publishing preserves history: the prior published version is retired (not overwritten) and the new
// version is published; the head points at the current version.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { MESSAGE_TEMPLATE, MESSAGE_TEMPLATE_VERSION } from '../communications-lifecycles';

export interface TemplateHead { id: string; tenant_id: string | null; name: string; channel: string; category: string | null; status: string; current_version: number; created_at: string }
export interface TemplateVersion { id: string; version: number; subject: string | null; body: string; push_title: string | null; placeholders: string[]; status: string; published_at: string | null; created_at: string }

export class CommunicationsTemplatesRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(limit = 50): Promise<(TemplateHead & { versions: number })[]> {
    try {
      return (await sql`select t.id::text as id, t.tenant_id::text as tenant_id, t.name, t.channel, t.category, t.status, t.current_version, t.created_at::text as created_at,
          (select count(*) from message_template_versions v where v.template_id = t.id)::int as versions
        from message_templates t order by t.updated_at desc limit ${limit}`.execute(this.db as any)).rows as any[];
    } catch { return []; }
  }

  async head(id: string): Promise<TemplateHead | null> {
    const r = (await sql`select id::text as id, tenant_id::text as tenant_id, name, channel, category, status, current_version, created_at::text as created_at from message_templates where id = ${id} limit 1`.execute(this.db as any)).rows[0] as TemplateHead | undefined;
    return r ?? null;
  }

  async versions(templateId: string): Promise<TemplateVersion[]> {
    return (await sql`select id::text as id, version, subject, body, push_title, placeholders, status, published_at::text as published_at, created_at::text as created_at from message_template_versions where template_id = ${templateId} order by version desc`.execute(this.db as any)).rows as TemplateVersion[];
  }

  async versionRow(templateId: string, version: number): Promise<TemplateVersion | null> {
    const r = (await sql`select id::text as id, version, subject, body, push_title, placeholders, status, published_at::text as published_at, created_at::text as created_at from message_template_versions where template_id = ${templateId} and version = ${version} limit 1`.execute(this.db as any)).rows[0] as TemplateVersion | undefined;
    return r ?? null;
  }

  async nextVersion(templateId: string): Promise<number> {
    const r = (await sql`select coalesce(max(version), 0) + 1 as n from message_template_versions where template_id = ${templateId}`.execute(this.db as any)).rows[0] as { n: number };
    return r?.n ?? 1;
  }

  async insertHead(i: { tenantId: string | null; name: string; channel: string; category: string | null; createdBy: string | null }): Promise<{ id: string }> {
    const r = (await sql`insert into message_templates (tenant_id, name, channel, category, status, current_version, created_by)
      values (${i.tenantId}, ${i.name}, ${i.channel}, ${i.category}, 'draft', 0, ${i.createdBy}) returning id::text as id`.execute(this.db as any)).rows[0] as { id: string };
    return r;
  }

  async insertVersion(i: { templateId: string; version: number; subject: string | null; body: string; pushTitle: string | null; placeholders: string[]; createdBy: string | null }): Promise<{ id: string }> {
    const r = (await sql`insert into message_template_versions (template_id, version, subject, body, push_title, placeholders, status, created_by)
      values (${i.templateId}, ${i.version}, ${i.subject}, ${i.body}, ${i.pushTitle}, ${i.placeholders}, 'draft', ${i.createdBy}) returning id::text as id`.execute(this.db as any)).rows[0] as { id: string };
    return r;
  }

  /** Publish a version: retire the currently-published version (preserved, not deleted), publish the target, and point
   *  the head at it — all in one transaction. */
  async publish(templateId: string, version: number, tenantId: string | null): Promise<void> {
    await sql`update message_template_versions set status = 'retired' where template_id = ${templateId} and status = 'published' and version <> ${version} and ${canMoveToSql(MESSAGE_TEMPLATE_VERSION, 'retired')}`.execute(this.db as any);
    await sql`update message_template_versions set status = 'published', published_at = now() where template_id = ${templateId} and version = ${version} and ${canMoveToSql(MESSAGE_TEMPLATE_VERSION, 'published')}`.execute(this.db as any);
    // Scoped by tenant as well as id — defence in depth. The service verifies ownership before calling this, but
    // a scoped write means a future caller that forgets cannot cross tenants either. `is not distinct from` so a
    // platform template (tenant_id NULL) matches a null caller.
    await sql`update message_templates set current_version = ${version}, status = 'published', updated_at = now() where id = ${templateId} and tenant_id is not distinct from ${tenantId} and ${canMoveToSql(MESSAGE_TEMPLATE, 'published')}`.execute(this.db as any);
  }

  async touch(templateId: string, tenantId: string | null): Promise<void> {
    await sql`update message_templates set updated_at = now() where id = ${templateId} and tenant_id is not distinct from ${tenantId}`.execute(this.db as any);
  }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    if (!tenantId) return; // platform templates are recorded by the template rows themselves (audit_events.tenant_id NOT NULL)
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'communications', ${action}, 'message_template', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
