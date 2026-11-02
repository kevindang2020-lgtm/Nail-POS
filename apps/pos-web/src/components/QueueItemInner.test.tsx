import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { REALTIME_EVENT } from '../realtime/realtime-client';

const item = vi.fn();
const callNext = vi.fn();
vi.mock('../api/posQueueApi', () => ({
  posQueueApi: { item: (...a: any[]) => item(...a), callNext: (...a: any[]) => callNext(...a), startService: vi.fn(), moveToServing: vi.fn(), notifyCustomer: vi.fn() },
}));

import { QueueItemInner } from './QueueItemInner';

const qi = {
  queueItemId: 'q1', customerName: 'Ava Thompson', customerPhone: '(555) 111-2222', isVip: true,
  requestedServices: [{ serviceName: 'Nail Art' }], serviceCount: 1, priority: 'high', status: 'waiting',
  requestedTechnicianName: 'Mia', bestMatchTechnicianName: 'Mia Johnson', assignedTechnicianName: null,
  quotedWaitMinutes: 28, actualWaitMinutes: 25, allergies: 'Latex', notes: 'Prefers a quiet station', visitCount: 5, loyaltyPoints: 300,
};

beforeEach(() => { item.mockReset(); callNext.mockReset(); item.mockResolvedValue(qi); callNext.mockResolvedValue({}); });

describe('QueueItemInner (iPad queue view — real data)', () => {
  it('loads the real queue item: guest, services, priority, status, wait, tech, allergies, notes', async () => {
    render(<QueueItemInner queueItemId="q1" />);
    await waitFor(() => expect(screen.getByText('Ava Thompson')).toBeTruthy());
    expect(item).toHaveBeenCalledWith('q1');
    expect(screen.getByText('Nail Art')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.getByText('28 min')).toBeTruthy();       // quoted wait
    expect(screen.getByText(/Unassigned/)).toBeTruthy();
    expect(screen.getByText(/Latex/)).toBeTruthy();
    expect(screen.getByText(/Prefers a quiet station/)).toBeTruthy();
  });

  it('Call Next calls the real endpoint and refreshes', async () => {
    const onChanged = vi.fn();
    render(<QueueItemInner queueItemId="q1" initial={qi as any} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Call Next'));
    await waitFor(() => expect(callNext).toHaveBeenCalledWith('q1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('re-fetches when a realtime queue event changes the record', async () => {
    render(<QueueItemInner queueItemId="q1" />);
    await waitFor(() => expect(item).toHaveBeenCalledTimes(1));
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { screens: ['queue'] } })); });
    await waitFor(() => expect(item).toHaveBeenCalledTimes(2));
  });

  it('renders an error state when the item fails to load', async () => {
    item.mockRejectedValueOnce(new Error('nope'));
    render(<QueueItemInner queueItemId="q1" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('optimistically flips the status badge before the server responds', async () => {
    let resolveCall: () => void = () => {};
    callNext.mockReturnValue(new Promise<void>((r) => { resolveCall = () => r(); }));
    render(<QueueItemInner queueItemId="q1" initial={qi as any} />);
    fireEvent.click(screen.getByText('Call Next'));
    // The badge shows "Called" instantly — no waiting on the round-trip.
    expect(screen.getByText('Called')).toBeTruthy();
    await act(async () => { resolveCall(); });
  });

  it('rolls the badge back and surfaces the reason when the action fails', async () => {
    callNext.mockRejectedValue(new Error('That guest was already called.'));
    render(<QueueItemInner queueItemId="q1" initial={qi as any} />);
    fireEvent.click(screen.getByText('Call Next'));
    await waitFor(() => expect(screen.getByText('That guest was already called.')).toBeTruthy());
    expect(screen.getByText('Waiting')).toBeTruthy();   // rolled back from the optimistic "Called"
  });

  it('hides queue transition actions for a guest already in service (no dead-end taps)', async () => {
    item.mockResolvedValue({ ...qi, status: 'in_service' });
    render(<QueueItemInner queueItemId="q1" />);
    await waitFor(() => expect(screen.getByText('Ava Thompson')).toBeTruthy());
    expect(screen.queryByText('Call Next')).toBeNull();
    expect(screen.queryByText('Start Service')).toBeNull();
    expect(screen.queryByText('Move to Serving')).toBeNull();
    expect(screen.getByText(/No queue actions/)).toBeTruthy();
  });
});
