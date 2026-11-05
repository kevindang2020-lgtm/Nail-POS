import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const privacyRequests = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { privacyRequests: (...a: any[]) => privacyRequests(...a) } }));

import { PrivacyRequestsScreen } from './PrivacyRequestsScreen';

const payload = () => ({
  total: 2,
  kpis: { total: 2, overdue: 1, byStatus: [{ status: 'completed', n: 0 }] },
  rows: [
    { id: 'pr_1', request_type: 'export', status: 'in_review', requester_name: 'Ava Anderson', scope: 'profile', due_at: '2027-06-30T00:00:00Z', customer_id: 'CUS-7', tenant_id: 't1', tenant_name: 'Glamour Studio', created_at: '2026-05-01T00:00:00Z' },
    { id: 'pr_2', request_type: 'delete', status: 'new', requester_name: 'Sarah Davis', scope: 'all', due_at: '2026-05-01T00:00:00Z', customer_id: 'CUS-9', tenant_id: 't2', tenant_name: 'The Hair Lounge', created_at: '2026-04-01T00:00:00Z' },
  ],
});

describe('PrivacyRequestsScreen', () => {
  beforeEach(() => { privacyRequests.mockReset(); privacyRequests.mockResolvedValue(payload()); });

  it('renders header, summary, and the queue with mapped request types', async () => {
    render(<MemoryRouter><PrivacyRequestsScreen /></MemoryRouter>);
    expect(await screen.findByText('Privacy Requests', { selector: 'h1' })).toBeInTheDocument();
    expect(await screen.findByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Deletion')).toBeInTheDocument();
    expect(screen.getByText('Ava Anderson')).toBeInTheDocument();
    expect(screen.getAllByText('Overdue').length).toBeGreaterThanOrEqual(1); // summary card + filter option
  });

  it('marks an overdue request (past due, non-terminal)', async () => {
    render(<MemoryRouter><PrivacyRequestsScreen /></MemoryRouter>);
    expect(await screen.findByText(/· Overdue/)).toBeInTheDocument();
  });

  it('filters by status', async () => {
    render(<MemoryRouter><PrivacyRequestsScreen /></MemoryRouter>);
    await screen.findByText('Export');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'overdue' } });
    await waitFor(() => expect(privacyRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'overdue' })));
  });

  it('shows an empty state when there are no requests', async () => {
    privacyRequests.mockResolvedValue({ total: 0, kpis: { total: 0, overdue: 0, byStatus: [] }, rows: [] });
    render(<MemoryRouter><PrivacyRequestsScreen /></MemoryRouter>);
    expect(await screen.findByText(/No privacy requests/)).toBeInTheDocument();
  });
});
