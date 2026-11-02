import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const auth: any = { principal: null };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/customerApi', () => ({ customerApi: { deals: vi.fn(), dealsNearby: vi.fn().mockResolvedValue([]), dealDetail: vi.fn(), dealEstimate: vi.fn(), saveDeal: vi.fn(), unsaveDeal: vi.fn(), savedDeals: vi.fn().mockResolvedValue([]), couponWallet: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { DealsScreen } from './DealsScreen';
import { DealDetailScreen, termsLines } from './DealDetailScreen';

describe('DealsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); auth.principal = null; (customerApi.dealsNearby as any).mockResolvedValue([]); (customerApi.savedDeals as any).mockResolvedValue([]); });
  it('lists the salon’s active deals (from the one deals domain)', async () => {
    (customerApi.deals as any).mockResolvedValue([{ id: 'd1', title: '20% off gel', description: 'This month only', code: null, startsAt: null, endsAt: '2026-12-31T00:00:00Z', requiresCode: true }]);
    render(<MemoryRouter><DealsScreen /></MemoryRouter>);
    expect(await screen.findByText('20% off gel')).toBeInTheDocument();
    expect(screen.getByText('Coupon — use your code at checkout')).toBeInTheDocument();
  });
  it('shows an honest empty state when there are no deals', async () => {
    (customerApi.deals as any).mockResolvedValue([]);
    render(<MemoryRouter><DealsScreen /></MemoryRouter>);
    expect(await screen.findByText('No active deals right now')).toBeInTheDocument();
  });
  it('nearby deals are filtered on the server (search, type, max price)', async () => {
    (customerApi.deals as any).mockResolvedValue([]);
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok: any, fail: any) => fail({}) }, configurable: true });
    render(<MemoryRouter><DealsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'Nearby' }));
    fireEvent.change(await screen.findByLabelText('Deal type'), { target: { value: 'technician' } });
    fireEvent.change(screen.getByLabelText('Max price'), { target: { value: '40' } });
    await waitFor(() => expect(customerApi.dealsNearby).toHaveBeenLastCalledWith(expect.objectContaining({ ownerType: 'technician', maxPriceCents: 4000 })));
  });
  it('signed in: My coupons shows a wallet coupon and its QR (a reference, never a code)', async () => {
    auth.principal = { userId: 'u1' };
    (customerApi.deals as any).mockResolvedValue([]);
    (customerApi.couponWallet as any).mockResolvedValue([{ id: '0b5c6a3e-1111-4222-8333-444455556666', dealId: 'd', title: 'Welcome back $10', description: null, terms: 'One visit', codeHint: 'AB12', status: 'active', usable: true, expiresAt: null, qr: 'APS-CPN:0b5c6a3e-1111-4222-8333-444455556666', discountType: 'fixed', discountPercent: null, discountCents: 1000 }]);
    render(<MemoryRouter><DealsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'My coupons' }));
    expect(await screen.findByTestId('coupon-wallet')).toHaveTextContent('Welcome back $10');
    fireEvent.click(screen.getByText('Show at checkout'));
    expect(screen.getByTestId('qr-0b5c6a3e-1111-4222-8333-444455556666')).toBeInTheDocument();
  });
});

describe('DealDetailScreen', () => {
  const detail = { id: 'd1', tenantId: 't', branchId: 'b', kind: 'deal', title: 'Weekday Gel', shortDescription: 'Gel for less', terms: 'Not with other offers.', imageUrl: null, ownerType: 'salon', technicianName: null, salonName: 'Luxe', branchName: 'Main', address: null,
    discountType: 'percent', discountPercent: 20, discountCents: null, originalPriceCents: 5000, finalPriceCents: 4000, savingsCents: 1000, startsAt: null, endsAt: '2026-12-31T00:00:00Z', newCustomersOnly: true, memberOnly: false,
    maxPerCustomer: 1, minSpendCents: null, daysOfWeek: [1, 2], validFromMinute: 600, validToMinute: 840, bookingLeadMinutes: 120, serviceIds: ['s1'], status: 'active', saved: false };
  beforeEach(() => { vi.clearAllMocks(); auth.principal = null; });
  it('a guest sees the full terms and what they would pay (from the server engine)', async () => {
    (customerApi.dealDetail as any).mockResolvedValue(detail);
    (customerApi.dealEstimate as any).mockResolvedValue({ eligible: true, reasons: [], subtotalCents: 5000, discountCents: 1000, totalCents: 4000, lines: [] });
    render(<MemoryRouter initialEntries={['/deals/d1']}><Routes><Route path="/deals/:id" element={<DealDetailScreen />} /></Routes></MemoryRouter>);
    const terms = await screen.findByTestId('deal-terms');
    expect(terms).toHaveTextContent('On Mon, Tue.');
    expect(terms).toHaveTextContent('Between 10:00 AM and 2:00 PM.');
    expect(terms).toHaveTextContent('For new customers only.');
    expect(terms).toHaveTextContent('One per customer.');
    expect(terms).toHaveTextContent('Not with other offers.');
    expect(await screen.findByTestId('deal-estimate')).toHaveTextContent('$50.00 − $10.00 = $40.00');
    expect(customerApi.dealDetail).toHaveBeenCalledWith('d1', false);   // the public page for a guest
  });
  it('the estimate says why it would not apply', async () => {
    (customerApi.dealDetail as any).mockResolvedValue(detail);
    (customerApi.dealEstimate as any).mockResolvedValue({ eligible: false, reasons: [{ code: 'new_customers_only', message: 'For new customers only.' }], subtotalCents: 5000, discountCents: 0, totalCents: 5000, lines: [] });
    render(<MemoryRouter initialEntries={['/deals/d1']}><Routes><Route path="/deals/:id" element={<DealDetailScreen />} /></Routes></MemoryRouter>);
    expect(await screen.findByTestId('deal-estimate')).toHaveTextContent('Not available to you yet: For new customers only.');
  });
  it('termsLines covers lead time and the technician', () => {
    expect(termsLines({ ...detail, ownerType: 'technician', technicianName: 'Ana' } as any)).toEqual(expect.arrayContaining(['Book at least 2 hour(s) ahead.', 'Valid only with Ana.']));
  });
});
