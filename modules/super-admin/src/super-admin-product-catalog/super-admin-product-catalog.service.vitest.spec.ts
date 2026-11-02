import { describe, it, expect } from 'vitest';
import { CatalogOversightService } from './super-admin-product-catalog.service';
import { InMemoryCatalogRepo } from './super-admin-product-catalog.repository';

const svc = () => new CatalogOversightService(new InMemoryCatalogRepo());

describe('CatalogOversightService', () => {
  it('returns the 12 KPIs, charts, and a paginated directory', async () => {
    const ov = await svc().getOverview({ pageSize: 5 });
    expect(ov.kpis).toHaveLength(12);
    expect(ov.directory.length).toBe(5);
    expect(ov.directoryTotal).toBe(8);
    expect(ov.pagination.totalPages).toBe(2);
    expect(ov.retailPriceDistribution.length).toBe(6);
  });

  it('flags duplicate SKUs and computes tenant reach cross-tenant', async () => {
    const ov = await svc().getOverview({ pageSize: 50, sort: 'sku' });
    const dupRows = ov.directory.filter((r) => r.duplicateFlag);
    expect(dupRows.length).toBe(2);                 // CND-CO-15 on two tenants
    expect(dupRows.every((r) => r.activeTenants === 2)).toBe(true); // reach = 2 tenants
    expect(ov.duplicateDetection.duplicateSkus).toBe(1);
  });

  it('renders honest NotConnected for import status, tax, import errors, sync updates', async () => {
    const ov = await svc().getOverview({ pageSize: 50 });
    expect(ov.directory.every((r) => r.importStatusAvailable === false && r.taxCategory === null)).toBe(true);
    const byKey = Object.fromEntries(ov.kpis.map((k) => [k.key, k]));
    expect(byKey.import_errors.available).toBe(false);
    expect(byKey.taxable_products.available).toBe(false);
    expect(byKey.product_sync_updates.available).toBe(false);
  });

  it('filters to duplicates only', async () => {
    const ov = await svc().getOverview({ pageSize: 50, duplicateOnly: true });
    expect(ov.directory.length).toBe(2);
    expect(ov.directory.every((r) => r.duplicateFlag)).toBe(true);
  });

  it('scopes to a single tenant', async () => {
    const ov = await svc().getOverview({ tenantId: 't3', pageSize: 50 });
    expect(ov.directory.every((r) => r.tenantId === 't3')).toBe(true);
    expect(ov.directory.some((r) => r.status === 'Retired')).toBe(true); // seeded retired product in t3
  });
});
