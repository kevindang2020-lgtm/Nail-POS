import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const privacyRequests = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { privacyRequests: (...a: any[]) => privacyRequests(...a) } }));

import { DataExportsScreen } from './DataExportsScreen';

const payload = () => ({
  total: 3, kpis: {},
  rows: [
    { id: 'pr_1', request_type: 'export', status: 'in_review', requester_name: 'Ava Anderson', scope: 'profile', due_at: '2027-06-30T00:00:00Z', customer_id: 'CUS-7', tenant_id: 't1', tenant_name: 'Glamour Studio', created_at: '2026-05-01T00:00:00Z' },
    { id: 'pr_2', request_type: 'delete', status: 'new', requester_name: 'Sarah Davis', due_at: null, customer_id: 'CUS-9', tenant_id: 't2', tenant_name: 'The Hair Lounge', created_at: '2026-04-01T00:00:00Z' }, // NOT an export → filtered out
    { id: 'pr_3', request_type: 'export', status: 'new', requester_name: 'Liam Thomas', scope: 'all', due_at: '2026-05-01T00:00:00Z', customer_id: 'CUS-3', tenant_id: 't1', tenant_name: 'Glamour Studio', created_at: '2026-04-15T00:00:00Z' },
  ],
});

describe('DataExportsScreen', () => {
  beforeEach(() => { privacyRequests.mockReset(); privacyRequests.mockResolvedValue(payload()); });

  it('renders only export-type requests', async () => {
    render(<MemoryRouter><DataExportsScreen /></MemoryRouter>);
    expect(await screen.findByText('Data Exports', { selector: 'h1' })).toBeInTheDocument();
    expect(await screen.findByText('CUS-7')).toBeInTheDocument();
    expect(screen.getByText('CUS-3')).toBeInTheDocument();
    expect(screen.queryByText('CUS-9')).not.toBeInTheDocument(); // delete request excluded
  });

  it('marks an overdue export request', async () => {
    render(<MemoryRouter><DataExportsScreen /></MemoryRouter>);
    expect(await screen.findByText(/· Overdue/)).toBeInTheDocument();
  });

  it('filters by status via the shared endpoint', async () => {
    render(<MemoryRouter><DataExportsScreen /></MemoryRouter>);
    await screen.findByText('CUS-7');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'completed' } });
    await waitFor(() => expect(privacyRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' })));
  });

  it('shows an empty state when there are no export requests', async () => {
    privacyRequests.mockResolvedValue({ total: 0, kpis: {}, rows: [{ id: 'x', request_type: 'delete', status: 'new' }] });
    render(<MemoryRouter><DataExportsScreen /></MemoryRouter>);
    expect(await screen.findByText(/No data-export requests/)).toBeInTheDocument();
  });
});
