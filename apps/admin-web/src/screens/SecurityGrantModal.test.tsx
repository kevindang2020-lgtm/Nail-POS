import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockList, mockReq, mockApprove, mockRevoke } = vi.hoisted(() => ({ mockList: vi.fn(), mockReq: vi.fn(), mockApprove: vi.fn(), mockRevoke: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securityPrivilegedGrants: () => mockList(),
  securityPrivilegedGrantRequest: (b: any) => mockReq(b),
  securityPrivilegedGrantApprove: (id: string) => mockApprove(id),
  securityPrivilegedGrantRevoke: (id: string, b: any) => mockRevoke(id, b),
} }));
import { SecurityGrantModal } from './SecurityGrantModal';

const future = () => { const d = new Date(Date.now() + 7 * 86400000); return d.toISOString().slice(0, 16); };
const past = () => { const d = new Date(Date.now() - 86400000); return d.toISOString().slice(0, 16); };

beforeEach(() => {
  mockList.mockReset(); mockReq.mockReset(); mockApprove.mockReset(); mockRevoke.mockReset();
  mockList.mockResolvedValue([{ id: 'g1', grantRef: 'PAG-2026-001', userId: 'u1', privilege: 'security_admin', scope: 'platform', status: 'pending', expiresAt: new Date(Date.now() + 6 * 86400000).toISOString() }]);
  mockReq.mockResolvedValue({ id: 'g2', grantRef: 'PAG-2026-002', status: 'pending' });
  mockApprove.mockResolvedValue({ id: 'g1', status: 'active' });
});

describe('SecurityGrantModal', () => {
  it('lists grants and shows the pending Approve action', async () => {
    render(<SecurityGrantModal onClose={() => {}} />);
    expect(await screen.findByText('PAG-2026-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('Request is disabled until user + reason + a FUTURE expiry are provided (time-boxed)', async () => {
    render(<SecurityGrantModal onClose={() => {}} />);
    await screen.findByText('PAG-2026-001');
    const btn = () => screen.getByRole('button', { name: /Request elevation/ });
    expect(btn()).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('user to elevate'), { target: { value: 'u9' } });
    fireEvent.change(screen.getByPlaceholderText(/why this elevation/), { target: { value: 'incident' } });
    fireEvent.change(screen.getByLabelText('expires at'), { target: { value: past() } });
    expect(screen.getByText(/Expiry must be in the future/)).toBeInTheDocument();
    expect(btn()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('expires at'), { target: { value: future() } });
    expect(btn()).not.toBeDisabled();
    fireEvent.click(btn());
    await waitFor(() => expect(mockReq).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u9', privilege: 'security_admin' })));
  });

  it('approves a pending grant', async () => {
    render(<SecurityGrantModal onClose={() => {}} />);
    await screen.findByText('PAG-2026-001');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('g1'));
  });

  it('surfaces the separation-of-duties error if approval is forbidden', async () => {
    mockApprove.mockRejectedValue(new Error('the approver cannot be the requester (separation of duties)'));
    render(<SecurityGrantModal onClose={() => {}} />);
    await screen.findByText('PAG-2026-001');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/separation of duties/)).toBeInTheDocument();
  });

  it('revokes an active grant with a reason', async () => {
    mockList.mockResolvedValue([{ id: 'g5', grantRef: 'PAG-2026-005', userId: 'u2', privilege: 'owner', scope: 'platform', status: 'active', expiresAt: new Date(Date.now() + 86400000).toISOString() }]);
    mockRevoke.mockResolvedValue({ id: 'g5', status: 'revoked' });
    render(<SecurityGrantModal onClose={() => {}} />);
    await screen.findByText('PAG-2026-005');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'no longer needed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith('g5', { reason: 'no longer needed' }));
  });
});
