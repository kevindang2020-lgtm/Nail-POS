// service-templates.repository.ts — data port for the service-template catalog overview (read-only in Unit 1).
import type { CatalogOverviewData } from './catalog-overview-core';

export type TemplateLibraryRow = {
  id: string; code: string; name: string; categoryCode: string | null; categoryName: string | null;
  durationMinutes: number; priceMinCents: number; priceMaxCents: number;
  resources: { label: string; quantity: number }[]; taxSetting: string; commissionEligible: boolean;
  addonCount: number; activeTenantUsage: number; versionLabel: string; status: string;
};
export type ListParams = {
  page: number; pageSize: number; search?: string; category?: string; status?: string;
  commission?: 'yes' | 'no'; tax?: 'taxable' | 'non_taxable'; usage?: 'using' | 'unused'; serviceType?: 'individual' | 'package';
};
export type ListResult = { rows: TemplateLibraryRow[]; total: number; page: number; pageSize: number };

export type TemplateDetail = {
  id: string; code: string; name: string; categoryCode: string | null; description: string | null;
  durationMinutes: number; priceMinCents: number; priceMaxCents: number; taxSetting: string;
  commissionEligible: boolean; isCustomizable: boolean; status: string; version: number; versionLabel: string;
  resources: { label: string; quantity: number }[]; addons: { name: string; priceCents: number }[];
  deploymentCount: number;
};
export type CategoryRowDetail = { code: string; name: string; iconKey: string | null; displayOrder: number; status: string; templateCount: number };
export type DeployResult = { tenantId: string; tenantName: string; action: string; reason: string; copiedServiceId: string | null };
export type ComparisonRow = {
  deploymentId: string; tenantId: string; tenantName: string; copiedServiceId: string | null; customizable: boolean;
  templateName: string; serviceName: string | null; templatePriceMinCents: number; servicePriceCents: number | null;
  templateDuration: number; serviceDuration: number | null; customized: boolean;
};
export type AuditActor = { userId?: string | null; role?: string | null; permissions?: string[] };

export interface CatalogRepo {
  getOverviewData(): Promise<CatalogOverviewData>;
  listTemplates(params: ListParams): Promise<ListResult>;
  exportTemplates(params: ListParams): Promise<TemplateLibraryRow[]>;
  getTemplateDetail(id: string): Promise<TemplateDetail | null>;
  categoryExists(code: string): Promise<boolean>;
  createTemplate(n: import('./template-mutations-core').NormalizedCreateTemplate, actor: AuditActor): Promise<string>;
  updateTemplate(id: string, patch: import('./template-mutations-core').NormalizedTemplatePatch, actor: AuditActor): Promise<void>;
  publishTemplate(id: string, actor: AuditActor): Promise<void>;
  retireTemplate(id: string, reason: string, actor: AuditActor): Promise<void>;
  listCategories(): Promise<CategoryRowDetail[]>;
  createCategory(n: { name: string; iconKey: string | null }, actor: AuditActor): Promise<string>;
  updateCategory(code: string, patch: { name?: string; iconKey?: string | null; displayOrder?: number; status?: string }, actor: AuditActor): Promise<boolean>;
  getDeployFacts(templateId: string, templateName: string): Promise<import('./deploy-core').TenantDeployFacts[]>;
  executeDeploy(templateId: string, plan: import('./deploy-core').DeployPlanItem[], options: { customizable: boolean }, actor: AuditActor): Promise<DeployResult[]>;
  setDeploymentCustomizable(deploymentId: string, customizable: boolean): Promise<boolean>;
  getComparison(templateId: string): Promise<ComparisonRow[]>;
  writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void>;
}

const NO_DB = () => { throw new Error('database not available'); };

// In-memory stub: no DB -> honest empty overview (used when DATABASE isn't provided, e.g. some test contexts).
export class InMemoryCatalogRepo implements CatalogRepo {
  async getOverviewData(): Promise<CatalogOverviewData> {
    return { templates: [], categories: [], deployments: [], totalTenants: 0, resourceLabels: [], addonTotal: 0, versionsThisMonth: 0, recentVersions: [], tenantCompare: [] };
  }
  async listTemplates(params: ListParams): Promise<ListResult> {
    return { rows: [], total: 0, page: params.page, pageSize: params.pageSize };
  }
  async exportTemplates(): Promise<TemplateLibraryRow[]> { return []; }
  async getTemplateDetail(): Promise<TemplateDetail | null> { return null; }
  async categoryExists(): Promise<boolean> { return false; }
  async createTemplate(): Promise<string> { return NO_DB(); }
  async updateTemplate(): Promise<void> { return NO_DB(); }
  async publishTemplate(): Promise<void> { return NO_DB(); }
  async retireTemplate(): Promise<void> { return NO_DB(); }
  async listCategories(): Promise<CategoryRowDetail[]> { return []; }
  async createCategory(): Promise<string> { return NO_DB(); }
  async updateCategory(): Promise<boolean> { return NO_DB(); }
  async getDeployFacts(): Promise<import('./deploy-core').TenantDeployFacts[]> { return []; }
  async executeDeploy(): Promise<DeployResult[]> { return NO_DB(); }
  async setDeploymentCustomizable(): Promise<boolean> { return NO_DB(); }
  async getComparison(): Promise<ComparisonRow[]> { return []; }
  async writeAudit(): Promise<void> { /* no-op */ }
}
