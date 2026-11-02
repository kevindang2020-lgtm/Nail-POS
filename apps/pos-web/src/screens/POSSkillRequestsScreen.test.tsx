// POS Skill Requests: the manager approval queue for technician skill changes. Reads /tech/skills/change-requests/pending
// and approves/rejects via /tech/skills/change-requests/:id/decision. Verifies the queue renders, decisions call the real
// route and refresh, and a FAILED decision shows in the error (red) box — not the green success note.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/posSkillRequestsApi', () => ({ posSkillRequestsApi: { pending: vi.fn(), decide: vi.fn() } }));

import { posSkillRequestsApi } from '../api/posSkillRequestsApi';
import { POSSkillRequestsScreen } from './POSSkillRequestsScreen';

const req = (over: any = {}) => ({
  id: 'req1', serviceId: 'svc1', serviceName: 'Gel Manicure', requestType: 'add', note: null,
  status: 'pending', createdAt: '2026-06-17T14:30:00Z', decidedAt: null, technicianId: 'tech1', technicianName: 'Mia Tran', ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  (posSkillRequestsApi.pending as any).mockResolvedValue([req()]);
  (posSkillRequestsApi.decide as any).mockResolvedValue(req({ status: 'approved' }));
});

// Sep 2026 redesign (developer): the queue is a list of cards; "Review Request" opens a detail panel whose buttons are
// "Approve Request" / "Reject Request", and an optional decision note is passed as the third argument.
const openReview = async () => { await screen.findByText('Mia Tran'); fireEvent.click(screen.getByRole('button', { name: 'Review Request' })); };
const decidedWith = () => (posSkillRequestsApi.decide as any).mock.calls[0].slice(0, 2);

describe('POSSkillRequestsScreen', () => {
  it('renders the pending queue', async () => {
    render(<POSSkillRequestsScreen />);
    expect(await screen.findByText('Mia Tran')).toBeInTheDocument();
    expect(screen.getByText('1 Pending')).toBeInTheDocument();
    expect(screen.getByText('ADD')).toBeInTheDocument();
    expect(screen.getAllByText(/Gel Manicure/).length).toBeGreaterThan(0);
  });

  it('approves a request via the real decision route and refreshes', async () => {
    render(<POSSkillRequestsScreen />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Request' }));
    await waitFor(() => expect(posSkillRequestsApi.decide).toHaveBeenCalled());
    expect(decidedWith()).toEqual(['req1', 'approved']);
    expect(await screen.findByText(/marked as approved/i)).toBeInTheDocument();   // success note
    expect(posSkillRequestsApi.pending).toHaveBeenCalledTimes(2);                // initial load + refresh
  });

  it('rejects a request via the real decision route', async () => {
    render(<POSSkillRequestsScreen />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Reject Request' }));
    await waitFor(() => expect(posSkillRequestsApi.decide).toHaveBeenCalled());
    expect(decidedWith()).toEqual(['req1', 'rejected']);
  });

  it('shows a failed decision as an error, not a green success note', async () => {
    (posSkillRequestsApi.decide as any).mockRejectedValue(new Error('Not permitted'));
    render(<POSSkillRequestsScreen />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Request' }));
    const msg = await screen.findByText('Not permitted');
    // the message must render in the error box (role status is reserved for the success note), not be styled as success
    expect(msg.closest('[role="status"]')).toBeNull();
  });

  // Decision 7: the reviewer's middle steps are reachable from the screen.
  it('Start Review moves a submitted request to under review', async () => {
    (posSkillRequestsApi.pending as any).mockResolvedValue([req({ status: 'submitted' })]);
    (posSkillRequestsApi.decide as any).mockResolvedValue(req({ status: 'under_review' }));
    render(<POSSkillRequestsScreen />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'Start Review' }));
    await waitFor(() => expect(posSkillRequestsApi.decide).toHaveBeenCalled());
    expect(decidedWith()).toEqual(['req1', 'under_review']);
  });

  it('Request More Info needs a note and sends it; it is not offered once the request is waiting on the technician', async () => {
    (posSkillRequestsApi.pending as any).mockResolvedValue([req({ status: 'under_review' })]);
    (posSkillRequestsApi.decide as any).mockResolvedValue(req({ status: 'more_information_required' }));
    render(<POSSkillRequestsScreen />);
    await openReview();
    expect(screen.queryByRole('button', { name: 'Start Review' })).toBeNull();          // already under review
    const ask = screen.getByRole('button', { name: 'Request More Info' });
    expect(ask).toBeDisabled();                                                          // no note yet
    fireEvent.change(screen.getByPlaceholderText(/Notes for the technician/), { target: { value: 'Add a photo of a finished set.' } });
    expect(ask).not.toBeDisabled();
    fireEvent.click(ask);
    await waitFor(() => expect(posSkillRequestsApi.decide).toHaveBeenCalled());
    expect((posSkillRequestsApi.decide as any).mock.calls[0]).toEqual(['req1', 'more_information_required', 'Add a photo of a finished set.']);
  });

  it('a request waiting on the technician shows the reviewer note and only Approve / Reject', async () => {
    (posSkillRequestsApi.pending as any).mockResolvedValue([req({ status: 'more_information_required', reviewNotes: 'Add a photo of a finished set.' })]);
    render(<POSSkillRequestsScreen />);
    await openReview();
    expect(screen.getByText('Add a photo of a finished set.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Review' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Request More Info' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve Request' })).toBeInTheDocument();
  });

  it('the Pending count counts only requests waiting on the reviewer', async () => {
    (posSkillRequestsApi.pending as any).mockResolvedValue([req({ id: 'a', status: 'submitted' }), req({ id: 'b', status: 'approved' }), req({ id: 'c', status: 'more_information_required' })]);
    render(<POSSkillRequestsScreen />);
    expect(await screen.findByText('1 Pending')).toBeInTheDocument();
  });
});
