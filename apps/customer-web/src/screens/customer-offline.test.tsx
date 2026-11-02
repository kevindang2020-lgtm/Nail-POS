// customer-offline.test.tsx — BUILD_PLAN Phase 13 (Constitution 6 §14–15, §18, §20): the migrated Customer screens. Cached
// appointments render offline with "last updated"; the wallet is never written to the device cache; booking is online-only
// and sends ONE Idempotency-Key that a retry after a LOST answer reuses (the server then returns the first booking).
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileQueryProvider, MemoryKvStore, createAppQueryClient, persistNow, scopedKey, resetNetworkState, type QueryScope } from '@aipowersalon/mobile-sdk';

vi.mock('../api/customerApi', () => ({ customerApi: { appointments: vi.fn(), wallet: vi.fn(), loyalty: vi.fn(), paymentMethods: vi.fn(), topUp: vi.fn(),
  salon: vi.fn().mockResolvedValue({ id: 'b1', name: 'Luxe Nails', address: '1 Main St', phone: null }), salonsNearby: vi.fn().mockResolvedValue({ results: [] }), salonServices: vi.fn().mockResolvedValue([]),
  salonTechnicians: vi.fn().mockResolvedValue({ technicians: [] }), sendBookingVerification: vi.fn(), checkBookingVerification: vi.fn(), bookingCaptcha: vi.fn(), bookingOptions: vi.fn(), availability: vi.fn(), createBooking: vi.fn(),
  bookingServiceTechnicians: vi.fn(async () => ({ serviceId: 's1', technicians: [] })) } }));
vi.mock('../api/customerScheduleProposalsApi', () => ({ customerScheduleProposalsApi: { list: vi.fn().mockResolvedValue([]) }, isPendingProposal: () => false }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'c-1', tenantId: 't1', branchId: 'b1', role: 'CUSTOMER' } }) }));

import { customerApi } from '../api/customerApi';
import { AppointmentsScreen } from './AppointmentsScreen';
import { WalletScreen } from './WalletScreen';
import { BookScreen } from './BookScreen';

const S: QueryScope = { realm: 'customer', tenantId: 't1', branchId: 'b1', userId: 'c-1' };
const offlineErr = () => Object.assign(new TypeError('Failed to fetch'), { status: 0, code: 'NETWORK_ERROR' });
function setOnline(v: boolean) { Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v }); window.dispatchEvent(new Event(v ? 'online' : 'offline')); }
let store: MemoryKvStore;
const wrap = (el: JSX.Element) => <MemoryRouter><MobileQueryProvider app="customer" scope={S} send={async () => ({})} store={store}>{el}</MobileQueryProvider></MemoryRouter>;
beforeEach(() => { vi.clearAllMocks(); store = new MemoryKvStore(); setOnline(true); resetNetworkState(); });
afterEach(() => { cleanup(); setOnline(true); vi.useRealTimers(); });

describe('Appointments + Wallet (migrated)', () => {
  it('Appointments: cached list renders offline with "last updated"', async () => {
    const c = createAppQueryClient(); const k = scopedKey(S, 'customer', 'appointments');
    c.setQueryDefaults(k, { meta: { persist: true } });
    c.setQueryData(k, [{ appointmentId: 'a1', status: 'booked', startTime: '2099-01-01T15:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Lisa', salonName: 'Luxe' }]);
    await persistNow(c, { app: 'customer', store }, S);
    setOnline(false); (customerApi.appointments as any).mockRejectedValue(offlineErr());
    render(wrap(<AppointmentsScreen />));
    expect(await screen.findByText(/You’re offline — showing saved data\. Last updated/)).toBeInTheDocument();
    expect(screen.getByText(/Gel Manicure/)).toBeInTheDocument();
  });
  it('Wallet: balances and saved cards are never written to the device cache', async () => {
    (customerApi.wallet as any).mockResolvedValue({ balanceCents: 4321, transactions: [] });
    (customerApi.loyalty as any).mockResolvedValue({ points: 77, tier: 'Gold' });
    (customerApi.paymentMethods as any).mockResolvedValue([{ id: 'pm_1', brand: 'visa', last4: '4242', isDefault: true }]);
    render(wrap(<WalletScreen />));
    await waitFor(() => expect(customerApi.wallet).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 700));
    const raw = (await Promise.all((await store.keys()).map((k) => store.get(k)))).join('');
    expect(raw).not.toContain('4321'); expect(raw).not.toContain('4242'); expect(raw).not.toContain('pm_1');
  });
});

describe('booking: online-only, one Idempotency-Key per attempt', () => {
  const setup = () => {
    (customerApi.bookingOptions as any).mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4500, category: 'Nails' }], technicians: [{ id: 't1', fullName: 'Lisa' }] });
    (customerApi.availability as any).mockResolvedValue({ date: '2026-08-27', serviceId: 's1', durationMinutes: 45, window: { open: '09:00', close: '19:00', stepMinutes: 60 }, slots: [{ startTime: '10:00', available: true, technicianIds: ['t1'] }] });
  };
  async function toSummary() {
    const go = await screen.findByRole('button', { name: /Continue to Services/ }, { timeout: 5000 });
    await waitFor(() => expect(customerApi.salon).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));                  // the signed-in salon has arrived → Continue skips the salon step
    fireEvent.click(go);
    await screen.findByText('Gel Manicure', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByRole('button', { name: /Select Gel Manicure/ }));
    fireEvent.click(screen.getByRole('button', { name: /Choose Time & Tech/ }));
    fireEvent.click(await screen.findByText('10:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /Review Booking Summary/ }));
  }
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-08-27T08:00:00')); setup(); });

  it('a lost answer → Confirm again reuses the SAME key', async () => {
    (customerApi.createBooking as any).mockRejectedValueOnce(Object.assign(new Error('Request timed out'), { status: 0, code: 'NETWORK_TIMEOUT' }))
      .mockResolvedValueOnce({ appointmentId: 'a1', date: '2026-08-27', startTime: '10:00', endTime: '10:45', serviceName: 'Gel Manicure', technicianName: 'Lisa', status: 'booked' });
    render(wrap(<BookScreen />));
    await toSummary();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm & Book Now/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    await waitFor(() => expect(customerApi.createBooking).toHaveBeenCalledTimes(2));
    const keys = (customerApi.createBooking as any).mock.calls.map((c: any[]) => c[1].idempotencyKey);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_\-:.]{8,200}$/);
    expect(keys[0]).toBe(keys[1]);
  });
  it('offline: refused, nothing sent, nothing queued', async () => {
    render(wrap(<BookScreen />));
    await toSummary();
    setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Book Now/ }));
    expect(await screen.findByText(/You’re offline\. Booking needs a live connection/)).toBeInTheDocument();
    expect(customerApi.createBooking).not.toHaveBeenCalled();
    expect((await store.keys()).filter((k) => k.startsWith('aps.journal'))).toEqual([]);
  });
});
