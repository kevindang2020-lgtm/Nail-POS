// Technician App own-data screens (merge Oct 12 2026): each calls ONE route of AUTH's tech self-service controller.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';

const h = vi.hoisted(() => ({ timeClockSummary: vi.fn(), performance: vi.fn(), tips: vi.fn(), myCustomers: vi.fn() }));
vi.mock('../api/techApi', () => ({ techApi: h }));
import { TechTimeClockScreen, TechPerformanceScreen, TechTipsScreen, TechCustomersScreen } from './TechMyWorkScreens';
const wrap = (el: JSX.Element) => render(<TechNavProvider>{el}</TechNavProvider>);

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.timeClockSummary.mockResolvedValue({ clockStatus: 'ON_BREAK', timezone: 'America/New_York', today: { punches: [{ start: '2026-10-12T13:00:00Z', end: null, minutes: 125 }], breaks: [{ kind: 'lunch', start: '2026-10-12T15:00:00Z', end: null, minutes: 10 }], workedMinutes: 115, breakMinutes: 10 }, weekWorkedMinutes: 900 });
  h.performance.mockImplementation(async (days: number) => ({ windowDays: days, servicesCompleted: 12, ticketsServed: 9, salesCents: 54000, averageTicketCents: 6000, tipsCents: 9000, tipRatePercent: 16.7, rating: { average: null, count: 0 }, returningCustomerPercent: 33 }));
  h.tips.mockResolvedValue({ windowDays: 14, totalCents: 2550, cardCents: 1550, cashCents: 1000, byDay: [{ date: '2026-10-11', cardCents: 1550, cashCents: 1000 }] });
  h.myCustomers.mockResolvedValue([{ customerKey: 'c1', displayName: 'Ann A.', visits: 2, lastVisitAt: '2026-10-11T15:00:00Z', lastServices: ['Gel Manicure'] }]);
});

describe('Technician App — my work screens', () => {
  it('Time Clock shows status, worked / break / week totals and the breaks list', async () => {
    wrap(<TechTimeClockScreen />);
    expect(await screen.findByText('On break')).toBeInTheDocument();
    expect(screen.getByText('1h 55m')).toBeInTheDocument();
    expect(screen.getByText('0h 10m')).toBeInTheDocument();
    expect(screen.getByText('15h 00m')).toBeInTheDocument();
    expect(screen.getByText(/Lunch/)).toBeInTheDocument();
    expect(h.timeClockSummary).toHaveBeenCalledTimes(1);
  });
  it('Performance re-queries on a window switch and shows "—" for an unknown rating', async () => {
    wrap(<TechPerformanceScreen />);
    expect(await screen.findByText('$540.00')).toBeInTheDocument();
    expect(h.performance).toHaveBeenLastCalledWith(30);
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '90 days' }));
    await waitFor(() => expect(h.performance).toHaveBeenLastCalledWith(90));
  });
  it('Tips shows the card / cash split and the per-day total', async () => {
    wrap(<TechTipsScreen />);
    expect((await screen.findAllByText('$25.50')).length).toBe(2);   // total metric + the day row
    expect(screen.getByText('$15.50')).toBeInTheDocument();
  });
  it('My Clients lists name + visits + last services; a search re-queries', async () => {
    wrap(<TechCustomersScreen />);
    expect(await screen.findByText('Ann A.')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search clients'), { target: { value: 'Ann' } });
    await waitFor(() => expect(h.myCustomers).toHaveBeenLastCalledWith('Ann'), { timeout: 2000 });
  });
  it('an error is shown, never an invented zero', async () => {
    h.tips.mockRejectedValue(new Error('Tips are unavailable.'));
    wrap(<TechTipsScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Tips are unavailable.');
    expect(screen.queryByText('$0')).toBeNull();
  });
});
