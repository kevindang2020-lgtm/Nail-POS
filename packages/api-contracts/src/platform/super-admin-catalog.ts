// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: platform. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export type CatalogOverview = {
  kpis: {
    totalTemplates: number; activeCategories: number; publishedTemplates: number; draftTemplates: number;
    retiredTemplates: number; tenantsUsingTemplates: number; avgSuggestedDurationMinutes: number;
    templateDeployments: number; addOnEnabledTemplates: number; commissionEligibleTemplates: number;
    priceRangeConfigured: number; versionUpdatesThisMonth: number;
  };
  categoryChips: { code: string; name: string; templateCount: number }[];
  usageByCategory: { label: string; value: number }[];
  priceRangeDistribution: { label: string; value: number }[];
  tenantAdoption: { adopted: number; partial: number; notAdopted: number; totalTenants: number };
  resourcesSnapshot: { uniqueResources: number; mostUsedResource: string | null; totalAddOnOptions: number; avgAddOnsPerTemplate: number };
  taxCommission: {
    taxableCount: number; taxablePct: number; nonTaxableCount: number; nonTaxablePct: number;
    commissionEligibleCount: number; commissionEligiblePct: number; commissionNotEligibleCount: number; commissionNotEligiblePct: number;
  };
  recentVersions: RecentVersion[];
  tenantCompare: { tenantName: string; copied: number; customized: number; unchanged: number; customizationPct: number }[];
  avgTenantAdoptionPct: number;
};

export type RecentVersion = { templateName: string; versionLabel: string | null; changeReason: string | null; createdAt: string };
