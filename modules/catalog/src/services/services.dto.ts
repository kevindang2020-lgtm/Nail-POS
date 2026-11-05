// services.dto.ts — AIPowerSalon POS Services contracts.
// Endpoints derive tenantId/branchId from the authenticated session — never from the client (§4).
// Super Admin global service templates are a separate surface (/super-admin/service-templates); NOT here.

export type ServiceStatus = "active" | "inactive" | "archived";
export type CommissionType = "none" | "fixed" | "percent";

// ---- §9 KPIs ----
export interface ServiceKpis {
  totalServices: number;
  totalServicesTrendPercent: number;
  serviceCategories: number;
  serviceCategoriesTrendPercent: number;
  mostBookedServiceName: string;
  mostBookedServiceBookings: number;
  averageServicePriceCents: number;
  averageServicePriceTrendPercent: number;
  totalRevenueCents: number;
  totalRevenueTrendPercent: number;
}

// ---- §10 table ----
export interface Pagination { page: number; pageSize: number; totalItems: number; totalPages: number; }
export interface ServiceTechRef { technicianId: string; displayName: string; avatarUrl?: string; }
export interface ServiceListItem {
  serviceId: string;
  serviceName: string;
  categoryId: string;
  categoryName: string;
  durationMinutes: number;
  priceCents: number;
  assignedTechnicians: ServiceTechRef[];
  extraTechnicianCount: number;
  bookingsCount: number;
  revenueCents: number;
  status: ServiceStatus;
}
export interface ServiceListResponse { items: ServiceListItem[]; pagination: Pagination; }

// ---- §11/§12 create + edit ----
export interface CreateServiceRequest {
  name: string;
  categoryId: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  commissionType?: CommissionType;
  commissionValue?: number;
  technicianIds?: string[];
  skillTags?: string[];
  onlineBookingEnabled?: boolean;
  customerAppBookingEnabled?: boolean;
  aiBookingEnabled?: boolean;
  colorKey?: string;
  iconKey?: string;
  status: "active" | "inactive";
}
export type UpdateServiceRequest = Partial<CreateServiceRequest>;

// ---- §13 delete safety ----
export interface DeleteServiceResult {
  ok: boolean;
  reasonCode?: "SERVICE_HAS_HISTORY";
  message?: string;
  archived?: boolean;
}

// ---- §14 categories ----
export interface ServiceCategorySummary {
  totalServices: number;
  categories: { categoryId: string; categoryName: string; serviceCount: number; percent: number; colorKey: string }[];
}
export interface ServiceCategoryOption { categoryId: string; name: string; colorKey: string; status: ServiceStatus; }

// ---- §15 top by revenue ----
export interface TopServiceByRevenue { serviceId: string; rank: number; serviceName: string; revenueCents: number; bookingsCount: number; }

// ---- §16 mobile ----
export interface ServiceMobileQuickStats {
  dateLabel: string;
  totalBookings: number;
  totalBookingsTrendPercent: number;
  totalRevenueCents: number;
  totalRevenueTrendPercent: number;
  averageServicePriceCents: number;
  averageServicePriceTrendPercent: number;
  newServices: number;
  newServicesTrendCount: number;
  topBookedServices: { serviceId: string; rank: number; serviceName: string; bookingsCount: number }[];
}

// ---- §17 booking option ----
export interface ServiceOption {
  serviceId: string;
  name: string;
  categoryName: string;
  durationMinutes: number;
  priceCents: number;
  onlineBookingEnabled: boolean;
  aiBookingEnabled: boolean;
  requiredSkillTags: string[];
}
export interface TechnicianOption { technicianId: string; displayName: string; avatarUrl?: string; }

// ---- §22 consolidated state ----
export interface POSServicesState {
  kpis: ServiceKpis;
  services: ServiceListResponse;
  categoriesSummary: ServiceCategorySummary;
  topServicesByRevenue: TopServiceByRevenue[];
  categories: ServiceCategoryOption[];
  technicians: TechnicianOption[];
}

// ===== pure helpers (unit-testable) =====

// §9 average price across active services
export function averagePriceCents(priceCentsList: number[]): number {
  if (priceCentsList.length === 0) return 0;
  return Math.round(priceCentsList.reduce((a, b) => a + b, 0) / priceCentsList.length);
}

// §14 category donut percentages (sum rounds to ~100)
export function categoryPercentages(counts: { categoryId: string; categoryName: string; serviceCount: number; colorKey: string }[]): ServiceCategorySummary {
  const total = counts.reduce((a, c) => a + c.serviceCount, 0);
  return {
    totalServices: total,
    categories: counts.map((c) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      serviceCount: c.serviceCount,
      colorKey: c.colorKey,
      percent: total > 0 ? Math.round((c.serviceCount / total) * 1000) / 10 : 0,
    })),
  };
}

// §15/§21 rank by revenue from ticket-line snapshots (never current price)
export interface ServiceRevenueAgg { serviceId: string; serviceName: string; revenueCents: number; bookingsCount: number; }
export function topByRevenue(rows: ServiceRevenueAgg[], limit: number): TopServiceByRevenue[] {
  return [...rows]
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, limit)
    .map((r, i) => ({ serviceId: r.serviceId, rank: i + 1, serviceName: r.serviceName, revenueCents: r.revenueCents, bookingsCount: r.bookingsCount }));
}

// §13 hard-delete only when the service has zero historical usage
export function canHardDelete(usage: { appointmentLines: number; ticketLines: number; reportRefs: number }): boolean {
  return usage.appointmentLines === 0 && usage.ticketLines === 0 && usage.reportRefs === 0;
}

// ===== §10/§14-§19 additions: richer row + sub-resources + filters (extend, don't replace) =====
export interface POSServiceRow {
  serviceId: string; tenantId: string; branchId?: string; categoryId: string; categoryName: string;
  name: string; description?: string; basePriceCents: number; durationMinutes: number; bufferMinutes?: number;
  isActive: boolean; isTaxable: boolean; bookingEnabled: boolean; checkoutEnabled: boolean;
  onlineBookingEnabled: boolean; aiBookingEnabled: boolean; technicianSkillRequired?: string[];
  addOnsCount: number; commissionType?: CommissionType; commissionValue?: number; sortOrder?: number;
  createdAt: string; updatedAt: string;
}
export interface ServiceAddOn { addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean; }
export interface ServiceTechnicianMappingRow { technicianId: string; displayName: string; skillLevel?: string; commissionOverrideValue?: number; isActive: boolean; }
export interface ServiceCommission { type: CommissionType; value: number; byTechnician?: { technicianId: string; type: CommissionType; value: number }[]; }
export interface ServiceTax { isTaxable: boolean; taxCategory?: string; overridePercent?: number; exemptAllowed: boolean; }
export interface POSServiceDetail extends POSServiceRow {
  addOns: ServiceAddOn[]; technicianMapping: ServiceTechnicianMappingRow[]; commission: ServiceCommission; tax: ServiceTax;
  auditSummary: { lastAction: string; lastActorRole: string; lastAt: string }[];
}

export interface ServiceFilters {
  search?: string; categoryId?: string; status?: string; taxable?: string;
  bookingEnabled?: string; checkoutEnabled?: string; onlineBookingEnabled?: string; aiBookingEnabled?: string;
  priceMin?: number; priceMax?: number; durationMin?: number; durationMax?: number;
  missingMapping?: string; missingPrice?: string; missingDuration?: string; technicianSkillGroup?: string;
  page?: number; pageSize?: number;
}

// spec §8 KPI shape (richer than the dashboard ServiceKpis; both are kept)
export interface ServicesKpisFull {
  totalServices: number; activeServices: number; inactiveServices: number; categoriesCount: number;
  addOnsCount: number; servicesMissingDuration: number; servicesMissingPrice: number;
  servicesWithoutTechMapping: number; topServiceRevenueCents: number;
}
export interface ServicesFilterFacets {
  categories: { categoryId: string; name: string }[]; statuses: string[]; taxableOptions: string[];
  durationRanges: string[]; priceRanges: string[]; technicianSkillGroups: string[];
}

// Consolidated state returned by GET /pos/services/state (extends the original contract).
export interface POSServicesFullState extends POSServicesState {
  kpisFull: ServicesKpisFull;
  rows: { items: POSServiceRow[]; pagination: Pagination };
  filterFacets: ServicesFilterFacets;
  selectedService?: POSServiceDetail;
}

// CSV export (formula-injection-safe)
export function servicesToCsv(headers: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  return [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas/newlines, and "" escapes. Returns rows of
// string cells; blank lines are dropped. Used by the service import (preview + commit).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQ = false; let i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { endField(); i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

// Parse a Price cell to integer cents. The value is read as DOLLARS — "80", "80.00", and "$80" all mean $80.00 → 8000
// cents (commas and whitespace are ignored). Returns null when unparseable. Matches the dollar-formatted export, so a
// re-imported export round-trips exactly, and a hand-typed price means what a person expects.
export function parsePriceCents(raw: string): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/^'/, '').replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// ---- service CSV import (preview + commit) ----
export type ServiceImportAction = 'create' | 'update' | 'error';
export interface ServiceImportRow {
  line: number;                 // 1-based source row number (data rows; header is line 1)
  name: string;
  categoryName: string;
  categoryExists: boolean;      // false → the category will be created on commit
  priceCents: number;
  priceDisplay: string;         // e.g. "$60.00" — so the user can sanity-check the unit before committing
  durationMinutes: number;
  status: 'active' | 'inactive';
  action: ServiceImportAction;
  matchedServiceId?: string;    // set when action === 'update'
  errors: string[];
}
export interface ServiceImportPreview {
  ok: boolean;                  // false → header/columns invalid; see message
  message?: string;
  totalRows: number;
  willCreate: number;
  willUpdate: number;
  willCreateCategories: string[];
  errorCount: number;
  rows: ServiceImportRow[];
}
export interface ServiceImportResult {
  ok: boolean;
  message?: string;
  created: number;
  updated: number;
  skipped: number;              // error rows that were not applied
  failed: number;               // rows that errored during apply
  createdCategories: string[];
  rows: { line: number; name: string; outcome: 'created' | 'updated' | 'skipped' | 'failed'; error?: string }[];
}
