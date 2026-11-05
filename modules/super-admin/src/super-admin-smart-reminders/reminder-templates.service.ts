// reminder-templates.service.ts — Create Global Reminder Templates (§30). Templates are bound to a reminder type and
// carry per-channel content. Creating makes a head + draft v1; editing appends a NEW draft version (published versions
// are never overwritten); publishing retires the prior published version and promotes the new one. Placeholders are
// validated against injection and previews are HTML-escaped — reusing the shared pure template core.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validateTemplate, renderPreview } from '@aipowersalon/communications';
import { REMINDER_TYPES } from './smart-reminders-core';
import { ReminderTemplatesRepository } from './reminder-templates.kysely.repository';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const TYPE_KEYS = new Set<string>(REMINDER_TYPES.map((t) => t.key));
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class ReminderTemplatesService {
  constructor(private readonly repo: ReminderTemplatesRepository) {}

  async list() { return { templates: await this.repo.list() }; }

  async get(id: string) {
    if (!validUuid(id)) throw new BadRequestException('invalid template id');
    const head = await this.repo.head(id);
    if (!head) throw new NotFoundException('template not found');
    return { template: head, versions: await this.repo.versions(id) };
  }

  private validateContent(body: any) {
    const sms = typeof body?.sms === 'string' && body.sms.trim() ? body.sms : null;
    const emailSubject = typeof body?.emailSubject === 'string' && body.emailSubject.trim() ? body.emailSubject : null;
    const emailBody = typeof body?.emailBody === 'string' && body.emailBody.trim() ? body.emailBody : null;
    const pushTitle = typeof body?.pushTitle === 'string' && body.pushTitle.trim() ? body.pushTitle : null;
    const pushBody = typeof body?.pushBody === 'string' && body.pushBody.trim() ? body.pushBody : null;
    if (!sms && !emailBody && !pushBody) throw new BadRequestException('at least one channel content (SMS, email, or push) is required');
    const v = validateTemplate(sms, emailSubject, emailBody, pushTitle, pushBody);
    if (!v.ok) throw new BadRequestException(v.error);
    return { sms, emailSubject, emailBody, pushTitle, pushBody, placeholders: v.placeholders };
  }

  async createTemplate(ctx: AdminCtx, body: any) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) throw new BadRequestException('name is required');
    const reminderType = String(body?.reminderType ?? '');
    if (!TYPE_KEYS.has(reminderType)) throw new BadRequestException('invalid reminderType');
    const c = this.validateContent(body);
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;
    const createdBy = ctx.userId && validUuid(ctx.userId) ? ctx.userId : null;
    const { id } = await this.repo.insertHead({ tenantId, reminderType, name, createdBy });
    await this.repo.insertVersion({ templateId: id, version: 1, sms: c.sms, emailSubject: c.emailSubject, emailBody: c.emailBody, pushTitle: c.pushTitle, pushBody: c.pushBody, placeholders: c.placeholders, createdBy });
    await this.repo.writeAudit(tenantId, ctx, 'reminder_template_created', `Reminder template created: ${name}`, { id, reminderType, placeholders: c.placeholders });
    return { ok: true, id, version: 1, status: 'draft', reminderType, placeholders: c.placeholders };
  }

  async addVersion(ctx: AdminCtx, templateId: string, body: any) {
    if (!validUuid(templateId)) throw new BadRequestException('invalid template id');
    const head = await this.repo.head(templateId);
    if (!head) throw new NotFoundException('template not found');
    const c = this.validateContent(body);
    const version = await this.repo.nextVersion(templateId);
    const createdBy = ctx.userId && validUuid(ctx.userId) ? ctx.userId : null;
    await this.repo.insertVersion({ templateId, version, sms: c.sms, emailSubject: c.emailSubject, emailBody: c.emailBody, pushTitle: c.pushTitle, pushBody: c.pushBody, placeholders: c.placeholders, createdBy });
    await this.repo.touch(templateId);
    await this.repo.writeAudit(head.tenant_id, ctx, 'reminder_template_version_added', `Reminder template ${head.name} v${version} drafted`, { templateId, version });
    return { ok: true, templateId, version, status: 'draft', placeholders: c.placeholders };
  }

  async publishVersion(ctx: AdminCtx, templateId: string, version: number) {
    if (!validUuid(templateId)) throw new BadRequestException('invalid template id');
    const head = await this.repo.head(templateId);
    if (!head) throw new NotFoundException('template not found');
    const row = await this.repo.versionRow(templateId, version);
    if (!row) throw new NotFoundException('version not found');
    if (row.status === 'published') return { ok: true, templateId, version, status: 'published', idempotent: true };
    if (row.status === 'retired') throw new BadRequestException('cannot publish a retired version');
    await this.repo.publish(templateId, version);
    await this.repo.writeAudit(head.tenant_id, ctx, 'reminder_template_version_published', `Reminder template ${head.name} v${version} published`, { templateId, version });
    return { ok: true, templateId, version, status: 'published', idempotent: false };
  }

  async preview(body: any) {
    const parts = [body?.sms, body?.emailBody, body?.pushBody].filter((x) => typeof x === 'string' && x.trim());
    if (!parts.length) throw new BadRequestException('provide content to preview');
    const val = validateTemplate(...parts);
    if (!val.ok) throw new BadRequestException(val.error);
    const sample: Record<string, string> = (body?.values && typeof body.values === 'object') ? body.values : {};
    return {
      placeholders: val.placeholders,
      sms: typeof body?.sms === 'string' ? renderPreview(body.sms, sample) : null,
      emailBody: typeof body?.emailBody === 'string' ? renderPreview(body.emailBody, sample) : null,
      pushBody: typeof body?.pushBody === 'string' ? renderPreview(body.pushBody, sample) : null,
    };
  }
}
