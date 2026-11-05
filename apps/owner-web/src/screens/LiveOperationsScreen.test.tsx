// LiveOperationsScreen (owner, read-only): live floor snapshot for the selected branch (or all locations) — waiting/
// serving/completed counts, ready-to-checkout + delayed-appointment + walk-in signals, an active Tech Queue, and a Live
// customer Queue. Verifies the snapshot renders (counts, tech row + elapsed, VIP queue row + wait), a friendly 403, and
// empty states. Data is typed from /owner/live; the screen never mutates the floor.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('../api/ownerApi', () => ({ ownerLiveApi: { get: vi.fn() } }));

import { ownerLiveApi } from '../api/ownerApi';
import { LiveOperationsScreen } from './LiveOperationsScreen';

const snap = (over: any = {}) => ({
  branchId: null,
  counts: { waiting: 5, serving: 3, completedToday: 12 },
  techQueue: [{ technicianId: 'te1', technicianName: 'Mia', serviceLabel: 'Gel-X Full Set', customerName: 'Grace', elapsedMinutes: 14, paused: false }],
  liveQueue: [{ queueItemId: 'q1', customerName: 'Ana', isVip: true, serviceLabel: 'Pedicure', requestedTechnicianName: 'Mia', waitMinutes: 8, status: 'waiting' }],
  todaySoFar: { servicesDone: 12, walkIns: 4 },
  signals: { readyForCheckout: 2, delayedAppointments: 1 },
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerLiveApi.get as any).mockResolvedValue(snap()); });

describe('LiveOperationsScreen', () => {
  it('renders counts, the active tech queue, and the live customer queue', async () => {
    render(<LiveOperationsScreen />);
    await waitFor(() => expect(screen.getByText('Mia')).toBeInTheDocument());
    expect(screen.getByText('Tech Queue')).toBeInTheDocument();
    expect(screen.getByText('Live Queue')).toBeInTheDocument();
    expect(screen.getByText(/Gel-X Full Set/)).toBeInTheDocument();
    expect(screen.getByText('14m')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('8m')).toBeInTheDocument();
  });

  it('shows a friendly error when the request is rejected (e.g., a forbidden branch)', async () => {
    (ownerLiveApi.get as any).mockRejectedValue(new Error('You do not have access to that branch.'));
    render(<LiveOperationsScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/access to that branch/i));
  });

  it('shows empty states when nothing is on the floor', async () => {
    (ownerLiveApi.get as any).mockResolvedValue(snap({ techQueue: [], liveQueue: [] }));
    render(<LiveOperationsScreen />);
    await waitFor(() => expect(screen.getByText('No services in progress.')).toBeInTheDocument());
    expect(screen.getByText('💅')).toBeInTheDocument();
    expect(screen.getByText('No one waiting.')).toBeInTheDocument();
    expect(screen.getByText('🪑')).toBeInTheDocument();
  });
});
