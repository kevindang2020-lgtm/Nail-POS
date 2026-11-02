import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mergeHistory = vi.fn();
const customerDataOversight = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  mergeHistory: (...a: any[]) => mergeHistory(...a),
  customerDataOversight: (...a: any[]) => customerDataOversight(...a),
} }));

import { MergeHistoryScreen } from './MergeHistoryScreen';

describe('MergeHistoryScreen', () => {
  beforeEach(() => {
    mergeHistory.mockReset(); mergeHistory.mockResolvedValue([
      { id: 'mrg_1', sourceCustomerId: 'CUS-9', targetCustomerId: 'CUS-1', mergedByUserId: 'admin1', mergedAt: '2026-05-06T12:00:00Z' },
    ]);
    customerDataOversight.mockReset(); customerDataOversight.mockResolvedValue({ customersByTenant: [{ tenantId: 't1', label: 'Glamour Studio', count: 10 }] });
  });

  it('renders the header and the merge trail', async () => {
    render(<MemoryRouter><MergeHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText('Merge History')).toBeInTheDocument();
    expect(await screen.findByText('CUS-1')).toBeInTheDocument();
    expect(screen.getByText('CUS-9')).toBeInTheDocument();
    expect(screen.getByText('admin1')).toBeInTheDocument();
  });

  it('filters by tenant', async () => {
    render(<MemoryRouter><MergeHistoryScreen /></MemoryRouter>);
    await screen.findByText('CUS-1');
    fireEvent.change(screen.getByLabelText('Filter by tenant'), { target: { value: 't1' } });
    await waitFor(() => expect(mergeHistory).toHaveBeenCalledWith({ tenantId: 't1' }));
  });

  it('shows an empty state when there are no merges', async () => {
    mergeHistory.mockResolvedValue([]);
    render(<MemoryRouter><MergeHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText(/No merges recorded/)).toBeInTheDocument();
  });
});
