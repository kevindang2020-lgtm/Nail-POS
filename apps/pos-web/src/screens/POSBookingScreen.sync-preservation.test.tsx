// POSBookingScreen.sync-preservation.test.tsx — Smooth Refresh spec §48–§52, §115–§119: a background refresh (realtime
// event, reconcile, or the 15 s safety tick) arriving WHILE a receptionist is working must not reset anything she is
// doing — scroll position, selected date, filters, search text, an open modal/drawer, a half-filled booking form or an
// in-progress drag — and must never blank the board. Every test fires the refresh the way the realtime client does and
// proves the refetch really happened (so a pass is not vacuous).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen } from './POSBookingScreen';
import { runOnClassicBookingBoard } from './booking/boardMode.testkit';
// these tests pin the CLASSIC calendar (recoverable behind "Classic board" since the Booking Schedule Board merge, Nov 13 2026)
runOnClassicBookingBoard();
import { REALTIME_EVENT, REALTIME_RECONCILE } from '../realtime/realtime-client';

const TECHS = Array.from({ length: 12 }, (_, i) => ({ technicianId: `t${i}`, name: `Tech ${String.fromCharCode(65 + i)}` }));
const grid = (date = '2026-06-07') => ({
  date, openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0,
  columns: TECHS.map((t) => ({ ...t, available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 })),
  appointments: [],
});
const appt = (version: number, startTime = '10:00') => ({
  appointmentId: 'apX', customerName: 'Drag Me', customerPhone: '', isVip: false, technicianId: 't0', technicianName: 'Tech A',
  services: [{ serviceName: 'Mani' }], source: 'manual', startTime, endTime: '10:30', durationMinutes: 30, status: 'booked',
  depositStatus: 'not_required', conflictStatus: 'none', createdAt: '', updatedAt: '', version,
});
const state = (version = 7, startTime = '10:00') => ({
  kpis: { totalBookingsToday: 1, confirmedBookings: 0, checkedInBookings: 0, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, walkInsToday: 0, conflictCount: 0 },
  dateRange: { from: '2026-06-07', to: '2026-06-07', timezone: 'America/New_York' },
  bookings: { items: [appt(version, startTime)], pagination: { totalItems: 1 } },
  filters: { statuses: [], sources: [], technicians: TECHS, services: [], serviceCategories: [], branches: [] },
  integrationStatus: { googleReserveConnected: false, aiPhoneEnabled: false, onlineBookingEnabled: false },
});

/** A fetch whose board answer can be changed mid-test (another device moved something) or made to fail. */
function server() {
  const ctl = { version: 7, startTime: '10:00', fail: false, stateCalls: 0, reschedules: [] as any[] };
  const fetch = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (init?.method === 'POST' && u.includes('/reschedule')) { ctl.reschedules.push(JSON.parse(init.body)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => appt(ctl.version + 1) } as any; }
    if (u.includes('/changes')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ appointments: [], cursor: 'v1.x', serverTime: new Date().toISOString() }) } as any;
    if (u.includes('/day-grid')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ...grid(new URL(u, 'http://x').searchParams.get('date') || '2026-06-07'), appointments: ctl.fail ? [] : [appt(ctl.version, ctl.startTime)] }) } as any;
    if (u.includes('/pos/booking') && !u.includes('/appointments/')) {
      ctl.stateCalls++;
      if (ctl.fail) return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({ message: 'Bad gateway' }) } as any;
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => state(ctl.version, ctl.startTime) } as any;
  });
  return { ctl, fetch };
}
/** Exactly what the realtime client dispatches for a booking event. */
const bookingEvent = () => act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_updated', screens: ['booking'] } })); await new Promise((r) => setTimeout(r, 300)); });
const reconcile = () => act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_RECONCILE, { detail: { reason: 'reconnected' } })); await new Promise((r) => setTimeout(r, 50)); });

class PEPoly extends MouseEvent { pointerId: number; pointerType: string; constructor(t: string, i: any = {}) { super(t, i); this.pointerId = i.pointerId ?? 1; this.pointerType = i.pointerType ?? 'mouse'; } }
beforeEach(() => { vi.restoreAllMocks(); (window as any).PointerEvent = PEPoly; });

describe('background refresh never disturbs the receptionist (spec §48–§52, §115–§119)', () => {
  it('§115/§51: 12-technician board — scroll position, selected date and search text survive a background refresh; nothing blanks', async () => {
    const { ctl, fetch } = server(); globalThis.fetch = fetch as any;
    const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('Drag Me');
    fireEvent.click(screen.getByRole('button', { name: /next day/i }));            // selected date moves to the 8th
    await waitFor(() => expect(fetch.mock.calls.some((c: any[]) => String(c[0]).includes('date=2026-06-08'))).toBe(true));
    const scroller = container.querySelector('.overflow-auto.rounded-\\[10px\\]') as HTMLElement;
    expect(scroller).toBeTruthy();
    scroller.scrollTop = 420; scroller.scrollLeft = 900;                           // scrolled to the afternoon, tech J
    const search = screen.getByPlaceholderText('Search customer, phone, tech…') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'dra' } });
    const before = ctl.stateCalls;
    await bookingEvent();
    await waitFor(() => expect(ctl.stateCalls).toBeGreaterThan(before));           // the refetch really happened
    expect(scroller.scrollTop).toBe(420);
    expect(scroller.scrollLeft).toBe(900);
    expect(search.value).toBe('dra');
    expect(fetch.mock.calls.slice(-3).some((c: any[]) => String(c[0]).includes('date=2026-06-08'))).toBe(true);   // still the 8th
    expect(screen.queryByText(/Loading booking/)).toBeNull();
  });

  it('§20/§42: a FAILED background refresh keeps the board on screen (no error page)', async () => {
    const { ctl, fetch } = server(); globalThis.fetch = fetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('Drag Me');
    ctl.fail = true;
    const before = ctl.stateCalls;
    await reconcile();
    await waitFor(() => expect(ctl.stateCalls).toBeGreaterThan(before));
    expect(screen.getAllByText('Drag Me').length).toBeGreaterThan(0);
    expect(screen.queryByText('Bad gateway')).toBeNull();
  });

  it('§52/§116/§117: the New Booking form and the Walk-in tab keep what was typed while the board refreshes', async () => {
    const { ctl, fetch } = server(); globalThis.fetch = fetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('Drag Me');
    const name = screen.getAllByPlaceholderText('Customer name *')[0] as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Olivia Brown' } });
    let before = ctl.stateCalls;
    await bookingEvent();
    await waitFor(() => expect(ctl.stateCalls).toBeGreaterThan(before));
    expect((screen.getAllByPlaceholderText('Customer name *')[0] as HTMLInputElement).value).toBe('Olivia Brown');
    fireEvent.click(screen.getAllByRole('tab', { name: 'Walk-In' })[0]);
    const tabBefore = screen.getAllByRole('tab', { name: 'Walk-In' })[0].getAttribute('aria-selected');
    before = ctl.stateCalls;
    await reconcile();
    await waitFor(() => expect(ctl.stateCalls).toBeGreaterThan(before));
    expect(screen.getAllByRole('tab', { name: 'Walk-In' })[0].getAttribute('aria-selected')).toBe(tabBefore);
    expect(tabBefore).toBe('true');
  });

  it('§52: an open Manage drawer stays open through a background refresh', async () => {
    const { ctl, fetch } = server(); globalThis.fetch = fetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('Drag Me');
    fireEvent.click(screen.getAllByRole('button', { name: 'Manage' })[0]);
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    const before = ctl.stateCalls;
    await bookingEvent();
    await waitFor(() => expect(ctl.stateCalls).toBeGreaterThan(before));
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);   // still open
  });

  it('§50/§118: a refresh that lands MID-DRAG does not cancel the drag, and the drop quotes the version from when the drag STARTED', async () => {
    const { ctl, fetch } = server(); globalThis.fetch = fetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('View day');   // calendar cards come from the day grid
    const card = (await screen.findAllByText('Drag Me')).map((el) => el.closest('button')!).find((b) => b?.closest('[data-cal-col]'))!;
    document.querySelectorAll('[data-cal-col]').forEach((el, i) => {
      (el as HTMLElement).getBoundingClientRect = () => ({ top: 0, left: 100 + i * 200, right: 300 + i * 200, bottom: 800, width: 200, height: 800, x: 100 + i * 200, y: 0, toJSON: () => ({}) } as any);
    });
    const target = document.querySelectorAll('[data-cal-col]')[1] as HTMLElement;
    const orig = document.elementFromPoint; (document as any).elementFromPoint = () => target;
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 350, clientY: 128 });
    // Another device changes this appointment; the board refreshes while the receptionist is still holding it.
    ctl.version = 8;
    const before = ctl.stateCalls;
    await bookingEvent();
    await waitFor(() => expect(ctl.stateCalls).toBeGreaterThan(before));
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 352, clientY: 128 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 352, clientY: 128 });
    (document as any).elementFromPoint = orig;
    await waitFor(() => expect(ctl.reschedules.length).toBe(1));                   // the drag survived the refresh
    // 7, not 8: the move was decided on the copy she started dragging — the server must be able to say
    // VERSION_CONFLICT. Quoting 8 would silently overwrite the other device's change.
    expect(ctl.reschedules[0].expectedVersion).toBe(7);
  });
});
