// POSBookingScreen.pager.test.tsx — 200-technician mandate §5: the board's technician pager has First / Previous /
// slider / Next / Last (200 technicians = 17 server pages of 12). First and Last ask the SERVER for page 1 / page 17.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen, boardPageCacheKey } from './POSBookingScreen';
import { useClassicBookingBoard } from './booking/boardMode.testkit';
// these tests pin the CLASSIC calendar (recoverable behind "Classic board" since the Booking Schedule Board merge, Nov 13 2026)
useClassicBookingBoard();

const state = {
  kpis: { totalBookingsToday: 0, confirmedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, conflictCount: 0 },
  dateRange: { from: '2026-06-10', to: '2026-06-10', timezone: 'UTC' }, bookings: { items: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 } },
  filters: { statuses: [], sources: [], technicians: [], services: [], serviceCategories: [], branches: [] }, integrationStatus: {}, settings: { openTime: '09:00', closeTime: '18:00' },
};
const tech = (n: number) => ({ technicianId: 't' + n, name: 'Tech ' + n, rosterNumber: n, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 });
const respond = (u: string) => {
  const url = new URL(u, 'http://x'); const p = url.searchParams;
  if (url.pathname.endsWith('/booking/technicians')) {
    const size = Number(p.get('pageSize') || 12); const pages = Math.ceil(200 / size); const pg = Math.min(pages, Number(p.get('page') || 1));
    return { date: '2026-06-10', technicians: Array.from({ length: 200 }, (_, i) => tech(i + 1)).slice((pg - 1) * size, pg * size), total: 200, totalAll: 200, workingCount: 200, page: pg, pageSize: size, totalPages: pages };
  }
  if (url.pathname.endsWith('/day-grid')) {
    const ids = (p.get('technicianIds') || '').split(',').filter(Boolean);
    return { date: '2026-06-10', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, appointments: [],
      columns: ids.map((id) => ({ technicianId: id, name: 'Tech ' + id.slice(1), available: true, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 })) };
  }
  if (url.pathname.includes('/pos/queue')) return { queue: { items: [] } };
  return state;
};

describe('board technician pager — First / Last (§5)', () => {
  it('Last asks the server for page 17; First goes back to page 1', { timeout: 30_000 }, async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => { urls.push(String(u)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(u)) } as any; }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const pager = await screen.findByTestId('board-tech-pager');
    const first = within(pager).getByRole('button', { name: '« First' }); const last = within(pager).getByRole('button', { name: 'Last »' });
    expect(first).toBeDisabled(); expect(last).not.toBeDisabled();
    fireEvent.click(last);
    await waitFor(() => expect(urls.some((u) => u.includes('/booking/technicians') && /[?&]page=17\b/.test(u))).toBe(true));
    await waitFor(() => expect(within(screen.getByTestId('board-tech-pager')).getByRole('button', { name: 'Last »' })).toBeDisabled());
    expect(await screen.findAllByText('Tech 200')).not.toHaveLength(0);
    const before = urls.length;
    fireEvent.click(within(screen.getByTestId('board-tech-pager')).getByRole('button', { name: '« First' }));
    await waitFor(() => expect(within(screen.getByTestId('board-tech-pager')).getByRole('button', { name: '« First' })).toBeDisabled());
    expect(urls.slice(before).some((u) => u.includes('/booking/technicians') && /[?&]page=1\b/.test(u))).toBe(true);
  });
});

describe('adjacent-page prefetch (§19) and its cache key (§20)', () => {
  it('the key changes with the date, the branch, any filter, the technician filters and the page', () => {
    const tq = { working: false, search: '', pageSize: 12 };
    const k = boardPageCacheKey({ date: '2026-06-10' }, tq, 2);
    expect(boardPageCacheKey({ date: '2026-06-10' }, tq, 2)).toBe(k);
    for (const other of [
      boardPageCacheKey({ date: '2026-06-11' }, tq, 2), boardPageCacheKey({ date: '2026-06-10', branchId: 'b2' }, tq, 2),
      boardPageCacheKey({ date: '2026-06-10', status: 'booked' }, tq, 2), boardPageCacheKey({ date: '2026-06-10', serviceCategory: 'Pedicure' }, tq, 2),
      boardPageCacheKey({ date: '2026-06-10', conflictOnly: true }, tq, 2), boardPageCacheKey({ date: '2026-06-10' }, { ...tq, working: true }, 2),
      boardPageCacheKey({ date: '2026-06-10' }, { ...tq, search: 'mia' }, 2), boardPageCacheKey({ date: '2026-06-10' }, { ...tq, pageSize: 24 }, 2),
      boardPageCacheKey({ date: '2026-06-10' }, tq, 3),
    ]) expect(other).not.toBe(k);
  });

  it('after page 1 settles, ONLY page 2 is prefetched (technicians + its 12-column day grid); Next paints it from the cache and revalidates', { timeout: 30_000 }, async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => { urls.push(String(u)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => respond(String(u)) } as any; }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByTestId('board-tech-pager');
    await waitFor(() => expect(urls.some((u) => u.includes('/booking/technicians') && /[?&]page=2\b/.test(u))).toBe(true), { timeout: 3000 });
    await waitFor(() => expect(urls.some((u) => u.includes('/day-grid') && decodeURIComponent(u).includes('t13,t14'))).toBe(true), { timeout: 3000 });
    // never more than the next page: no page 3+ requested
    expect(urls.some((u) => u.includes('/booking/technicians') && /[?&]page=([3-9]|1[0-7])\b/.test(u))).toBe(false);
    fireEvent.click(within(screen.getByTestId('board-tech-pager')).getByRole('button', { name: /Next/ }));
    expect(await screen.findAllByText('Tech 13')).not.toHaveLength(0);
    await waitFor(() => expect(urls.filter((u) => u.includes('/booking/technicians') && /[?&]page=2\b/.test(u)).length).toBeGreaterThanOrEqual(2));   // revalidated
  });
});
