import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/customerApi', () => ({ customerApi: { queue: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { LiveQueueScreen } from './LiveQueueScreen';

describe('LiveQueueScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('renders the real position, total waiting, and ETA range', async () => {
    (customerApi.queue as any).mockResolvedValue({ inQueue: true, queueItemId: 'q3', position: 3, totalWaiting: 4, estimatedWaitMinMinutes: 24, estimatedWaitMaxMinutes: 36, status: 'waiting' });
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('#3')).toBeInTheDocument();
    expect(screen.getByText(/in line of 4 waiting/)).toBeInTheDocument();
    expect(screen.getByText('24–36 mins')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
  });
  it('shows an honest not-in-line state', async () => {
    (customerApi.queue as any).mockResolvedValue({ inQueue: false });
    render(<MemoryRouter><LiveQueueScreen /></MemoryRouter>);
    expect(await screen.findByText('You’re not in line right now')).toBeInTheDocument();
  });
});
