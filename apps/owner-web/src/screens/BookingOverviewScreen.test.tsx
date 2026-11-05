// BookingOverviewScreen (owner, read-only): status donut + legend, 7-day trend, completion/cancellation/no-show rate cards,
// and a legend->drill-down. Verifies the donut/legend/rate rendering, the drill-down call + row render + toggle-close, the
// period toggle, the empty state, and a friendly 403. Data is typed from /owner/bookings/overview + /owner/bookings/drill-down.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back: vi.fn() }) }));
vi.mock('../api/ownerApi', () => ({ ownerBookingsApi: { overview: vi.fn(), drillDown: vi.fn() } }));

import { ownerBookingsApi } from '../api/ownerApi';
import { BookingOverviewScreen } from './BookingOverviewScreen';

const overview = (over: any = {}) => ({
  dateFrom: '2026-06-15T12:00:00.000Z', dateTo: '2026-06-21T12:00:00.000Z', totalBookings: 50,
  completed: { count: 40, percentage: 80.0 }, cancelled: { count: 7, percentage: 14.0 }, noShow: { count: 3, percentage: 6.0 },
  trend: [5, 8, 6, 9, 11, 12, 5].map((c, i) => ({ date: `2026-06-1${i}`, bookingCount: c })),
  completionRate: 80.0, completionRateTrendPercent: 4.0,
  cancellationRate: 14.0, cancellationRateTrendPercent: -2.0,
  noShowRate: 6.0, noShowRateTrendPercent: 1.0,
  bookingSources: [{ label: 'Online', count: 30, percentage: 60 }, { label: 'Phone', count: 11, percentage: 22 }, { label: 'Walk-in', count: 5, percentage: 10 }, { label: 'Other', count: 4, percentage: 8 }], ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (ownerBookingsApi.overview as any).mockResolvedValue(overview());
  (ownerBookingsApi.drillDown as any).mockResolvedValue([{ appointmentId: 'a1', customerName: 'Jane Doe', startTime: '10:00', endTime: '11:00', source: 'walk_in', status: 'completed' }]);
});

const card = (label: string) => screen.getByText(label).closest('.owner-kpi') as HTMLElement;

describe('BookingOverviewScreen', () => {
  it('renders the donut total, legend counts and rate cards', async () => {
    render(<BookingOverviewScreen />);
    expect(await screen.findByText('50')).toBeInTheDocument();          // donut center total
    expect(screen.getByText('June 15, 2026')).toBeInTheDocument();      // period start (local-stable)
    expect(screen.getByText('40')).toBeInTheDocument();                 // completed count
    expect(screen.getByText('7')).toBeInTheDocument();                  // cancelled count
    expect(screen.getByText('3')).toBeInTheDocument();                  // no-show count
    expect(within(card('Completion Rate')).getByText('80.0%')).toBeInTheDocument();
    expect(within(card('Cancellation Rate')).getByText('14.0%')).toBeInTheDocument();
    expect(within(card('No-Show Rate')).getByText('6.0%')).toBeInTheDocument();
    // Booking Insights (source mix)
    expect(screen.getByText('Booking Insights')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();                // online share
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
  });

  it('opens a drill-down from the legend and toggles it closed', async () => {
    render(<BookingOverviewScreen />);
    await screen.findByText('50');
    fireEvent.click(screen.getByText('Completed').closest('[role="button"]') as HTMLElement);
    await waitFor(() => expect(ownerBookingsApi.drillDown).toHaveBeenCalledWith({ period: 'week', status: 'completed', branchId: undefined }));
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('completed appointments (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Completed').closest('[role="button"]') as HTMLElement);
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('reloads for the Daily period when toggled', async () => {
    render(<BookingOverviewScreen />);
    await screen.findByText('50');
    fireEvent.click(screen.getByText('Daily'));
    await waitFor(() => expect((ownerBookingsApi.overview as any).mock.calls.some((c: any[]) => c[0] === 'today')).toBe(true));
  });

  it('shows the empty state when there are no bookings', async () => {
    (ownerBookingsApi.overview as any).mockResolvedValue(overview({ totalBookings: 0 }));
    render(<BookingOverviewScreen />);
    expect(await screen.findByText('No bookings found')).toBeInTheDocument();
  });

  it('shows a friendly 403 with Retry', async () => {
    (ownerBookingsApi.overview as any).mockRejectedValue({ status: 403 });
    render(<BookingOverviewScreen />);
    expect(await screen.findByText('You do not have access to booking reports.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
