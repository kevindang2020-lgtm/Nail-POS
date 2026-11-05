import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const auditHistory = vi.fn();
const customerDataOversight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  auditHistory: (...a: any[]) => auditHistory(...a),
  customerDataOversight: (...a: any[]) => customerDataOversight(...a),
} }));

import { AuditHistoryScreen } from './AuditHistoryScreen';

describe('AuditHistoryScreen', () => {
  beforeEach(() => {
    auditHistory.mockReset(); auditHistory.mockResolvedValue([
      { action: 'customer_deletion_executed', entityType: 'customer', entityId: 'CUS-9', actorUserId: 'admin1', at: '2026-05-06T12:00:00Z' },
      { action: 'customer_legal_hold_applied', entityType: 'customer_legal_hold', entityId: 'lh_1', actorUserId: 'admin2', at: '2026-05-05T12:00:00Z' },
    ]);
    customerDataOversight.mockReset(); customerDataOversight.mockResolvedValue({ customersByTenant: [{ tenantId: 't1', label: 'Glamour Studio', count: 10 }] });
  });

  it('renders the header and the audit feed', async () => {
    render(<MemoryRouter><AuditHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText('Audit History')).toBeInTheDocument();
    expect(await screen.findByText('Customer Deletion Executed')).toBeInTheDocument();
    expect(screen.getByText('Customer Legal Hold Applied')).toBeInTheDocument();
    expect(screen.getByText('CUS-9')).toBeInTheDocument();
  });

  it('filters by tenant', async () => {
    render(<MemoryRouter><AuditHistoryScreen /></MemoryRouter>);
    await screen.findByText('CUS-9');
    fireEvent.change(screen.getByLabelText('Filter by tenant'), { target: { value: 't1' } });
    await waitFor(() => expect(auditHistory).toHaveBeenCalledWith({ tenantId: 't1' }));
  });

  it('shows an empty state when there are no events', async () => {
    auditHistory.mockResolvedValue([]);
    render(<MemoryRouter><AuditHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText(/No customer-data audit events/)).toBeInTheDocument();
  });
});
