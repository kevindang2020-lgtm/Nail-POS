import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'me' } }) }));
import { api } from '../api/client';
import { ApprovalsScreen } from './ApprovalsScreen';

const req = (id: string, requestedBy: string) => ({ id, action: 'plan.limit_override', label: 'Tenant plan-limit override', targetRef: 't1', payload: { input: { metric: 'customers', limit: 9000 } },
  reason: 'large salon onboarding', requestedBy, requestedByEmail: requestedBy + '@platform.test', requiredPermission: 'super_admin.plans.manage', status: 'pending', expiresAt: '2026-09-29T10:00:00Z', createdAt: '2026-09-28T10:00:00Z' });
describe('Approvals (Constitution 7 §119)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => Promise.resolve(url.endsWith('/policies')
      ? [{ action: 'plan.limit_override', label: 'Tenant plan-limit override', requiredPermission: 'super_admin.plans.manage', required: false }]
      : { rows: [req('r1', 'someone-else'), req('r2', 'me')] }));
    (api.post as any).mockResolvedValue({ ok: true });
  });
  it("another person's request can be approved; your own shows it needs someone else", async () => {
    render(<ApprovalsScreen />);
    expect(await screen.findByText('Your request — another person must approve')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/super-admin/approvals/r1/approve', {}));
  });
  it('rejecting and changing policy both need a reason', async () => {
    render(<ApprovalsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reject…' }));
    const rej = screen.getByRole('button', { name: 'Reject' });
    expect((rej as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'not justified by usage' } });
    fireEvent.click(rej);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/super-admin/approvals/r1/reject', { note: 'not justified by usage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Require approval…' }));
    fireEvent.change(screen.getByLabelText('Policy reason for Tenant plan-limit override'), { target: { value: 'second operator joined the team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/super-admin/approvals/policies/plan.limit_override', { required: true, reason: 'second operator joined the team' }));
  });
});
