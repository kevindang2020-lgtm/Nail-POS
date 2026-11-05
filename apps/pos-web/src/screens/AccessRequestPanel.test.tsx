// AccessRequestPanel — tenant self-service requester. Verifies it lists the user's own requests, gates submit on a
// role + a ≥5-char reason, sends the request WITHOUT any user id (identity is server-derived), and cancels an open one.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/posMeAccessRequestsApi', () => ({
  posMeAccessRequestsApi: { listMine: vi.fn(), create: vi.fn(), cancel: vi.fn() },
}));
import { posMeAccessRequestsApi } from '../api/posMeAccessRequestsApi';
import { AccessRequestPanel } from './AccessRequestPanel';

const mine = [
  { id: 'a1', currentRole: 'TECHNICIAN', requestedRole: 'MANAGER', reason: 'Cover branch lead', requestedDurationDays: 30, status: 'submitted', highRisk: false },
  { id: 'a2', currentRole: 'TECHNICIAN', requestedRole: 'OWNER', reason: 'Franchise', requestedDurationDays: null, status: 'rejected', highRisk: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  (posMeAccessRequestsApi.listMine as any).mockResolvedValue({ rows: mine, total: mine.length });
  (posMeAccessRequestsApi.create as any).mockResolvedValue({ id: 'new', status: 'submitted', highRisk: false });
  (posMeAccessRequestsApi.cancel as any).mockResolvedValue({ id: 'a1', status: 'cancelled' });
});

describe('AccessRequestPanel', () => {
  it('lists the user’s own requests with status', async () => {
    render(<AccessRequestPanel currentRole="TECHNICIAN" />);
    expect(await screen.findByText('Technician → Manager')).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();   // the status code is labelled (Vietnamese POS WP-C4), never printed raw
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });

  it('gates submit on a role and a ≥5-char reason, then sends NO user id', async () => {
    render(<AccessRequestPanel currentRole="TECHNICIAN" />);
    await screen.findByText('Technician → Manager');
    const submit = screen.getByRole('button', { name: 'Submit request' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Requested role'), { target: { value: 'MANAGER' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'no' } });
    expect(submit).toBeDisabled();                               // reason too short
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cover the front desk on weekends' } });
    fireEvent.change(screen.getByLabelText('Duration in days'), { target: { value: '14' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(posMeAccessRequestsApi.create as any).toHaveBeenCalledWith({ requestedRole: 'MANAGER', reason: 'Cover the front desk on weekends', requestedDurationDays: 14 }));
    const payload = (posMeAccessRequestsApi.create as any).mock.calls[0][0];
    expect(payload).not.toHaveProperty('requestingUserId');     // identity is server-derived
    expect(payload).not.toHaveProperty('tenantId');
  });

  it('excludes the current role from the request options', async () => {
    render(<AccessRequestPanel currentRole="MANAGER" />);
    await screen.findByText('Technician → Manager');
    const opts = Array.from(screen.getByLabelText('Requested role').querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(opts).not.toContain('MANAGER');
    expect(opts).toContain('OWNER');
  });

  it('cancels an open request', async () => {
    render(<AccessRequestPanel currentRole="TECHNICIAN" />);
    await screen.findByText('Technician → Manager');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); // only the submitted one has a Cancel
    await waitFor(() => expect(posMeAccessRequestsApi.cancel as any).toHaveBeenCalledWith('a1'));
  });
});
