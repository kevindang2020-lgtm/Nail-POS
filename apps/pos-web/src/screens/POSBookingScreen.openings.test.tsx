// POSBookingScreen.openings.test — deep-scan (Oct 22 2026): (1) the board drew only the first page of the day (50
// appointments); (2) Best Matches searched a fixed "Gel Manicure · 45 min" label for any free gap of any technician,
// skilled or not; Find an Opening ignored the service. Now: the whole day, and the real availability for a real service.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadAllBookings, earliestOpening } from './POSBookingScreen';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ok = (body: unknown) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body }) as any;

describe('loadAllBookings — the board holds the whole day', () => {
  it('asks for the largest page and follows the pagination to the end', async () => {
    const calls: string[] = [];
    const row = (i: number) => ({ appointmentId: `a${i}` });
    globalThis.fetch = vi.fn(async (u: any) => {
      const url = String(u); calls.push(url);
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] || 1);
      const items = Array.from({ length: page < 3 ? 100 : 30 }, (_, i) => row((page - 1) * 100 + i));
      return ok(url.includes('/state') ? { filters: {}, bookings: { items, pagination: { page, pageSize: 100, totalItems: 230, totalPages: 3 } } } : { items, pagination: { page, totalPages: 3 } });
    }) as any;
    const st = await loadAllBookings({ date: '2026-10-22' });
    expect(st.bookings.items).toHaveLength(230);
    expect(new Set(st.bookings.items.map((r: any) => r.appointmentId)).size).toBe(230);
    expect(calls[0]).toMatch(/\/state\?.*pageSize=100/);
    expect(calls.some((c) => /\/appointments\?.*page=3/.test(c))).toBe(true);
  });
  it('one page → one call (nothing extra on a quiet day)', async () => {
    globalThis.fetch = vi.fn(async () => ok({ filters: {}, bookings: { items: [{ appointmentId: 'a1' }], pagination: { totalPages: 1 } } })) as any;
    expect((await loadAllBookings({})).bookings.items).toHaveLength(1);
    expect((globalThis.fetch as any).mock.calls).toHaveLength(1);
  });
});

describe('earliestOpening — Best Matches', () => {
  const rows = [{ technicianId: 't1', slots: ['11:00', '13:00'] }, { technicianId: 't2', slots: ['09:30', '12:00'] }, { technicianId: 't3', slots: [] }];
  it('the earliest open start across the technicians the server offered (only the eligible ones get slots)', () => {
    expect(earliestOpening(rows)).toEqual({ technicianId: 't2', time: '09:30' });
  });
  it('today: never a start already past; nothing left → null', () => {
    expect(earliestOpening(rows, '10:15')).toEqual({ technicianId: 't1', time: '11:00' });
    expect(earliestOpening(rows, '13:30')).toBeNull();
  });
});
