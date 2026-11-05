import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const customerDuplicates = vi.fn();
const customerDataOversight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  customerDuplicates: (...a: any[]) => customerDuplicates(...a),
  customerDataOversight: (...a: any[]) => customerDataOversight(...a),
} }));

import { DuplicateDetectionScreen } from './DuplicateDetectionScreen';

const dupCase = {
  id: 'dup1', kind: 'phone', keyMasked: '•••4567', confidence: 'high', tenantId: 't1', tenantName: 'Glamour Studio',
  members: [
    { id: 'c1', name: 'Emily Johnson', phone: '•••4567', email: 'e•••@x.com', branch: 'Downtown', status: 'active' },
    { id: 'c2', name: 'Emily J', phone: '•••4567', email: 'e2•••@x.com', branch: 'Downtown', status: 'active' },
  ],
};

describe('DuplicateDetectionScreen', () => {
  beforeEach(() => {
    customerDuplicates.mockReset(); customerDuplicates.mockResolvedValue({ total: 1, cases: [dupCase] });
    customerDataOversight.mockReset(); customerDataOversight.mockResolvedValue({ customersByTenant: [{ tenantId: 't1', label: 'Glamour Studio', count: 10 }] });
  });

  it('renders header, isolation notice, summary, and a cluster with members', async () => {
    render(<MemoryRouter><DuplicateDetectionScreen /></MemoryRouter>);
    expect(await screen.findByText('Duplicate Detection')).toBeInTheDocument();
    expect(screen.getByText(/per tenant only/)).toBeInTheDocument();
    expect(await screen.findByText('Emily J')).toBeInTheDocument();
    expect(screen.getByText('Emily Johnson')).toBeInTheDocument();
    expect(screen.getByText('High Risk')).toBeInTheDocument();
    expect(screen.getByText(/requires an active Customer Support session/)).toBeInTheDocument();
  });

  it('filters by tenant', async () => {
    render(<MemoryRouter><DuplicateDetectionScreen /></MemoryRouter>);
    await screen.findByText('Emily J');
    fireEvent.change(screen.getByLabelText('Filter by tenant'), { target: { value: 't1' } });
    await waitFor(() => expect(customerDuplicates).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' })));
  });

  it('shows an empty state when there are no clusters', async () => {
    customerDuplicates.mockResolvedValue({ total: 0, cases: [] });
    render(<MemoryRouter><DuplicateDetectionScreen /></MemoryRouter>);
    expect(await screen.findByText(/No duplicate clusters detected/)).toBeInTheDocument();
  });
});
