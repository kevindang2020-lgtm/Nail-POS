// ScheduleProposalsScreen.test.tsx — BUILD_PLAN Phase 7: the customer's "approve a new time" page (/appointments/proposals).
// Original and proposed time side by side (the original is kept until approval), approve / keep original with the
// proposal's version, a 409 reloads with a plain message, answered / expired ones show their status only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api: Record<string, any> = { list: vi.fn(), approve: vi.fn(), reject: vi.fn() };
vi.mock('../api/customerScheduleProposalsApi', async (orig) => ({ ...(await orig<any>()), customerScheduleProposalsApi: new Proxy({}, { get: (_t, k: string) => (...a: any[]) => api[k](...a) }) }));
import { ScheduleProposalsScreen } from './ScheduleProposalsScreen';

const proposal = (o: any = {}) => ({
  id: 'p1', salonName: 'Glow Nails', branchName: 'Cherry Hill', appointmentId: 'a1', services: ['Gel Manicure', 'Nail Art'],
  original: { date: '2026-10-09', startTime: '10:00', technicianName: 'Mia' }, proposed: { date: '2026-10-09', startTime: '11:15', technicianName: 'Leo' },
  reason: 'Leo has an opening and you would not wait.', status: 'customer_notified', expiresAt: '2026-10-09T08:00:00Z', version: 3, ...o,
});
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.list.mockResolvedValue([proposal(), proposal({ id: 'p2', status: 'customer_approved', version: 5 })]); });
const renderIt = () => render(<MemoryRouter><ScheduleProposalsScreen /></MemoryRouter>);

describe('ScheduleProposalsScreen', () => {
  it('shows original vs proposed, services, salon and the reason; answered ones have no buttons', async () => {
    renderIt();
    const cards = await screen.findAllByTestId('proposal-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('Glow Nails · Cherry Hill');
    expect(within(cards[0]).getByTestId('proposal-original').textContent).toContain('10:00 AM');
    expect(within(cards[0]).getByTestId('proposal-original').textContent).toContain('Mia');
    expect(within(cards[0]).getByTestId('proposal-new').textContent).toContain('11:15 AM');
    expect(within(cards[0]).getByTestId('proposal-new').textContent).toContain('Leo');
    expect(cards[0].textContent).toContain('Gel Manicure, Nail Art');
    expect(cards[0].textContent).toContain('Your original time stays booked until you approve');
    expect(within(cards[1]).queryByText('Approve new time')).toBeNull();
    expect(cards[1].textContent).toContain('You approved');
  });
  it('approve sends the proposal version and shows the answer', async () => {
    api.approve.mockResolvedValue({ proposal: proposal({ status: 'customer_approved', version: 4 }) });
    renderIt();
    const card = (await screen.findAllByTestId('proposal-card'))[0];
    fireEvent.click(within(card).getByText('Approve new time'));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('p1', 3));
    expect(await screen.findByRole('status')).toHaveTextContent(/approved/i);
  });
  it('keep my original time = reject with the version', async () => {
    api.reject.mockResolvedValue({ proposal: proposal({ status: 'customer_rejected', version: 4 }) });
    renderIt();
    const card = (await screen.findAllByTestId('proposal-card'))[0];
    fireEvent.click(within(card).getByText('Keep my original time'));
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith('p1', 3));
    expect(await screen.findByRole('status')).toHaveTextContent(/original time stays/i);
  });
  it('409 → plain message and the list reloads', async () => {
    api.approve.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409, code: 'VERSION_CONFLICT' }));
    renderIt();
    const card = (await screen.findAllByTestId('proposal-card'))[0];
    fireEvent.click(within(card).getByText('Approve new time'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed/i);
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });
  it('empty → plain message', async () => {
    api.list.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText(/No time changes to review/)).toBeInTheDocument();
  });
});
