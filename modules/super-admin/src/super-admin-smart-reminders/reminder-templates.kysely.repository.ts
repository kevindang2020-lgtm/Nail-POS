// reminder-templates.kysely.repository.ts — persistence for versioned reminder templates (§30). Publishing preserves
// history: the prior published version is retired (not overwritten), the target is published, and the head points at it.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { REMINDER_TEMPLATE_VERSION, REMINDER_TEMPLATE } from '../lifecycles';

export interface TemplateHead { id: string; tenant_id: string | null; reminder_type: string; name: string; status: string; current_version: number; created_at: string }
export interface TemplateVersion { id: string; version: number; sms_content: string | null; email_subject: string | null; email_body: string | null; push_title: string | null; push_body: string | null; placeholders: string[]; status: string; published_at: string | null; created_at: string }

export class ReminderTemplatesRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(limit = 50): Promise<(TemplateHead & { versions: number })[]> {
    try {
      return (await sql`select t.id::text as id, t.tenant_id::text as tenant_id, t.reminder_type, t.name, t.status, t.current_version, t.created_at::text as created_at,
          (select count(*) from reminder_template_versions v where v.template_id = t.id)::int as versions
        from reminder_templates t order by t.updated_at desc limit ${limit}`.execute(this.db as any)).rows as any[];
    } catch { return []; }
  }

  async head(id: string): Promise<TemplateHead | null> {
    const r = (await sql`select id::text as id, tenant_id::text as tenant_id, reminder_type, name, status, current_version, created_at::text as created_at from reminder_templates where id = ${id} limit 1`.execute(this.db as any)).rows[0] as TemplateHead | undefined;
    return r ?? null;
  }

  async versions(templateId: string): Promise<TemplateVersion[]> {
    return (await sql`select id::text as id, version, sms_content, email_subject, email_body, push_title, push_body, placeholders, status, published_at::text as published_at, created_at::text as created_at from reminder_template_versions where template_id = ${templateId} order by version desc`.execute(this.db as any)).rows as TemplateVersion[];
  }

  async versionRow(templateId: string, version: number): Promise<TemplateVersion | null> {
    const r = (await sql`select id::text as id, version, sms_content, email_subject, email_body, push_title, push_body, placeholders, status, published_at::text as published_at, created_at::text as created_at from reminder_template_versions where template_id = ${templateId} and version = ${version} limit 1`.execute(this.db as any)).rows[0] as TemplateVersion | undefined;
    return r ?? null;
  }

  async nextVersion(templateId: string): Promise<number> {
    const r = (await sql`select coalesce(max(version), 0) + 1 as n from reminder_template_versions where template_id = ${templateId}`.execute(this.db as any)).rows[0] as { n: number };
    return r?.n ?? 1;
  }

  async insertHead(i: { tenantId: string | null; reminderType: string; name: string; createdBy: string | null }): Promise<{ id: string }> {
    return (await sql`insert into reminder_templates (tenant_id, reminder_type, name, status, current_version, created_by)
      values (${i.tenantId}, ${i.reminderType}, ${i.name}, 'draft', 0, ${i.createdBy}) returning id::text as id`.execute(this.db as any)).rows[0] as { id: string };
  }

  async insertVersion(i: { templateId: string; version: number; sms: string | null; emailSubject: string | null; emailBody: string | null; pushTitle: string | null; pushBody: string | null; placeholders: string[]; createdBy: string | null }): Promise<{ id: string }> {
    return (await sql`insert into reminder_template_versions (template_id, version, sms_content, email_subject, email_body, push_title, push_body, placeholders, status, created_by)
      values (${i.templateId}, ${i.version}, ${i.sms}, ${i.emailSubject}, ${i.emailBody}, ${i.pushTitle}, ${i.pushBody}, ${i.placeholders}, 'draft', ${i.createdBy}) returning id::text as id`.execute(this.db as any)).rows[0] as { id: string };
  }

  async publish(templateId: string, version: number): Promise<void> {
    await sql`update reminder_template_versions set status = 'retired' where template_id = ${templateId} and status = 'published' and version <> ${version} and ${canMoveToSql(REMINDER_TEMPLATE_VERSION, 'retired')}`.execute(this.db as any);
    await sql`update reminder_template_versions set status = 'published', published_at = now() where template_id = ${templateId} and version = ${version} and ${canMoveToSql(REMINDER_TEMPLATE_VERSION, 'published')}`.execute(this.db as any);
    await sql`update reminder_templates set current_version = ${version}, status = 'published', updated_at = now() where id = ${templateId} and ${canMoveToSql(REMINDER_TEMPLATE, 'published')}`.execute(this.db as any);
  }

  async touch(templateId: string): Promise<void> {
    await sql`update reminder_templates set updated_at = now() where id = ${templateId}`.execute(this.db as any);
  }

  async writeAudit(tenantId: string | null, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    if (!tenantId) return; // platform templates are recorded by the template rows themselves (audit_events.tenant_id NOT NULL)
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'smart-reminders', ${action}, 'reminder_template', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
