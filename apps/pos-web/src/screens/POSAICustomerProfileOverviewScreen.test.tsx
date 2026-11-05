import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { tenantOverviewMock, refreshMock } = vi.hoisted(() => ({ tenantOverviewMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('../api/posAiCustomerProfileApi', () => ({
  posAiCustomerProfileApi: { tenantOverview: tenantOverviewMock, refreshTenantOverview: refreshMock },
}));
import { POSAICustomerProfileOverviewScreen } from './POSAICustomerProfileOverviewScreen';

beforeEach(() => { tenantOverviewMock.mockReset(); refreshMock.mockReset(); });

describe('POSAICustomerProfileOverviewScreen', () => {
  it('shows the real duplicate count and em-dashes the not-yet-computed metrics', async () => {
    tenantOverviewMock.mockResolvedValue({ duplicateCandidateGroups: 3, generatedAt: '2026-07-07T12:00:00Z', freshness: { source: 'cache' } });
    render(<POSAICustomerProfileOverviewScreen />);
    expect(await screen.findByRole('heading', { name: 'Customer Intelligence' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();                 // real duplicate group count
    expect(screen.getAllByText('\u2014').length).toBeGreaterThanOrEqual(3); // pending metrics honestly em-dashed
  });

  it('refreshes on demand', async () => {
    tenantOverviewMock.mockResolvedValue({ duplicateCandidateGroups: 0, generatedAt: '2026-07-07T12:00:00Z' });
    refreshMock.mockResolvedValue({ duplicateCandidateGroups: 1, generatedAt: '2026-07-07T12:05:00Z' });
    render(<POSAICustomerProfileOverviewScreen />);
    await screen.findByRole('heading', { name: 'Customer Intelligence' });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' })); // the help text also contains the word Refresh
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
