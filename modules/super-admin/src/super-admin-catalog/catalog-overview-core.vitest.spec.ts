import { describe, it, expect } from 'vitest';
import { buildCatalogOverview, type CatalogOverviewData } from './catalog-overview-core';

const base: CatalogOverviewData = {
  templates: [
    { code: 'a', name: 'A', categoryCode: 'manicure', status: 'published', taxSetting: 'taxable', commissionEligible: true, durationMinutes: 30, priceMinCents: 2000, priceMaxCents: 3500, addonCount: 1, deploymentCount: 2 },
    { code: 'b', name: 'B', categoryCode: 'manicure', status: 'draft', taxSetting: 'taxable', commissionEligible: false, durationMinutes: 60, priceMinCents: 6000, priceMaxCents: 9000, addonCount: 0, deploymentCount: 0 },
    { code: 'c', name: 'C', categoryCode: 'waxing', status: 'retired', taxSetting: 'non_taxable', commissionEligible: true, durationMinutes: 90, priceMinCents: 8000, priceMaxCents: 15000, addonCount: 2, deploymentCount: 1 },
  ],
  categories: [{ code: 'manicure', name: 'Manicure' }, { code: 'waxing', name: 'Waxing' }],
  deployments: [{ tenantId: 't1', customized: true }, { tenantId: 't1', customized: false }, { tenantId: 't2', customized: false }],
  totalTenants: 3,
  resourceLabels: [{ label: 'Nail Tech', count: 5 }, { label: 'Station', count: 2 }],
  addonTotal: 3,
  versionsThisMonth: 4,
  recentVersions: [{ templateName: 'A', versionLabel: 'v2.0', changeReason: 'x', createdAt: '2026-06-01T00:00:00Z' }],
  tenantCompare: [{ tenantName: 'Salon One', copied: 4, customized: 1 }],
};

describe('buildCatalogOverview', () => {
  it('computes KPI counts', () => {
    const o = buildCatalogOverview(base);
    expect(o.kpis.totalTemplates).toBe(3);
    expect(o.kpis.publishedTemplates).toBe(1);
    expect(o.kpis.draftTemplates).toBe(1);
    expect(o.kpis.retiredTemplates).toBe(1);
    expect(o.kpis.activeCategories).toBe(2);
    expect(o.kpis.commissionEligibleTemplates).toBe(2);
    expect(o.kpis.addOnEnabledTemplates).toBe(2);
    expect(o.kpis.avgSuggestedDurationMinutes).toBe(60); // (30+60+90)/3
    expect(o.kpis.templateDeployments).toBe(3);
    expect(o.kpis.tenantsUsingTemplates).toBe(2); // t1, t2
    expect(o.kpis.versionUpdatesThisMonth).toBe(4);
  });

  it('buckets prices by suggested minimum', () => {
    const o = buildCatalogOverview(base);
    const b = Object.fromEntries(o.priceRangeDistribution.map((x) => [x.label, x.value]));
    expect(b['$0–25']).toBe(1);   // $20 min
    expect(b['$51–75']).toBe(1);  // $60 min
    expect(b['$76–100']).toBe(1); // $80 min
    expect(b['$100+']).toBe(0);
  });

  it('derives tax/commission percentages and adoption', () => {
    const o = buildCatalogOverview(base);
    expect(o.taxCommission.taxableCount).toBe(2);
    expect(o.taxCommission.nonTaxableCount).toBe(1);
    expect(o.taxCommission.commissionEligibleCount).toBe(2);
    expect(o.tenantAdoption).toEqual({ adopted: 2, partial: 1, notAdopted: 1, totalTenants: 3 });
    expect(o.resourcesSnapshot.mostUsedResource).toBe('Nail Tech (5)');
    expect(o.tenantCompare[0]).toMatchObject({ copied: 4, customized: 1, unchanged: 3, customizationPct: 25 });
  });
});
