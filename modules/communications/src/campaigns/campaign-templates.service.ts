// Reusable campaign templates service. Create → draft (version 1). Publishing marks the current version published.
// Editing creates a NEW version (monotonic; prior versions preserved) — it never overwrites a tenant's customized
// copy. Distribution to tenants is out of scope here (tenants copy + customize through their own workflow).

import { validateTemplateInput, canPublish, nextVersion, type TemplateInput } from './campaign-template-core';
import type { TemplateRepo, TemplateRow, TemplateVersionRow } from './campaign-templates.repository';

export class CampaignTemplatesService {
  constructor(private readonly repo: TemplateRepo) {}

  list(scope: { status?: string } = {}) { return this.repo.list(scope); }
  versions(templateId: string) { return this.repo.listVersions(templateId); }

  async create(input: TemplateInput & { campaignType?: string; suggestedAudience?: string | null; suggestedOffer?: string | null; complianceNote?: string | null; createdByUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; template?: TemplateRow }> {
    const { errors } = validateTemplateInput(input);
    if (errors.length) return { ok: false, errors };
    const template = await this.repo.create({ ...input, createdByUserId: input.createdByUserId ?? null });
    return { ok: true, template };
  }

  async newVersion(id: string, patch: { subject?: string | null; body?: string | null; channel?: string | null; notes?: string | null; createdByUserId?: string | null }):
    Promise<{ ok: boolean; errors?: string[]; version?: TemplateVersionRow }> {
    const t = await this.repo.get(id);
    if (!t) return { ok: false, errors: ['Template not found.'] };
    const version = await this.repo.addVersion(id, { ...patch, published: false, createdByUserId: patch.createdByUserId ?? null });
    if (!version) return { ok: false, errors: ['Template not found.'] };
    await this.repo.setStatusAndVersion(id, t.status, nextVersion(t.currentVersion));
    return { ok: true, version };
  }

  async publish(id: string): Promise<{ ok: boolean; errors?: string[]; template?: TemplateRow }> {
    const t = await this.repo.get(id);
    if (!t) return { ok: false, errors: ['Template not found.'] };
    if (!canPublish(t.status as any)) return { ok: false, errors: [`A ${t.status} template cannot be published.`] };
    const template = await this.repo.setStatusAndVersion(id, 'published', t.currentVersion);
    return template ? { ok: true, template } : { ok: false, errors: ['Template not found.'] };
  }
}
