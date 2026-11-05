// service-templates.kysely.repository.ts — real reads for the catalog overview. Aggregates templates with per-template
// add-on + deployment counts, category list, deployment facts, resource frequencies, version recency, and per-tenant
// customization comparison. BIGINT money coerced to Number.
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { CatalogRepo, ListParams, ListResult, TemplateDetail, CategoryRowDetail, DeployResult, ComparisonRow, AuditActor } from './service-templates.repository';
import type { CatalogOverviewData } from './catalog-overview-core';
import type { NormalizedCreateTemplate, NormalizedTemplatePatch } from './template-mutations-core';
import type { TenantDeployFacts, DeployPlanItem } from './deploy-core';
import { nextVersionLabel } from './template-mutations-core';
import { canMoveToSql } from '@aipowersalon/database';
import { SERVICE_TEMPLATE } from '../lifecycles';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'template';

export class KyselyCatalogRepo implements CatalogRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async getDeployFacts(templateId: string, templateName: string): Promise<TenantDeployFacts[]> {
    const r: any = await sql`
      SELECT t.id AS tenant_id, COALESCE(t.display_name, t.legal_name, t.id::text) AS tenant_name,
        EXISTS (SELECT 1 FROM service_template_deployments d WHERE d.template_id = ${templateId} AND d.tenant_id = t.id) AS already_deployed,
        EXISTS (SELECT 1 FROM services s WHERE s.tenant_id = t.id AND lower(s.name) = lower(${templateName}) AND s.archived_at IS NULL) AS name_collision,
        EXISTS (SELECT 1 FROM branches b WHERE b.tenant_id = t.id) AS has_branch,
        EXISTS (SELECT 1 FROM service_categories c WHERE c.tenant_id = t.id) AS has_category
      FROM tenants t ORDER BY tenant_name`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({
      tenantId: String(x.tenant_id), tenantName: String(x.tenant_name),
      alreadyDeployed: !!x.already_deployed, nameCollision: !!x.name_collision, hasBranch: !!x.has_branch, hasCategory: !!x.has_category,
    }));
  }

  async executeDeploy(templateId: string, plan: DeployPlanItem[], options: { customizable: boolean }, actor: AuditActor): Promise<DeployResult[]> {
    return this.db.transaction().execute(async (trx) => {
      const t: any = await sql`SELECT t.name, t.description, t.suggested_duration_minutes, t.suggested_price_min_cents, c.name AS category_name
                               FROM service_templates t LEFT JOIN service_template_categories c ON c.code = t.category_code WHERE t.id = ${templateId}`.execute(trx);
      const tpl = t.rows[0];
      const results: DeployResult[] = [];
      for (const item of plan) {
        if (item.action === 'skip') { results.push({ ...item, copiedServiceId: null }); continue; }
        // resolve branch + category for this tenant
        const br: any = await sql`SELECT id FROM branches WHERE tenant_id = ${item.tenantId} ORDER BY created_at LIMIT 1`.execute(trx);
        const branchId = br.rows[0]?.id;
        const cat: any = await sql`SELECT COALESCE(
            (SELECT id FROM service_categories WHERE tenant_id = ${item.tenantId} AND lower(name) = lower(${String(tpl.category_name ?? '')}) LIMIT 1),
            (SELECT id FROM service_categories WHERE tenant_id = ${item.tenantId} ORDER BY sort_order, created_at LIMIT 1)
          ) AS id`.execute(trx);
        const categoryId = cat.rows[0]?.id;
        if (!branchId || !categoryId) { results.push({ ...item, action: 'skip', reason: !branchId ? 'no_branch' : 'no_category', copiedServiceId: null }); continue; }

        let serviceId: string;
        if (item.action === 'overwrite') {
          const up: any = await sql`UPDATE services SET description = ${tpl.description}, duration_minutes = ${Number(tpl.suggested_duration_minutes)},
                                      price_cents = ${Number(tpl.suggested_price_min_cents)}, updated_at = now()
                                    WHERE tenant_id = ${item.tenantId} AND lower(name) = lower(${String(tpl.name)}) AND archived_at IS NULL
                                    RETURNING id`.execute(trx);
          serviceId = String(up.rows[0]?.id);
        } else {
          const ins: any = await sql`INSERT INTO services (tenant_id, branch_id, category_id, name, description, duration_minutes, price_cents, commission_type, commission_value, status, created_by_user_id)
            VALUES (${item.tenantId}, ${branchId}, ${categoryId}, ${String(tpl.name)}, ${tpl.description}, ${Number(tpl.suggested_duration_minutes)}, ${Number(tpl.suggested_price_min_cents)}, 'none', 0, 'active', ${actor.userId ?? null})
            RETURNING id`.execute(trx);
          serviceId = String(ins.rows[0].id);
        }
        await sql`INSERT INTO service_template_deployments (template_id, tenant_id, copied_service_id, customizable, customized, deployed_by, deploy_status)
                  VALUES (${templateId}, ${item.tenantId}, ${serviceId}, ${options.customizable}, false, ${actor.userId ?? null}, ${item.action === 'overwrite' ? 'overwritten' : 'success'})
                  ON CONFLICT (template_id, tenant_id) DO UPDATE SET copied_service_id = EXCLUDED.copied_service_id, customizable = EXCLUDED.customizable, deploy_status = EXCLUDED.deploy_status`.execute(trx);
        results.push({ ...item, copiedServiceId: serviceId });
      }
      return results;
    });
  }

  async setDeploymentCustomizable(deploymentId: string, customizable: boolean): Promise<boolean> {
    const r: any = await sql`UPDATE service_template_deployments SET customizable = ${customizable} WHERE id = ${deploymentId} RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).length > 0;
  }

  async getComparison(templateId: string): Promise<ComparisonRow[]> {
    const r: any = await sql`
      SELECT d.id AS deployment_id, d.tenant_id, COALESCE(t.display_name, t.legal_name, d.tenant_id::text) AS tenant_name,
             d.copied_service_id, d.customizable, tpl.name AS template_name, tpl.suggested_price_min_cents, tpl.suggested_duration_minutes,
             s.name AS service_name, s.price_cents AS service_price, s.duration_minutes AS service_duration
      FROM service_template_deployments d
      JOIN tenants t ON t.id = d.tenant_id
      JOIN service_templates tpl ON tpl.id = d.template_id
      LEFT JOIN services s ON s.id = d.copied_service_id
      WHERE d.template_id = ${templateId}
      ORDER BY tenant_name`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => {
      const servicePrice = x.service_price == null ? null : Number(x.service_price);
      const serviceDuration = x.service_duration == null ? null : Number(x.service_duration);
      const templatePriceMin = Number(x.suggested_price_min_cents);
      const templateDuration = Number(x.suggested_duration_minutes);
      const customized = x.copied_service_id != null && ((servicePrice != null && servicePrice !== templatePriceMin) || (serviceDuration != null && serviceDuration !== templateDuration) || (x.service_name != null && String(x.service_name) !== String(x.template_name)));
      return {
        deploymentId: String(x.deployment_id), tenantId: String(x.tenant_id), tenantName: String(x.tenant_name),
        copiedServiceId: x.copied_service_id ?? null, customizable: !!x.customizable, templateName: String(x.template_name),
        serviceName: x.service_name ?? null, templatePriceMinCents: templatePriceMin, servicePriceCents: servicePrice,
        templateDuration, serviceDuration, customized,
      };
    });
  }

  async listCategories(): Promise<CategoryRowDetail[]> {
    const r: any = await sql`SELECT c.code, c.name, c.icon_key, c.display_order, c.status,
                                    (SELECT COUNT(*) FROM service_templates t WHERE t.category_code = c.code)::int AS template_count
                             FROM service_template_categories c ORDER BY c.display_order, c.name`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).map((x) => ({ code: String(x.code), name: String(x.name), iconKey: x.icon_key ?? null, displayOrder: Number(x.display_order), status: String(x.status), templateCount: Number(x.template_count) }));
  }

  async createCategory(n: { name: string; iconKey: string | null }, actor: AuditActor): Promise<string> {
    let code = slug(n.name); let i = 1;
    while (true) { const e: any = await sql`SELECT 1 FROM service_template_categories WHERE code = ${code} LIMIT 1`.execute(this.db); if ((e.rows as any[]).length === 0) break; code = `${slug(n.name)}_${++i}`; }
    const ord: any = await sql`SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM service_template_categories`.execute(this.db);
    await sql`INSERT INTO service_template_categories (code, name, icon_key, display_order, status) VALUES (${code}, ${n.name}, ${n.iconKey}, ${Number(ord.rows[0]?.n ?? 1)}, 'active')`.execute(this.db);
    return code;
  }

  async updateCategory(code: string, patch: { name?: string; iconKey?: string | null; displayOrder?: number; status?: string }, _actor: AuditActor): Promise<boolean> {
    const sets: any[] = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.iconKey !== undefined) sets.push(sql`icon_key = ${patch.iconKey}`);
    if (patch.displayOrder !== undefined) sets.push(sql`display_order = ${patch.displayOrder}`);
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
    sets.push(sql`updated_at = now()`);
    const r: any = await sql`UPDATE service_template_categories SET ${sql.join(sets, sql`, `)} WHERE code = ${code} RETURNING code`.execute(this.db);
    return (r.rows as any[]).length > 0;
  }

  async categoryExists(code: string): Promise<boolean> {
    const r: any = await sql`SELECT 1 FROM service_template_categories WHERE code = ${code} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows as any[]).length > 0;
  }

  async getTemplateDetail(id: string): Promise<TemplateDetail | null> {
    const r: any = await sql`SELECT id, code, name, category_code, description, suggested_duration_minutes, suggested_price_min_cents,
                                    suggested_price_max_cents, tax_setting, commission_eligible, is_customizable, status, version, version_label,
                                    (SELECT COUNT(*) FROM service_template_deployments d WHERE d.template_id = t.id)::int AS deployment_count
                             FROM service_templates t WHERE id = ${id}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows[0]; if (!x) return null;
    const res: any = await sql`SELECT resource_label, quantity FROM service_template_resources WHERE template_id = ${id} ORDER BY display_order`.execute(this.db).catch(() => ({ rows: [] }));
    const add: any = await sql`SELECT name, price_cents FROM service_template_addons WHERE template_id = ${id} ORDER BY display_order`.execute(this.db).catch(() => ({ rows: [] }));
    return {
      id: String(x.id), code: String(x.code), name: String(x.name), categoryCode: x.category_code ?? null,
      description: x.description ?? null, durationMinutes: Number(x.suggested_duration_minutes),
      priceMinCents: Number(x.suggested_price_min_cents), priceMaxCents: Number(x.suggested_price_max_cents),
      taxSetting: String(x.tax_setting), commissionEligible: !!x.commission_eligible, isCustomizable: !!x.is_customizable,
      status: String(x.status), version: Number(x.version), versionLabel: String(x.version_label),
      resources: (res.rows as any[]).map((y) => ({ label: String(y.resource_label), quantity: Number(y.quantity) })),
      addons: (add.rows as any[]).map((y) => ({ name: String(y.name), priceCents: Number(y.price_cents) })),
      deploymentCount: Number(x.deployment_count),
    };
  }

  async createTemplate(n: NormalizedCreateTemplate, actor: AuditActor): Promise<string> {
    return this.db.transaction().execute(async (trx) => {
      // unique code from slug(name)
      let code = slug(n.name); let i = 1;
      while (true) {
        const e: any = await sql`SELECT 1 FROM service_templates WHERE code = ${code} LIMIT 1`.execute(trx);
        if ((e.rows as any[]).length === 0) break;
        code = `${slug(n.name)}_${++i}`;
      }
      const ins: any = await sql`INSERT INTO service_templates
          (code, name, category_code, description, suggested_duration_minutes, suggested_price_min_cents, suggested_price_max_cents,
           tax_setting, commission_eligible, is_customizable, status, version, version_label, created_by, updated_by)
        VALUES (${code}, ${n.name}, ${n.categoryCode}, ${n.description}, ${n.durationMinutes}, ${n.priceMinCents}, ${n.priceMaxCents},
                ${n.taxSetting}, ${n.commissionEligible}, ${n.isCustomizable}, 'draft', 1, 'v1.0', ${actor.userId ?? null}, ${actor.userId ?? null})
        RETURNING id`.execute(trx);
      const id = String(ins.rows[0].id);
      for (let j = 0; j < n.resources.length; j++) await sql`INSERT INTO service_template_resources (template_id, resource_label, quantity, display_order) VALUES (${id}, ${n.resources[j].label}, ${n.resources[j].quantity}, ${j})`.execute(trx);
      for (let j = 0; j < n.addons.length; j++) await sql`INSERT INTO service_template_addons (template_id, name, price_cents, display_order) VALUES (${id}, ${n.addons[j].name}, ${n.addons[j].priceCents}, ${j})`.execute(trx);
      await sql`INSERT INTO service_template_versions (template_id, version_number, version_label, change_reason, created_by) VALUES (${id}, 1, 'v1.0', 'Initial template', ${actor.userId ?? null})`.execute(trx);
      return id;
    });
  }

  async updateTemplate(id: string, patch: NormalizedTemplatePatch, actor: AuditActor): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const cur: any = await sql`SELECT version FROM service_templates WHERE id = ${id} FOR UPDATE`.execute(trx);
      const nextVer = Number(cur.rows[0]?.version ?? 1) + 1;
      const sets: any[] = [];
      if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
      if (patch.categoryCode !== undefined) sets.push(sql`category_code = ${patch.categoryCode}`);
      if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
      if (patch.durationMinutes !== undefined) sets.push(sql`suggested_duration_minutes = ${patch.durationMinutes}`);
      if (patch.priceMinCents !== undefined) sets.push(sql`suggested_price_min_cents = ${patch.priceMinCents}`);
      if (patch.priceMaxCents !== undefined) sets.push(sql`suggested_price_max_cents = ${patch.priceMaxCents}`);
      if (patch.taxSetting !== undefined) sets.push(sql`tax_setting = ${patch.taxSetting}`);
      if (patch.commissionEligible !== undefined) sets.push(sql`commission_eligible = ${patch.commissionEligible}`);
      if (patch.isCustomizable !== undefined) sets.push(sql`is_customizable = ${patch.isCustomizable}`);
      sets.push(sql`version = ${nextVer}`, sql`version_label = ${nextVersionLabel(nextVer)}`, sql`updated_by = ${actor.userId ?? null}`, sql`updated_at = now()`);
      await sql`UPDATE service_templates SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`.execute(trx);
      if (patch.resources !== undefined) {
        await sql`DELETE FROM service_template_resources WHERE template_id = ${id}`.execute(trx);
        for (let j = 0; j < patch.resources.length; j++) await sql`INSERT INTO service_template_resources (template_id, resource_label, quantity, display_order) VALUES (${id}, ${patch.resources[j].label}, ${patch.resources[j].quantity}, ${j})`.execute(trx);
      }
      if (patch.addons !== undefined) {
        await sql`DELETE FROM service_template_addons WHERE template_id = ${id}`.execute(trx);
        for (let j = 0; j < patch.addons.length; j++) await sql`INSERT INTO service_template_addons (template_id, name, price_cents, display_order) VALUES (${id}, ${patch.addons[j].name}, ${patch.addons[j].priceCents}, ${j})`.execute(trx);
      }
      await sql`INSERT INTO service_template_versions (template_id, version_number, version_label, change_reason, created_by)
                VALUES (${id}, ${nextVer}, ${nextVersionLabel(nextVer)}, ${patch.changeNote ?? 'Updated template'}, ${actor.userId ?? null})`.execute(trx);
    });
  }

  async publishTemplate(id: string, actor: AuditActor): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await sql`UPDATE service_templates SET status = 'published', published_at = now(), published_by = ${actor.userId ?? null}, updated_at = now() WHERE id = ${id} AND ${canMoveToSql(SERVICE_TEMPLATE, 'published')}`.execute(trx);
      const cur: any = await sql`SELECT version, version_label FROM service_templates WHERE id = ${id}`.execute(trx);
      const v = Number(cur.rows[0]?.version ?? 1);
      await sql`INSERT INTO service_template_versions (template_id, version_number, version_label, change_reason, created_by)
                VALUES (${id}, ${v}, ${String(cur.rows[0]?.version_label ?? 'v1.0')}, 'Published', ${actor.userId ?? null})
                ON CONFLICT (template_id, version_number) DO NOTHING`.execute(trx);
    });
  }

  async retireTemplate(id: string, reason: string, actor: AuditActor): Promise<void> {
    await sql`UPDATE service_templates SET status = 'retired', retired_at = now(), retired_by = ${actor.userId ?? null}, retire_reason = ${reason}, updated_at = now() WHERE id = ${id} AND ${canMoveToSql(SERVICE_TEMPLATE, 'retired')}`.execute(this.db);
  }

  async writeAudit(actor: AuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    const tenantId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId) ? entityId : null;
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: tenantId, user_id: actor.userId ?? null, role: 'SUPER_ADMIN',
      action_type: action, entity_type: 'service_template', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }

  private buildConds(params: ListParams): any[] {
    const conds: any[] = [];
    if (params.search) conds.push(sql`t.name ILIKE ${'%' + params.search + '%'}`);
    if (params.category) conds.push(sql`t.category_code = ${params.category}`);
    if (params.status) conds.push(sql`t.status = ${params.status}`);
    if (params.commission === 'yes') conds.push(sql`t.commission_eligible = true`);
    if (params.commission === 'no') conds.push(sql`t.commission_eligible = false`);
    if (params.tax === 'taxable') conds.push(sql`t.tax_setting = 'taxable'`);
    if (params.tax === 'non_taxable') conds.push(sql`t.tax_setting = 'non_taxable'`);
    if (params.serviceType === 'package') conds.push(sql`t.category_code = 'combination_packages'`);
    if (params.serviceType === 'individual') conds.push(sql`(t.category_code IS DISTINCT FROM 'combination_packages')`);
    if (params.usage === 'using') conds.push(sql`EXISTS (SELECT 1 FROM service_template_deployments d WHERE d.template_id = t.id)`);
    if (params.usage === 'unused') conds.push(sql`NOT EXISTS (SELECT 1 FROM service_template_deployments d WHERE d.template_id = t.id)`);
    return conds;
  }

  private async hydrateResources(rows: any[]): Promise<Map<string, { label: string; quantity: number }[]>> {
    const map = new Map<string, { label: string; quantity: number }[]>();
    const ids = rows.map((r) => r.id);
    if (!ids.length) return map;
    const resRes: any = await sql`SELECT template_id, resource_label, quantity FROM service_template_resources
                                  WHERE template_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY display_order`.execute(this.db).catch(() => ({ rows: [] }));
    for (const r of (resRes.rows as any[])) {
      const arr = map.get(String(r.template_id)) ?? [];
      arr.push({ label: String(r.resource_label), quantity: Number(r.quantity) });
      map.set(String(r.template_id), arr);
    }
    return map;
  }

  private mapRow(r: any, resByTemplate: Map<string, { label: string; quantity: number }[]>) {
    return {
      id: String(r.id), code: String(r.code), name: String(r.name), categoryCode: r.category_code ?? null,
      categoryName: r.category_name ?? null, durationMinutes: Number(r.suggested_duration_minutes),
      priceMinCents: Number(r.suggested_price_min_cents), priceMaxCents: Number(r.suggested_price_max_cents),
      resources: resByTemplate.get(String(r.id)) ?? [], taxSetting: String(r.tax_setting),
      commissionEligible: !!r.commission_eligible, addonCount: Number(r.addon_count),
      activeTenantUsage: Number(r.deployment_count), versionLabel: String(r.version_label), status: String(r.status),
    };
  }

  private readonly SELECT_COLS = sql`t.id, t.code, t.name, t.category_code, c.name AS category_name, t.suggested_duration_minutes,
             t.suggested_price_min_cents, t.suggested_price_max_cents, t.tax_setting, t.commission_eligible,
             t.status, t.version_label,
             (SELECT COUNT(*) FROM service_template_addons a WHERE a.template_id = t.id)::int AS addon_count,
             (SELECT COUNT(*) FROM service_template_deployments d WHERE d.template_id = t.id)::int AS deployment_count`;

  async exportTemplates(params: ListParams): Promise<import('./service-templates.repository').TemplateLibraryRow[]> {
    const conds = this.buildConds(params);
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
    const rowsRes: any = await sql`SELECT ${this.SELECT_COLS} FROM service_templates t LEFT JOIN service_template_categories c ON c.code = t.category_code
                                   ${where} ORDER BY t.display_order, t.name LIMIT 5000`.execute(this.db).catch(() => ({ rows: [] }));
    const rows = rowsRes.rows as any[];
    const resByTemplate = await this.hydrateResources(rows);
    return rows.map((r) => this.mapRow(r, resByTemplate));
  }

  async listTemplates(params: ListParams): Promise<ListResult> {
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 10));
    const conds = this.buildConds(params);
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const countRes: any = await sql`SELECT COUNT(*)::int AS n FROM service_templates t ${where}`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] }));
    const total = Number(countRes.rows[0]?.n ?? 0);

    const rowsRes: any = await sql`SELECT ${this.SELECT_COLS} FROM service_templates t LEFT JOIN service_template_categories c ON c.code = t.category_code
      ${where} ORDER BY t.display_order, t.name LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(this.db).catch(() => ({ rows: [] }));
    const rows = rowsRes.rows as any[];
    const resByTemplate = await this.hydrateResources(rows);
    return { page, pageSize, total, rows: rows.map((r) => this.mapRow(r, resByTemplate)) };
  }

  async getOverviewData(): Promise<CatalogOverviewData> {
    const [tpl, cats, deps, tenants, resources, addons, versMonth, recentVers, compare] = await Promise.all([
      sql`SELECT t.code, t.name, t.category_code, t.status, t.tax_setting, t.commission_eligible,
                 t.suggested_duration_minutes, t.suggested_price_min_cents, t.suggested_price_max_cents,
                 (SELECT COUNT(*) FROM service_template_addons a WHERE a.template_id = t.id)::int AS addon_count,
                 (SELECT COUNT(*) FROM service_template_deployments d WHERE d.template_id = t.id)::int AS deployment_count
          FROM service_templates t ORDER BY t.display_order, t.name`.execute(this.db).catch(() => ({ rows: [] as any[] })),
      sql`SELECT code, name FROM service_template_categories WHERE status = 'active' ORDER BY display_order, name`.execute(this.db).catch(() => ({ rows: [] as any[] })),
      sql`SELECT tenant_id, customized FROM service_template_deployments`.execute(this.db).catch(() => ({ rows: [] as any[] })),
      sql`SELECT COUNT(*)::int AS n FROM tenants`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] as any[] })),
      sql`SELECT resource_label AS label, COUNT(*)::int AS count FROM service_template_resources GROUP BY resource_label ORDER BY count DESC`.execute(this.db).catch(() => ({ rows: [] as any[] })),
      sql`SELECT COUNT(*)::int AS n FROM service_template_addons`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] as any[] })),
      sql`SELECT COUNT(*)::int AS n FROM service_template_versions WHERE created_at >= date_trunc('month', now())`.execute(this.db).catch(() => ({ rows: [{ n: 0 }] as any[] })),
      sql`SELECT t.name AS template_name, v.version_label, v.change_reason, v.created_at
          FROM service_template_versions v JOIN service_templates t ON t.id = v.template_id
          ORDER BY v.created_at DESC LIMIT 6`.execute(this.db).catch(() => ({ rows: [] as any[] })),
      sql`SELECT COALESCE(t.display_name, t.legal_name, t.id::text) AS tenant_name,
                 COUNT(*)::int AS copied, COUNT(*) FILTER (WHERE d.customized)::int AS customized
          FROM service_template_deployments d JOIN tenants t ON t.id = d.tenant_id
          GROUP BY t.id, t.display_name, t.legal_name ORDER BY copied DESC LIMIT 8`.execute(this.db).catch(() => ({ rows: [] as any[] })),
    ]);

    return {
      templates: (tpl.rows as any[]).map((r) => ({
        code: String(r.code), name: String(r.name), categoryCode: r.category_code ?? null, status: String(r.status),
        taxSetting: String(r.tax_setting), commissionEligible: !!r.commission_eligible,
        durationMinutes: Number(r.suggested_duration_minutes), priceMinCents: Number(r.suggested_price_min_cents),
        priceMaxCents: Number(r.suggested_price_max_cents), addonCount: Number(r.addon_count), deploymentCount: Number(r.deployment_count),
      })),
      categories: (cats.rows as any[]).map((r) => ({ code: String(r.code), name: String(r.name) })),
      deployments: (deps.rows as any[]).map((r) => ({ tenantId: String(r.tenant_id), customized: !!r.customized })),
      totalTenants: Number((tenants.rows as any[])[0]?.n ?? 0),
      resourceLabels: (resources.rows as any[]).map((r) => ({ label: String(r.label), count: Number(r.count) })),
      addonTotal: Number((addons.rows as any[])[0]?.n ?? 0),
      versionsThisMonth: Number((versMonth.rows as any[])[0]?.n ?? 0),
      recentVersions: (recentVers.rows as any[]).map((r) => ({
        templateName: String(r.template_name), versionLabel: r.version_label ?? null,
        changeReason: r.change_reason ?? null, createdAt: new Date(r.created_at).toISOString(),
      })),
      tenantCompare: (compare.rows as any[]).map((r) => ({ tenantName: String(r.tenant_name), copied: Number(r.copied), customized: Number(r.customized) })),
    };
  }
}
