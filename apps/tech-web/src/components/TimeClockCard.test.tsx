// TimeClockCard.test.tsx — Decision 9: the Technician App shows the technician's own clock state and clocks in / out
// through the real routes; a refused clock-out (mid-service) shows the server's reason as an alert, not success.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../api/techApi', async (orig) => ({
  ...(await orig<typeof import('../api/techApi')>()),
  techApi: { timeClock: vi.fn(), clockIn: vi.fn(), clockOut: vi.fn() },
}));
import { techApi } from '../api/techApi';
import { TimeClockCard } from './TimeClockCard';

const view = (over: any = {}) => ({ state: 'clocked_out', clockedInAt: null, lastClockOutAt: null, hoursToday: 0, serverTime: '2026-10-01T13:00:00Z', ...over });
beforeEach(() => { vi.clearAllMocks(); });

describe('TimeClockCard', () => {
  it('clocked out -> Clock In calls the route (no time sent) and shows the server time', async () => {
    (techApi.timeClock as any).mockResolvedValue(view());
    (techApi.clockIn as any).mockResolvedValue(view({ state: 'clocked_in', clockedInAt: '2026-10-01T13:02:00Z' }));
    render(<TimeClockCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clock In' }));
    await waitFor(() => expect(techApi.clockIn).toHaveBeenCalledWith());
    expect(await screen.findByRole('status')).toHaveTextContent(/Clocked in at/);
    expect(screen.getByRole('button', { name: 'Clock Out' })).toBeInTheDocument();
  });

  it('a refused clock-out shows the reason as an alert and stays clocked in', async () => {
    (techApi.timeClock as any).mockResolvedValue(view({ state: 'clocked_in', clockedInAt: '2026-10-01T09:00:00Z', hoursToday: 4.5 }));
    (techApi.clockOut as any).mockRejectedValue(new Error('Finish your current service before clocking out.'));
    render(<TimeClockCard />);
    expect(await screen.findByText('4h 30m')).toBeInTheDocument();   // the "Today:" footer row
    expect(screen.getByText(/Since/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clock Out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish your current service before clocking out.');
    expect(screen.getByText('Clocked In')).toBeInTheDocument();
  });

  it('renders nothing when the clock cannot be read (no profile / app off)', async () => {
    (techApi.timeClock as any).mockRejectedValue(new Error('No technician profile'));
    const { container } = render(<TimeClockCard />);
    await waitFor(() => expect(techApi.timeClock).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="time-clock-card"]')).toBeNull());
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('rounds hours to whole minutes — 1.999 h reads 2h 00m, never 1h 60m', async () => {
    (techApi.timeClock as any).mockResolvedValue(view({ hoursToday: 1.999 }));
    render(<TimeClockCard />);
    expect(await screen.findByText('2h 00m')).toBeInTheDocument();
  });

  it('shows a skeleton (no button) until the dashboard is ready, then the clock', async () => {
    (techApi.timeClock as any).mockResolvedValue(view());
    const { rerender } = render(<TimeClockCard ready={false} />);
    await waitFor(() => expect(techApi.timeClock).toHaveBeenCalled());
    expect(screen.getByRole('status', { name: 'Loading time clock' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TimeClockCard ready />);
    expect(await screen.findByRole('button', { name: 'Clock In' })).toBeInTheDocument();
    expect(screen.getByText('Ready for shift')).toBeInTheDocument();
  });
});
