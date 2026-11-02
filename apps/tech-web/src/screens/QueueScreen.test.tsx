// QueueScreen (1:1): GET /tech/queue/state now returns My Queue (waiting for this tech) + branch All lists. Verifies the
// turn indicator + waiting copy, the My Queue list, the All-tab branch list, the not-active/empty states, and the break
// start/end actions calling the real endpoints.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../shell/nav', () => ({ useTechNav: () => ({ back: vi.fn(), openTicket: vi.fn() }) }));
vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../lib/tech', () => ({
  clock: () => '2:00 PM', statusLabel: (s: string) => s, statusKind: (s: string) => s,
  initials: (n?: string) => (n ? n.slice(0, 2).toUpperCase() : 'XX'),
}));
vi.mock('../api/techApi', () => ({ techApi: { queue: vi.fn(), startBreak: vi.fn(), endBreak: vi.fn() } }));

import { techApi } from '../api/techApi';
import { QueueScreen } from './QueueScreen';

const entry = (over: any = {}) => ({ ticketId: 'k1', ticketNumber: 'T-1043', name: 'Jane Doe', serviceSummary: 'Gel Manicure', scheduledTime: '2026-06-17T14:00:00Z', status: 'waiting', vip: false, mine: true, ...over });
const queue = (over: any = {}) => ({
  turnPosition: 3, status: 'available', onBreak: false,
  myQueue: [entry(), entry({ ticketId: 'k2', ticketNumber: 'T-1044', name: 'Bob Lee', serviceSummary: 'Spa Pedicure', scheduledTime: null })],
  branchQueue: [entry({ ticketId: 'k9', ticketNumber: 'T-1099', name: 'Olivia Brown', serviceSummary: 'Pedicure', mine: false })],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.queue as any).mockResolvedValue(queue());
  (techApi.startBreak as any).mockResolvedValue({ status: 'on_break' });
  (techApi.endBreak as any).mockResolvedValue({ status: 'available' });
});

describe('QueueScreen', () => {
  it('renders the turn indicator, waiting count, and the My Queue customers', async () => {
    render(<QueueScreen />);
    expect(await screen.findByText('#3')).toBeInTheDocument();
    expect(screen.getByText('3 customers waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Bob Lee')).toBeInTheDocument();
    expect(screen.getByText(/Gel Manicure/)).toBeInTheDocument();
  });

  it('switches to the branch All queue', async () => {
    render(<QueueScreen />);
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(await screen.findByText('Olivia Brown')).toBeInTheDocument();
  });

  it('shows the not-active state and empty My Queue', async () => {
    (techApi.queue as any).mockResolvedValue(queue({ turnPosition: null, myQueue: [], branchQueue: [] }));
    render(<QueueScreen />);
    expect(await screen.findByText('Your queue turn is not active.')).toBeInTheDocument();
    expect(screen.getByText('No one is up next for you.')).toBeInTheDocument();
  });

  it('starts a break via the real endpoint', async () => {
    render(<QueueScreen />);
    await screen.findByText('#3');
    fireEvent.click(screen.getByRole('button', { name: /Take Lunch Break/ }));
    await waitFor(() => expect(techApi.startBreak).toHaveBeenCalled());
    expect(await screen.findByText('Lunch break started.')).toBeInTheDocument();
  });

  it('ends a break when on break', async () => {
    (techApi.queue as any).mockResolvedValue(queue({ onBreak: true }));
    render(<QueueScreen />);
    const endBtn = await screen.findByRole('button', { name: 'End Break' });
    fireEvent.click(endBtn);
    await waitFor(() => expect(techApi.endBreak).toHaveBeenCalled());
  });

  it('BUILD_PLAN Phase 6: shows how each of YOUR guests came to you — AI suggestion, auto-assign, locked to you', async () => {
    (techApi.queue as any).mockResolvedValue(queue({
      myQueue: [
        entry({ ticketId: 'a1', name: 'Ann Ai', assignSource: 'ai_suggestion' }),
        entry({ ticketId: 'a2', name: 'Al Auto', queueItemId: 'q2', assignSource: 'auto_assign', lock: { technicianId: 'me', reason: 'Regular client' }, lockedToYou: true }),
        entry({ ticketId: 'a3', name: 'Sam Staff', queueItemId: 'q3', assignSource: 'staff', lock: null, lockedToYou: false }),
      ],
      branchQueue: [entry({ ticketId: 'o1', name: 'Other Guest', mine: false, assignSource: 'auto_assign', lock: { technicianId: 'someone', reason: null }, lockedToYou: false })],
    }));
    render(<QueueScreen />);
    const ai = await screen.findByRole('button', { name: /Ann Ai/ });
    expect(ai).toHaveTextContent('Suggested by AI');
    expect(ai).toHaveAccessibleName(/Suggested by AI/);
    const auto = screen.getByRole('button', { name: /Al Auto/ });
    expect(auto).toHaveTextContent('Auto-assigned');
    expect(auto).toHaveTextContent('Locked to you');
    const staff = screen.getByRole('button', { name: /Sam Staff/ });
    expect(staff.querySelector('[data-testid="assignment-origin"]')).toBeNull();   // a plain front-desk assignment: no chip
    // another technician's guest on the All tab never carries "how it came to you"
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    const other = await screen.findByRole('button', { name: /Other Guest/ });
    expect(other).not.toHaveTextContent('Auto-assigned');
    expect(other).not.toHaveTextContent('Locked to you');
  });

  it('BUILD_PLAN Phase 6: without a source or lock from the server, no chip is guessed', async () => {
    render(<QueueScreen />);
    await screen.findByText('Jane Doe');
    expect(screen.queryByTestId('assignment-origin')).toBeNull();
  });

  it('multi-technician routing: a part of a shared visit shows the chip and who else is on it', async () => {
    (techApi.queue as any).mockResolvedValue(queue({ myQueue: [entry({ serviceSummary: 'Pedicure', sharedVisit: { visitPart: 2, partCount: 2, others: [{ technicianName: 'Mia', serviceNames: ['Manicure'], status: 'serving' }] } })] }));
    render(<QueueScreen />);
    expect(await screen.findByText('Shared visit · Part 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('With Mia (Manicure)')).toBeInTheDocument();
  });

  it('shows an error when the queue fails to load', async () => {
    (techApi.queue as any).mockRejectedValue(new Error('queue down'));
    render(<QueueScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('queue down');
  });
});
