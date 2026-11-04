// services.kysely.repository.ts — production ServicesRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped CRUD over services, service_categories, technician_services. Per-service bookings/revenue
// and usage are computed from ticket_service_lines / appointment_service_lines. Aggregate math reuses the SAME dto
// helpers as the in-memory repo. SCOPE is session-derived (tenant_id + branch_id), never the client.
//
// Schema note (honest): migration 006 has no add-ons or per-service tax tables, so getAddOns/getTax return safe
// defaults are accepted but not persisted by this adapter (documented limitation); setAddOns updates by key and never deletes; setTax stores taxable / not
// taxable (792) and refuses a rate / exemption / category.
import { categoryAddOnsForService, mergeAddOnRows, canMoveToSql } from '@aipowersalon/database';
import { recordCatalogChanges, diffFields } from '../catalog-screens/catalog-change-log';
import { SERVICE_CATEGORY } from '../catalog-lifecycles';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ServicesContext, ServicesRepositoryPort } from './services.repository';
import {
  POSServicesFullState, POSServiceRow, POSServiceDetail, ServiceListItem, ServiceListResponse, ServiceFilters,
  ServiceAddOn, ServiceTechnicianMappingRow, ServiceCommission, ServiceTax, ServiceKpis, ServicesKpisFull,
  ServiceCategoryOption, ServiceCategorySummary, TechnicianOption, CreateServiceRequest, UpdateServiceRequest,
  CommissionType, ServiceStatus, categoryPercentages, topByRevenue, averagePriceCents, Pagination,
} from './services.dto';
import { clampPageSize, clampPage, foldVi } from '@aipowersalon/api-contracts';

interface Row {
  serviceId: string; categoryId: string; name: string; description: string; basePriceCents: number; durationMinutes: number;
  status: ServiceStatus; onlineBookingEnabled: boolean; aiBookingEnabled: boolean; customerAppBookingEnabled: boolean; commissionType: CommissionType;
  commissionValue: number; sortOrder: number; createdAt: string; updatedAt: string; isTaxable: boolean;
  mapping: ServiceTechnicianMappingRow[]; bookingsCount: number; revenueCents: number;
  usage: { appointmentLines: number; ticketLines: number; reportRefs: number };
}

const iso = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export class KyselyServicesRepository implements ServicesRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  private scoped(qb: any, ctx: ServicesContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }

  private async resolveBranchId(ctx: ServicesContext): Promise<string> {
    if (ctx.branchId && ctx.branchId.trim().length > 0) {
      return ctx.branchId;
    }
    const fallback = await this.db.selectFrom('branches')
      .select('id')
      .where('tenant_id', '=', ctx.tenantId)
      .orderBy('created_at', 'asc')
      .executeTakeFirst()
      .catch(() => undefined);
    return fallback?.id ?? '00000000-0000-0000-0000-000000000000';
  }

  private async cats(ctx: ServicesContext): Promise<{ categoryId: string; name: string; colorKey: string; status: ServiceStatus; sortOrder: number }[]> {
    const rows = await this.scoped(this.db.selectFrom('service_categories'), ctx)
      .select(['id', 'name', 'color_key', 'status', 'sort_order']).orderBy('sort_order').execute().catch(() => []);
    return rows.map((c: any) => ({ categoryId: c.id, name: c.name, colorKey: c.color_key || 'gold', status: c.status as ServiceStatus, sortOrder: Number(c.sort_order) }));
  }

  private async loadRows(ctx: ServicesContext): Promise<Row[]> {
    const svc = await this.scoped(this.db.selectFrom('services'), ctx)
      .select(['id', 'category_id', 'name', 'description', 'duration_minutes', 'price_cents', 'commission_type', 'commission_value',
        'online_booking_enabled', 'ai_booking_enabled', 'customer_app_booking_enabled', 'status', 'sort_order', 'created_at', 'updated_at', 'is_taxable' as any]).orderBy('sort_order').execute().catch(() => []);
    const ids = svc.map((s: any) => s.id);
    // mapping (technician_services + technician display names)
    const maps = ids.length ? await this.scoped(this.db.selectFrom('technician_services as ts'), ctx, 'ts')
      .leftJoin('technicians as t', 't.id', 'ts.technician_id').where('ts.service_id', 'in', ids)
      .select(['ts.service_id as serviceId', 'ts.technician_id as technicianId', 't.full_name as displayName']).execute().catch(() => []) : [];
    // bookings + revenue from ticket_service_lines
    const lines = ids.length ? await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('service_id', 'in', ids)
      .groupBy('service_id').select((eb: any) => ['service_id as serviceId', eb.fn.countAll().as('cnt'), eb.fn.sum('line_total_cents').as('rev')]).execute().catch(() => []) : [];
    const lineBy: Record<string, { cnt: number; rev: number }> = {};
    for (const l of lines) lineBy[l.serviceId] = { cnt: Number(l.cnt), rev: Number(l.rev) };
    const mapBy: Record<string, ServiceTechnicianMappingRow[]> = {};
    for (const m of maps) (mapBy[m.serviceId] ||= []).push({ technicianId: m.technicianId, displayName: m.displayName || m.technicianId, isActive: true });

    return svc.map((s: any) => ({
      serviceId: s.id, categoryId: s.category_id, name: s.name, description: s.description || '', basePriceCents: Number(s.price_cents),
      durationMinutes: Number(s.duration_minutes), status: s.status as ServiceStatus, onlineBookingEnabled: !!s.online_booking_enabled,
      aiBookingEnabled: !!s.ai_booking_enabled, customerAppBookingEnabled: !!s.customer_app_booking_enabled, commissionType: s.commission_type as CommissionType, commissionValue: Number(s.commission_value),
      sortOrder: Number(s.sort_order), createdAt: iso(s.created_at), updatedAt: iso(s.updated_at), isTaxable: (s as any).is_taxable !== false,
      mapping: mapBy[s.id] || [], bookingsCount: lineBy[s.id]?.cnt || 0, revenueCents: lineBy[s.id]?.rev || 0,
      usage: { appointmentLines: 0, ticketLines: lineBy[s.id]?.cnt || 0, reportRefs: 0 },
    }));
  }

  private toRow(ctx: ServicesContext, s: Row, catName: string): POSServiceRow {
    return {
      serviceId: s.serviceId, tenantId: ctx.tenantId, branchId: ctx.branchId, categoryId: s.categoryId, categoryName: catName,
      name: s.name, description: s.description, basePriceCents: s.basePriceCents, durationMinutes: s.durationMinutes, bufferMinutes: 5,
      isActive: s.status === 'active', isTaxable: s.isTaxable !== false, bookingEnabled: true, checkoutEnabled: true,
      onlineBookingEnabled: s.onlineBookingEnabled, aiBookingEnabled: s.aiBookingEnabled, technicianSkillRequired: [],
      addOnsCount: 0, commissionType: s.commissionType, commissionValue: s.commissionValue, sortOrder: s.sortOrder,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    };
  }
  private bool(v?: string) { return v === 'true' || v === 'yes' || v === '1'; }
  private applyFilters(rows: Row[], catName: (id: string) => string, f: ServiceFilters): Row[] {
    let r = rows.slice();
    if (f.search) { const q = foldVi(f.search);   /* WP-E §41: accent-insensitive ("nguyen" finds "Nguyễn") */ r = r.filter((s) => [s.name, catName(s.categoryId), s.description].some((x) => foldVi(x).includes(q))); }
    if (f.categoryId) r = r.filter((s) => s.categoryId === f.categoryId);
    if (f.status) r = r.filter((s) => s.status === f.status);
    if (f.onlineBookingEnabled) r = r.filter((s) => s.onlineBookingEnabled === this.bool(f.onlineBookingEnabled));
    if (f.aiBookingEnabled) r = r.filter((s) => s.aiBookingEnabled === this.bool(f.aiBookingEnabled));
    if (f.bookingEnabled) r = r.filter((s) => s.customerAppBookingEnabled === this.bool(f.bookingEnabled));
    if (f.priceMin != null) r = r.filter((s) => s.basePriceCents >= Number(f.priceMin));
    if (f.priceMax != null) r = r.filter((s) => s.basePriceCents <= Number(f.priceMax));
    if (f.durationMin != null) r = r.filter((s) => s.durationMinutes >= Number(f.durationMin));
    if (f.durationMax != null) r = r.filter((s) => s.durationMinutes <= Number(f.durationMax));
    if (this.bool(f.missingMapping)) r = r.filter((s) => s.mapping.filter((m) => m.isActive).length === 0);
    if (this.bool(f.missingPrice)) r = r.filter((s) => s.basePriceCents === 0);
    if (this.bool(f.missingDuration)) r = r.filter((s) => s.durationMinutes === 0);
    // NOTE: f.taxable, f.checkoutEnabled, f.technicianSkillGroup are accepted by the DTO but intentionally NOT applied:
    // there is no backing column for taxable/checkout on the services table (tax_setting exists only on
    // service_templates), and per-service required skill groups aren't modeled. Filtering on fabricated always-true
    // values would be dishonest, so these are left as no-ops until the schema supports them.
    return r;
  }

  async query(ctx: ServicesContext, f: ServiceFilters): Promise<POSServicesFullState> {
    const all = await this.loadRows(ctx);
    const cats = await this.cats(ctx);
    const catName = (id: string) => cats.find((c) => c.categoryId === id)?.name || '';
    const matched = this.applyFilters(all, catName, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };

    const listItems: ServiceListItem[] = pageRows.map((s) => ({
      serviceId: s.serviceId, serviceName: s.name, categoryId: s.categoryId, categoryName: catName(s.categoryId),
      durationMinutes: s.durationMinutes, priceCents: s.basePriceCents,
      assignedTechnicians: s.mapping.filter((m) => m.isActive).slice(0, 3).map((m) => ({ technicianId: m.technicianId, displayName: m.displayName })),
      extraTechnicianCount: Math.max(0, s.mapping.filter((m) => m.isActive).length - 3), bookingsCount: s.bookingsCount, revenueCents: s.revenueCents, status: s.status,
    }));
    const rowItems = pageRows.map((s) => this.toRow(ctx, s, catName(s.categoryId)));
    const active = all.filter((s) => s.status === 'active');
    const catCounts = cats.map((c) => ({ categoryId: c.categoryId, categoryName: c.name, serviceCount: all.filter((s) => s.categoryId === c.categoryId).length, colorKey: c.colorKey }));
    const categoriesSummary: ServiceCategorySummary = categoryPercentages(catCounts);
    const topServicesByRevenue = topByRevenue(all.map((s) => ({ serviceId: s.serviceId, serviceName: s.name, revenueCents: s.revenueCents, bookingsCount: s.bookingsCount })), 5);
    const mostBooked = [...all].sort((a, b) => b.bookingsCount - a.bookingsCount)[0];

    const kpis: ServiceKpis = {
      totalServices: all.length, totalServicesTrendPercent: 0, serviceCategories: cats.length, serviceCategoriesTrendPercent: 0,
      mostBookedServiceName: mostBooked?.name || '—', mostBookedServiceBookings: mostBooked?.bookingsCount || 0,
      averageServicePriceCents: averagePriceCents(active.map((s) => s.basePriceCents)), averageServicePriceTrendPercent: 0,
      totalRevenueCents: all.reduce((a, s) => a + s.revenueCents, 0), totalRevenueTrendPercent: 0,
    };
    const kpisFull: ServicesKpisFull = {
      totalServices: all.length, activeServices: active.length, inactiveServices: all.filter((s) => s.status === 'inactive').length,
      categoriesCount: cats.length, addOnsCount: 0,
      servicesMissingDuration: all.filter((s) => s.durationMinutes === 0).length, servicesMissingPrice: all.filter((s) => s.basePriceCents === 0).length,
      servicesWithoutTechMapping: all.filter((s) => s.mapping.filter((m) => m.isActive).length === 0).length,
      topServiceRevenueCents: all.reduce((m, s) => Math.max(m, s.revenueCents), 0),
    };
    return {
      kpis, services: { items: listItems, pagination } as ServiceListResponse, categoriesSummary, topServicesByRevenue,
      categories: cats.map((c) => ({ categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status })),
      technicians: [] as TechnicianOption[], kpisFull, rows: { items: rowItems, pagination },
      filterFacets: {
        categories: cats.map((c) => ({ categoryId: c.categoryId, name: c.name })),
        statuses: ['active', 'inactive', 'archived'], taxableOptions: ['yes', 'no'],
        durationRanges: ['0-30', '31-60', '61-90', '90+'], priceRanges: ['0-3000', '3001-6000', '6001+'],
        technicianSkillGroups: [],
      },
    };
  }

  async detail(ctx: ServicesContext, serviceId: string): Promise<POSServiceDetail | null> {
    const all = await this.loadRows(ctx); const s = all.find((x) => x.serviceId === serviceId); if (!s) return null;
    const cats = await this.cats(ctx); const catName = cats.find((c) => c.categoryId === s.categoryId)?.name || '';
    return { ...this.toRow(ctx, s, catName), addOns: [], technicianMapping: s.mapping, commission: { type: s.commissionType, value: s.commissionValue }, tax: { isTaxable: s.isTaxable !== false, exemptAllowed: false }, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: s.updatedAt }] };
  }

  async create(ctx: ServicesContext, req: CreateServiceRequest): Promise<POSServiceRow> {
    const branchId = await this.resolveBranchId(ctx);
    const inserted = await this.db.insertInto('services').values({
      tenant_id: ctx.tenantId, branch_id: branchId, category_id: req.categoryId, name: req.name, description: req.description || null,
      duration_minutes: req.durationMinutes, price_cents: req.priceCents, commission_type: req.commissionType || 'percent', commission_value: req.commissionValue ?? 40,
      online_booking_enabled: req.onlineBookingEnabled ?? true, customer_app_booking_enabled: true, ai_booking_enabled: req.aiBookingEnabled ?? true,
      status: req.status, sort_order: 0,
    }).returning(['id']).executeTakeFirstOrThrow();
    if (req.technicianIds?.length) {
      await this.db.insertInto('technician_services').values(req.technicianIds.map((tid) => ({ tenant_id: ctx.tenantId, branch_id: branchId, technician_id: tid, service_id: inserted.id, is_primary: false }))).execute();
    }
    return (await this.detail(ctx, inserted.id))!;
  }

  async update(ctx: ServicesContext, serviceId: string, req: UpdateServiceRequest): Promise<POSServiceRow | null> {
    const patch: any = { updated_at: sql`now()` };
    if (req.name != null) patch.name = req.name; if (req.categoryId != null) patch.category_id = req.categoryId; if (req.description != null) patch.description = req.description;
    if (req.priceCents != null) patch.price_cents = req.priceCents; if (req.durationMinutes != null) patch.duration_minutes = req.durationMinutes;
    if (req.commissionType != null) patch.commission_type = req.commissionType; if (req.commissionValue != null) patch.commission_value = req.commissionValue;
    if (req.onlineBookingEnabled != null) patch.online_booking_enabled = req.onlineBookingEnabled; if (req.aiBookingEnabled != null) patch.ai_booking_enabled = req.aiBookingEnabled;
    if (req.status != null) patch.status = req.status;
    // the durable history (migration 718): the before-values under the row lock, the change and its rows in one transaction
    const B = ctx.branchId || null;
    const done = await this.db.transaction().execute(async (trx) => {
      const before: any = (await sql<any>`select name, category_id, description, price_cents, duration_minutes, commission_type, commission_value, online_booking_enabled, ai_booking_enabled, status
        from services where tenant_id = ${ctx.tenantId} and (${B}::uuid is null or branch_id = ${B} or branch_id is null) and id = ${serviceId} for update`.execute(trx)).rows[0];
      if (!before) return false;
      await sql`update services set name = coalesce(${req.name ?? null}::text, name), category_id = coalesce(${req.categoryId ?? null}::uuid, category_id), description = coalesce(${req.description ?? null}::text, description),
          price_cents = coalesce(${req.priceCents ?? null}::int, price_cents), duration_minutes = coalesce(${req.durationMinutes ?? null}::int, duration_minutes),
          commission_type = coalesce(${req.commissionType ?? null}::text, commission_type), commission_value = coalesce(${req.commissionValue ?? null}::numeric, commission_value),
          online_booking_enabled = coalesce(${req.onlineBookingEnabled ?? null}::boolean, online_booking_enabled), ai_booking_enabled = coalesce(${req.aiBookingEnabled ?? null}::boolean, ai_booking_enabled),
          status = coalesce(${req.status ?? null}::text, status), updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${serviceId}`.execute(trx);
      const { updated_at: _u, ...after } = patch;
      await recordCatalogChanges(trx, ctx, diffFields('service', serviceId, { ...before, commission_value: before.commission_value == null ? null : Number(before.commission_value) }, after, { serviceId, source: 'pos' }));
      return true;
    });
    if (!done) return null;
    return this.toRowById(ctx, serviceId);
  }

  private async toRowById(ctx: ServicesContext, serviceId: string): Promise<POSServiceRow | null> {
    const all = await this.loadRows(ctx); const s = all.find((x) => x.serviceId === serviceId); if (!s) return null;
    const cats = await this.cats(ctx); return this.toRow(ctx, s, cats.find((c) => c.categoryId === s.categoryId)?.name || '');
  }

  async setStatus(ctx: ServicesContext, serviceId: string, status: ServiceStatus): Promise<POSServiceRow | null> {
    const B = ctx.branchId || null;
    const changed = await this.db.transaction().execute(async (trx) => {
      const before: any = (await sql<any>`select status from services where tenant_id = ${ctx.tenantId} and (${B}::uuid is null or branch_id = ${B} or branch_id is null) and id = ${serviceId} for update`.execute(trx)).rows[0];
      if (!before) return false;
      await sql`update services set status = ${status}, updated_at = now(), archived_at = case when ${status} = 'archived' then now() else null end where tenant_id = ${ctx.tenantId} and id = ${serviceId}`.execute(trx);
      await recordCatalogChanges(trx, ctx, diffFields('service', serviceId, { status: before.status }, { status }, { serviceId, source: 'pos' }));
      return true;
    });
    if (!changed) return null;
    return this.toRowById(ctx, serviceId);
  }

  async usage(ctx: ServicesContext, serviceId: string) {
    const exists = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select('id').executeTakeFirst().catch(() => undefined);
    if (!exists) return null;
    const t = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('service_id', '=', serviceId).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst().catch(() => undefined);
    return { appointmentLines: 0, ticketLines: Number(t?.n || 0), reportRefs: 0 };
  }

  async listCategories(ctx: ServicesContext): Promise<ServiceCategoryOption[]> {
    return (await this.cats(ctx)).map((c) => ({ categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status }));
  }
  async createCategory(ctx: ServicesContext, name: string, colorKey = 'gold'): Promise<ServiceCategoryOption> {
    const branchId = await this.resolveBranchId(ctx);
    const count = (await this.cats(ctx)).length;
    const ins = await this.db.insertInto('service_categories').values({ tenant_id: ctx.tenantId, branch_id: branchId, name, color_key: colorKey, status: 'active', sort_order: count }).returning(['id', 'name', 'color_key', 'status']).executeTakeFirstOrThrow();
    return { categoryId: (ins as any).id, name: (ins as any).name, colorKey: (ins as any).color_key || colorKey, status: (ins as any).status };
  }
  async updateCategory(ctx: ServicesContext, categoryId: string, patch: { name?: string; colorKey?: string; status?: ServiceStatus }): Promise<ServiceCategoryOption | null> {
    const set: any = { updated_at: sql`now()` };
    if (patch.name != null) set.name = patch.name; if (patch.colorKey != null) set.color_key = patch.colorKey; if (patch.status != null) set.status = patch.status;
    const B = ctx.branchId || null;
    const ok = await this.db.transaction().execute(async (trx) => {
      const before: any = (await sql<any>`select name, color_key, status from service_categories where tenant_id = ${ctx.tenantId} and (${B}::uuid is null or branch_id = ${B} or branch_id is null) and id = ${categoryId} for update`.execute(trx)).rows[0];
      if (!before) return false;
      const res = await sql`update service_categories set name = coalesce(${patch.name ?? null}::text, name), color_key = coalesce(${patch.colorKey ?? null}::text, color_key), status = coalesce(${patch.status ?? null}::text, status), updated_at = now()
        where tenant_id = ${ctx.tenantId} and id = ${categoryId} and ${patch.status ? canMoveToSql(SERVICE_CATEGORY, patch.status) : sql`true`} returning id`.execute(trx);   // Phase 12 (#27): a merged category is not revived
      if (!res.rows.length) return false;
      const { updated_at: _u, ...after } = set;
      await recordCatalogChanges(trx, ctx, diffFields('category', categoryId, before, after, { source: 'pos' }));
      return true;
    });
    if (!ok) return null;
    const c = (await this.cats(ctx)).find((x) => x.categoryId === categoryId); return c ? { categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status } : null;
  }
  /** Archive a category. It used to archive FIRST and let the service refuse afterwards ("has N active services — confirm"),
   *  so the refusal arrived after the change. Now: with active services and no confirmation, nothing is written. */
  async archiveCategory(ctx: ServicesContext, categoryId: string, confirm = true): Promise<{ ok: boolean; activeServices: number }> {
    const B = ctx.branchId || null;
    return this.db.transaction().execute(async (trx) => {
      const before: any = (await sql<any>`select status from service_categories where tenant_id = ${ctx.tenantId} and (${B}::uuid is null or branch_id = ${B} or branch_id is null) and id = ${categoryId} for update`.execute(trx)).rows[0];
      const a: any = (await sql<any>`select count(*)::int as n from services where tenant_id = ${ctx.tenantId} and (${B}::uuid is null or branch_id = ${B} or branch_id is null) and category_id = ${categoryId} and status = 'active'`.execute(trx)).rows[0];
      const activeServices = Number(a?.n || 0);
      if (!before || (activeServices > 0 && !confirm)) return { ok: false, activeServices };
      const res = await sql`update service_categories set status = 'archived', updated_at = now() where tenant_id = ${ctx.tenantId} and id = ${categoryId} and ${canMoveToSql(SERVICE_CATEGORY, 'archived')} returning id`.execute(trx);
      const ok = res.rows.length > 0;
      if (ok) await recordCatalogChanges(trx, ctx, [{ entityType: 'category', entityId: categoryId, field: 'status', oldValue: before.status, newValue: 'archived', reason: activeServices ? `${activeServices} active service(s) kept their category` : null, source: 'pos' }]);
      return { ok, activeServices };
    });
  }
  async reorderCategories(ctx: ServicesContext, order: string[]): Promise<ServiceCategoryOption[]> {
    for (let i = 0; i < order.length; i++) await this.scoped(this.db.updateTable('service_categories'), ctx).set({ sort_order: i, updated_at: sql`now()` }).where('id', '=', order[i]).executeTakeFirst();
    return this.listCategories(ctx);
  }

  // --- mapping (real, technician_services) ---
  async getMapping(ctx: ServicesContext, serviceId: string): Promise<ServiceTechnicianMappingRow[] | null> {
    const s = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select('id').executeTakeFirst().catch(() => undefined);
    if (!s) return null;
    const rows = await this.scoped(this.db.selectFrom('technician_services as ts'), ctx, 'ts').leftJoin('technicians as t', 't.id', 'ts.technician_id').where('ts.service_id', '=', serviceId)
      .select(['ts.technician_id as technicianId', 't.full_name as displayName']).execute().catch(() => []);
    return rows.map((m: any) => ({ technicianId: m.technicianId, displayName: m.displayName || m.technicianId, isActive: true }));
  }
  async setMapping(ctx: ServicesContext, serviceId: string, m: ServiceTechnicianMappingRow[]): Promise<ServiceTechnicianMappingRow[] | null> {
    const s = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select('id').executeTakeFirst().catch(() => undefined);
    if (!s) return null;
    const branchId = await this.resolveBranchId(ctx);
    await this.scoped(this.db.deleteFrom('technician_services'), ctx).where('service_id', '=', serviceId).execute();
    if (m.length) await this.db.insertInto('technician_services').values(m.map((x) => ({ tenant_id: ctx.tenantId, branch_id: branchId, technician_id: x.technicianId, service_id: serviceId, is_primary: false }))).execute();
    return (await this.getMapping(ctx, serviceId))!;
  }

  // --- commission (real, on services) ---
  async getCommission(ctx: ServicesContext, serviceId: string): Promise<ServiceCommission | null> {
    const s = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select(['commission_type', 'commission_value']).executeTakeFirst().catch(() => undefined);
    return s ? { type: s.commission_type as CommissionType, value: Number(s.commission_value) } : null;
  }
  async setCommission(ctx: ServicesContext, serviceId: string, c: ServiceCommission): Promise<ServiceCommission | null> {
    const res = await this.scoped(this.db.updateTable('services'), ctx).set({ commission_type: c.type, commission_value: c.value, updated_at: sql`now()` }).where('id', '=', serviceId).executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) ? { type: c.type, value: c.value } : null;
  }

  // --- add-ons: D1 (Oct 22 2026) the "Add-ons" CATEGORY is the authority (categoryAddOnsForService, packages/database);
  // the service_add_ons table (migration 346) is kept and served beside it — a legacy row that names a category add-on's
  // service id is not repeated. setAddOns still writes the table (deprecated: new add-ons are services in the category).
  async getAddOns(ctx: ServicesContext, serviceId: string): Promise<ServiceAddOn[] | null> {
    const s = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select('id').executeTakeFirst().catch(() => undefined);
    if (!s) return null;
    const category = await categoryAddOnsForService(this.db, ctx.tenantId, serviceId);
    const rows = await this.db.selectFrom('service_add_ons')
      .where('tenant_id', '=', ctx.tenantId).where('service_id', '=', serviceId)
      .selectAll().orderBy('sort_order', 'asc').execute().catch(() => [] as any[]);
    const legacy = rows.map((r) => ({
      addOnId: String(r.add_on_key), name: String(r.name), priceCents: Number(r.price_cents || 0),
      durationDeltaMinutes: Number(r.duration_delta_minutes || 0), isTaxable: !!r.is_taxable, isActive: !!r.is_active,
    }));
    return mergeAddOnRows(category, legacy).map(({ source: _source, ...a }) => a);
  }
  /** The older per-service add-on route (PATCH /pos/services/:id/add-ons). Nov 4 2026: it DELETED every add-on row of the service
   *  and re-inserted the list it was sent — so a list from an old client wiped the add-ons made in the Add-Ons screen (archived
   *  ones and their history too). Now nothing is deleted: rows are matched by add-on key and updated, new keys are added, and an
   *  add-on left out of the list is set inactive (restorable from the Add-Ons screen). Every change is in the catalog history. */
  async setAddOns(ctx: ServicesContext, serviceId: string, addOns: ServiceAddOn[]): Promise<ServiceAddOn[] | null> {
    const s = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select('id').executeTakeFirst().catch(() => undefined);
    if (!s) return null;
    const branchId = await this.resolveBranchId(ctx);
    await this.db.transaction().execute(async (trx) => {
      const existing: any[] = await trx.selectFrom('service_add_ons').selectAll().where('tenant_id', '=', ctx.tenantId).where('service_id', '=', serviceId).execute();
      const byKey = new Map(existing.map((r) => [String(r.add_on_key), r]));
      const sent = new Set<string>();
      const changes: any[] = [];
      for (const [i, a] of addOns.entries()) {
        const key = String(a.addOnId); sent.add(key);
        const ex = byKey.get(key);
        const next = { name: a.name, price_cents: a.priceCents, duration_delta_minutes: a.durationDeltaMinutes, is_taxable: a.isTaxable, is_active: a.isActive, sort_order: i };
        if (!ex) {
          await trx.insertInto('service_add_ons').values({ tenant_id: ctx.tenantId, branch_id: branchId, service_id: serviceId, add_on_key: key, ...next, updated_at: new Date() } as any).execute();
          changes.push(...diffFields('add_on', key, {}, { name: a.name, price_cents: a.priceCents, is_active: a.isActive }, { serviceId, source: 'pos' }));
        } else {
          await trx.updateTable('service_add_ons').set({ ...next, updated_at: new Date() } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ex.id).execute();
          changes.push(...diffFields('add_on', key, { name: ex.name, price_cents: Number(ex.price_cents), duration_delta_minutes: Number(ex.duration_delta_minutes), is_taxable: !!ex.is_taxable, is_active: !!ex.is_active },
            { name: a.name, price_cents: a.priceCents, duration_delta_minutes: a.durationDeltaMinutes, is_taxable: a.isTaxable, is_active: a.isActive }, { serviceId, source: 'pos' }));
        }
      }
      for (const ex of existing) {
        if (sent.has(String(ex.add_on_key)) || !ex.is_active) continue;
        await trx.updateTable('service_add_ons').set({ is_active: false, updated_at: new Date() } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', ex.id).execute();
        changes.push(...diffFields('add_on', String(ex.add_on_key), { is_active: true }, { is_active: false }, { serviceId, source: 'pos' }));
      }
      if (changes.length) await recordCatalogChanges(trx as any, ctx as any, changes);
    });
    return this.getAddOns(ctx, serviceId);
  }
  async getTax(ctx: ServicesContext, serviceId: string): Promise<ServiceTax | null> {
    const s: any = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select(['id', 'is_taxable' as any]).executeTakeFirst().catch(() => undefined);
    return s ? { isTaxable: s.is_taxable !== false, exemptAllowed: false } : null;
  }

  async setTax(ctx: ServicesContext, serviceId: string, t: ServiceTax): Promise<ServiceTax | null> {
    const s: any = await this.scoped(this.db.selectFrom('services'), ctx).where('id', '=', serviceId).select(['id', 'is_taxable' as any]).executeTakeFirst().catch(() => undefined);
    if (!s) return null;
    // D2 Services (Nov 4 2026): taxable / not taxable is stored per service (792); every ticket line copies it when rung up, so
    // a change applies to new tickets only. The RATE stays the salon's / location's; a per-service rate, an exemption
    // workflow or a tax category are not available and are refused with a coded reason (never answered "saved").
    if (t?.exemptAllowed || t?.overridePercent != null || t?.taxCategory) {
      throw Object.assign(new Error('Services are taxed at the salon\'s tax rate; a per-service rate, exemption or tax category is not available.'), { apiCode: 'SERVICE_TAX_NOT_CONFIGURABLE', status: 409 });
    }
    const next = t?.isTaxable !== false;
    const before = s.is_taxable !== false;
    if (next !== before) {
      await this.db.transaction().execute(async (trx) => {
        await (trx as any).updateTable('services').set({ is_taxable: next, updated_at: new Date() }).where('tenant_id', '=', ctx.tenantId).where('id', '=', serviceId).execute();
        await recordCatalogChanges(trx as any, ctx as any, diffFields('service', serviceId, { is_taxable: before }, { is_taxable: next }, { serviceId, source: 'pos' }));
      });
    }
    return { isTaxable: next, exemptAllowed: false };
  }

  async exportRows(ctx: ServicesContext, f: ServiceFilters): Promise<{ headers: string[]; rows: (string | number)[][] }> {
    const all = await this.loadRows(ctx); const cats = await this.cats(ctx);
    const catName = (id: string) => cats.find((c) => c.categoryId === id)?.name || '';
    const rows = this.applyFilters(all, catName, f);
    return { headers: ['Id', 'Name', 'Category', 'Price', 'Duration', 'Status', 'Taxable', 'Bookings', 'Revenue'], rows: rows.map((s) => [s.serviceId, s.name, catName(s.categoryId), (s.basePriceCents/100).toFixed(2), s.durationMinutes, s.status, 'yes', s.bookingsCount, s.revenueCents]) };
  }
}
