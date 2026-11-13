// POSBookingScreen.board.test.tsx — the merged Booking Schedule Board in the real Booking page (Nov 13 2026).
// The new board is the default schedule region; Classic board is a per-person switch; KPI cards, the toolbar and the
// Booking Assistant stay the page's; an open time prefills that assistant; technicians are paged on the SERVER (200 → 17
// pages, last page 8 real columns); a booking realtime event reloads the visible page; nothing in Booking prints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { technicianAccent } from '@aipowersalon/booking-schedule-board';
import { POSBookingScreen } from './POSBookingScreen';
import { boardModeKey } from './booking/boardMode';
import { BOARD_STATE_KEY } from './booking/BookingBoardRegion';
import { REALTIME_EVENT } from '../realtime/realtime-client';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

const DAY = '2031-03-04';
const state = {
  kpis: { totalBookingsToday: 0, confirmedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, conflictCount: 0 },
  dateRange: { from: DAY, to: DAY, timezone: 'UTC' }, bookings: { items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } },
  filters: { statuses: ['booked'], sources: [], technicians: [], services: [{ serviceId: 'svc-gel', name: 'Gel Polish', durationMinutes: 45, priceCents: 4000 }], serviceCategories: [], branches: [] },
  integrationStatus: {}, settings: { openTime: '09:00', closeTime: '19:00' },
};
const TOTAL = 200;
const tech = (n: number) => ({ technicianId: 't' + n, name: 'Tech ' + n, rosterNumber: n, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 });
function respond(u: string) {
  const url = new URL(u, 'http://x'); const p = url.searchParams;
  if (url.pathname.endsWith('/booking/technicians')) {
    const q = p.get('search');
    if (q) { const n = Number(q.replace('#', '')); return { date: DAY, technicians: n >= 1 && n <= TOTAL ? [tech(n)] : [], total: n >= 1 && n <= TOTAL ? 1 : 0, totalAll: TOTAL, workingCount: TOTAL, page: 1, pageSize: 8, totalPages: 1 }; }
    const size = Number(p.get('pageSize') || 12); const pages = Math.ceil(TOTAL / size);
    const loc = p.get('locate'); const idx = loc ? Number(loc.slice(1)) - 1 : -1;
    const pg = loc && idx >= 0 ? Math.floor(idx / size) + 1 : Math.min(pages, Number(p.get('page') || 1));
    return { date: DAY, technicians: Array.from({ length: TOTAL }, (_, i) => tech(i + 1)).slice((pg - 1) * size, pg * size), total: TOTAL, totalAll: TOTAL, workingCount: TOTAL, page: pg, pageSize: size, totalPages: pages,
      ...(loc ? { located: idx >= 0 ? { technicianId: loc, page: pg, index: idx } : null } : {}) };
  }
  if (url.pathname.endsWith('/day-grid')) {
    const ids = (p.get('technicianIds') || '').split(',').filter(Boolean);
    return { date: DAY, openTime: '09:00', closeTime: '19:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 45, totalOpenSlots: 0,
      columns: ids.map((id) => ({ technicianId: id, name: 'Tech ' + id.slice(1), available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1140 }], blocked: [], openRanges: [{ start: 600, end: 660, minutes: 60 }], openMinutes: 60, openSlotCount: 4 })),
      appointments: ids.includes('t1') ? [{ appointmentId: 'ap1', customerName: 'Guest One', technicianId: 't1', services: [{ serviceId: 'svc-gel', serviceName: 'Gel Polish', durationMinutes: 45, priceCents: 4000 }], source: 'manual', startTime: '09:00', endTime: '09:45', durationMinutes: 45, status: 'confirmed', version: 3, date: DAY }] : [] };
  }
  if (url.pathname.endsWith('/changes')) return { appointments: [], cursor: 'v1.x', serverTime: new Date().toISOString() };
  if (url.pathname.includes('/pos/queue')) return { queue: { items: [] } };
  return state;
}
let urls: string[] = [];
beforeEach(() => {
  urls = [];
  localStorage.clear(); sessionStorage.clear();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  globalThis.fetch = vi.fn(async (u: unknown) => { urls.push(String(u)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(u)) } as unknown as Response; }) as unknown as typeof fetch;
});
afterEach(cleanup);
// the BOARD's page requests (it always asks working=true by default; the page's own KPI read does not)
const techPages = () => urls.filter((u) => u.includes('/booking/technicians') && u.includes('working=true'));
const gridCalls = () => urls.filter((u) => u.includes('/day-grid'));

describe('Booking page — merged schedule board', () => {
  it('is the default schedule region; KPI cards, the toolbar and Booking Assistant · New Appointment stay', { timeout: 30_000 }, async () => {
    const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const board = await screen.findByTestId('booking-schedule-board');
    expect(await within(board).findByTestId('bsb-tech-t1')).toBeInTheDocument();
    expect(container.querySelector('[data-module-id="booking-kpis"]')).not.toBeNull();
    expect(container.querySelector('[data-module-id="booking-assistant"]')).not.toBeNull();
    expect(screen.queryByTestId('tech-page-label')).toBeNull();            // the classic pager is not rendered
    // 12 server-paged columns, the server's counts — never the 200-technician roster in the DOM
    expect(within(board).getAllByRole('columnheader')).toHaveLength(12);
    expect(within(board).getByText('Technicians 1–12 of 200')).toBeInTheDocument();
    expect(gridCalls()[gridCalls().length - 1]).toContain(encodeURIComponent('t1,t2,t3,t4,t5,t6,t7,t8,t9,t10,t11,t12'));
    // stable identity accent on the header and the card rail
    const accent = technicianAccent('', 't1');
    expect(within(board).getByTestId('bsb-tech-t1').getAttribute('data-accent')).toBe(accent);
    expect(within(board).getByTestId('bsb-appt-ap1').getAttribute('data-accent')).toBe(accent);
  });

  it('a tap on an open time prefills the existing Booking Assistant (technician, date, time) — no booking is created', { timeout: 30_000 }, async () => {
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const board = await screen.findByTestId('booking-schedule-board');
    fireEvent.click(await within(board).findByTestId('bsb-cell-t2-600'));   // 10:00 on Tech 2
    const assistant = document.getElementById('booking-assistant')!;
    await waitFor(() => expect(within(assistant).getAllByText(/Tech 2 ·/).length).toBeGreaterThan(0));
    expect((within(assistant).getByDisplayValue(DAY) as HTMLInputElement).value).toBe(DAY);
    expect(within(assistant).getByRole('option', { name: /10:00a/ })).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/booking/appointments') && !u.includes('?'))).toBe(false);
  });

  it('200 technicians: Next asks the server for page 2; the jump box finds #200 on page 17 (8 real columns)', { timeout: 30_000 }, async () => {
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const board = await screen.findByTestId('booking-schedule-board');
    await within(board).findByTestId('bsb-tech-t1');
    fireEvent.click(within(within(board).getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    await waitFor(() => expect(techPages().some((u) => /[?&]page=2\b/.test(u))).toBe(true));
    expect(await within(board).findByText('Technicians 13–24 of 200')).toBeInTheDocument();
    const jump = screen.getAllByRole('searchbox', { name: /find technician/i })[0];
    fireEvent.change(jump, { target: { value: '#200' } });
    await waitFor(() => expect(urls.some((u) => u.includes('search=%23200'))).toBe(true));
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    fireEvent.keyDown(jump, { key: 'Enter' });
    const col = await within(board).findByTestId('bsb-tech-t200', {}, { timeout: 4000 });
    expect(urls.some((u) => u.includes('locate=t200'))).toBe(true);
    expect(within(board).getAllByRole('columnheader')).toHaveLength(8);      // #193–#200, no phantom columns
    expect(within(board).getByText('Technicians 193–200 of 200')).toBeInTheDocument();
    await waitFor(() => expect(col).toHaveAttribute('aria-selected', 'true'));
  });

  it('a booking realtime event reloads the visible page (technicians + day grid of those columns)', { timeout: 30_000 }, async () => {
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const board = await screen.findByTestId('booking-schedule-board');
    await within(board).findByTestId('bsb-tech-t1');
    const before = gridCalls().length;
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_updated', screens: ['booking'], payload: { technicianId: 't3', date: DAY } } })); await new Promise((r) => setTimeout(r, 400)); });
    await waitFor(() => expect(gridCalls().length).toBeGreaterThan(before));
    // B-14: a change for technician #150 (not on this page) never reloads the 12 visible columns
    await waitFor(() => expect(gridCalls().length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    const settled = gridCalls().length;
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_updated', screens: ['booking'], payload: { technicianId: 't150', date: DAY } } })); await new Promise((r) => setTimeout(r, 600)); });
    expect(gridCalls().length).toBe(settled);
  });

  it('board state survives leaving and coming back (page restored from this tab)', { timeout: 30_000 }, async () => {
    const first = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const board = await screen.findByTestId('booking-schedule-board');
    await within(board).findByTestId('bsb-tech-t1');
    fireEvent.click(within(within(board).getByTestId('bsb-pager')).getByRole('button', { name: /Next 12/ }));
    await within(board).findByText('Technicians 13–24 of 200');
    fireEvent.click(screen.getByRole('button', { name: /next day/i }));            // the page's date moves to the 5th
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(BOARD_STATE_KEY) || '{}')).toMatchObject({ pageIndex: 1, date: '2031-03-05' }));
    first.unmount();
    urls = [];
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const again = await screen.findByTestId('booking-schedule-board');
    expect(await within(again).findByText('Technicians 13–24 of 200')).toBeInTheDocument();
    expect(techPages().find((u) => /[?&]page=\d/.test(u))).toMatch(/[?&]page=2\b/);   // the FIRST request is already page 2
    expect(techPages()[0]).toContain('date=2031-03-05');                              // …for the date the receptionist was on (not reset to today)
  });

  it('Classic board is a per-person switch: remembered, and the classic calendar returns', { timeout: 30_000 }, async () => {
    const first = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByTestId('booking-schedule-board');
    fireEvent.click(screen.getByTestId('booking-classic-board'));
    expect(localStorage.getItem(boardModeKey(undefined, undefined))).toBe('classic');
    expect(await screen.findByTestId('tech-page-label')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-schedule-board')).toBeNull();
    first.unmount();
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByTestId('tech-page-label')).toBeInTheDocument();
    expect((screen.getByTestId('booking-classic-board') as HTMLInputElement).checked).toBe(true);
  });

  it('no schedule printing anywhere in Booking (owner rule, addendum B-20) — Block time is the bottom-right action', { timeout: 30_000 }, async () => {
    const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const board = await screen.findByTestId('booking-schedule-board');
    await within(board).findByTestId('bsb-tech-t1');
    expect(within(board).getByTestId('bsb-block-time-action')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /print/i })).toHaveLength(0);
    expect(container.textContent ?? '').not.toMatch(/print schedule|in lịch/i);   // check:no-print — asserts the label is ABSENT
  });

  it('reads in Vietnamese at the front desk (P-14): the board’s own words come from the bsb namespace, no English left', { timeout: 30_000 }, async () => {
    await act(async () => { await setLanguage('vi'); });
    try {
      render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
      const board = await screen.findByTestId('booking-schedule-board');
      await within(board).findByTestId('bsb-tech-t1');
      expect(within(board).getByText('Tìm giờ trống')).toBeInTheDocument();
      expect(within(board).getByText('Chặn thời gian')).toBeInTheDocument();
      expect(within(board).getByText('Thợ 1–12 trên 200')).toBeInTheDocument();
      const names = Array.from({ length: 12 }, (_, i) => `Tech ${i + 1}`).concat(['Tech', 'Guest One', 'Gel Polish', 'GO', 'TE']);
      expect(leftoverEnglish(board, names)).toEqual([]);
    } finally { await act(async () => { await setLanguage('en'); }); }
  });
});
