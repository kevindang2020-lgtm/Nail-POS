// POSBookingScreen.no-print.test — booking200 addendum (round 12), rendered: (1) P-04 / P-05 — the Booking page offers NO
// schedule printing (no control whose text, aria-label or title says print, in the normal page or in View All Techs, and
// Ctrl/Cmd+P on the page never calls window.print); (2) §08 — the page's KPI region is the server's six cards for the
// board's date (GET /pos/booking/kpi-cards), not numbers computed in the browser.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen } from './POSBookingScreen';

const DATE = '2026-06-10';
const state = {
  kpis: { totalBookingsToday: 3, confirmedBookings: 1, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, conflictCount: 0 },
  dateRange: { from: DATE, to: DATE, timezone: 'UTC' }, bookings: { items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } },
  filters: { statuses: [], sources: [], technicians: [], services: [], serviceCategories: [], branches: [] }, integrationStatus: {}, settings: { openTime: '09:00', closeTime: '18:00' },
};
const tech = (n: number) => ({ technicianId: 't' + n, name: 'Tech ' + n, rosterNumber: n, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 });
const kpiCards = {
  date: DATE, today: DATE, isToday: true, timeZone: 'UTC', asOf: '2026-06-10T15:00:00.000Z', arrivingWindowMinutes: 60,
  appointments: { state: 'ok', value: 17, awaitingConfirmation: 5, confirmed: 7, inSalon: 3, completed: 2 },
  arrivingSoon: { state: 'ok', value: 3 }, walkIns: { state: 'ok', value: 8, fromAppointments: 2, fromQueue: 6 },
  waitlist: { state: 'unavailable', value: null }, availableNow: { state: 'ok', value: 4, workingCount: 9 },
  bookedRevenue: { state: 'ok', value: 123456, basis: 'booked_service_subtotal' },
};
const respond = (u: string) => {
  const url = new URL(u, 'http://x'); const p = url.searchParams;
  if (url.pathname.endsWith('/booking/kpi-cards')) return kpiCards;
  if (url.pathname.endsWith('/booking/technicians')) return { date: DATE, technicians: Array.from({ length: 12 }, (_, i) => tech(i + 1)), total: 12, totalAll: 12, workingCount: 12, page: 1, pageSize: 12, totalPages: 1 };
  if (url.pathname.endsWith('/day-grid')) {
    const ids = (p.get('technicianIds') || '').split(',').filter(Boolean);
    return { date: DATE, openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, appointments: [],
      columns: ids.map((id) => ({ technicianId: id, name: 'Tech ' + id.slice(1), available: true, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 })) };
  }
  if (url.pathname.includes('/pos/queue')) return { queue: { items: [] } };
  return state;
};
const offersPrint = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="menuitem"], [role="tab"], [title], [aria-label]')]
  .filter((el) => /\bprint/i.test(`${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`));

describe('Booking page — no schedule printing (P-04 / P-05), rendered', () => {
  it('no print control on the page or in View All Techs; Ctrl/Cmd+P does not call window.print', { timeout: 30_000 }, async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => { urls.push(String(u)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(u)) } as any; }) as any;
    const printSpy = vi.fn(); const origPrint = window.print; window.print = printSpy;
    try {
      const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
      await screen.findByTestId('booking-kpi-strip');
      await waitFor(() => expect(container.querySelectorAll('button').length).toBeGreaterThan(10));
      expect(offersPrint(container)).toEqual([]);
      fireEvent.keyDown(window, { key: 'p', ctrlKey: true }); fireEvent.keyDown(window, { key: 'p', metaKey: true });
      fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true });
      expect(printSpy).not.toHaveBeenCalled();
      const viewAll = screen.queryByText('View All Techs ⤢');
      if (viewAll) { fireEvent.click(viewAll); expect(offersPrint(container)).toEqual([]); }
    } finally { window.print = origPrint; }
  });
});

describe('Booking page — the KPI region shows the server\'s six cards (booking200 §08)', () => {
  it('asks /kpi-cards for the board date and renders those numbers (an unavailable card says so, not 0)', { timeout: 30_000 }, async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => { urls.push(String(u)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(u)) } as any; }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const strip = await screen.findByTestId('booking-kpi-strip');
    await waitFor(() => expect(within(strip).getByTestId('kpi-value-appointments').textContent).toBe('17'));
    expect(urls.some((u) => u.includes('/booking/kpi-cards') && u.includes(`date=${DATE}`))).toBe(true);
    expect(within(strip).getByTestId('kpi-value-walkIns').textContent).toBe('8');
    expect(within(strip).getByTestId('kpi-value-availableNow').textContent).toBe('4');
    expect(within(strip).getByTestId('kpi-value-bookedRevenue').textContent).toBe('$1,234.56');
    expect(within(strip).getByTestId('kpi-value-waitlist').textContent).toBe('—');
    expect(within(strip).getByTestId('kpi-sub-waitlist').textContent).toBe('Could not load — not zero');
    expect(strip.closest('[data-module-id="booking-kpis"]')).not.toBeNull();
  });
});

describe('Booking Overview analytics stay out of the 12-column calendar (booking200 §14)', () => {
  it('the analytic modules render below the schedule, never inside it; the KPI strip is above it', { timeout: 30_000 }, async () => {
    globalThis.fetch = vi.fn(async (u: any) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(u)) } as any)) as any;
    const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByTestId('booking-kpi-strip');
    const schedule = await waitFor(() => { const el = container.querySelector('[data-module-id="booking-schedule"]'); expect(el).not.toBeNull(); return el!; });
    const analytics = ['booking-status-list', 'booking-mix', 'booking-upcoming', 'booking-team', 'booking-quick-actions'];
    for (const id of analytics) {
      const el = container.querySelector(`[data-module-id="${id}"]`);
      expect(el, id).not.toBeNull();
      expect(schedule.contains(el), `${id} inside the calendar`).toBe(false);
      expect(schedule.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING, `${id} after the calendar`).toBeTruthy();
    }
    const kpis = container.querySelector('[data-module-id="booking-kpis"]')!;
    expect(schedule.contains(kpis)).toBe(false);
    expect(schedule.compareDocumentPosition(kpis) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});
