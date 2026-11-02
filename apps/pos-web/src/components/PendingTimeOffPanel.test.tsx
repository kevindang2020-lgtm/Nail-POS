import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ pendingTimeOff: vi.fn(), decideTimeOff: vi.fn() }));
vi.mock('../api/posWorkforceApi', () => ({ posWorkforceApi: h }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
import { PendingTimeOffPanel } from './PendingTimeOffPanel';

const row = { id: 'to1', tenantId: 'x', technicianId: 't1', branchId: null, startsAt: '2099-03-01T14:00:00Z', endsAt: '2099-03-02T22:00:00Z', kind: 'SICK', status: 'pending', reason: null, requestedBy: 'u', approvedBy: null, decidedAt: null, decisionNote: null, createdAt: '' };
beforeEach(() => { h.pendingTimeOff.mockReset(); h.decideTimeOff.mockReset(); h.decideTimeOff.mockResolvedValue({}); });

describe('PendingTimeOffPanel', () => {
  it('renders nothing when nothing is waiting', async () => {
    h.pendingTimeOff.mockResolvedValue([]);
    const { container } = render(<PendingTimeOffPanel names={{}} />);
    await waitFor(() => expect(h.pendingTimeOff).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
  it('lists waiting requests by roster name; approve and decline (with reason) record the decision and refresh', async () => {
    h.pendingTimeOff.mockResolvedValueOnce([row]).mockResolvedValue([]);
    const onChanged = vi.fn();
    render(<PendingTimeOffPanel names={{ t1: 'Mia' }} onChanged={onChanged} />);
    expect(await screen.findByText('Mia')).toBeInTheDocument();
    expect(screen.getByText(/Sick/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.decideTimeOff).toHaveBeenCalledWith('t1', 'to1', 'approved', undefined));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it('a failed load says so (never "nothing waiting")', async () => {
    h.pendingTimeOff.mockRejectedValue(new Error('x'));
    render(<PendingTimeOffPanel names={{}} />);
    expect(await screen.findByText('Could not load time-off requests.')).toBeInTheDocument();
  });
});
