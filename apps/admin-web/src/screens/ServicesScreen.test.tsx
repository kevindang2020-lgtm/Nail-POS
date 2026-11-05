import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    platformServices: vi.fn().mockResolvedValue({
      rows: [
        { id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4000, commissionType: 'percentage', commissionValue: 15, onlineBooking: true, status: 'active', tenantId: 't1', tenantName: 'Pilot Nail Salon', category: 'Manicures' },
        { id: 's2', name: 'Spa Pedicure', durationMinutes: 75, priceCents: 6000, commissionType: 'percentage', commissionValue: 15, onlineBooking: true, status: 'active', tenantId: 't1', tenantName: 'Pilot Nail Salon', category: 'Pedicures' },
      ],
      total: 2,
      kpis: { totalServices: 6, activeServices: 6, categories: 3, avgPriceCents: 5250, avgDurationMinutes: 58, onlineBookable: 6, bookingsThisMonth: 4, revenueCentsThisMonth: 19500, bookingsTotal: 4, revenueCentsTotal: 19500, avgRating: 0, reviewCount: 0 },
      byCategory: [{ category: 'Manicures', count: 2 }, { category: 'Pedicures', count: 2 }, { category: 'Enhancements', count: 2 }],
      byStatus: [{ status: 'active', count: 6 }],
      catalogHealth: { active: 6, inactive: 0, needsUpdate: 6, missingInfo: 0 },
      monthly: [{ month: 'Jun', bookings: 4, revenueCents: 19500 }],
      topServices: [{ name: 'Full Set Acrylic', bookings: 1, revenueCents: 6500 }, { name: 'Gel-X Extensions', bookings: 0, revenueCents: 0 }],
      lowServices: [{ name: 'Gel-X Extensions', bookings: 0, revenueCents: 0 }, { name: 'Gel Manicure', bookings: 0, revenueCents: 0 }],
      recentActivity: [{ name: 'Classic Manicure', action: 'created', at: '2026-06-20T10:00:00Z', tenantName: 'Pilot Nail Salon' }],
      packages: [],
      pricing: { avgCents: 5250, highestCents: 6500, highestName: 'Full Set Acrylic', lowestCents: 4000, lowestName: 'Gel Manicure' },
      healthPct: 92.6,
      topByRevenue: [{ name: 'Full Set Acrylic', bookings: 1, revenueCents: 6500 }, { name: 'Spa Pedicure', bookings: 2, revenueCents: 12000 }],
      staffAvailability: [{ name: 'Samantha Green', tenantName: 'Pilot Nail Salon', servicesOffered: 24, utilizationPct: null }],
    }),
    platformServiceCategories: vi.fn().mockResolvedValue({
      rows: [
        { normalizedName: 'manicures', name: 'Manicures', tenantCount: 3, categoryCount: 3, activeCount: 3, serviceCount: 22 },
        { normalizedName: 'pedicures', name: 'Pedicures', tenantCount: 1, categoryCount: 1, activeCount: 1, serviceCount: 8 },
      ],
      total: 2,
      kpis: { totalCategories: 4, distinctNames: 2, activeCategories: 4, tenantsCovered: 3, uncategorizedServices: 1 },
      duplicates: [{ id: 'manicures', normalizedName: 'manicures', displayName: 'Manicures', tenantCount: 3, totalProducts: 22, members: [{ tenantName: 'Pilot Nail Salon', name: 'Manicures', products: 10 }, { tenantName: 'Westside Spa', name: 'Manicures', products: 12 }] }],
    }),
    supportSessions: vi.fn().mockResolvedValue([
      { id: 'sess-1', tenant_id: 't1-uuid-aaaa-bbbb', reason: 'taxonomy cleanup', expires_at: new Date(Date.now() + 3600_000).toISOString(), ended_at: null },
    ]),
    tenantServiceCategories: vi.fn().mockResolvedValue({
      tenantName: 'Pilot Nail Salon',
      categories: [
        { id: 'c-mani', name: 'Manicures', status: 'active', serviceCount: 6 },
        { id: 'c-mani-dup', name: 'Manicure', status: 'active', serviceCount: 2 },
        { id: 'c-ped', name: 'Pedicures', status: 'active', serviceCount: 4 },
      ],
    }),
    mergeServiceCategories: vi.fn().mockResolvedValue({ ok: true, mergeLogId: 'mlog-1', sourceCategoryId: 'c-mani-dup', targetCategoryId: 'c-mani', reattributedServiceCount: 2 }),
  },
}));

import { ServicesScreen } from './ServicesScreen';

describe('ServicesScreen (S06)', () => {
  it('renders every mockup module wired to real data, with honest empties where there is no source', async () => {
    render(<MemoryRouter><ServicesScreen /></MemoryRouter>);
    expect(await screen.findByText('Services Management')).toBeInTheDocument();
    // KPI strip
    expect(screen.getByText('Total Services')).toBeInTheDocument();
    expect(screen.getByText('Bookings (This Month)')).toBeInTheDocument();
    // performance + donut + health gauge
    expect(screen.getByText('Service Performance Overview')).toBeInTheDocument();
    expect(screen.getByText('Services by Category')).toBeInTheDocument();
    expect(screen.getByText('Service Catalog Health')).toBeInTheDocument();
    // catalog table (real rows)
    expect(screen.getAllByText('Gel Manicure').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Spa Pedicure').length).toBeGreaterThanOrEqual(1);
    // top/low/recent + AI insight honest gap
    expect(screen.getByText('Top Selling Services')).toBeInTheDocument();
    expect(screen.getByText('Low Performing Services')).toBeInTheDocument();
    expect(screen.getByText('Recent Service Activity')).toBeInTheDocument();
    expect(screen.getByText('AI Service Insights')).toBeInTheDocument();
    expect(screen.getByText('Service Packages & Add-ons')).toBeInTheDocument();
    expect(screen.getAllByText('Full Set Acrylic').length).toBeGreaterThanOrEqual(1);
    // new wired modules (global services management)
    expect(screen.getByText(/Manage global service templates/i)).toBeInTheDocument();
    expect(screen.getByText('Pricing Overview')).toBeInTheDocument();
    expect(screen.getByText('Highest Price')).toBeInTheDocument();
    expect(screen.getByText('Staff Service Availability')).toBeInTheDocument();
    expect(screen.getByText('Samantha Green')).toBeInTheDocument();
    expect(screen.getByText('Top Services by Revenue')).toBeInTheDocument();
    // the nine global quick actions
    ['Add New Service', 'Manage Categories', 'Create Package', 'Add Add-On', 'Pricing Rules', 'Service Calendar', 'Bulk Import Services', 'View Reports', 'Export Services'].forEach((l) => expect(screen.getAllByText(l).length).toBeGreaterThanOrEqual(1));
    // honest empties / not-connected
    expect(screen.getAllByText(/not connected/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows an honest notice when an unbuilt global-template quick action is used, and routes the real ones', async () => {
    const { findByText, getByText, queryByText } = render(<MemoryRouter><ServicesScreen /></MemoryRouter>);
    await findByText('Services Management');
    fireEvent.click(getByText('Create Package'));
    expect(getByText(/isn’t built yet/i)).toBeInTheDocument();
    fireEvent.click(getByText('Dismiss'));
    expect(queryByText(/isn’t built yet/i)).not.toBeInTheDocument();
  });

  it('opens the Service Categories oversight modal with grouped rows, cross-tenant duplicates, and the override-safe note (§25)', async () => {
    const { findByText, getByText, findByRole } = render(<MemoryRouter><ServicesScreen /></MemoryRouter>);
    await findByText('Services Management');
    fireEvent.click(getByText('Manage Categories'));
    expect(await findByRole('dialog', { name: /service categories/i })).toBeInTheDocument();
    expect(getByText('Cross-tenant duplicates')).toBeInTheDocument();
    expect(getByText('Uncategorized services')).toBeInTheDocument();
    expect(getByText(/never overwrite a tenant’s local taxonomy/i)).toBeInTheDocument();
  });

  it('runs the same-tenant category merge through an active support session, gated and audited (§25 mutation tier)', async () => {
    const { findByText, getByText, findByRole, getByRole } = render(<MemoryRouter><ServicesScreen /></MemoryRouter>);
    await findByText('Services Management');
    fireEvent.click(getByText('Manage Categories'));
    await findByRole('dialog', { name: /service categories/i });
    fireEvent.click(getByText('Merge duplicates…'));
    const dialog = await findByRole('dialog', { name: /merge service categories/i });
    // merge disabled until session + source + target + reason
    const mergeBtn = getByText('Merge categories') as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);
    // pick the active session → tenant categories load
    const selects = dialog.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'sess-1' } });
    expect(await findByText('Pilot Nail Salon')).toBeInTheDocument();
    const after = dialog.querySelectorAll('select');
    fireEvent.change(after[1], { target: { value: 'c-mani-dup' } }); // source
    fireEvent.change(after[2], { target: { value: 'c-mani' } });     // target
    fireEvent.change(dialog.querySelector('input') as HTMLInputElement, { target: { value: 'consolidating duplicate category' } });
    expect((getByText('Merge categories') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByText('Merge categories'));
    expect(await findByText(/Service categories merged/i)).toBeInTheDocument();
  });
});
