import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const deletionRequests = vi.fn();
const requestDeletion = vi.fn();
const approveDeletion = vi.fn();
const rejectDeletion = vi.fn();
const executeDeletion = vi.fn();
const customerDataOversight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  deletionRequests: (...a: any[]) => deletionRequests(...a),
  requestDeletion: (...a: any[]) => requestDeletion(...a),
  approveDeletion: (...a: any[]) => approveDeletion(...a),
  rejectDeletion: (...a: any[]) => rejectDeletion(...a),
  executeDeletion: (...a: any[]) => executeDeletion(...a),
  customerDataOversight: (...a: any[]) => customerDataOversight(...a),
} }));

import { DeletionRequestsScreen } from './DeletionRequestsScreen';

const req = (over: any = {}) => ({ id: 'del_1', tenantId: 't1', customerId: 'CUS-7', reason: 'GDPR', status: 'approved', requestedByUserId: 'u1', approvedByUserId: 'u2', executedByUserId: null, rejectReason: null, retentionChecked: false, retentionNote: null, legalHoldBlocked: false, requestedAt: '2026-05-01T00:00:00Z', approvedAt: '2026-05-02T00:00:00Z', executedAt: null, ...over });

describe('DeletionRequestsScreen', () => {
  beforeEach(() => {
    deletionRequests.mockReset(); deletionRequests.mockResolvedValue([req()]);
    requestDeletion.mockReset(); requestDeletion.mockResolvedValue({ ok: true, request: { id: 'del_9' } });
    approveDeletion.mockReset(); approveDeletion.mockResolvedValue({ ok: true });
    rejectDeletion.mockReset(); rejectDeletion.mockResolvedValue({ ok: true });
    executeDeletion.mockReset(); executeDeletion.mockResolvedValue({ ok: true });
    customerDataOversight.mockReset(); customerDataOversight.mockResolvedValue({ customersByTenant: [{ tenantId: 't1', label: 'Glamour Studio', count: 10 }] });
  });

  it('renders header, summary, request form, and the requests table', async () => {
    render(<MemoryRouter><DeletionRequestsScreen /></MemoryRouter>);
    expect(await screen.findByText('Deletion Requests', { selector: 'h1' })).toBeInTheDocument();
    expect(await screen.findByText('CUS-7')).toBeInTheDocument();
    expect(screen.getByText('Request a deletion')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Approval')).toBeInTheDocument();
  });

  it('requires the exact typed customer ID before execution', async () => {
    render(<MemoryRouter><DeletionRequestsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Execute'));
    const erase = await screen.findByText('Permanently erase');
    expect(erase).toBeDisabled();
    const input = screen.getByPlaceholderText('CUS-7');
    fireEvent.change(input, { target: { value: 'WRONG' } });
    expect(screen.getByText('Permanently erase')).toBeDisabled();
    fireEvent.change(input, { target: { value: 'CUS-7' } });
    expect(screen.getByText('Permanently erase')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Permanently erase'));
    await waitFor(() => expect(executeDeletion).toHaveBeenCalledWith('del_1', 'CUS-7'));
  });

  it('requests a deletion from the form', async () => {
    render(<MemoryRouter><DeletionRequestsScreen /></MemoryRouter>);
    await waitFor(() => expect(customerDataOversight).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('CUS-…'), { target: { value: 'CUS-9' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. GDPR erasure request'), { target: { value: 'erasure' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tenant' }), { target: { value: 't1' } });
    fireEvent.click(screen.getByText('Request deletion'));
    await waitFor(() => expect(requestDeletion).toHaveBeenCalledWith({ tenantId: 't1', customerId: 'CUS-9', reason: 'erasure' }));
  });
});
