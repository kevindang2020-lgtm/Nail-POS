// POSBookingScreen.vi.test — English + Vietnamese POS mandate (WP-C1): the Booking board reads in Vietnamese — status pills
// from the appointment codes, the source mix from its codes, the calendar axis in the 24-hour clock, the New Booking /
// Walk-In tabs from the glossary — with no English left in what staff read. Names and services stay as typed.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { POSBookingScreen, calLabel } from './POSBookingScreen';

const appt = (id: string, name: string, status: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({ appointmentId: id, customerName: name, technicianId: 't1', technicianName: 'Trần Mỹ Linh', services: [{ serviceName: 'Gel Manicure' }], source: 'online', startTime: start, endTime: end, durationMinutes: 45, status, date: '2026-06-07', ...extra });
const state = {
  kpis: { totalBookingsToday: 3, confirmedBookings: 1, checkedInBookings: 1, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 1, onlineBookings: 2, googleBookings: 0, aiBookings: 0, conflictCount: 0, depositsCollectedCents: 0 },
  dateRange: { from: '2026-06-07', to: '2026-06-07', timezone: 'America/New_York' },
  bookings: { items: [appt('a1', 'Nguyễn Thị Hương', 'confirmed', '10:00', '10:45'), appt('a2', 'Mai Pham', 'no_show', '11:00', '11:45'), appt('a3', 'Lan Vo', 'checked_in', '13:00', '13:45', { source: 'walk_in' })], pagination: { totalItems: 3 } },
  filters: { statuses: [], sources: [], technicians: [], services: [], serviceCategories: [], branches: [] },
  integrationStatus: { googleReserveConnected: false, aiPhoneEnabled: false, onlineBookingEnabled: false },
  settings: { openTime: '9:00', closeTime: '18:00' },
  aggregates: { walkInsToday: 1, bookedRevenueCents: 13500, bookedMinutes: 135, sourceCounts: [{ source: 'online', count: 2 }, { source: 'walk_in', count: 1 }], serviceCounts: [{ name: 'Gel Manicure', count: 3 }] },
};
const techPage = { date: '2026-06-07', technicians: [{ technicianId: 't1', name: 'Trần Mỹ Linh', rosterNumber: 1, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 }], total: 1, totalAll: 1, workingCount: 1, page: 1, pageSize: 12, totalPages: 1 };
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
const NAMES = ['Nguyễn Thị Hương', 'Trần Mỹ Linh', 'Mai Pham', 'Lan Vo', 'Gel Manicure', 'NT', 'MP', 'LV', 'TM', 'CN'];

describe('Booking board in Vietnamese (WP-C1)', () => {
  it('statuses, sources, tabs and the 24-hour calendar axis are Vietnamese; no English left', async () => {
    await setLanguage('vi');
    globalThis.fetch = vi.fn(async (url: any) => { const u = String(url); const body = u.includes('/booking/technicians') ? techPage : u.includes('/booking/state') ? state : {}; return { ok: true, status: 200, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) } as any; }) as any;
    const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/Nguyễn Thị Hương/).length).toBeGreaterThan(0));
    expect(calLabel(870)).toBe('14:30');
    for (const en of ['No-Show', 'Confirmed', 'Walk-in', 'New Booking', 'Online', 'Unassigned', 'today']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, NAMES)).toEqual([]);
  });
});
