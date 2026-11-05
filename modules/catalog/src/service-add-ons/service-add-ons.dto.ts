// service-add-ons.dto.ts — a catalog-wide view of every add-on across all services. Add-ons themselves are
// owned/managed per service (pos/services/:id/add-ons); this only flattens them for a cross-service lens.

export interface ServiceAddOnsContext {
  tenantId: string; branchId?: string; userId: string; role: string; permissions: string[];
}

export interface AddOnCatalogRow {
  serviceId: string; serviceName: string; categoryName: string;
  addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean;
}
export interface AddOnSummary { totalAddOns: number; activeAddOns: number; servicesWithAddOns: number; averagePriceCents: number; }
export interface ServiceAddOnsState { kpis: AddOnSummary; addOns: AddOnCatalogRow[]; }

export interface ServiceLite { serviceId: string; name: string; categoryName: string }
export interface AddOnLite { addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean }

// Flatten per-service add-ons into a catalog list, active first then by price desc.
export function buildAddOnCatalog(services: ServiceLite[], addOnsByService: Record<string, AddOnLite[]>): AddOnCatalogRow[] {
  const rows: AddOnCatalogRow[] = [];
  for (const s of services) {
    for (const a of addOnsByService[s.serviceId] || []) {
      rows.push({
        serviceId: s.serviceId, serviceName: s.name, categoryName: s.categoryName,
        addOnId: a.addOnId, name: a.name, priceCents: a.priceCents, durationDeltaMinutes: a.durationDeltaMinutes,
        isTaxable: a.isTaxable, isActive: a.isActive,
      });
    }
  }
  return rows.sort((a, b) => (a.isActive === b.isActive ? b.priceCents - a.priceCents : a.isActive ? -1 : 1));
}

export function buildAddOnSummary(rows: AddOnCatalogRow[]): AddOnSummary {
  const active = rows.filter((r) => r.isActive);
  const services = new Set(rows.map((r) => r.serviceId));
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.priceCents, 0) / rows.length) : 0;
  return { totalAddOns: rows.length, activeAddOns: active.length, servicesWithAddOns: services.size, averagePriceCents: avg };
}

export interface CreateAddOnRequest {
  name: string;
  priceCents: number;
  durationDeltaMinutes: number;
  isTaxable?: boolean;
  serviceIds?: string[];
}

export interface UpdateAddOnRequest {
  name?: string;
  priceCents?: number;
  durationDeltaMinutes?: number;
  isTaxable?: boolean;
  serviceIds?: string[];
}
