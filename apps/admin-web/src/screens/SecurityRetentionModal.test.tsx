import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockList, mockSet, mockPreview } = vi.hoisted(() => ({ mockList: vi.fn(), mockSet: vi.fn(), mockPreview: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securityRetentionRules: () => mockList(),
  securityRetentionRuleSet: (dc: string, b: any) => mockSet(dc, b),
  securityRetentionPurgePreview: (dc: string) => mockPreview(dc),
} }));
import { SecurityRetentionModal } from './SecurityRetentionModal';

beforeEach(() => {
  mockList.mockReset(); mockSet.mockReset(); mockPreview.mockReset();
  mockList.mockResolvedValue([{ id: 'r1', dataClass: 'audit_events', version: 2, status: 'active', retentionDays: 400, action: 'archive' }]);
  mockSet.mockResolvedValue({ dataClass: 'audit_events', version: 3, retentionDays: 400, action: 'archive' });
  mockPreview.mockResolvedValue({ dataClass: 'audit_events', action: 'archive', cutoff: '2025-04-01T00:00:00Z', eligibleCount: 120, netToProcess: 120, message: '120 audit_events record(s) older than 2025-04-01 eligible for archive. Dry run — nothing deleted.' });
});

describe('SecurityRetentionModal', () => {
  it('lists active rules and shows the compliance floor for the selected class', async () => {
    render(<SecurityRetentionModal onClose={() => {}} />);
    expect(await screen.findByText('Audit Events')).toBeInTheDocument();
    expect(screen.getByText(/Compliance minimum for Audit Events: 365 days/)).toBeInTheDocument();
  });

  it('blocks Save below the compliance floor and enables it at/above', async () => {
    render(<SecurityRetentionModal onClose={() => {}} />);
    await screen.findByText('Audit Events');
    const days = screen.getByPlaceholderText('≥ 365');
    fireEvent.change(days, { target: { value: '30' } });
    expect(screen.getByText(/Below the compliance minimum of 365 days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
    fireEvent.change(days, { target: { value: '400' } });
    expect(screen.getByRole('button', { name: 'Save rule' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith('audit_events', expect.objectContaining({ retentionDays: 400 })));
    expect(await screen.findByText(/Saved Audit Events retention v3/)).toBeInTheDocument();
  });

  it('runs a non-destructive dry-run purge preview', async () => {
    render(<SecurityRetentionModal onClose={() => {}} />);
    await screen.findByText('Audit Events');
    fireEvent.click(screen.getByRole('button', { name: 'Preview purge' }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('audit_events'));
    expect(await screen.findByText(/Dry run — nothing deleted/)).toBeInTheDocument();
  });

  it('honestly surfaces when preview is not connected for a data class', async () => {
    mockPreview.mockRejectedValue(new Error('dry-run count is not connected for data class "audit_events"'));
    render(<SecurityRetentionModal onClose={() => {}} />);
    await screen.findByText('Audit Events');
    fireEvent.click(screen.getByRole('button', { name: 'Preview purge' }));
    expect(await screen.findByText(/not connected for data class/)).toBeInTheDocument();
  });
});
