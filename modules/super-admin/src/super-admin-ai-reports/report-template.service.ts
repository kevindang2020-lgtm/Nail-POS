// Report-template engine — create draft (versioned), publish (archives the prior published version of the same report),
// archive, list, and build a GROUNDED narrative from a metrics snapshot using the current published template. Every
// change is validated by report-template-core; narratives never contain a number the metrics snapshot doesn't have.
import { nextTemplateVersion, canPublishTemplate, canArchiveTemplate, validateTemplateSections, buildGroundedNarrative } from './report-template-core';
import type { ReportTemplateRepositoryPort } from './report-template.repository';

export class TemplateError extends Error { constructor(public code: 'invalid' | 'not_found' | 'conflict', message: string) { super(message); } }

export class ReportTemplateService {
  constructor(private readonly repo: ReportTemplateRepositoryPort) {}

  async createDraft(input: { reportKey: string; name: string; sections: unknown }, createdBy: string | null = null) {
    const reportKey = String(input.reportKey || '').trim();
    if (!reportKey) throw new TemplateError('invalid', 'reportKey is required');
    if (!String(input.name || '').trim()) throw new TemplateError('invalid', 'name is required');
    const v = validateTemplateSections(input.sections);
    if (!v.ok) throw new TemplateError('invalid', v.reason);
    const version = nextTemplateVersion(await this.repo.listVersions(reportKey));
    return this.repo.insert({ reportKey, name: input.name.trim(), version, sections: v.sections, createdBy });
  }

  async publish(id: string) {
    const t = await this.repo.get(String(id || ''));
    if (!t) throw new TemplateError('not_found', 'Template not found');
    if (!canPublishTemplate(t.status)) throw new TemplateError('conflict', `only a draft template can be published (status "${t.status}")`);
    const published = await this.repo.setStatus(t.id, 'published', new Date().toISOString());
    await this.repo.archiveOtherPublished(t.reportKey, t.id); // keep a single current published version
    return published;
  }

  async archive(id: string) {
    const t = await this.repo.get(String(id || ''));
    if (!t) throw new TemplateError('not_found', 'Template not found');
    if (!canArchiveTemplate(t.status)) throw new TemplateError('conflict', `a "${t.status}" template cannot be archived`);
    return this.repo.setStatus(t.id, 'archived', null);
  }

  async listByKey(reportKey: string) { return this.repo.listByKey(String(reportKey || '')); }

  // Grounded narrative for a metrics snapshot using the current published template. If no template is published, the
  // caller gets a clear signal rather than a fabricated document.
  async buildNarrative(reportKey: string, metrics: Record<string, unknown>) {
    const tpl = await this.repo.currentPublished(String(reportKey || ''));
    if (!tpl) return { available: false as const, note: 'No published template for this report' };
    const grounded = buildGroundedNarrative(tpl.sections, metrics || {});
    return { available: true as const, templateId: tpl.id, version: tpl.version, ...grounded };
  }
}
