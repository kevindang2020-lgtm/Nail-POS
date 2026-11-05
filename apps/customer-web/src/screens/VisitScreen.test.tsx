// VisitScreen (customer "My Visit"): the live in-progress service display fed by GET /customer/service-progress. Verifies the
// active-service render (name / status label / progress % / elapsed), the "almost ready" cue near completion, the
// ready-for-checkout status, the no-active-service empty state, and the error path.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../api/customerApi', () => ({ customerApi: { serviceProgress: vi.fn() } }));

import { customerApi } from '../api/customerApi';
import { VisitScreen } from './VisitScreen';

const active = (over: any = {}) => ({
  ticketId: 'tk1', serviceName: 'Gel-X Full Set', status: 'serving',
  startedAt: new Date(Date.now() - 150000).toISOString(), elapsedSeconds: 150,
  progressPercent: 45, estimatedFinishTime: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (customerApi.serviceProgress as any).mockResolvedValue(active());
});
afterEach(() => { vi.clearAllTimers(); });

describe('VisitScreen', () => {
  it('renders the active service with status, progress and elapsed time', async () => {
    render(<VisitScreen />);
    expect(await screen.findByText('Gel-X Full Set')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();    // 'serving' -> label
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText('Elapsed 2:30')).toBeInTheDocument();   // 150s, no est. finish
    expect(screen.queryByText(/Almost ready/)).not.toBeInTheDocument();
  });

  it('shows the almost-ready cue near completion', async () => {
    (customerApi.serviceProgress as any).mockResolvedValue(active({ progressPercent: 85 }));
    render(<VisitScreen />);
    expect(await screen.findByText(/Almost ready/)).toBeInTheDocument();
  });

  it('labels a wrapped service as ready for checkout', async () => {
    (customerApi.serviceProgress as any).mockResolvedValue(active({ status: 'ready_checkout', progressPercent: 100 }));
    render(<VisitScreen />);
    expect(await screen.findByText('Ready for checkout')).toBeInTheDocument();
  });

  it('shows the empty state when no service is in progress', async () => {
    (customerApi.serviceProgress as any).mockResolvedValue(null);
    render(<VisitScreen />);
    expect(await screen.findByText(/service in progress right now/)).toBeInTheDocument();
  });

  it('shows an error when the visit cannot be loaded', async () => {
    (customerApi.serviceProgress as any).mockRejectedValue({ message: 'Could not load your visit.' });
    render(<VisitScreen />);
    expect(await screen.findByText('Could not load your visit.')).toBeInTheDocument();
  });
});
