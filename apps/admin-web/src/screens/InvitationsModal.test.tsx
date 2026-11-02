// InvitationsModal — manage secure token invitations. Verifies the list renders, pending rows expose resend/cancel
// (terminal rows don't), resend rotates the token and surfaces the manual link when delivery isn't connected, and
// cancel calls the cancel endpoint.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: { listInvitations: vi.fn(), resendInvitationToken: vi.fn(), cancelInvitationToken: vi.fn() },
}));
import { superAdminApi } from '../api/superAdminApi';
import { InvitationsModal } from './UsersRolesScreen';

const rows = [
  { id: 'i1', email: 'pending@x.com', role: 'MANAGER', tenantName: 'Glamour Studio', status: 'pending', deliveryStatus: 'not_connected', expiresAt: '2026-07-07T00:00:00Z', sendCount: 1 },
  { id: 'i2', email: 'done@x.com', role: 'TECHNICIAN', tenantName: 'Glamour Studio', status: 'accepted', deliveryStatus: 'delivered', expiresAt: null, sendCount: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.listInvitations as any).mockResolvedValue({ rows, total: rows.length });
  (superAdminApi.resendInvitationToken as any).mockResolvedValue({ id: 'i1', tokenPrefix: 'newtoken', expiresAt: '2026-07-14T00:00:00Z', deliveryStatus: 'not_connected', manualAcceptToken: 'ROT-TOKEN' });
  (superAdminApi.cancelInvitationToken as any).mockResolvedValue({ id: 'i1', status: 'cancelled' });
});

describe('InvitationsModal', () => {
  it('lists invitations with status, and only pending rows can be resent/cancelled', async () => {
    render(<InvitationsModal onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('pending@x.com')).toBeInTheDocument();
    expect(screen.getByText('done@x.com')).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeInTheDocument();   // exactly one pending row
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByText(/not connected/i)).toBeInTheDocument();               // honest delivery state
  });

  it('resends (rotates token) and surfaces the manual link when delivery is not connected', async () => {
    render(<InvitationsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('pending@x.com');
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(superAdminApi.resendInvitationToken as any).toHaveBeenCalledWith('i1'));
    expect(await screen.findByText(/accept-invite\?token=ROT-TOKEN/)).toBeInTheDocument();
  });

  it('cancels a pending invitation', async () => {
    render(<InvitationsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('pending@x.com');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(superAdminApi.cancelInvitationToken as any).toHaveBeenCalledWith('i1'));
  });
});
