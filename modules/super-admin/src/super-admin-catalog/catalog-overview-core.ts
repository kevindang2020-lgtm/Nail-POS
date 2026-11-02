import type { CatalogOverview, RecentVersion } from '@aipowersalon/api-contracts/platform';
export type { CatalogOverview, RecentVersion };   // owned by packages/api-contracts (Constitution 13 §13)
// catalog-overview-core.ts — pure aggregation for Super Admin › Catalog Management › Service Templates. Takes
// pre-aggregated rows from the repository and derives KPIs, chart series, and the right-side snapshots. No I/O. Money
// is integer cents. Honest: values with no source render as 0/empty, never fabricated.

export type TemplateRow = {
  code: string; name: string; categoryCode: string | null; status: string; taxSetting: string;
  commissionEligible: boolean; durationMinutes: number; priceMinCents: number; priceMaxCents: number;
  addonCount: number; deploymentCount: number;
};
export type CategoryRow = { code: string; name: string };
export type DeploymentFact = { tenantId: string; customized: boolean };
export type ResourceCount = { label: string; count: number };
export type TenantCompareRow = { tenantName: string; copied: number; customized: number };

export type CatalogOverviewData = {
  templates: TemplateRow[];
  categories: CategoryRow[];
  deployments: DeploymentFact[];
  totalTenants: number;
  resourceLabels: ResourceCount[];
  addonTotal: number;
  versionsThisMonth: number;
  recentVersions: RecentVersion[];
  tenantCompare: TenantCompareRow[];
};


const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

function priceBucket(minCents: number): string {
  const d = minCents / 100;
  if (d <= 25) return '$0–25';
  if (d <= 50) return '$26–50';
  if (d <= 75) return '$51–75';
  if (d <= 100) return '$76–100';
  return '$100+';
}

export function buildCatalogOverview(data: CatalogOverviewData): CatalogOverview {
  const t = data.templates;
  const total = t.length;
  const byStatus = (s: string) => t.filter((x) => x.status === s).length;
  const taxable = t.filter((x) => x.taxSetting === 'taxable').length;
  const commissionable = t.filter((x) => x.commissionEligible).length;

  // category chips + usage donut
  const countByCat = new Map<string, number>();
  for (const x of t) if (x.categoryCode) countByCat.set(x.categoryCode, (countByCat.get(x.categoryCode) ?? 0) + 1);
  const categoryChips = data.categories.map((c) => ({ code: c.code, name: c.name, templateCount: countByCat.get(c.code) ?? 0 }));
  const usageByCategory = categoryChips.filter((c) => c.templateCount > 0).map((c) => ({ label: c.name, value: c.templateCount }));

  // price-range distribution (by suggested minimum)
  const buckets = ['$0–25', '$26–50', '$51–75', '$76–100', '$100+'];
  const bucketCount = new Map<string, number>(buckets.map((b) => [b, 0]));
  for (const x of t) if (x.priceMaxCents > 0) { const b = priceBucket(x.priceMinCents); bucketCount.set(b, (bucketCount.get(b) ?? 0) + 1); }
  const priceRangeDistribution = buckets.map((b) => ({ label: b, value: bucketCount.get(b) ?? 0 }));

  // tenant adoption
  const deployedTenants = new Set(data.deployments.map((d) => d.tenantId));
  const partialTenants = new Set(data.deployments.filter((d) => d.customized).map((d) => d.tenantId));
  const adopted = deployedTenants.size;
  const partial = partialTenants.size;
  const notAdopted = Math.max(0, data.totalTenants - adopted);

  // resources snapshot
  const mostUsed = [...data.resourceLabels].sort((a, b) => b.count - a.count)[0] ?? null;
  const avgAddOns = total > 0 ? Math.round((data.addonTotal / total) * 10) / 10 : 0;

  // tenant compare
  const tenantCompare = data.tenantCompare.map((r) => ({
    tenantName: r.tenantName, copied: r.copied, customized: r.customized,
    unchanged: Math.max(0, r.copied - r.customized), customizationPct: pct(r.customized, r.copied),
  }));

  return {
    kpis: {
      totalTemplates: total,
      activeCategories: data.categories.length,
      publishedTemplates: byStatus('published'),
      draftTemplates: byStatus('draft'),
      retiredTemplates: byStatus('retired'),
      tenantsUsingTemplates: adopted,
      avgSuggestedDurationMinutes: total > 0 ? Math.round(t.reduce((s, x) => s + x.durationMinutes, 0) / total) : 0,
      templateDeployments: data.deployments.length,
      addOnEnabledTemplates: t.filter((x) => x.addonCount > 0).length,
      commissionEligibleTemplates: commissionable,
      priceRangeConfigured: t.filter((x) => x.priceMaxCents > 0).length,
      versionUpdatesThisMonth: data.versionsThisMonth,
    },
    categoryChips,
    usageByCategory,
    priceRangeDistribution,
    tenantAdoption: { adopted, partial, notAdopted, totalTenants: data.totalTenants },
    resourcesSnapshot: {
      uniqueResources: data.resourceLabels.length,
      mostUsedResource: mostUsed ? `${mostUsed.label} (${mostUsed.count})` : null,
      totalAddOnOptions: data.addonTotal,
      avgAddOnsPerTemplate: avgAddOns,
    },
    taxCommission: {
      taxableCount: taxable, taxablePct: pct(taxable, total),
      nonTaxableCount: total - taxable, nonTaxablePct: pct(total - taxable, total),
      commissionEligibleCount: commissionable, commissionEligiblePct: pct(commissionable, total),
      commissionNotEligibleCount: total - commissionable, commissionNotEligiblePct: pct(total - commissionable, total),
    },
    recentVersions: data.recentVersions,
    tenantCompare,
    avgTenantAdoptionPct: pct(adopted, data.totalTenants),
  };
}
