// POSBookingScreen.week-paging.test.tsx — 200-technician mandate: the Week view groups appointments by their REAL date
// (it used to deal the day's list round-robin across Mon–Sun), and the appointment list pages on the server.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen, weekStart, weekDays } from './POSBookingScreen';

const row = (id: string, date: string, name: string) => ({ appointmentId: id, date, customerName: name, technicianId: 't1', technicianName: 'Mia', services: [{ serviceName: 'Mani' }], source: 'manual', startTime: '10:00', endTime: '10:30', durationMinutes: 30, status: 'booked' });
const state = (items: any[], pagination: any) => ({
  kpis: { totalBookingsToday: items.length }, dateRange: { from: '2026-06-10', to: '2026-06-10', timezone: 'UTC' },
  bookings: { items, pagination },
  filters: { statuses: [], sources: [], technicians: [{ technicianId: 't1', name: 'Mia' }], services: [], serviceCategories: [], branches: [] },
  integrationStatus: {},
});

describe('week helpers', () => {
  it('weekStart is the Monday of the week (UTC calendar math)', () => {
    expect(weekStart('2026-06-10')).toBe('2026-06-08');   // Wed → Mon
    expect(weekStart('2026-06-08')).toBe('2026-06-08');
    expect(weekStart('2026-06-14')).toBe('2026-06-08');   // Sun → the Monday before
    expect(weekDays('2026-06-08')).toEqual(['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14']);
    expect(weekDays('2026-12-28')[6]).toBe('2027-01-03');
  });
});

describe('Week view and list pager', () => {
  it('asks for the week range and puts each appointment on its own date', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url); urls.push(u);
      const body = u.includes('/appointments?') && u.includes('from=')
        ? { items: [row('w1', '2026-06-09', 'Tuesday Guest'), row('w2', '2026-06-12', 'Friday Guest')], pagination: { page: 1, pageSize: 100, totalItems: 2, totalPages: 1 } }
        : u.includes('/day-grid') ? { date: '2026-06-10', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, columns: [], appointments: [] }
        : state([], { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as any;
    }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: 'Week' }));
    await waitFor(() => expect(document.querySelector('[data-week-day]')).not.toBeNull());
    const wk = urls.find((u) => u.includes('/appointments?') && u.includes('from='))!;
    expect(wk).toMatch(/from=\d{4}-\d{2}-\d{2}/); expect(wk).toMatch(/to=\d{4}-\d{2}-\d{2}/);
    // no date picked → the week of the board's day (the day grid says 2026-06-10, a Wednesday) → Mon 06-08 … Sun 06-14
    expect(wk).toContain('from=2026-06-08'); expect(wk).toContain('to=2026-06-14');
    const tue = document.querySelector('[data-week-day="2026-06-09"]')!; const fri = document.querySelector('[data-week-day="2026-06-12"]')!;
    await waitFor(() => expect(tue.textContent).toContain('Tuesday Guest'));
    expect(fri.textContent).toContain('Friday Guest'); expect(tue.textContent).not.toContain('Friday Guest');
    expect(document.querySelectorAll('[data-week-day]').length).toBe(7);
  });

  it('the appointment list shows a pager when the server says there is more than one page, and Next asks for page 2', async () => {
    const urls: string[] = [];
    const items = Array.from({ length: 50 }, (_, i) => row('a' + i, '2026-06-10', 'Guest ' + i));
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url); urls.push(u);
      const body = u.includes('/day-grid') ? { date: '2026-06-10', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, columns: [], appointments: [] }
        : state(items, { page: u.includes('page=2') ? 2 : 1, pageSize: 50, totalItems: 120, totalPages: 3 });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body } as any;
    }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const pager = await screen.findByTestId('booking-list-pager');
    expect(pager.textContent).toContain('Page 1 of 3');
    expect(pager.textContent).toContain('Showing 50 of 120');
    fireEvent.click(Array.from(pager.querySelectorAll('button')).find((b) => /Next/.test(b.textContent || ''))!);
    await waitFor(() => expect(urls.some((u) => u.includes('/state?') && u.includes('page=2'))).toBe(true));
  });
});
