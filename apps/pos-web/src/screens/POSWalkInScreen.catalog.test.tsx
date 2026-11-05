// POSWalkInScreen.catalog.test.tsx — the Walk-In and New Booking screens after the Oct 1 service rule (unknown service
// ids refused; a changed price needs the checkout override permission and a reason):
//   • only the salon's real catalog is offered — never the old demo list or demo add-ons (the server refuses their ids);
//   • "Edit price" is shown only to staff who may override prices, and an override needs a typed reason.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let perms: string[] | undefined;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'FRONT_DESK', permissions: perms } }) }));
const state = vi.fn();
vi.mock('../api/posBookingApi', () => ({ posBookingApi: { state: (...a: any[]) => state(...a), technicians: vi.fn(async () => ({ date: '', technicians: [], total: 0, totalAll: 0, workingCount: 0, page: 1, pageSize: 12, totalPages: 1 })) } }));
vi.mock('../api/posCheckInApi', () => ({ posCheckInApi: { walkIn: vi.fn(), createCustomer: vi.fn(), waitEstimate: vi.fn(async () => ({ configured: true, quotedWaitMinutes: 20 })) } }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: vi.fn(async () => []) } }));
import { POSWalkInScreen } from './POSWalkInScreen';
import { POSNewBookingScreen } from './POSNewBookingScreen';

const catalog = (services: any[]) => ({ filters: { services, serviceCategories: [...new Set(services.map((s) => s.category))], technicians: [] } });
const gel = { serviceId: 'svc-real-gel', name: 'Gel Polish Deluxe', category: 'Manicure', priceCents: 5200, durationMinutes: 50 };
const mount = (Screen: any) => render(<MemoryRouter><Screen /></MemoryRouter>);
beforeEach(() => { state.mockReset(); perms = ['checkout.view']; });

describe.each([['Walk-In', POSWalkInScreen], ['New Booking', POSNewBookingScreen]])('%s — service catalog', (_n, Screen) => {
  it('shows only the salon\'s services and add-ons — no demo catalog', async () => {
    state.mockResolvedValue(catalog([gel]));
    mount(Screen);
    expect(await screen.findByText('Gel Polish Deluxe')).toBeInTheDocument();
    for (const demo of ['Classic Manicure', 'Spa Manicure', 'Gel Manicure']) expect(screen.queryByText(demo)).toBeNull();
    expect(screen.getByText("No add-ons in this salon's catalog.")).toBeInTheDocument();
  });
  it('the salon\'s add-ons category in any spelling ("Add Ons") is its add-ons — the guest\'s own check-in uses the same rule (23-inch spec §20)', async () => {
    state.mockResolvedValue(catalog([gel, { serviceId: 'svc-art', name: 'Chrome Art', category: 'Add Ons', priceCents: 1000, durationMinutes: 15 }]));
    mount(Screen);
    expect((await screen.findAllByText('Chrome Art')).length).toBeGreaterThan(0);
    expect(screen.queryByText("No add-ons in this salon's catalog.")).toBeNull();
  });
  it('an empty catalog or a failed load says so instead of inventing services', async () => {
    state.mockResolvedValue(catalog([]));
    const a = mount(Screen);
    expect(await screen.findByText('This salon has no services in its catalog yet.')).toBeInTheDocument();
    a.unmount();
    state.mockRejectedValue(new Error('down'));
    mount(Screen);
    expect(await screen.findByText(/Could not load the service catalog/)).toBeInTheDocument();
    expect(screen.queryByText('Classic Manicure')).toBeNull();
  });
});

describe('Walk-In — price override permission and reason', () => {
  const pickGel = async () => { state.mockResolvedValue(catalog([gel])); mount(POSWalkInScreen); fireEvent.click(await screen.findByText('Gel Polish Deluxe')); };
  it('front desk (no override permission) gets no "Edit price"', async () => {
    await pickGel();
    await waitFor(() => expect(screen.getAllByText('Gel Polish Deluxe').length).toBeGreaterThan(1));   // in the summary
    expect(screen.queryByRole('button', { name: 'Edit price' })).toBeNull();
  });
  it('a manager can edit the price, but only with a reason', async () => {
    perms = ['checkout.view', 'checkout.manage_overrides'];
    await pickGel();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit price' }));
    fireEvent.click(screen.getByText('Apply Price Override'));
    expect(await screen.findByText('Add a reason for the price change.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60.00' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Long nails, Extra art, VIP courtesy'), { target: { value: 'Long nails' } });
    fireEvent.click(screen.getByText('Apply Price Override'));
    expect(await screen.findByText((_t, el) => !!el && el.tagName === 'SPAN' && /Custom: \$60(\.00)? · Long nails/.test(el.textContent || ''))).toBeInTheDocument();
    expect(screen.queryByText('Add a reason for the price change.')).toBeNull();
  });
});
