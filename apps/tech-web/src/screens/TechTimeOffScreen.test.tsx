// TechTimeOffScreen (merge Oct 12 2026) — our 528/582 vocabulary: pending | approved | rejected | cancelled.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';

const h = vi.hoisted(() => ({ timeOff: vi.fn(), requestTimeOff: vi.fn(), withdrawTimeOff: vi.fn() }));
vi.mock('../api/techApi', () => ({ techApi: h }));
import { TechTimeOffScreen } from './TechTimeOffScreen';

const base = { tenantId: 'x', branchId: null, technicianId: 't1', requestedBy: 'u', approvedBy: null, decidedAt: null, createdAt: '' };
const pending = { ...base, id: 'r1', startsAt: '2099-03-01T14:00:00Z', endsAt: '2099-03-02T22:00:00Z', kind: 'VACATION', status: 'pending', reason: null, decisionNote: null };
const declined = { ...base, id: 'r2', startsAt: '2099-04-01T14:00:00Z', endsAt: '2099-04-02T22:00:00Z', kind: 'SICK', status: 'rejected', reason: null, decisionNote: 'Short-staffed' };
const withdrawn = { ...base, id: 'r3', startsAt: '2099-05-01T14:00:00Z', endsAt: '2099-05-02T22:00:00Z', kind: 'PERSONAL', status: 'cancelled', reason: null, decisionNote: null };
beforeEach(() => { Object.values(h).forEach((f) => f.mockReset()); h.timeOff.mockResolvedValue([pending, declined, withdrawn]); h.requestTimeOff.mockResolvedValue(pending); h.withdrawTimeOff.mockResolvedValue({ ok: true }); });
const mount = () => render(<TechNavProvider><TechTimeOffScreen /></TechNavProvider>);

describe('TechTimeOffScreen', () => {
  it('lists a waiting request, a declined one with the salon note, and hides a withdrawn one', async () => {
    mount();
    expect(await screen.findByText('Waiting for the salon')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText('Salon note: Short-staffed')).toBeInTheDocument();
    expect(screen.queryByText('Withdrawn')).toBeNull();   // a withdrawn request is not listed
  });
  it('withdraws a waiting request only after the in-app confirm (no native dialog)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    expect(h.withdrawTimeOff).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    await waitFor(() => expect(h.withdrawTimeOff).toHaveBeenCalledWith('r1'));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
  it('validates the window, then sends ISO times and the chosen type', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/starts and ends/);
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2099-03-02T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2099-03-01T18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/after the start/);
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2099-03-03T18:00' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'SICK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(h.requestTimeOff).toHaveBeenCalledWith({ startsAt: new Date('2099-03-02T09:00').toISOString(), endsAt: new Date('2099-03-03T18:00').toISOString(), kind: 'SICK' }));
    expect(await screen.findByText(/Request sent/)).toBeInTheDocument();
  });
});
