// services.service.ts — tenant POS Services. Resolves tenant/role from session context; enforces per-action
// permissions; validates; preserves history on archive; writes audit logs; never fakes data.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  POSServicesFullState, POSServiceRow, POSServiceDetail, ServiceFilters, CreateServiceRequest, UpdateServiceRequest,
  ServiceAddOn, ServiceTechnicianMappingRow, ServiceCommission, ServiceTax, ServiceCategoryOption, DeleteServiceResult,
  ServiceListResponse, servicesToCsv, canHardDelete,
  parseCsv, parsePriceCents, ServiceImportRow, ServiceImportPreview, ServiceImportResult,
} from './services.dto';
import { ServicesContext, ServicesRepositoryPort } from './services.repository';
import type { TenantCache } from '@aipowersalon/cache';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }


// The service-category list is read on every services/booking screen but changes rarely, so it's an ideal cache
// target: a longer TTL than a live aggregate, with explicit bust-on-write on the four category mutations so an edit
// is reflected immediately rather than waiting for the TTL.
const CATEGORIES_CACHE_KEY = 'services:categories';
const CATEGORIES_CACHE_TTL_SECONDS = 300;

export interface POSServicesAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

export class ServicesService {
  private audit: POSServicesAuditLog[] = [];
  constructor(private readonly repo: ServicesRepositoryPort, private readonly cache?: TenantCache) {}

  private assertUser(ctx: ServicesContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Services are not available for this role');
  }
  private need(ctx: ServicesContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: ServicesContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSServicesAuditLog[] { return this.audit.slice(); }

  // ---- read ----
  async getState(ctx: ServicesContext, f: ServiceFilters = {}): Promise<POSServicesFullState> { this.need(ctx, 'pos.services.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_services_viewed', 'pos_service', undefined, undefined, undefined, { filters: f }); return st; }
  async getKpis(ctx: ServicesContext) { return (await this.getState(ctx)).kpisFull; }
  async list(ctx: ServicesContext, f: ServiceFilters = {}): Promise<ServiceListResponse> { this.need(ctx, 'pos.services.view'); return (await this.repo.query(ctx, f)).services; }
  async search(ctx: ServicesContext, f: ServiceFilters = {}): Promise<ServiceListResponse> { return this.list(ctx, f); }
  async detail(ctx: ServicesContext, serviceId: string): Promise<POSServiceDetail> { this.need(ctx, 'pos.services.view'); const d = await this.repo.detail(ctx, serviceId); if (!d) throw new ValidationError('Service not found'); return d; }
  async listCategories(ctx: ServicesContext): Promise<ServiceCategoryOption[]> {
    this.need(ctx, 'pos.services.view');
    if (!this.cache) return this.repo.listCategories(ctx);
    return this.cache.getOrSet(this.cacheCtx(ctx), CATEGORIES_CACHE_KEY, CATEGORIES_CACHE_TTL_SECONDS, () => this.repo.listCategories(ctx));
  }

  // Cache scope: categories are tenant-wide (not branch-specific), so the key is keyed on tenant only.
  private cacheCtx(ctx: ServicesContext) { return { tenantId: ctx.tenantId }; }
  // Bust the cached category list for this tenant after any category mutation so edits show immediately.
  private async bustCategories(ctx: ServicesContext) { if (this.cache) await this.cache.invalidate(this.cacheCtx(ctx), CATEGORIES_CACHE_KEY); }

  // ---- validation ----
  private async validate(ctx: ServicesContext, req: Partial<CreateServiceRequest>, requireAll: boolean) {
    if (requireAll || req.name !== undefined) if (!req.name || !req.name.trim()) throw new ValidationError('Service name is required');
    if (requireAll || req.categoryId !== undefined) {
      if (!req.categoryId) throw new ValidationError('Category is required');
      const cats = await this.repo.listCategories(ctx);
      if (!cats.some((c) => c.categoryId === req.categoryId)) throw new ValidationError('Category must belong to this tenant');
    }
    if (req.priceCents !== undefined && req.priceCents < 0) throw new ValidationError('Price must be 0 or greater');
    if ((requireAll || req.durationMinutes !== undefined) && (req.durationMinutes === undefined || req.durationMinutes <= 0)) throw new ValidationError('Duration must be greater than 0');
    this.checkCommission(req.commissionType, req.commissionValue, requireAll ? 'percent' : undefined, 'Commission');
  }

  // Commission must be a known type and non-negative; a percentage commission cannot exceed 100% (a >100% rate would
  // estimate a tech payout larger than the sale — the compensation engine applies value as a percent of the line). On create the
  // default type is 'percent' so the cap applies; on a partial update we only enforce the cap when the caller explicitly
  // sends type='percent', since we don't fetch the stored type here. A flat commission is any non-negative cents amount.
  private checkCommission(type: string | undefined, value: number | undefined, knownType: string | undefined, label: string): void {
    if (type !== undefined && type !== 'percent' && type !== 'flat') throw new ValidationError(`${label} type must be 'percent' or 'flat'`);
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < 0) throw new ValidationError(`${label} value must be 0 or greater`);
    if ((type ?? knownType) === 'percent' && value > 100) throw new ValidationError(`${label} percent cannot exceed 100`);
  }

  // ---- create / edit / archive ----
  async create(ctx: ServicesContext, req: CreateServiceRequest): Promise<POSServiceRow> {
    this.need(ctx, 'pos.services.create'); await this.validate(ctx, req, true);
    const row = await this.repo.create(ctx, req); this.log(ctx, 'pos_service_created', 'pos_service', row.serviceId, undefined, row as any); return row;
  }
  async update(ctx: ServicesContext, serviceId: string, req: UpdateServiceRequest): Promise<POSServiceRow> {
    this.need(ctx, 'pos.services.edit'); await this.validate(ctx, req, false);
    if (req.priceCents !== undefined) this.need(ctx, 'pos.services.pricing.edit');
    const before = await this.repo.detail(ctx, serviceId); if (!before) throw new ValidationError('Service not found');
    const row = (await this.repo.update(ctx, serviceId, req))!; this.log(ctx, 'pos_service_updated', 'pos_service', serviceId, before as any, row as any); return row;
  }
  async archive(ctx: ServicesContext, serviceId: string): Promise<DeleteServiceResult> {
    this.need(ctx, 'pos.services.archive');
    const usage = await this.repo.usage(ctx, serviceId); if (!usage) throw new ValidationError('Service not found');
    await this.repo.setStatus(ctx, serviceId, 'archived'); this.log(ctx, 'pos_service_archived', 'pos_service', serviceId, undefined, undefined, { usage });
    return { ok: true, archived: true, message: 'Service archived; it remains in historical reports.' };
  }
  async reactivate(ctx: ServicesContext, serviceId: string): Promise<POSServiceRow> {
    this.need(ctx, 'pos.services.archive');
    const row = await this.repo.setStatus(ctx, serviceId, 'active'); if (!row) throw new ValidationError('Service not found');
    this.log(ctx, 'pos_service_reactivated', 'pos_service', serviceId); return row;
  }
  // hard delete is guarded behind zero usage + owner/manager (kept off the default surface)
  async hardDelete(ctx: ServicesContext, serviceId: string): Promise<DeleteServiceResult> {
    this.need(ctx, 'pos.services.archive');
    // BUILD_PLAN Phase 9: was a role-name check (OWNER / MANAGER). Deleting a service outright is a catalogue edit —
    // pos.services.edit (→ services.edit: owners and managers by default), on top of the route's archive key.
    if (!hasPermission(ctx as any, 'pos.services.edit')) throw new ForbiddenError('Only an owner or manager can delete services');
    const usage = await this.repo.usage(ctx, serviceId); if (!usage) throw new ValidationError('Service not found');
    if (!canHardDelete(usage)) { await this.repo.setStatus(ctx, serviceId, 'archived'); return { ok: false, reasonCode: 'SERVICE_HAS_HISTORY', archived: true, message: 'Service has history; archived instead of deleted.' }; }
    this.log(ctx, 'pos_service_archived', 'pos_service', serviceId, undefined, undefined, { hardDeleted: true });
    return { ok: true, message: 'Service deleted (no historical usage).' };
  }

  // ---- categories ----
  async createCategory(ctx: ServicesContext, name: string, colorKey?: string): Promise<ServiceCategoryOption> { this.need(ctx, 'pos.services.edit'); if (!name?.trim()) throw new ValidationError('Category name is required'); const c = await this.repo.createCategory(ctx, name, colorKey); this.log(ctx, 'pos_service_category_created', 'pos_service_category', c.categoryId, undefined, c as any); await this.bustCategories(ctx); return c; }
  async updateCategory(ctx: ServicesContext, categoryId: string, patch: { name?: string; colorKey?: string; status?: any }): Promise<ServiceCategoryOption> { this.need(ctx, 'pos.services.edit'); const c = await this.repo.updateCategory(ctx, categoryId, patch); if (!c) throw new ValidationError('Category not found'); this.log(ctx, 'pos_service_category_updated', 'pos_service_category', categoryId, undefined, c as any); await this.bustCategories(ctx); return c; }
  async archiveCategory(ctx: ServicesContext, categoryId: string, confirm?: boolean): Promise<{ ok: boolean; activeServices: number }> {
    this.need(ctx, 'pos.services.edit');
    const res = await this.repo.archiveCategory(ctx, categoryId);
    if (res.activeServices > 0 && !confirm) throw new ValidationError(`Category has ${res.activeServices} active service(s). Confirm to archive.`);
    this.log(ctx, 'pos_service_category_archived', 'pos_service_category', categoryId, undefined, undefined, { activeServices: res.activeServices }); await this.bustCategories(ctx); return res;
  }
  async reorderCategories(ctx: ServicesContext, order: string[]): Promise<ServiceCategoryOption[]> { this.need(ctx, 'pos.services.edit'); const out = await this.repo.reorderCategories(ctx, order); this.log(ctx, 'pos_service_categories_reordered', 'pos_service_category', undefined, undefined, undefined, { order }); await this.bustCategories(ctx); return out; }

  // ---- sub-resources ----
  async getAddOns(ctx: ServicesContext, serviceId: string) { this.need(ctx, 'pos.services.view'); const a = await this.repo.getAddOns(ctx, serviceId); if (a === null) throw new ValidationError('Service not found'); return a; }
  async setAddOns(ctx: ServicesContext, serviceId: string, addOns: ServiceAddOn[]) { this.need(ctx, 'pos.services.edit'); const a = await this.repo.setAddOns(ctx, serviceId, addOns); if (a === null) throw new ValidationError('Service not found'); this.log(ctx, 'pos_service_addons_updated', 'pos_service_addon', serviceId, undefined, undefined, { count: addOns.length }); return a; }
  async getMapping(ctx: ServicesContext, serviceId: string) { this.need(ctx, 'pos.services.view'); const m = await this.repo.getMapping(ctx, serviceId); if (m === null) throw new ValidationError('Service not found'); return m; }
  async setMapping(ctx: ServicesContext, serviceId: string, m: ServiceTechnicianMappingRow[]) { this.need(ctx, 'pos.services.technician_mapping.edit'); const out = await this.repo.setMapping(ctx, serviceId, m); if (out === null) throw new ValidationError('Service not found'); this.log(ctx, 'pos_service_technician_mapping_updated', 'pos_service_technician_mapping', serviceId, undefined, undefined, { count: m.length }); return out; }
  async getCommission(ctx: ServicesContext, serviceId: string) { this.need(ctx, 'pos.services.view'); const c = await this.repo.getCommission(ctx, serviceId); if (c === null) throw new ValidationError('Service not found'); return c; }
  async setCommission(ctx: ServicesContext, serviceId: string, c: ServiceCommission) { this.need(ctx, 'pos.services.commission.edit'); this.checkCommission(c.type, c.value, c.type, 'Commission'); for (const o of c.byTechnician || []) this.checkCommission(o.type, o.value, o.type, 'Technician commission'); const out = await this.repo.setCommission(ctx, serviceId, c); if (out === null) throw new ValidationError('Service not found'); this.log(ctx, 'pos_service_commission_updated', 'pos_service_commission', serviceId, undefined, out as any); return out; }
  async getTax(ctx: ServicesContext, serviceId: string) { this.need(ctx, 'pos.services.view'); const t = await this.repo.getTax(ctx, serviceId); if (t === null) throw new ValidationError('Service not found'); return t; }
  async setTax(ctx: ServicesContext, serviceId: string, t: ServiceTax) { this.need(ctx, 'pos.services.edit'); const out = await this.repo.setTax(ctx, serviceId, t); if (out === null) throw new ValidationError('Service not found'); this.log(ctx, 'pos_service_tax_updated', 'pos_service_tax', serviceId, undefined, out as any); return out; }

  // ---- import / export ----
  async export(ctx: ServicesContext, f: ServiceFilters = {}): Promise<{ format: 'csv'; filename: string; csv: string }> {
    this.need(ctx, 'pos.services.export'); const { headers, rows } = await this.repo.exportRows(ctx, f); const csv = servicesToCsv(headers, rows);
    this.log(ctx, 'pos_services_exported', 'pos_services_export', undefined, undefined, undefined, { rows: rows.length, filters: f }); return { format: 'csv', filename: 'pos-services.csv', csv };
  }
  // CSV import — preview (read-only) and commit. Round-trips with export (Id, Name, Category, Price, Duration, Status):
  // rows are matched to existing services by Id, else by Name (case-insensitive). Unknown categories are created on
  // commit. Price accepts dollars ("60.00") or cents (round-trips the export). The preview shows the parsed result so
  // nothing is written blindly; commit applies only the valid rows and reports per-row outcomes.
  private async parseImport(ctx: ServicesContext, csv: string): Promise<{ ok: boolean; message?: string; rows: ServiceImportRow[]; newCategories: string[] }> {
    const table = parseCsv(csv || '');
    if (table.length < 2) return { ok: false, message: 'CSV needs a header row and at least one data row.', rows: [], newCategories: [] };
    const header = table[0].map((h) => h.trim().toLowerCase());
    const col = (...names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
    const ci = { id: col('id'), name: col('name', 'service', 'service name'), category: col('category', 'category name'), price: col('price', 'price cents', 'amount'), duration: col('duration', 'duration minutes', 'minutes'), status: col('status') };
    if (ci.name < 0 || ci.price < 0 || ci.duration < 0) return { ok: false, message: 'CSV must have at least Name, Price, and Duration columns.', rows: [], newCategories: [] };

    const existing = (await this.repo.query(ctx, {})).services.items;
    const byId = new Map(existing.map((s) => [s.serviceId, s]));
    const byName = new Map(existing.map((s) => [s.serviceName.trim().toLowerCase(), s]));
    const cats = await this.repo.listCategories(ctx);
    const catByName = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c]));
    const newCategories = new Set<string>();
    const rows: ServiceImportRow[] = [];

    for (let r = 1; r < table.length; r++) {
      const cells = table[r];
      const get = (i: number) => (i >= 0 && i < cells.length ? String(cells[i]).trim() : '');
      const errors: string[] = [];
      const name = get(ci.name);
      if (!name) errors.push('Name is required');
      const priceCents = parsePriceCents(get(ci.price));
      if (priceCents == null) errors.push('Price is not a valid amount');

      // match an existing service by Id, else by Name (determines create vs update, and lets updates keep existing values)
      const idVal = get(ci.id);
      const matched = (idVal && byId.get(idVal)) || byName.get(name.toLowerCase());

      const durRaw = get(ci.duration).replace(/[^0-9.]/g, '');
      let durationMinutes = Math.round(Number(durRaw));
      const durationValid = !!durRaw && Number.isFinite(durationMinutes) && durationMinutes > 0;
      if (!durationValid) {
        if (matched) durationMinutes = matched.durationMinutes;            // update: keep the existing duration
        else errors.push('Duration must be a positive number of minutes'); // new service: a real duration is required
      }
      const statusRaw = get(ci.status).toLowerCase();
      // import supports active/inactive; any other lifecycle value (e.g. an exported "archived") maps to inactive
      // rather than erroring, so a re-imported export round-trips cleanly.
      const status: 'active' | 'inactive' = (statusRaw === '' || statusRaw === 'active') ? 'active' : 'inactive';
      const categoryName = get(ci.category);

      const categoryExists = !!categoryName && catByName.has(categoryName.toLowerCase());
      if (categoryName && !categoryExists) newCategories.add(categoryName);
      // a brand-new service needs a category to live in
      if (!matched && !categoryName) errors.push('Category is required for a new service');

      rows.push({
        line: r, name, categoryName, categoryExists,
        priceCents: priceCents ?? 0, priceDisplay: `$${((priceCents ?? 0) / 100).toFixed(2)}`,
        durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : 0, status,
        action: errors.length ? 'error' : (matched ? 'update' : 'create'),
        matchedServiceId: matched ? matched.serviceId : undefined, errors,
      });
    }
    return { ok: true, rows, newCategories: [...newCategories] };
  }

  async importPreview(ctx: ServicesContext, csv: string): Promise<ServiceImportPreview> {
    this.need(ctx, 'pos.services.import');
    const p = await this.parseImport(ctx, csv);
    if (!p.ok) return { ok: false, message: p.message, totalRows: 0, willCreate: 0, willUpdate: 0, willCreateCategories: [], errorCount: 0, rows: [] };
    // only count categories that valid (non-error) rows actually need
    const neededCats = new Set(p.rows.filter((r) => r.action !== 'error' && r.categoryName && !r.categoryExists).map((r) => r.categoryName));
    return {
      ok: true, totalRows: p.rows.length,
      willCreate: p.rows.filter((r) => r.action === 'create').length,
      willUpdate: p.rows.filter((r) => r.action === 'update').length,
      willCreateCategories: [...neededCats], errorCount: p.rows.filter((r) => r.action === 'error').length, rows: p.rows,
    };
  }

  async importCommit(ctx: ServicesContext, csv: string): Promise<ServiceImportResult> {
    this.need(ctx, 'pos.services.import');
    this.need(ctx, 'pos.services.create');
    const p = await this.parseImport(ctx, csv);
    if (!p.ok) return { ok: false, message: p.message, created: 0, updated: 0, skipped: 0, failed: 0, createdCategories: [], rows: [] };

    // resolve categories (create the missing ones referenced by valid rows), building a name → id map
    const cats = await this.repo.listCategories(ctx);
    const catId = new Map(cats.map((c) => [c.name.trim().toLowerCase(), c.categoryId]));
    const createdCategories: string[] = [];
    for (const nm of p.newCategories) {
      if (p.rows.some((r) => r.action !== 'error' && r.categoryName.toLowerCase() === nm.toLowerCase())) {
        try { const c = await this.repo.createCategory(ctx, nm, 'gold'); catId.set(nm.trim().toLowerCase(), c.categoryId); createdCategories.push(nm); }
        catch { /* a row referencing it will fail below with a clear error */ }
      }
    }

    const out: ServiceImportResult = { ok: true, created: 0, updated: 0, skipped: 0, failed: 0, createdCategories, rows: [] };
    for (const row of p.rows) {
      if (row.action === 'error') { out.skipped++; out.rows.push({ line: row.line, name: row.name, outcome: 'skipped', error: row.errors.join('; ') }); continue; }
      try {
        if (row.action === 'update' && row.matchedServiceId) {
          const patch: UpdateServiceRequest = { name: row.name, priceCents: row.priceCents, durationMinutes: row.durationMinutes, status: row.status };
          const cid = row.categoryName ? catId.get(row.categoryName.toLowerCase()) : undefined;
          if (cid) patch.categoryId = cid;
          await this.repo.update(ctx, row.matchedServiceId, patch);
          out.updated++; out.rows.push({ line: row.line, name: row.name, outcome: 'updated' });
        } else {
          const cid = catId.get(row.categoryName.toLowerCase());
          if (!cid) { out.failed++; out.rows.push({ line: row.line, name: row.name, outcome: 'failed', error: `Category "${row.categoryName}" could not be resolved` }); continue; }
          const req: CreateServiceRequest = { name: row.name, categoryId: cid, durationMinutes: row.durationMinutes, priceCents: row.priceCents, status: row.status };
          await this.repo.create(ctx, req);
          out.created++; out.rows.push({ line: row.line, name: row.name, outcome: 'created' });
        }
      } catch (e: any) { out.failed++; out.rows.push({ line: row.line, name: row.name, outcome: 'failed', error: e?.message || 'apply failed' }); }
    }
    this.log(ctx, 'pos_services_imported', 'pos_services_import', undefined, undefined, undefined, { created: out.created, updated: out.updated, skipped: out.skipped, failed: out.failed, createdCategories });
    return out;
  }
}
