// service-templates.service.ts — read-only overview for the service-template catalog (Unit 1). Mutations arrive in
// later units. Pure aggregation lives in catalog-overview-core.
import { Injectable, Inject } from '@nestjs/common';
import type { CatalogRepo, ListParams, ListResult, AuditActor } from './service-templates.repository';
import { buildCatalogOverview, type CatalogOverview } from './catalog-overview-core';
import { normalizeCreateTemplate, normalizeTemplatePatch, assertPublishable, assertRetirable, normalizeCategoryCreate, normalizeCategoryPatch } from './template-mutations-core';
import { planDeployment, summarizePlan } from './deploy-core';

export class CatalogForbiddenError extends Error {}
export class CatalogNotFoundError extends Error {}
const MANAGE_PERM = 'super_admin.catalog.manage';

@Injectable()
export class ServiceTemplatesService {
  constructor(@Inject('CatalogRepo') private readonly repo: CatalogRepo) {}

  private requireManage(actor: AuditActor) {
    if (!(actor?.permissions ?? []).includes(MANAGE_PERM)) throw new CatalogForbiddenError(`missing permission: ${MANAGE_PERM}`);
  }

  async getOverview(): Promise<CatalogOverview> {
    return buildCatalogOverview(await this.repo.getOverviewData());
  }

  async getTemplate(id: string) {
    const t = await this.repo.getTemplateDetail(id);
    if (!t) throw new CatalogNotFoundError('template not found');
    return t;
  }

  async createTemplate(actor: AuditActor, body: unknown) {
    this.requireManage(actor);
    const n = normalizeCreateTemplate(body); // throws Error -> 400
    if (!(await this.repo.categoryExists(n.categoryCode))) throw new CatalogNotFoundError(`category not found: ${n.categoryCode}`);
    const id = await this.repo.createTemplate(n, actor);
    await this.repo.writeAudit(actor, 'super_admin_service_template_created', id, { name: n.name, categoryCode: n.categoryCode });
    return this.repo.getTemplateDetail(id);
  }

  async updateTemplate(actor: AuditActor, id: string, body: unknown) {
    this.requireManage(actor);
    const existing = await this.repo.getTemplateDetail(id);
    if (!existing) throw new CatalogNotFoundError('template not found');
    const patch = normalizeTemplatePatch(body);
    if (patch.categoryCode !== undefined && !(await this.repo.categoryExists(patch.categoryCode))) throw new CatalogNotFoundError(`category not found: ${patch.categoryCode}`);
    await this.repo.updateTemplate(id, patch, actor);
    await this.repo.writeAudit(actor, 'super_admin_service_template_updated', id, { changed: Object.keys(patch), changeNote: patch.changeNote ?? null });
    return this.repo.getTemplateDetail(id);
  }

  async publishTemplate(actor: AuditActor, id: string) {
    this.requireManage(actor);
    const existing = await this.repo.getTemplateDetail(id);
    if (!existing) throw new CatalogNotFoundError('template not found');
    assertPublishable(existing); // throws Error -> 400
    await this.repo.publishTemplate(id, actor);
    await this.repo.writeAudit(actor, 'super_admin_service_template_published', id, { name: existing.name });
    return this.repo.getTemplateDetail(id);
  }

  async retireTemplate(actor: AuditActor, id: string, body: any) {
    this.requireManage(actor);
    const existing = await this.repo.getTemplateDetail(id);
    if (!existing) throw new CatalogNotFoundError('template not found');
    const reason = assertRetirable(existing, body?.reason); // throws Error -> 400
    await this.repo.retireTemplate(id, reason, actor);
    await this.repo.writeAudit(actor, 'super_admin_service_template_retired', id, { name: existing.name, reason, deploymentCount: existing.deploymentCount });
    return this.repo.getTemplateDetail(id);
  }

  async listCategories() {
    return this.repo.listCategories();
  }

  // Preview: per-tenant plan (deploy/overwrite/skip) without writing — surfaces conflicts before the operator commits.
  async previewDeploy(actor: AuditActor, id: string, allowOverwrite: boolean) {
    this.requireManage(actor);
    const tpl = await this.repo.getTemplateDetail(id);
    if (!tpl) throw new CatalogNotFoundError('template not found');
    const facts = await this.repo.getDeployFacts(id, tpl.name);
    const plan = planDeployment(facts, { allowOverwrite });
    return { template: { id: tpl.id, name: tpl.name, status: tpl.status }, plan, summary: summarizePlan(plan) };
  }

  async deploy(actor: AuditActor, id: string, body: any) {
    this.requireManage(actor);
    const tpl = await this.repo.getTemplateDetail(id);
    if (!tpl) throw new CatalogNotFoundError('template not found');
    if (tpl.status !== 'published') throw new Error('only published templates can be deployed to tenants');
    const allowOverwrite = body?.allowOverwrite === true;
    const customizable = body?.customizable !== false;
    const requested: string[] | null = Array.isArray(body?.tenantIds) && body.tenantIds.length ? body.tenantIds.map(String) : null;
    let facts = await this.repo.getDeployFacts(id, tpl.name);
    if (requested) facts = facts.filter((f) => requested.includes(f.tenantId));
    if (facts.length === 0) throw new Error('no target tenants selected');
    const plan = planDeployment(facts, { allowOverwrite });
    const results = await this.repo.executeDeploy(id, plan, { customizable }, actor);
    const summary = summarizePlan(plan);
    await this.repo.writeAudit(actor, 'super_admin_service_template_deployed', id, { name: tpl.name, allowOverwrite, customizable, summary, results: results.map((r) => ({ tenantId: r.tenantId, action: r.action, reason: r.reason })) });
    return { summary, results };
  }

  async setCustomizable(actor: AuditActor, deploymentId: string, body: any) {
    this.requireManage(actor);
    const customizable = body?.customizable !== false;
    const ok = await this.repo.setDeploymentCustomizable(deploymentId, customizable);
    if (!ok) throw new CatalogNotFoundError('deployment not found');
    await this.repo.writeAudit(actor, 'super_admin_service_template_deployment_customizable_set', deploymentId, { customizable });
    return { deploymentId, customizable };
  }

  async getComparison(id: string) {
    const tpl = await this.repo.getTemplateDetail(id);
    if (!tpl) throw new CatalogNotFoundError('template not found');
    return { template: { id: tpl.id, name: tpl.name }, rows: await this.repo.getComparison(id) };
  }

  async createCategory(actor: AuditActor, body: unknown) {
    this.requireManage(actor);
    const n = normalizeCategoryCreate(body);
    const code = await this.repo.createCategory(n, actor);
    await this.repo.writeAudit(actor, 'super_admin_service_category_created', code, { name: n.name });
    return this.repo.listCategories();
  }

  async updateCategory(actor: AuditActor, code: string, body: unknown) {
    this.requireManage(actor);
    const patch = normalizeCategoryPatch(body);
    const ok = await this.repo.updateCategory(code, patch, actor);
    if (!ok) throw new CatalogNotFoundError(`category not found: ${code}`);
    await this.repo.writeAudit(actor, 'super_admin_service_category_updated', code, { changed: Object.keys(patch), ...patch });
    return this.repo.listCategories();
  }

  private csvCell(v: unknown): string {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  async exportCsv(actor: AuditActor, q: any): Promise<{ filename: string; csv: string; rowCount: number; generatedAt: string }> {
    this.requireManage(actor);
    const params = this.normalizeList(q);
    const rows = await this.repo.exportTemplates(params);
    const dollars = (c: number) => (c / 100).toFixed(2);
    const header = ['Template Name', 'Category', 'Suggested Duration (min)', 'Suggested Price Min', 'Suggested Price Max', 'Required Resources', 'Tax Setting', 'Commission Eligible', 'Add-Ons', 'Active Tenant Usage', 'Version', 'Status'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.name, r.categoryName ?? '', r.durationMinutes, dollars(r.priceMinCents), dollars(r.priceMaxCents),
        r.resources.map((x) => `${x.label} (${x.quantity})`).join('; '), r.taxSetting === 'non_taxable' ? 'Non-Taxable' : 'Taxable',
        r.commissionEligible ? 'Yes' : 'No', r.addonCount, r.activeTenantUsage, r.versionLabel, r.status,
      ].map((c) => this.csvCell(c)).join(','));
    }
    const generatedAt = new Date().toISOString();
    await this.repo.writeAudit(actor, 'super_admin_service_template_export', 'platform', { format: 'csv', rowCount: rows.length, filters: params, generatedAt, exportedBy: actor.userId ?? null });
    return { filename: `service-templates-${generatedAt.slice(0, 10)}.csv`, csv: lines.join('\n'), rowCount: rows.length, generatedAt };
  }

  private normalizeList(q: any): ListParams {
    return {
      page: 1, pageSize: 5000,
      search: typeof q?.search === 'string' && q.search.trim() ? q.search.trim() : undefined,
      category: typeof q?.category === 'string' && q.category ? q.category : undefined,
      status: ['draft', 'published', 'retired'].includes(q?.status) ? q.status : undefined,
      commission: q?.commission === 'yes' || q?.commission === 'no' ? q.commission : undefined,
      tax: q?.tax === 'taxable' || q?.tax === 'non_taxable' ? q.tax : undefined,
      usage: q?.usage === 'using' || q?.usage === 'unused' ? q.usage : undefined,
      serviceType: q?.serviceType === 'individual' || q?.serviceType === 'package' ? q.serviceType : undefined,
    };
  }

  async listTemplates(q: any): Promise<ListResult> {
    const params: ListParams = {
      page: Math.max(1, parseInt(q?.page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(q?.pageSize, 10) || 10)),
      search: typeof q?.search === 'string' && q.search.trim() ? q.search.trim() : undefined,
      category: typeof q?.category === 'string' && q.category ? q.category : undefined,
      status: ['draft', 'published', 'retired'].includes(q?.status) ? q.status : undefined,
      commission: q?.commission === 'yes' || q?.commission === 'no' ? q.commission : undefined,
      tax: q?.tax === 'taxable' || q?.tax === 'non_taxable' ? q.tax : undefined,
      usage: q?.usage === 'using' || q?.usage === 'unused' ? q.usage : undefined,
      serviceType: q?.serviceType === 'individual' || q?.serviceType === 'package' ? q.serviceType : undefined,
    };
    return this.repo.listTemplates(params);
  }

  // Server-side CSV export of the CURRENT filtered scope (all matching rows, not just a page). Audited with the actor +
  // filters + generation time. Money rendered as dollars for spreadsheet friendliness.
}

