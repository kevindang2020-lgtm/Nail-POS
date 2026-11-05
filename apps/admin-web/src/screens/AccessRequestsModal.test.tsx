// AccessRequestsModal — review surface for the access-request workflow. Verifies open requests render with the
// current→requested role, that Approve sends confirmHighRisk for high-risk grants (after a confirm) and omits it
// otherwise, and that Reject calls the reject endpoint.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    listAccessRequests: vi.fn(),
    approveAccessRequest: vi.fn(),
    rejectAccessRequest: vi.fn(),
  },
}));
import { superAdminApi } from '../api/superAdminApi';
import { AccessRequestsModal } from './UsersRolesScreen';

const rows = [
  { id: 'ar1', requesterName: 'Tess Tech', requesterEmail: 't@x.com', tenantName: 'Glamour Studio', currentRole: 'TECHNICIAN', requestedRole: 'MANAGER', requestedDurationDays: 30, reason: 'Cover branch lead during leave', status: 'submitted', highRisk: false },
  { id: 'ar2', requesterName: 'Reece Recep', requesterEmail: 'r@x.com', tenantName: 'Glamour Studio', currentRole: 'RECEPTION', requestedRole: 'OWNER', requestedDurationDays: null, reason: 'Promote to franchise owner', status: 'submitted', highRisk: true },
  { id: 'ar3', requesterName: 'Old One', requestedRole: 'MANAGER', currentRole: 'TECHNICIAN', reason: 'done', status: 'approved', highRisk: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.listAccessRequests as any).mockResolvedValue({ rows, total: rows.length });
  (superAdminApi.approveAccessRequest as any).mockResolvedValue({ status: 'approved' });
  (superAdminApi.rejectAccessRequest as any).mockResolvedValue({ status: 'rejected' });
});

describe('AccessRequestsModal', () => {
  it('lists open requests with the current→requested role and a high-risk badge', async () => {
    render(<AccessRequestsModal onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('Tess Tech')).toBeInTheDocument();
    expect(screen.getByText('Reece Recep')).toBeInTheDocument();
    expect(screen.getByText('High-risk')).toBeInTheDocument();
    expect(screen.getByText('Recently decided')).toBeInTheDocument();   // approved one shows in the decided list
  });

  it('approves a normal request WITHOUT a high-risk confirmation flag', async () => {
    render(<AccessRequestsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('Tess Tech');
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]); // ar1 (normal)
    await waitFor(() => expect(superAdminApi.approveAccessRequest as any).toHaveBeenCalledWith('ar1', {}));
  });

  it('requires a confirm for a high-risk approval and sends confirmHighRisk', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<AccessRequestsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('Reece Recep');
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[1]); // ar2 (high-risk)
    // In-app confirmation (not the OS dialog): the approval only fires from the confirm tap.
    fireEvent.click(await screen.findByRole('button', { name: 'Approve high-risk grant' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(superAdminApi.approveAccessRequest as any).toHaveBeenCalledWith('ar2', { confirmHighRisk: true }));
    confirmSpy.mockRestore();
  });

  it('rejects a request', async () => {
    render(<AccessRequestsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('Tess Tech');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0]);
    await waitFor(() => expect(superAdminApi.rejectAccessRequest as any).toHaveBeenCalledWith('ar1', {}));
  });
});
