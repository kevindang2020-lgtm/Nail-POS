// DealsOversightScreen.test.tsx — BUILD_PLAN Phase 5: Super Admin oversight of deals across salons. Suspending needs a
// real reason (bug 17: it used to be a silent status flip), the per-salon switch needs a reason, and the live-deal limit
// can be set or cleared.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api: Record<string, any> = { overview: vi.fn(), list: vi.fn(), tenants: vi.fn(), suspend: vi.fn(), setTenant: vi.fn() };
vi.mock('../api/superAdminDealsApi', () => ({ superAdminDealsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
import { DealsOversightScreen } from './DealsOversightScreen';

const overview = { totalDeals: 9, active: 4, pendingApproval: 1, suspended: 1, totalRedemptions: 12, totalDiscountedCents: 12345, discountedLast30DaysCents: 5000, reversedRedemptions: 2, openApplications: 3, tenantsWithDeals: 2, coupons: 3, automatic: 1, tenantsSwitchedOff: 0 };
const row = (over: any = {}) => ({ id: 'd1', tenantId: 'aaaaaaaa-1111', salonName: 'Pilot Nails', title: 'Spring Gel', ownerType: 'salon', kind: 'deal', status: 'active', redemptionCount: 3, createdAt: null, suspendedReason: null, suspendedAt: null,
  discountType: 'percent', discountPercent: 20, discountCents: null, maxRedemptions: 10, budgetCents: 5000, budgetReservedCents: 1500, endsAt: null, ...over });
const tenant = (over: any = {}) => ({ tenantId: 'aaaaaaaa-1111', salonName: 'Pilot Nails', platformDisabled: false, platformDisabledReason: null, platformMaxActiveDeals: 5, dealsEnabled: true, stackingPolicy: 'best_single', activeDeals: 4, discountedLast30DaysCents: 5000, ...over });

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.overview.mockResolvedValue(overview);
  api.list.mockResolvedValue([row(), row({ id: 'd2', title: 'Old', status: 'expired' }), row({ id: 'd3', title: 'Pulled', suspendedAt: '2026-10-01', suspendedReason: 'Misleading terms on the card', status: 'canceled' })]);
  api.tenants.mockResolvedValue([tenant()]);
});

describe('Deals Oversight', () => {
  it('shows the marketplace totals, every deal with cap and budget, and why a suspended deal was pulled', async () => {
    render(<DealsOversightScreen />);
    expect(await screen.findByText('$123.45')).toBeInTheDocument();
    const rows = await screen.findAllByTestId('oversight-deal');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('3 / 10');
    expect(rows[0]).toHaveTextContent('$15.00 / $50.00');
    expect(rows[2]).toHaveTextContent('Suspended: Misleading terms on the card');
    // only live deals can be suspended
    expect(screen.getAllByText('Suspend…')).toHaveLength(1);
  });

  it('filters go to the server', async () => {
    render(<DealsOversightScreen />);
    await screen.findAllByTestId('oversight-deal');
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'coupon' } });
    fireEvent.click(screen.getByLabelText('Suspended only'));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ kind: 'coupon', suspended: true }));
  });

  it('suspending needs a reason of at least 12 characters, then reports what was given back', async () => {
    api.suspend.mockResolvedValue({ suspended: true, releasedPlaces: 2, releasedApplications: 1 });
    render(<DealsOversightScreen />);
    fireEvent.click(await screen.findByText('Suspend…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'too short' } });
    fireEvent.click(screen.getByText('Suspend deal'));
    expect(screen.getByText('Enter at least 12 characters.')).toBeInTheDocument();
    expect(api.suspend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Advertised price is not the catalog price' } });
    fireEvent.click(screen.getByText('Suspend deal'));
    await waitFor(() => expect(api.suspend).toHaveBeenCalledWith('d1', 'Advertised price is not the catalog price'));
    expect(await screen.findByRole('status')).toHaveTextContent('2 booked place(s) and 1 unpaid ticket(s)');
  });

  it('a salon can be switched off with a reason; the live-deal limit can be set and cleared', async () => {
    api.setTenant.mockResolvedValue(tenant());
    render(<DealsOversightScreen />);
    fireEvent.click(await screen.findByText('Switch off…'));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Chargebacks on discounted tickets' } });
    fireEvent.click(screen.getByText('Switch off'));
    await waitFor(() => expect(api.setTenant).toHaveBeenCalledWith('aaaaaaaa-1111', { disabled: true, reason: 'Chargebacks on discounted tickets' }));

    fireEvent.click(await screen.findByText('Limit…'));
    expect(screen.getByLabelText('Limit')).toHaveValue('5');
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.setTenant).toHaveBeenLastCalledWith('aaaaaaaa-1111', { maxActiveDeals: null }));

    fireEvent.click(await screen.findByText('Limit…'));
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '2.5' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByRole('status')).toHaveTextContent('whole number');
    expect(api.setTenant).toHaveBeenCalledTimes(2);
  });

  it('a platform-disabled salon shows the reason and offers "Switch on…"', async () => {
    api.tenants.mockResolvedValue([tenant({ platformDisabled: true, platformDisabledReason: 'Under review' })]);
    render(<DealsOversightScreen />);
    expect(await screen.findByText(/Off by platform — Under review/)).toBeInTheDocument();
    expect(screen.getByText('Switch on…')).toBeInTheDocument();
  });

  it('a failed load says so instead of showing an empty marketplace', async () => {
    api.overview.mockRejectedValue(new Error('500'));
    api.list.mockRejectedValue(new Error('500'));
    render(<DealsOversightScreen />);
    expect(await screen.findByText('Could not load the overview.')).toBeInTheDocument();
    expect(await screen.findByText('Could not load deals.')).toBeInTheDocument();
  });
});
