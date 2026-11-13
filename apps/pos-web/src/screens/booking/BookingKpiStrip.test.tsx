// BookingKpiStrip.test — booking200 addendum §08 (round 12): six cards from the server answer; unavailable → "—" + an
// explicit "could not load" (never 0); another date → "Today only" on the now-cards; booked revenue labelled booked, not
// collected; the Arriving-soon window is sent to the server and persisted; tap → onOpen; 6 / 3 / 2 column layout; no
// screenshot sample values in the component.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BookingKpiCards } from '@aipowersalon/api-contracts/tenant';
import { BookingKpiStrip } from './BookingKpiStrip';

const today = (over: Partial<BookingKpiCards> = {}): BookingKpiCards => ({
  date: '2026-11-02', today: '2026-11-02', isToday: true, timeZone: 'America/New_York', asOf: '2026-11-02T15:00:00.000Z', arrivingWindowMinutes: 60,
  appointments: { state: 'ok', value: 6, awaitingConfirmation: 2, confirmed: 1, inSalon: 2, completed: 1 },
  arrivingSoon: { state: 'ok', value: 2 },
  walkIns: { state: 'ok', value: 4, fromAppointments: 1, fromQueue: 3 },
  waitlist: { state: 'ok', value: 11 },
  availableNow: { state: 'ok', value: 1, workingCount: 2 },
  bookedRevenue: { state: 'ok', value: 29000, basis: 'booked_service_subtotal' },
  ...over,
});
const val = (k: string) => screen.getByTestId(`kpi-value-${k}`).textContent;
const sub = (k: string) => screen.getByTestId(`kpi-sub-${k}`).textContent;

beforeEach(() => sessionStorage.clear());

describe('BookingKpiStrip', () => {
  it('renders the six cards in order from the server answer (one request, the board date + window)', async () => {
    const load = vi.fn().mockResolvedValue(today());
    const { container } = render(<BookingKpiStrip date="2026-11-02" load={load} />);
    await waitFor(() => expect(val('appointments')).toBe('6'));
    expect(load).toHaveBeenCalledWith({ date: '2026-11-02', arrivingWindowMinutes: 60 });
    expect([...container.querySelectorAll('[data-kpi]')].map((e) => e.getAttribute('data-kpi'))).toEqual(['appointments', 'arrivingSoon', 'walkIns', 'waitlist', 'availableNow', 'bookedRevenue']);
    expect(sub('appointments')).toBe('2 awaiting confirmation · 1 confirmed');
    expect([val('arrivingSoon'), sub('arrivingSoon')]).toEqual(['2', 'Next 60 min']);
    expect([val('walkIns'), sub('walkIns')]).toEqual(['4', '1 booked · 3 from queue']);
    expect([val('waitlist'), sub('waitlist')]).toEqual(['11', 'Waiting in Customer Queue']);   // the server total — no 6-row page cap
    expect([val('availableNow'), sub('availableNow')]).toEqual(['1', '2 working today']);
    expect(val('bookedRevenue')).toBe('$290.00');
    expect(sub('bookedRevenue')).toBe('Booked services · not collected');
    expect(screen.getByTestId('kpi-value-bookedRevenue').closest('[data-kpi]')?.getAttribute('title')).toMatch(/Not money collected/);
  });
  it('an unavailable source shows "—" and says it could not load — never 0; the other cards still show', async () => {
    const load = vi.fn().mockResolvedValue(today({ waitlist: { state: 'unavailable', value: null }, walkIns: { state: 'unavailable', value: null, fromAppointments: 1, fromQueue: null } }));
    render(<BookingKpiStrip date="2026-11-02" load={load} />);
    await waitFor(() => expect(val('appointments')).toBe('6'));
    for (const k of ['waitlist', 'walkIns']) {
      expect(val(k)).toBe('—');
      expect(sub(k)).toBe('Could not load — not zero');
      expect(screen.getByTestId(`kpi-value-${k}`).closest('[data-kpi]')?.getAttribute('data-state')).toBe('unavailable');
    }
  });
  it('another date: the now-cards say "Today only" (Available now explains how many are scheduled)', async () => {
    const load = vi.fn().mockResolvedValue(today({ date: '2026-11-05', isToday: false, arrivingSoon: { state: 'not_today', value: null }, waitlist: { state: 'not_today', value: null }, availableNow: { state: 'not_today', value: null, workingCount: 9 } }));
    render(<BookingKpiStrip date="2026-11-05" load={load} />);
    await waitFor(() => expect(val('appointments')).toBe('6'));
    expect([val('arrivingSoon'), sub('arrivingSoon')]).toEqual(['—', 'Today only']);
    expect([val('waitlist'), sub('waitlist')]).toEqual(['—', 'Live — today only']);
    expect([val('availableNow'), sub('availableNow')]).toEqual(['—', '9 scheduled that day']);
  });
  it('a failed request: no numbers invented (loading → could not load + Retry); after a good load, a failure keeps it marked stale', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(today());
    render(<BookingKpiStrip date="2026-11-02" load={load} />);
    await waitFor(() => expect(screen.getByTestId('booking-kpi-stale').textContent).toMatch(/Could not load/));
    expect(val('appointments')).toBe('—');
    expect(val('bookedRevenue')).toBe('—');
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(val('appointments')).toBe('6'));
    expect(screen.queryByTestId('booking-kpi-stale')).toBeNull();
  });
  it('the Arriving-soon window is sent to the server and remembered for this tab', async () => {
    const load = vi.fn().mockImplementation(async (q: { arrivingWindowMinutes?: number }) => today({ arrivingWindowMinutes: q.arrivingWindowMinutes ?? 60, arrivingSoon: { state: 'ok', value: q.arrivingWindowMinutes === 90 ? 3 : 2 } }));
    const onOpen = vi.fn();
    render(<BookingKpiStrip date="2026-11-02" load={load} onOpen={{ arrivingSoon: onOpen }} />);
    await waitFor(() => expect(val('arrivingSoon')).toBe('2'));
    fireEvent.change(screen.getByTestId('kpi-arriving-window'), { target: { value: '90' } });
    await waitFor(() => expect(val('arrivingSoon')).toBe('3'));
    expect(load).toHaveBeenLastCalledWith({ date: '2026-11-02', arrivingWindowMinutes: 90 });
    expect(sub('arrivingSoon')).toBe('Next 90 min');
    expect(onOpen).not.toHaveBeenCalled();   // changing the window does not open the list
    expect(JSON.parse(sessionStorage.getItem('aps.booking.kpiArrivingWindow') || 'null')).toBe(90);
  });
  it('tap → the board\'s filtered list where one exists; cards without a list (Available now, Booked revenue) are not buttons', async () => {
    const appointments = vi.fn(); const walkIns = vi.fn();
    render(<BookingKpiStrip date="2026-11-02" load={vi.fn().mockResolvedValue(today())} onOpen={{ appointments, walkIns }} />);
    await waitFor(() => expect(val('appointments')).toBe('6'));
    fireEvent.click(screen.getByTestId('kpi-value-appointments'));
    fireEvent.keyDown(screen.getByTestId('kpi-value-walkIns').closest('[data-kpi]')!, { key: 'Enter' });
    expect(appointments).toHaveBeenCalledTimes(1); expect(walkIns).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('kpi-value-bookedRevenue').closest('[data-kpi]')?.getAttribute('role')).toBe('group');
    expect(screen.getByTestId('kpi-value-availableNow').closest('[data-kpi]')?.getAttribute('role')).toBe('group');
  });
  it('a different board date never paints the previous date\'s numbers', async () => {
    let resolve!: (v: BookingKpiCards) => void;
    const load = vi.fn().mockResolvedValueOnce(today()).mockImplementationOnce(() => new Promise<BookingKpiCards>((r) => { resolve = r; }));
    const { rerender } = render(<BookingKpiStrip date="2026-11-02" load={load} />);
    await waitFor(() => expect(val('appointments')).toBe('6'));
    rerender(<BookingKpiStrip date="2026-11-09" load={load} />);
    expect(val('appointments')).toBe('—');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    resolve(today({ date: '2026-11-09', isToday: false, appointments: { state: 'ok', value: 0, awaitingConfirmation: 0, confirmed: 0, inSalon: 0, completed: 0 } }));
    await waitFor(() => expect(val('appointments')).toBe('0'));   // a real zero from the server is shown as 0
  });
  it('layout (booking200 §06 / P-07): six equal columns when wide, 3 × 2 then 2 × 3 when narrower, equal-height rows — by the strip\'s own width', async () => {
    render(<BookingKpiStrip date="2026-11-02" load={vi.fn().mockResolvedValue(today())} />);
    const grid = screen.getByTestId('booking-kpi-grid');
    expect(grid.className.split(/\s+/)).toEqual(expect.arrayContaining(['grid', 'grid-cols-2', '@2xl:grid-cols-3', '@6xl:grid-cols-6', 'auto-rows-fr']));
    expect(screen.getByTestId('booking-kpi-strip').className).toMatch(/@container/);
    await waitFor(() => expect(val('appointments')).toBe('6'));
  });
  it('carries no screenshot sample values and no print control (P-04 / P-11)', () => {
    const src = readFileSync(join(__dirname, 'BookingKpiStrip.tsx'), 'utf8');
    for (const sample of ['2,840', '2840', 'Luxe Nails', 'Sophia Nguyen', 'May 6, 2026']) expect(src.includes(sample), sample).toBe(false);
    expect(/print/i.test(src)).toBe(false);
  });
});
