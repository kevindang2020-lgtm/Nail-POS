import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSServicesScreen } from './POSServicesScreen';

const servicesState = {
  kpisFull: { totalServices: 5, activeServices: 4, inactiveServices: 1, categoriesCount: 2, addOnsCount: 3, servicesMissingDuration: 0, servicesMissingPrice: 0, servicesWithoutTechMapping: 1, topServiceRevenueCents: 9000 },
  rows: { items: [{ serviceId: 's1', categoryId: 'c1', categoryName: 'Manicures', name: 'Classic Mani', basePriceCents: 3500, durationMinutes: 30, isActive: true, isTaxable: true, bookingEnabled: true, checkoutEnabled: true, onlineBookingEnabled: false, aiBookingEnabled: false, addOnsCount: 0 }], pagination: { totalItems: 1 } },
  filterFacets: { categories: [{ categoryId: 'c1', name: 'Manicures' }], statuses: ['active', 'inactive'], taxableOptions: [], durationRanges: [], priceRanges: [], technicianSkillGroups: [] },
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSServicesScreen', () => {
  it('renders the Services & Products dashboard with all reference modules', async () => {
    globalThis.fetch = mockFetch(servicesState) as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    expect(await screen.findByText('Services & Products')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Add New' })).toBeInTheDocument();
    expect(screen.getAllByText('Classic Mani').length).toBeGreaterThanOrEqual(1);
    // KPI labels (reference)
    expect(screen.getByText('Total Services')).toBeInTheDocument();
    expect(screen.getAllByText('Online Bookable').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Avg. Service Price')).toBeInTheDocument();
    // cards (reference)
    expect(screen.getByText('Service Menu')).toBeInTheDocument();
    expect(screen.getByText(/Retail Product Catalog/)).toBeInTheDocument();
    expect(screen.getByText('Bundles / Packages / Membership Add-ons')).toBeInTheDocument();
    expect(screen.getByText('AI Pricing & Menu Insights')).toBeInTheDocument();
    expect(screen.getByText(/Inventory Alerts/)).toBeInTheDocument();
    expect(screen.getByText('Service / Product Detail')).toBeInTheDocument();
    expect(screen.getByText('Top Services & Product Mix')).toBeInTheDocument();
    expect(screen.getByText('Service Mix by Revenue')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });

  it('exposes inline Add category in the Add New Service panel', async () => {
    globalThis.fetch = mockFetch(servicesState) as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    await screen.findByText('Services & Products');
    fireEvent.click(screen.getByRole('button', { name: '+ Add New' }));
    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New category name')).toBeInTheDocument();
  });

  it('shows an empty state when there are no services', async () => {
    globalThis.fetch = mockFetch({ ...servicesState, rows: { items: [], pagination: { totalItems: 0 } } }) as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    expect(await screen.findByText('No services match.')).toBeInTheDocument();
  });
});

// ── 2026-07-03 the Service Menu edit row now exposes Archive (active) / Reactivate (archived), wired to the dedicated
// lifecycle endpoints POST /pos/services/:id/archive and /reactivate. Previously the archive endpoint existed in the
// client but no control invoked it — a service could only be toggled active/inactive via the status field.
const recordFetch = (state: any) => {
  const calls: { url: string; method: string }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), method: init?.method || 'GET' });
    return { ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any;
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSServicesScreen — service lifecycle (archive/reactivate)', () => {
  it('Edit → Archive posts to the archive endpoint', async () => {
    const f = recordFetch(servicesState); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    await screen.findByText('Services & Products');
    // open the edit row for the active service, then click Archive
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive service' }));
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/services/s1/archive') && c.method === 'POST')).toBe(true);
    });
  });

  it('an archived service offers Reactivate instead, posting to reactivate', async () => {
    const archivedState = { ...servicesState, rows: { items: [{ ...servicesState.rows.items[0], isActive: false }], pagination: { totalItems: 1 } } };
    const f = recordFetch(archivedState); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    await screen.findByText('Services & Products');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/services/s1/reactivate') && c.method === 'POST')).toBe(true);
    });
  });

  it('the data-quality filter refetches with the backend-supported missingMapping param', async () => {
    const f = recordFetch(servicesState); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    await screen.findByText('Services & Products');
    const dq = screen.getByTitle('Find catalog gaps that block booking or checkout');
    fireEvent.change(dq, { target: { value: 'missingMapping' } });
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/services/state') && c.url.includes('missingMapping=1'))).toBe(true);
    });
  });

  it('lists qualified technicians with live availability for the selected service', async () => {
    const qualified = [
      { technicianId: 't1', displayName: 'Ava Chen', workingStatus: 'available', shiftStatus: 'on_shift', status: 'active' },
      { technicianId: 't2', displayName: 'Ben Ortiz', workingStatus: 'on_break', shiftStatus: 'on_shift', status: 'active' },
      { technicianId: 't3', displayName: 'Cara Diaz', workingStatus: 'off_today', shiftStatus: 'clocked_out', status: 'active' },
    ];
    globalThis.fetch = vi.fn(async (url: any) => {
      const body = String(url).includes('/pos/technicians/qualified') ? qualified : servicesState;
      return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSServicesScreen /></MemoryRouter>);
    await screen.findByText('Services & Products');
    // the detail panel auto-selects the first service → the qualified panel loads for it
    expect(await screen.findByText('Ava Chen')).toBeInTheDocument();
    expect(screen.getByText('Ben Ortiz')).toBeInTheDocument();
    expect(screen.getByText('Cara Diaz')).toBeInTheDocument();
    expect(screen.getByText('1 available now')).toBeInTheDocument(); // only Ava is 'available'
    expect(screen.getByText('off shift')).toBeInTheDocument();       // Cara is clocked out
  });
});
