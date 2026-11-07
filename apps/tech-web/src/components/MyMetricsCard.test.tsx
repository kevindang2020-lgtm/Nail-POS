import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const metrics = vi.fn((p: string) => Promise.resolve({ period: p, from: '2026-11-06', to: '2026-11-06', timezone: 'America/New_York', clockedMinutes: 420, breakMinutes: 30, serviceMinutes: 45, readyMinutes: 345, turnUnits: p === 'today' ? 2 : 3, services: 1 }));
vi.mock('../api/techApi', () => ({ techApi: { metrics: (p: string) => metrics(p) } }));
import { MyMetricsCard } from './MyMetricsCard';

describe('MyMetricsCard (F5 §73)', () => {
  it('shows today’s ready time and turns, and switches to the week', async () => {
    render(<MyMetricsCard />);
    expect(await screen.findByTestId('my-metrics-ready')).toHaveTextContent('5h 45m');
    expect(screen.getByTestId('my-metrics-turns')).toHaveTextContent('2');
    fireEvent.click(screen.getByTestId('my-metrics-week'));
    await waitFor(() => expect(metrics).toHaveBeenLastCalledWith('week'));
    expect(await screen.findByText('3')).toBeInTheDocument();
  });
});
