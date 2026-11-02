// communications-templates.service.ts — versioned message templates (§25). Creating a template makes a head + draft v1;
// editing appends a NEW draft version (published versions are never overwritten); publishing retires the prior
// published version and promotes the new one. Placeholders are validated (no injection) and previews are HTML-escaped.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from './communications-overview.service';
import { validateTemplate, renderPreview } from './communications-templates-core';
import { CommunicationsTemplatesRepository } from './communications-templates.kysely.repository';

/**
 * A message template belongs to ONE tenant. Every mutation here fetches the template head first, so this is the
 * one place to enforce that the caller owns it.
 *
 * Without this, `POST /pos/communications/templates/:id/versions/:version/publish` (TenantAuthGuard — any salon's
 * staff) let a manager at Salon A publish or modify Salon B's template by id. A platform template (tenant_id
 * NULL) is editable only by Super Admin, who has no tenant scope — so a null caller tenant is allowed ONLY when
 * the template is also platform-owned.
 */
function assertOwnsTemplate(ctx: AdminCtx, head: { tenant_id: string | null }): void {
  const caller = ctx.tenantId ?? null;
  if (String(head.tenant_id ?? '') !== String(caller ?? '')) {
    // 404, not 403 — a tenant must not be able to tell whether another tenant's template id exists.
    throw new NotFoundException('template not found');
  }
}
const CHANNELS = ['sms', 'email', 'push', 'in_app'];
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class CommunicationsTemplatesService {
  constructor(private readonly repo: CommunicationsTemplatesRepository) {}

  async list() { return { templates: await this.repo.list() }; }

  async get(ctx: AdminCtx, id: string) {
    if (!validUuid(id)) throw new BadRequestException('invalid template id');
    const head = await this.repo.head(id);
    if (!head) throw new NotFoundException('template not found');
    assertOwnsTemplate(ctx, head);
    return { template: head, versions: await this.repo.versions(id) };
  }

  private validateBody(body: any) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) throw new BadRequestException('name is required');
    const channel = String(body?.channel ?? '');
    if (!CHANNELS.includes(channel)) throw new BadRequestException('invalid channel');
    const bodyText = typeof body?.body === 'string' ? body.body : '';
    if (!bodyText.trim()) throw new BadRequestException('body is required');
    const subject = typeof body?.subject === 'string' && body.subject.trim() ? body.subject : null;
    const pushTitle = typeof body?.pushTitle === 'string' && body.pushTitle.trim() ? body.pushTitle : null;
    const v = validateTemplate(bodyText, subject, pushTitle);
    if (!v.ok) throw new BadRequestException(v.error);
    return { name, channel, bodyText, subject, pushTitle, placeholders: v.placeholders };
  }

  async createTemplate(ctx: AdminCtx, body: any) {
    const v = this.validateBody(body);
    const tenantId = typeof body?.tenantId === 'string' && validUuid(body.tenantId) ? body.tenantId : null;
    const category = typeof body?.category === 'string' && body.category.trim() ? body.category.trim() : null;
    const createdBy = ctx.userId && validUuid(ctx.userId) ? ctx.userId : null;
    const { id } = await this.repo.insertHead({ tenantId, name: v.name, channel: v.channel, category, createdBy });
    await this.repo.insertVersion({ templateId: id, version: 1, subject: v.subject, body: v.bodyText, pushTitle: v.pushTitle, placeholders: v.placeholders, createdBy });
    await this.repo.writeAudit(tenantId, ctx, 'template_created', `Template created: ${v.name}`, { id, channel: v.channel, placeholders: v.placeholders });
    return { ok: true, id, version: 1, status: 'draft', placeholders: v.placeholders };
  }

  /** Append a NEW draft version — never overwrites an existing (published) version. */
  async addVersion(ctx: AdminCtx, templateId: string, body: any) {
    if (!validUuid(templateId)) throw new BadRequestException('invalid template id');
    const head = await this.repo.head(templateId);
    if (!head) throw new NotFoundException('template not found');
    assertOwnsTemplate(ctx, head);
    const bodyText = typeof body?.body === 'string' ? body.body : '';
    if (!bodyText.trim()) throw new BadRequestException('body is required');
    const subject = typeof body?.subject === 'string' && body.subject.trim() ? body.subject : null;
    const pushTitle = typeof body?.pushTitle === 'string' && body.pushTitle.trim() ? body.pushTitle : null;
    const val = validateTemplate(bodyText, subject, pushTitle);
    if (!val.ok) throw new BadRequestException(val.error);
    const version = await this.repo.nextVersion(templateId);
    const createdBy = ctx.userId && validUuid(ctx.userId) ? ctx.userId : null;
    await this.repo.insertVersion({ templateId, version, subject, body: bodyText, pushTitle, placeholders: val.placeholders, createdBy });
    await this.repo.touch(templateId, head.tenant_id ?? null);
    await this.repo.writeAudit(head.tenant_id, ctx, 'template_version_added', `Template ${head.name} v${version} drafted`, { templateId, version });
    return { ok: true, templateId, version, status: 'draft', placeholders: val.placeholders };
  }

  async publishVersion(ctx: AdminCtx, templateId: string, version: number) {
    if (!validUuid(templateId)) throw new BadRequestException('invalid template id');
    const head = await this.repo.head(templateId);
    if (!head) throw new NotFoundException('template not found');
    assertOwnsTemplate(ctx, head);
    const row = await this.repo.versionRow(templateId, version);
    if (!row) throw new NotFoundException('version not found');
    if (row.status === 'published') return { ok: true, templateId, version, status: 'published', idempotent: true };
    if (row.status === 'retired') throw new BadRequestException('cannot publish a retired version');
    await this.repo.publish(templateId, version, head.tenant_id ?? null);
    await this.repo.writeAudit(head.tenant_id, ctx, 'template_version_published', `Template ${head.name} v${version} published`, { templateId, version });
    return { ok: true, templateId, version, status: 'published', idempotent: false };
  }

  async preview(body: any) {
    const bodyText = typeof body?.body === 'string' ? body.body : '';
    const val = validateTemplate(bodyText);
    if (!val.ok) throw new BadRequestException(val.error);
    const sample: Record<string, string> = (body?.values && typeof body.values === 'object') ? body.values : {};
    return { rendered: renderPreview(bodyText, sample), placeholders: val.placeholders };
  }
}
