// MyDealsScreen.test.tsx — BUILD_PLAN Phase 5 in the technician app: deals are priced from the technician's own
// services at the catalog price (bug 8 — no typed-in "original price"), percentages are whole numbers (bug 21), and a
// salon/plan/platform switch-off reads as an honest "off".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api: Record<string, any> = { settings: vi.fn(), myDeals: vi.fn(), services: vi.fn(), create: vi.fn(), submit: vi.fn(), pause: vi.fn() };
vi.mock('../api/techDealsApi', () => ({ techDealsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
vi.mock('../shell/nav', () => ({ useTechNav: () => ({ back: vi.fn() }) }));
import { MyDealsScreen } from './MyDealsScreen';

const settings = (over: any = {}) => ({ allowTechnicianDeals: 'on_with_approval', maxDiscountPercent: 30, maxFixedDiscountCents: null, minServicePriceCents: null, maxActiveDealsPerTech: null, ...over });
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.settings.mockResolvedValue(settings());
  api.myDeals.mockResolvedValue([{ id: 'd1', title: 'Gel week', discountType: 'percent', discountPercent: 15, discountCents: null, originalPriceCents: 5000, finalPriceCents: 4250, savingsCents: 750, status: 'pending_approval', redemptionCount: 0, createdAt: '2026-10-01' }]);
  api.services.mockResolvedValue([{ id: 's1', name: 'Gel', priceCents: 5000 }, { id: 's2', name: 'Pedi', priceCents: 3000 }]);
});

describe('My Deals', () => {
  it('creates a deal from the technician’s own services; no price is typed in', async () => {
    api.create.mockResolvedValue({});
    render(<MyDealsScreen />);
    expect(await screen.findByText('Gel week')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+ Create Deal'));
    expect(screen.queryByText(/Original price/)).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('My gel special'), { target: { value: 'Weekday gel' } });
    fireEvent.click(screen.getByLabelText('Gel'));
    fireEvent.change(screen.getByLabelText('Discount (%)'), { target: { value: '20' } });
    expect(screen.getByTestId('tech-deal-estimate')).toHaveTextContent('$50.00 → about $40.00');
    fireEvent.click(screen.getByText('Submit deal'));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ title: 'Weekday gel', discountType: 'percent', discountPercent: 20, serviceIds: ['s1'] }));
  });

  it('a fractional percentage is refused before it is sent', async () => {
    render(<MyDealsScreen />);
    fireEvent.click(await screen.findByText('+ Create Deal'));
    fireEvent.change(screen.getByPlaceholderText('My gel special'), { target: { value: 'Odd' } });
    fireEvent.click(screen.getByLabelText('Gel'));
    fireEvent.change(screen.getByLabelText('Discount (%)'), { target: { value: '12.5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('whole percentage');
    expect(screen.getByText('Submit deal')).toBeDisabled();
  });

  it('without assigned services it says so and cannot submit', async () => {
    api.services.mockResolvedValue([]);
    render(<MyDealsScreen />);
    fireEvent.click(await screen.findByText('+ Create Deal'));
    expect(screen.getByText(/No services are assigned to you yet/)).toBeInTheDocument();
    expect(screen.getByText('Submit deal')).toBeDisabled();
  });

  it('switched off shows the honest off state and loads nothing else', async () => {
    api.settings.mockResolvedValue(settings({ allowTechnicianDeals: 'off' }));
    render(<MyDealsScreen />);
    expect(await screen.findByText('Technician deals are turned off')).toBeInTheDocument();
    expect(api.myDeals).not.toHaveBeenCalled();
    expect(screen.queryByText('+ Create Deal')).toBeNull();
  });

  it('a server refusal is shown', async () => {
    api.create.mockRejectedValue(new Error('You can only discount services you perform.'));
    render(<MyDealsScreen />);
    fireEvent.click(await screen.findByText('+ Create Deal'));
    fireEvent.change(screen.getByPlaceholderText('My gel special'), { target: { value: 'X' } });
    fireEvent.click(screen.getByLabelText('Pedi'));
    fireEvent.change(screen.getByLabelText('Discount (%)'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Submit deal'));
    expect(await screen.findByText('You can only discount services you perform.')).toBeInTheDocument();
  });
});
