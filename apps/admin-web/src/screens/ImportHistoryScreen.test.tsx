import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const importJobs = vi.fn();
const approveImport = vi.fn();
const retryImport = vi.fn();
const rejectImport = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  importJobs: (...a: any[]) => importJobs(...a),
  approveImport: (...a: any[]) => approveImport(...a),
  retryImport: (...a: any[]) => retryImport(...a),
  rejectImport: (...a: any[]) => rejectImport(...a),
} }));

import { ImportHistoryScreen } from './ImportHistoryScreen';

const job = (over: any = {}) => ({ id: 'imp_1', tenantId: 't1', branchId: 'b1', source: 'csv', filename: 'batch.csv', status: 'pending', totalRows: 3, validRows: 2, invalidRows: 1, importedRows: 0, failedRows: 0, rejectReason: null, createdAt: '2026-05-01T00:00:00Z', approvedAt: null, completedAt: null, ...over });

describe('ImportHistoryScreen', () => {
  beforeEach(() => {
    importJobs.mockReset(); importJobs.mockResolvedValue([job()]);
    approveImport.mockReset(); approveImport.mockResolvedValue({ ok: true, job: { importedRows: 2, failedRows: 0 } });
    retryImport.mockReset(); retryImport.mockResolvedValue({ ok: true, job: { importedRows: 0, failedRows: 0 } });
    rejectImport.mockReset(); rejectImport.mockResolvedValue({ ok: true });
  });

  it('renders the header, summary, and job table', async () => {
    render(<MemoryRouter><ImportHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText('Import History')).toBeInTheDocument();
    expect(await screen.findByText('batch.csv')).toBeInTheDocument();
    expect(screen.getByText('Rows Imported')).toBeInTheDocument();
    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
  });

  it('approves a pending job and refreshes', async () => {
    render(<MemoryRouter><ImportHistoryScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(approveImport).toHaveBeenCalledWith('imp_1'));
    await waitFor(() => expect(importJobs).toHaveBeenCalledTimes(2)); // initial + reload
  });

  it('filters by status', async () => {
    render(<MemoryRouter><ImportHistoryScreen /></MemoryRouter>);
    await screen.findByText('batch.csv');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'failed' } });
    await waitFor(() => expect(importJobs).toHaveBeenCalledWith({ status: 'failed' }));
  });

  it('shows an empty state when there are no jobs', async () => {
    importJobs.mockResolvedValue([]);
    render(<MemoryRouter><ImportHistoryScreen /></MemoryRouter>);
    expect(await screen.findByText(/No import jobs/)).toBeInTheDocument();
  });
});
