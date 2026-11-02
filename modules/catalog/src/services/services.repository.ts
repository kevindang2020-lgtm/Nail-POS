// services.repository.ts — persistence port + in-memory adapter for POS Services.
// A tenant-scoped, MUTABLE catalog so create/edit/archive/category/mapping changes genuinely persist.
// Filters (§19) are applied server-side. A different tenant sees its own (empty) catalog — isolation.
import {
  POSServicesFullState, POSServiceRow, POSServiceDetail, ServiceListItem, ServiceListResponse, ServiceFilters,
  ServiceAddOn, ServiceTechnicianMappingRow, ServiceCommission, ServiceTax, ServiceKpis, ServicesKpisFull,
  ServiceCategoryOption, ServiceCategorySummary, TechnicianOption, CreateServiceRequest, UpdateServiceRequest,
  CommissionType, ServiceStatus, categoryPercentages, topByRevenue, averagePriceCents, canHardDelete, Pagination,
} from './services.dto';
import { clampPageSize, clampPage, foldVi } from '@aipowersalon/api-contracts';

export interface ServicesContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

interface Svc {
  serviceId: string; categoryId: string; name: string; description: string; basePriceCents: number;
  durationMinutes: number; bufferMinutes: number; status: ServiceStatus; isTaxable: boolean;
  bookingEnabled: boolean; checkoutEnabled: boolean; onlineBookingEnabled: boolean; aiBookingEnabled: boolean;
  technicianSkillRequired: string[]; commissionType: CommissionType; commissionValue: number; sortOrder: number;
  createdAt: string; updatedAt: string; addOns: ServiceAddOn[]; mapping: ServiceTechnicianMappingRow[]; tax: ServiceTax;
  usage: { appointmentLines: number; ticketLines: number; reportRefs: number }; bookingsCount: number; revenueCents: number;
}
interface Cat { categoryId: string; name: string; colorKey: string; status: ServiceStatus; sortOrder: number; }

export interface ServicesRepositoryPort {
  query(ctx: ServicesContext, f: ServiceFilters): Promise<POSServicesFullState>;
  detail(ctx: ServicesContext, serviceId: string): Promise<POSServiceDetail | null>;
  create(ctx: ServicesContext, req: CreateServiceRequest): Promise<POSServiceRow>;
  update(ctx: ServicesContext, serviceId: string, req: UpdateServiceRequest): Promise<POSServiceRow | null>;
  setStatus(ctx: ServicesContext, serviceId: string, status: ServiceStatus): Promise<POSServiceRow | null>;
  usage(ctx: ServicesContext, serviceId: string): Promise<{ appointmentLines: number; ticketLines: number; reportRefs: number } | null>;
  listCategories(ctx: ServicesContext): Promise<ServiceCategoryOption[]>;
  createCategory(ctx: ServicesContext, name: string, colorKey?: string): Promise<ServiceCategoryOption>;
  updateCategory(ctx: ServicesContext, categoryId: string, patch: { name?: string; colorKey?: string; status?: ServiceStatus }): Promise<ServiceCategoryOption | null>;
  archiveCategory(ctx: ServicesContext, categoryId: string, confirm?: boolean): Promise<{ ok: boolean; activeServices: number }>;
  reorderCategories(ctx: ServicesContext, order: string[]): Promise<ServiceCategoryOption[]>;
  getAddOns(ctx: ServicesContext, serviceId: string): Promise<ServiceAddOn[] | null>;
  setAddOns(ctx: ServicesContext, serviceId: string, addOns: ServiceAddOn[]): Promise<ServiceAddOn[] | null>;
  getMapping(ctx: ServicesContext, serviceId: string): Promise<ServiceTechnicianMappingRow[] | null>;
  setMapping(ctx: ServicesContext, serviceId: string, m: ServiceTechnicianMappingRow[]): Promise<ServiceTechnicianMappingRow[] | null>;
  getCommission(ctx: ServicesContext, serviceId: string): Promise<ServiceCommission | null>;
  setCommission(ctx: ServicesContext, serviceId: string, c: ServiceCommission): Promise<ServiceCommission | null>;
  getTax(ctx: ServicesContext, serviceId: string): Promise<ServiceTax | null>;
  setTax(ctx: ServicesContext, serviceId: string, t: ServiceTax): Promise<ServiceTax | null>;
  exportRows(ctx: ServicesContext, f: ServiceFilters): Promise<{ headers: string[]; rows: (string | number)[][] }>;
}

const now = () => new Date().toISOString();

export class InMemoryServicesRepository implements ServicesRepositoryPort {
  // per-tenant catalogs; only the seeded tenant has data
  private svc = new Map<string, Svc[]>();
  private cat = new Map<string, Cat[]>();
  private tech = new Map<string, TechnicianOption[]>();
  private seq = 1000;

  private ensure(tenantId: string) {
    if (this.svc.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.svc.set(tenantId, []); this.cat.set(tenantId, []); this.tech.set(tenantId, []); return; }
    const cats: Cat[] = [
      { categoryId: 'cat_mani', name: 'Manicures', colorKey: 'gold', status: 'active', sortOrder: 0 },
      { categoryId: 'cat_pedi', name: 'Pedicures', colorKey: 'rose', status: 'active', sortOrder: 1 },
      { categoryId: 'cat_enh', name: 'Enhancements', colorKey: 'sand', status: 'active', sortOrder: 2 },
    ];
    const techs: TechnicianOption[] = [
      { technicianId: 't_mia', displayName: 'Mia' }, { technicianId: 't_ava', displayName: 'Ava' }, { technicianId: 't_leo', displayName: 'Leo' },
    ];
    const mk = (id: string, cat: string, name: string, price: number, dur: number, skill: string[], techIds: string[], over: Partial<Svc> = {}): Svc => ({
      serviceId: id, categoryId: cat, name, description: '', basePriceCents: price, durationMinutes: dur, bufferMinutes: 5,
      status: 'active', isTaxable: true, bookingEnabled: true, checkoutEnabled: true, onlineBookingEnabled: true, aiBookingEnabled: true,
      technicianSkillRequired: skill, commissionType: 'percent', commissionValue: 40, sortOrder: 0, createdAt: now(), updatedAt: now(),
      addOns: [], tax: { isTaxable: true, exemptAllowed: false },
      mapping: techIds.map((tid) => ({ technicianId: tid, displayName: techs.find((t) => t.technicianId === tid)!.displayName, skillLevel: 'standard', isActive: true })),
      usage: { appointmentLines: 0, ticketLines: 0, reportRefs: 0 }, bookingsCount: 0, revenueCents: 0, ...over,
    });
    const list: Svc[] = [
      mk('svc_sig_mani', 'cat_mani', 'Signature Manicure', 4500, 45, ['manicure'], ['t_mia', 't_ava'], { bookingsCount: 38, revenueCents: 171000, usage: { appointmentLines: 38, ticketLines: 38, reportRefs: 1 }, addOns: [{ addOnId: 'ao_paraffin', name: 'Paraffin Treatment', priceCents: 800, durationDeltaMinutes: 10, isTaxable: true, isActive: true }] }),
      mk('svc_spa_pedi', 'cat_pedi', 'Spa Pedicure', 6500, 60, ['pedicure'], ['t_ava'], { bookingsCount: 27, revenueCents: 175500, usage: { appointmentLines: 27, ticketLines: 27, reportRefs: 1 } }),
      mk('svc_full_set', 'cat_enh', 'Sculpted Full Set', 8500, 90, ['acrylic'], ['t_leo'], { bookingsCount: 19, revenueCents: 161500, usage: { appointmentLines: 19, ticketLines: 19, reportRefs: 1 } }),
      mk('svc_gel_refresh', 'cat_mani', 'Gel Color Refresh', 3500, 30, ['manicure'], ['t_mia', 't_leo'], { bookingsCount: 22, revenueCents: 77000, usage: { appointmentLines: 22, ticketLines: 22, reportRefs: 1 } }),
      mk('svc_express', 'cat_mani', 'Express File & Polish', 0, 20, [], [], { status: 'inactive', onlineBookingEnabled: false, aiBookingEnabled: false }), // missing price + no mapping (for KPI/filter tests)
      mk('svc_legacy', 'cat_enh', 'Legacy Dip Set', 5500, 0, ['dip'], ['t_ava'], { status: 'archived', bookingsCount: 9, revenueCents: 49500, usage: { appointmentLines: 9, ticketLines: 9, reportRefs: 1 } }), // missing duration + archived (history)
    ];
    this.svc.set(tenantId, list); this.cat.set(tenantId, cats); this.tech.set(tenantId, techs);
  }
  private S(ctx: ServicesContext) { this.ensure(ctx.tenantId); return this.svc.get(ctx.tenantId)!; }
  private C(ctx: ServicesContext) { this.ensure(ctx.tenantId); return this.cat.get(ctx.tenantId)!; }
  private T(ctx: ServicesContext) { this.ensure(ctx.tenantId); return this.tech.get(ctx.tenantId)!; }
  private catName(ctx: ServicesContext, id: string) { return this.C(ctx).find((c) => c.categoryId === id)?.name || ''; }

  private toRow(ctx: ServicesContext, s: Svc): POSServiceRow {
    return {
      serviceId: s.serviceId, tenantId: ctx.tenantId, branchId: ctx.branchId, categoryId: s.categoryId, categoryName: this.catName(ctx, s.categoryId),
      name: s.name, description: s.description, basePriceCents: s.basePriceCents, durationMinutes: s.durationMinutes, bufferMinutes: s.bufferMinutes,
      isActive: s.status === 'active', isTaxable: s.isTaxable, bookingEnabled: s.bookingEnabled, checkoutEnabled: s.checkoutEnabled,
      onlineBookingEnabled: s.onlineBookingEnabled, aiBookingEnabled: s.aiBookingEnabled, technicianSkillRequired: s.technicianSkillRequired,
      addOnsCount: s.addOns.length, commissionType: s.commissionType, commissionValue: s.commissionValue, sortOrder: s.sortOrder,
      createdAt: s.createdAt, updatedAt: s.updatedAt,
    };
  }
  private bool(v?: string) { return v === 'true' || v === 'yes' || v === '1'; }

  private filtered(ctx: ServicesContext, f: ServiceFilters): Svc[] {
    let rows = this.S(ctx).slice();
    if (f.search) { const q = foldVi(f.search);   /* WP-E §41: accent-insensitive ("nguyen" finds "Nguyễn") */ rows = rows.filter((s) => [s.name, this.catName(ctx, s.categoryId), s.description].some((x) => foldVi(x).includes(q))); }
    if (f.categoryId) rows = rows.filter((s) => s.categoryId === f.categoryId);
    if (f.status) rows = rows.filter((s) => s.status === f.status);
    if (f.taxable) rows = rows.filter((s) => s.isTaxable === this.bool(f.taxable));
    if (f.bookingEnabled) rows = rows.filter((s) => s.bookingEnabled === this.bool(f.bookingEnabled));
    if (f.checkoutEnabled) rows = rows.filter((s) => s.checkoutEnabled === this.bool(f.checkoutEnabled));
    if (f.onlineBookingEnabled) rows = rows.filter((s) => s.onlineBookingEnabled === this.bool(f.onlineBookingEnabled));
    if (f.aiBookingEnabled) rows = rows.filter((s) => s.aiBookingEnabled === this.bool(f.aiBookingEnabled));
    if (f.priceMin != null) rows = rows.filter((s) => s.basePriceCents >= Number(f.priceMin));
    if (f.priceMax != null) rows = rows.filter((s) => s.basePriceCents <= Number(f.priceMax));
    if (f.durationMin != null) rows = rows.filter((s) => s.durationMinutes >= Number(f.durationMin));
    if (f.durationMax != null) rows = rows.filter((s) => s.durationMinutes <= Number(f.durationMax));
    if (this.bool(f.missingMapping)) rows = rows.filter((s) => s.mapping.filter((m) => m.isActive).length === 0);
    if (this.bool(f.missingPrice)) rows = rows.filter((s) => s.basePriceCents === 0);
    if (this.bool(f.missingDuration)) rows = rows.filter((s) => s.durationMinutes === 0);
    if (f.technicianSkillGroup) rows = rows.filter((s) => s.technicianSkillRequired.includes(f.technicianSkillGroup!));
    return rows;
  }

  async query(ctx: ServicesContext, f: ServiceFilters) {
    const all = this.S(ctx);
    const matched = this.filtered(ctx, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };

    const listItems: ServiceListItem[] = pageRows.map((s) => ({
      serviceId: s.serviceId, serviceName: s.name, categoryId: s.categoryId, categoryName: this.catName(ctx, s.categoryId),
      durationMinutes: s.durationMinutes, priceCents: s.basePriceCents,
      assignedTechnicians: s.mapping.filter((m) => m.isActive).slice(0, 3).map((m) => ({ technicianId: m.technicianId, displayName: m.displayName })),
      extraTechnicianCount: Math.max(0, s.mapping.filter((m) => m.isActive).length - 3), bookingsCount: s.bookingsCount, revenueCents: s.revenueCents, status: s.status,
    }));
    const rowItems: POSServiceRow[] = pageRows.map((s) => this.toRow(ctx, s));

    const active = all.filter((s) => s.status === 'active');
    const cats = this.C(ctx);
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
      categoriesCount: cats.length, addOnsCount: all.reduce((a, s) => a + s.addOns.length, 0),
      servicesMissingDuration: all.filter((s) => s.durationMinutes === 0).length, servicesMissingPrice: all.filter((s) => s.basePriceCents === 0).length,
      servicesWithoutTechMapping: all.filter((s) => s.mapping.filter((m) => m.isActive).length === 0).length,
      topServiceRevenueCents: all.reduce((m, s) => Math.max(m, s.revenueCents), 0),
    };

    return {
      kpis, services: { items: listItems, pagination } as ServiceListResponse, categoriesSummary, topServicesByRevenue,
      categories: cats.map((c) => ({ categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status })),
      technicians: this.T(ctx),
      kpisFull, rows: { items: rowItems, pagination },
      filterFacets: {
        categories: cats.map((c) => ({ categoryId: c.categoryId, name: c.name })),
        statuses: ['active', 'inactive', 'archived'], taxableOptions: ['yes', 'no'],
        durationRanges: ['0-30', '31-60', '61-90', '90+'], priceRanges: ['0-3000', '3001-6000', '6001+'],
        technicianSkillGroups: [...new Set(all.flatMap((s) => s.technicianSkillRequired))],
      },
    };
  }

  async detail(ctx: ServicesContext, serviceId: string) {
    const s = this.S(ctx).find((x) => x.serviceId === serviceId);
    if (!s) return null;
    return {
      ...this.toRow(ctx, s), addOns: s.addOns, technicianMapping: s.mapping,
      commission: { type: s.commissionType, value: s.commissionValue }, tax: s.tax,
      auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: s.updatedAt }],
    };
  }

  async create(ctx: ServicesContext, req: CreateServiceRequest) {
    const s: Svc = {
      serviceId: 'svc_' + (++this.seq), categoryId: req.categoryId, name: req.name, description: req.description || '',
      basePriceCents: req.priceCents, durationMinutes: req.durationMinutes, bufferMinutes: 5, status: req.status, isTaxable: true,
      bookingEnabled: true, checkoutEnabled: true, onlineBookingEnabled: req.onlineBookingEnabled ?? true, aiBookingEnabled: req.aiBookingEnabled ?? true,
      technicianSkillRequired: req.skillTags || [], commissionType: req.commissionType || 'percent', commissionValue: req.commissionValue ?? 40,
      sortOrder: this.S(ctx).length, createdAt: now(), updatedAt: now(), addOns: [], tax: { isTaxable: true, exemptAllowed: false },
      mapping: (req.technicianIds || []).map((tid) => ({ technicianId: tid, displayName: this.T(ctx).find((t) => t.technicianId === tid)?.displayName || tid, isActive: true })),
      usage: { appointmentLines: 0, ticketLines: 0, reportRefs: 0 }, bookingsCount: 0, revenueCents: 0,
    };
    this.S(ctx).push(s); return this.toRow(ctx, s);
  }
  async update(ctx: ServicesContext, serviceId: string, req: UpdateServiceRequest) {
    const s = this.S(ctx).find((x) => x.serviceId === serviceId); if (!s) return null;
    if (req.name != null) s.name = req.name; if (req.categoryId != null) s.categoryId = req.categoryId; if (req.description != null) s.description = req.description;
    if (req.priceCents != null) s.basePriceCents = req.priceCents; if (req.durationMinutes != null) s.durationMinutes = req.durationMinutes;
    if (req.commissionType != null) s.commissionType = req.commissionType; if (req.commissionValue != null) s.commissionValue = req.commissionValue;
    if (req.onlineBookingEnabled != null) s.onlineBookingEnabled = req.onlineBookingEnabled; if (req.aiBookingEnabled != null) s.aiBookingEnabled = req.aiBookingEnabled;
    if (req.status != null) s.status = req.status; if (req.skillTags != null) s.technicianSkillRequired = req.skillTags;
    s.updatedAt = now(); return this.toRow(ctx, s);
  }
  async setStatus(ctx: ServicesContext, serviceId: string, status: ServiceStatus) {
    const s = this.S(ctx).find((x) => x.serviceId === serviceId); if (!s) return null; s.status = status; s.updatedAt = now(); return this.toRow(ctx, s);
  }
  async usage(ctx: ServicesContext, serviceId: string) { const s = this.S(ctx).find((x) => x.serviceId === serviceId); return s ? s.usage : null; }

  async listCategories(ctx: ServicesContext) { return this.C(ctx).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status })); }
  async createCategory(ctx: ServicesContext, name: string, colorKey = 'gold') { const c: Cat = { categoryId: 'cat_' + (++this.seq), name, colorKey, status: 'active', sortOrder: this.C(ctx).length }; this.C(ctx).push(c); return { categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status }; }
  async updateCategory(ctx: ServicesContext, categoryId: string, patch: { name?: string; colorKey?: string; status?: ServiceStatus }) { const c = this.C(ctx).find((x) => x.categoryId === categoryId); if (!c) return null; if (patch.name != null) c.name = patch.name; if (patch.colorKey != null) c.colorKey = patch.colorKey; if (patch.status != null) c.status = patch.status; return { categoryId: c.categoryId, name: c.name, colorKey: c.colorKey, status: c.status }; }
  async archiveCategory(ctx: ServicesContext, categoryId: string, confirm = true) { const activeServices = this.S(ctx).filter((s) => s.categoryId === categoryId && s.status === 'active').length; const c = this.C(ctx).find((x) => x.categoryId === categoryId); if (c && (activeServices === 0 || confirm)) c.status = 'archived'; return { ok: !!c && (activeServices === 0 || confirm), activeServices }; }
  async reorderCategories(ctx: ServicesContext, order: string[]) { const cats = this.C(ctx); order.forEach((id, i) => { const c = cats.find((x) => x.categoryId === id); if (c) c.sortOrder = i; }); return this.listCategories(ctx); }

  async getAddOns(ctx: ServicesContext, serviceId: string) { return this.S(ctx).find((s) => s.serviceId === serviceId)?.addOns ?? null; }
  async setAddOns(ctx: ServicesContext, serviceId: string, addOns: ServiceAddOn[]) { const s = this.S(ctx).find((x) => x.serviceId === serviceId); if (!s) return null; s.addOns = addOns; s.updatedAt = now(); return s.addOns; }
  async getMapping(ctx: ServicesContext, serviceId: string) { return this.S(ctx).find((s) => s.serviceId === serviceId)?.mapping ?? null; }
  async setMapping(ctx: ServicesContext, serviceId: string, m: ServiceTechnicianMappingRow[]) { const s = this.S(ctx).find((x) => x.serviceId === serviceId); if (!s) return null; s.mapping = m; s.updatedAt = now(); return s.mapping; }
  async getCommission(ctx: ServicesContext, serviceId: string) { const s = this.S(ctx).find((x) => x.serviceId === serviceId); return s ? { type: s.commissionType, value: s.commissionValue } : null; }
  async setCommission(ctx: ServicesContext, serviceId: string, c: ServiceCommission) { const s = this.S(ctx).find((x) => x.serviceId === serviceId); if (!s) return null; s.commissionType = c.type; s.commissionValue = c.value; s.updatedAt = now(); return { type: s.commissionType, value: s.commissionValue }; }
  async getTax(ctx: ServicesContext, serviceId: string) { return this.S(ctx).find((s) => s.serviceId === serviceId)?.tax ?? null; }
  async setTax(ctx: ServicesContext, serviceId: string, t: ServiceTax) { const s = this.S(ctx).find((x) => x.serviceId === serviceId); if (!s) return null; s.tax = t; s.isTaxable = t.isTaxable; s.updatedAt = now(); return s.tax; }

  async exportRows(ctx: ServicesContext, f: ServiceFilters) {
    const rows = this.filtered(ctx, f);
    return { headers: ['Id', 'Name', 'Category', 'Price', 'Duration', 'Status', 'Taxable', 'Bookings', 'Revenue'], rows: rows.map((s) => [s.serviceId, s.name, this.catName(ctx, s.categoryId), (s.basePriceCents/100).toFixed(2), s.durationMinutes, s.status, s.isTaxable ? 'yes' : 'no', s.bookingsCount, s.revenueCents]) };
  }
}
