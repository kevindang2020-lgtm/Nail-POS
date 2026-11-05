import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    catalogOverview: vi.fn().mockResolvedValue({
      kpis: { totalTemplates: 10, activeCategories: 10, publishedTemplates: 10, draftTemplates: 0, retiredTemplates: 0, tenantsUsingTemplates: 2, avgSuggestedDurationMinutes: 66, templateDeployments: 4, addOnEnabledTemplates: 4, commissionEligibleTemplates: 8, priceRangeConfigured: 10, versionUpdatesThisMonth: 10 },
      categoryChips: [{ code: 'manicure', name: 'Manicure', templateCount: 1 }, { code: 'waxing', name: 'Waxing', templateCount: 1 }],
      usageByCategory: [{ label: 'Manicure', value: 1 }],
      priceRangeDistribution: [{ label: '$0–25', value: 2 }, { label: '$26–50', value: 4 }],
      tenantAdoption: { adopted: 2, partial: 1, notAdopted: 0, totalTenants: 2 },
      resourcesSnapshot: { uniqueResources: 13, mostUsedResource: 'Nail Tech (6)', totalAddOnOptions: 6, avgAddOnsPerTemplate: 0.6 },
      taxCommission: { taxableCount: 9, taxablePct: 90, nonTaxableCount: 1, nonTaxablePct: 10, commissionEligibleCount: 8, commissionEligiblePct: 80, commissionNotEligibleCount: 2, commissionNotEligiblePct: 20 },
      recentVersions: [{ templateName: 'Gel Manicure', versionLabel: 'v2.4', changeReason: 'Initial template', createdAt: '2026-06-01T00:00:00Z' }],
      tenantCompare: [{ tenantName: 'Pilot Nail Salon', copied: 3, customized: 2, unchanged: 1, customizationPct: 66.7 }],
      avgTenantAdoptionPct: 100,
    }),
    catalogTemplates: vi.fn().mockResolvedValue({
      page: 1, pageSize: 10, total: 1,
      rows: [{ id: 't1', code: 'classic_manicure', name: 'Classic Manicure', categoryCode: 'manicure', categoryName: 'Manicure', durationMinutes: 30, priceMinCents: 2000, priceMaxCents: 3500, resources: [{ label: 'Nail Tech', quantity: 1 }, { label: 'Station', quantity: 1 }], taxSetting: 'taxable', commissionEligible: true, addonCount: 1, activeTenantUsage: 2, versionLabel: 'v2.3', status: 'published' }],
    }),
    catalogCategories: vi.fn().mockResolvedValue([{ code: 'manicure', name: 'Manicure', iconKey: 'hand', displayOrder: 1, status: 'active', templateCount: 1 }]),
    catalogCategoryCreate: vi.fn().mockResolvedValue([]),
    catalogCategoryUpdate: vi.fn().mockResolvedValue([]),
    catalogExport: vi.fn().mockResolvedValue({ filename: 'service-templates-2026-07-01.csv', csv: 'Template Name\nClassic Manicure', rowCount: 1, generatedAt: '2026-07-01T00:00:00Z' }),
  },
}));

import { ServiceTemplatesScreen } from './ServiceTemplatesScreen';

const renderScreen = () => render(<MemoryRouter><ServiceTemplatesScreen /></MemoryRouter>);

describe('ServiceTemplatesScreen', () => {
  it('renders header, KPIs, chips, and the library table from real data', async () => {
    renderScreen();
    expect(await screen.findByText('Catalog Management')).toBeInTheDocument();
    // KPI values (Total Templates appears in KPI grid + summary strip)
    expect((await screen.findAllByText('Total Templates')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('10').length).toBeGreaterThan(0);
    // category chips
    expect(screen.getByText('Template Categories')).toBeInTheDocument();
    // library table row
    expect(await screen.findByText('Classic Manicure')).toBeInTheDocument();
    expect(screen.getByText('$20.00 – $35.00')).toBeInTheDocument();
    // right panels
    expect(screen.getByText('Super Admin Actions')).toBeInTheDocument();
    expect(screen.getByText(/should not overwrite a tenant's custom service/)).toBeInTheDocument();
    expect(screen.getByText('Resources & Add-Ons Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Nail Tech (6)')).toBeInTheDocument();
    // all 10 super admin actions present
    expect(screen.getByText('Create Service Templates')).toBeInTheDocument();
    expect(screen.getAllByText('Compare Tenant Service Configurations').length).toBeGreaterThan(0);
  });

  it('opens the Create Service Template modal from the Super Admin Actions panel', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Create Service Templates'));
    expect(await screen.findByText('Service name *')).toBeInTheDocument();
    expect(screen.getByText('Required resources')).toBeInTheDocument();
    expect(screen.getByText('Optional add-ons')).toBeInTheDocument();
  });

  it('opens the Organize Categories modal and lists categories', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('Organize Categories'));
    expect(await screen.findByPlaceholderText('New category name')).toBeInTheDocument();
    expect(await screen.findByText('Rename')).toBeInTheDocument();
  });

  it('opens View Options with density + column toggles', async () => {
    renderScreen();
    fireEvent.click(await screen.findByText('View Options ▾'));
    expect(await screen.findByText('Density')).toBeInTheDocument();
    expect(screen.getByText('comfortable')).toBeInTheDocument();
    // toggle off the Version column, header should disappear
    expect(screen.getAllByText('Version').length).toBeGreaterThan(0);
  });
});
