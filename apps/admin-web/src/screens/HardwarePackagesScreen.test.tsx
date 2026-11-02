// Hardware Packages QA: the screen renders the 8 KPIs, a package row, the selected detail panel (devices + shipment
// stepper), Packages-by-Status, and recent activity from the mocked state hook; shows the empty state; opens Assign Package.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useHw = vi.fn();
vi.mock('../api/superAdminHardwarePackagesApi', () => ({
  useSuperAdminHardwareState: () => useHw(),
  hwApi: { detail: vi.fn(() => Promise.resolve(null)), downloadCsv: vi.fn(), create: vi.fn(), setStatus: vi.fn(), updateTracking: vi.fn(), cancel: vi.fn(), returnPkg: vi.fn(), listTenants: vi.fn(() => Promise.resolve([])) },
}));

import { HardwarePackagesScreen } from './HardwarePackagesScreen';

const pkg = (o: any = {}) => ({ id: 'p2', tenantId: 't2', salonName: 'Diamond Nail Bar', salonCode: 'SAL-1002', ownerName: 'Sophia Martinez', city: 'Miami', state: 'FL', packageName: 'Pro Package', packageType: 'pro', status: 'delivered', paymentStatus: 'paid', hardwareCostCents: 500000, depositCents: 0, amountPaidCents: 500000, financingTerms: null, shippingAddress: null, shippingCity: null, shippingState: null, shippingZip: null, shippingCarrier: 'ups', trackingNumber: '1Z999AA10123456784', trackingUrl: null, orderedAt: '2026-05-01T00:00:00Z', shippedAt: '2026-05-03T00:00:00Z', deliveredAt: '2026-05-08T00:00:00Z', installedAt: null, completedAt: null, cancelledAt: null, returnedAt: null, deviceCount: 3, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-08T09:41:00Z', ...o });

const stateValue = (over: any = {}) => ({
  state: {
    summary: { totalPackages: 1892, notOrdered: 112, readyToShip: 197, shipped: 382, delivered: 1126, installedComplete: 1009, pendingPayment: 141, paidOff: 1751, trends: { totalPackages: 15.6, notOrdered: -8.2, readyToShip: 11.3, shipped: 18.7, delivered: 20.2, installedComplete: 17.4, pendingPayment: -6.7, paidOff: 16.9 } },
    filters: {}, packages: [pkg()], pagination: { page: 1, limit: 10, totalItems: 1892, totalPages: 237 },
    packagesByStatus: [{ status: 'not_ordered', count: 112, pct: 5.9 }, { status: 'ready_to_ship', count: 197, pct: 10.4 }, { status: 'shipped', count: 382, pct: 20.2 }, { status: 'delivered', count: 1126, pct: 59.4 }, { status: 'installed_complete', count: 1009, pct: 53.3 }],
    topPackageTypes: [{ type: 'pro_plus', count: 742, pct: 39.2 }, { type: 'pro', count: 681, pct: 36 }, { type: 'standard', count: 469, pct: 24.8 }],
    recentHardwareActivity: [{ id: 'a1', actionType: 'hardware_package_status_changed', packageId: 'p2', salonName: 'Diamond Nail Bar', createdAt: '2026-06-17T00:00:00Z' }],
    recentHardwareEvents: [{ id: 'e1', actionType: 'hardware_package_status_changed', packageId: 'p2', salonName: 'Diamond Nail Bar', createdAt: '2026-06-17T00:00:00Z' }],
    selectedPackage: { package: pkg(), devices: [{ deviceType: 'imac', deviceName: '24" iMac (M4)', serialNumber: null, quantity: 1 }, { deviceType: 'clover_flex', deviceName: 'Clover Flex Card Reader', serialNumber: null, quantity: 1 }, { deviceType: 'checkin_display', deviceName: 'Customer Check-In Display', serialNumber: null, quantity: 1 }], notes: [], normalizedStatus: 'delivered' },
    permissions: { view: true, assign: true }, reference: { statuses: [], paymentStatuses: [], carriers: [], packageTypes: [] },
  },
  loading: false, error: null, reload: vi.fn(), ...over,
});

describe('Super-Admin Hardware Packages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders KPIs, a package row, the detail panel, status chart, and activity', () => {
    useHw.mockReturnValue(stateValue());
    render(<MemoryRouter><HardwarePackagesScreen /></MemoryRouter>);
    expect(screen.getAllByText('1,892').length).toBeGreaterThan(0);       // Total Packages (KPI + donut + pager)
    expect(screen.getByText('1,751')).toBeInTheDocument();              // Paid Off KPI
    expect(screen.getAllByText('Diamond Nail Bar').length).toBeGreaterThan(0); // table + detail + activity
    expect(screen.getByText('Sophia Martinez')).toBeInTheDocument();
    expect(screen.getAllByText('SAL-1002').length).toBeGreaterThan(0);
    expect(screen.getByText('Packages by Status')).toBeInTheDocument();
    expect(screen.getByText('Top Package Types')).toBeInTheDocument();
    expect(screen.getByText('Customer Check-In Display')).toBeInTheDocument(); // detail panel devices
    expect(screen.getByText('Shipment Progress')).toBeInTheDocument();
  });

  it('shows the empty state when there are no packages', () => {
    useHw.mockReturnValue(stateValue({ state: { ...stateValue().state, packages: [], selectedPackage: null, pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 1 } } }));
    render(<MemoryRouter><HardwarePackagesScreen /></MemoryRouter>);
    expect(screen.getByText('No hardware packages yet.')).toBeInTheDocument();
  });

  it('opens the Assign Package modal', () => {
    useHw.mockReturnValue(stateValue());
    render(<MemoryRouter><HardwarePackagesScreen /></MemoryRouter>);
    fireEvent.click(screen.getByText('+ Assign Package'));
    expect(screen.getByText('Assign Hardware Package')).toBeInTheDocument();
  });

  it('opens the Edit Package modal from the row action menu', () => {
    useHw.mockReturnValue(stateValue());
    render(<MemoryRouter><HardwarePackagesScreen /></MemoryRouter>);
    fireEvent.click(screen.getByText('⋮'));            // open the row kebab
    fireEvent.click(screen.getByText('Edit Package'));
    expect(screen.getByText('Edit Hardware Package')).toBeInTheDocument();
    expect(screen.getByText('Save Changes')).toBeInTheDocument(); // edit modal (distinct from Assign)
  });
});
