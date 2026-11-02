// super-admin-report-builder.repository.ts — persistence for saved report-builder definitions.
// Two implementations behind one interface (the project's standard pattern): an in-memory repo for tests /
// no-DB boot, and a Kysely repo for live Postgres. The service depends only on the interface.

import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export type ReportDefinitionRow = {
  id: string; name: string; dimension: string; measure: string; visualization: string;
  rangeKey: string; scopeTenantId: string | null; filters: Record<string, unknown>;
  rowLimit: number; createdByUserId: string | null; createdAt: string; updatedAt: string;
};
export type CreateReportDefinition = {
  name: string; dimension: string; measure: string; visualization: string;
  rangeKey: string; scopeTenantId: string | null; filters?: Record<string, unknown>; rowLimit: number; createdByUserId?: string | null;
};
export type UpdateReportDefinition = Partial<Omit<CreateReportDefinition, 'createdByUserId'>>;

export interface SuperAdminReportRepo {
  list(): Promise<ReportDefinitionRow[]>;
  get(id: string): Promise<ReportDefinitionRow | null>;
  create(input: CreateReportDefinition): Promise<ReportDefinitionRow>;
  update(id: string, patch: UpdateReportDefinition): Promise<ReportDefinitionRow | null>;
  remove(id: string): Promise<boolean>;
}

export class InMemorySuperAdminReportRepo implements SuperAdminReportRepo {
  private rows = new Map<string, ReportDefinitionRow>();
  private seq = 0;
  async list() { return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async get(id: string) { return this.rows.get(id) ?? null; }
  async create(i: CreateReportDefinition) {
    const now = new Date().toISOString();
    const row: ReportDefinitionRow = {
      id: `rd_${++this.seq}_${Math.random().toString(36).slice(2, 8)}`, name: i.name, dimension: i.dimension, measure: i.measure,
      visualization: i.visualization, rangeKey: i.rangeKey, scopeTenantId: i.scopeTenantId, filters: i.filters ?? {},
      rowLimit: i.rowLimit, createdByUserId: i.createdByUserId ?? null, createdAt: now, updatedAt: now,
    };
    this.rows.set(row.id, row); return row;
  }
  async update(id: string, patch: UpdateReportDefinition) {
    const cur = this.rows.get(id); if (!cur) return null;
    const next = { ...cur, ...patch, filters: patch.filters ?? cur.filters, updatedAt: new Date().toISOString() } as ReportDefinitionRow;
    this.rows.set(id, next); return next;
  }
  async remove(id: string) { return this.rows.delete(id); }
}

const map = (r: any): ReportDefinitionRow => ({
  id: r.id, name: r.name, dimension: r.dimension, measure: r.measure, visualization: r.visualization,
  rangeKey: r.range_key, scopeTenantId: r.scope_tenant_id ?? null,
  filters: typeof r.filters_json === 'string' ? JSON.parse(r.filters_json) : (r.filters_json ?? {}),
  rowLimit: Number(r.row_limit), createdByUserId: r.created_by_user_id ?? null,
  createdAt: (r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)),
  updatedAt: (r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at)),
});

export class KyselySuperAdminReportRepo implements SuperAdminReportRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async list() {
    const rows = await this.db.selectFrom('super_admin_report_definitions').selectAll().orderBy('created_at', 'desc').limit(500).execute();
    return rows.map(map);
  }
  async get(id: string) {
    const r = await this.db.selectFrom('super_admin_report_definitions').selectAll().where('id', '=', id).executeTakeFirst();
    return r ? map(r) : null;
  }
  async create(i: CreateReportDefinition) {
    const r = await this.db.insertInto('super_admin_report_definitions').values({
      name: i.name, dimension: i.dimension, measure: i.measure, visualization: i.visualization, range_key: i.rangeKey,
      scope_tenant_id: i.scopeTenantId, filters_json: JSON.stringify(i.filters ?? {}), row_limit: i.rowLimit,
      created_by_user_id: i.createdByUserId ?? null,
    }).returningAll().executeTakeFirstOrThrow();
    return map(r);
  }
  async update(id: string, patch: UpdateReportDefinition) {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.dimension !== undefined) set.dimension = patch.dimension;
    if (patch.measure !== undefined) set.measure = patch.measure;
    if (patch.visualization !== undefined) set.visualization = patch.visualization;
    if (patch.rangeKey !== undefined) set.range_key = patch.rangeKey;
    if (patch.scopeTenantId !== undefined) set.scope_tenant_id = patch.scopeTenantId;
    if (patch.filters !== undefined) set.filters_json = JSON.stringify(patch.filters);
    if (patch.rowLimit !== undefined) set.row_limit = patch.rowLimit;
    const r = await this.db.updateTable('super_admin_report_definitions').set(set).where('id', '=', id).returningAll().executeTakeFirst();
    return r ? map(r) : null;
  }
  async remove(id: string) {
    const r = await this.db.deleteFrom('super_admin_report_definitions').where('id', '=', id).executeTakeFirst();
    return Number(r?.numDeletedRows ?? 0) > 0;
  }
}
