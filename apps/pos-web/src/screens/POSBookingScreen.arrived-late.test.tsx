// POSBookingScreen.arrived-late.test.tsx — Functional Decision 38 on the booking board: a booked customer gets an
// "Arrived" action (POST …/arrived), an arrived customer can still be checked in, and the server's computed LATE status
// shows as "Late · N min" (the row's stored status stays booked underneath).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen } from './POSBookingScreen';

const row = (over: any) => ({ appointmentId: 'a1', customerName: 'Grace Kim', technicianId: 't1', technicianName: 'Mia', services: [{ serviceName: 'Signature Manicure' }], source: 'online', startTime: '10:00', endTime: '10:45', durationMinutes: 45, status: 'booked', ...over });
const state = (items: any[]) => ({
  kpis: { totalBookingsToday: items.length, confirmedBookings: 0, checkedInBookings: 0, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, googleBookings: 0, aiBookings: 0, conflictCount: 0, depositsCollectedCents: 0 },
  dateRange: { from: '2026-06-07', to: '2026-06-07', timezone: 'America/New_York' },
  bookings: { items, pagination: { totalItems: items.length } },
  filters: { statuses: [], sources: [], technicians: [{ technicianId: 't1', name: 'Mia' }], services: [], serviceCategories: [], branches: [] },
  integrationStatus: { googleReserveConnected: false, aiPhoneEnabled: false, onlineBookingEnabled: false },
});
let calls: { url: string; method: string }[];
const mount = (items: any[]) => {
  calls = [];
  globalThis.fetch = vi.fn(async (url: any, init?: any) => { calls.push({ url: String(url), method: init?.method || 'GET' }); return { ok: true, status: 200, json: async () => (String(url).includes('/arrived') ? row({ status: 'arrived' }) : state(items)), headers: { get: () => null } } as any; }) as any;
  render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
};
beforeEach(() => { vi.restoreAllMocks(); });

describe('Booking board — Arrived and Late (Decision 38)', () => {
  it('a booked customer has Arrived, which posts to the arrived route', async () => {
    mount([row({})]);
    fireEvent.click(await screen.findByRole('button', { name: 'Arrived' }));
    await waitFor(() => expect(calls.some((c) => /\/appointments\/a1\/arrived$/.test(c.url) && c.method === 'POST')).toBe(true));
  });

  it('an arrived customer shows Arrived, keeps Check In, and is not offered Arrived again', async () => {
    mount([row({ status: 'arrived', displayStatus: 'arrived' })]);
    expect(await screen.findByRole('button', { name: 'Check In' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arrived' })).toBeNull();
    expect(screen.getAllByText('Arrived').length).toBeGreaterThanOrEqual(1);   // the status pill
  });

  it("the server's computed late status shows with its minutes; Arrived is still offered", async () => {
    mount([row({ status: 'booked', displayStatus: 'late', lateMinutes: 22, lateness: 'late_beyond_grace' })]);
    expect(await screen.findByText('Late · 22 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arrived' })).toBeInTheDocument();
  });
});
