// ScheduledReportsModal — define/manage recurring reports. Verifies the list renders, create posts the definition,
// and per-row toggle / run-now / delete call their endpoints.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: { listScheduledReports: vi.fn(), createScheduledReport: vi.fn(), toggleScheduledReport: vi.fn(), runScheduledReportNow: vi.fn(), deleteScheduledReport: vi.fn() },
}));
import { superAdminApi } from '../api/superAdminApi';
import { ScheduledReportsModal } from './UsersRolesScreen';

const rows = [{ id: 's1', name: 'Daily users CSV', reportKey: 'users', cadence: 'daily', recipientEmail: 'ops@x.com', enabled: true, lastStatus: 'delivered', nextRunAt: '2026-07-01T00:00:00Z' }];

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.listScheduledReports as any).mockResolvedValue({ rows, total: 1 });
  (superAdminApi.createScheduledReport as any).mockResolvedValue({ id: 'new' });
  (superAdminApi.toggleScheduledReport as any).mockResolvedValue({ id: 's1', enabled: false });
  (superAdminApi.runScheduledReportNow as any).mockResolvedValue({ id: 's1', status: 'delivered' });
  (superAdminApi.deleteScheduledReport as any).mockResolvedValue({ id: 's1', deleted: true });
});

describe('ScheduledReportsModal', () => {
  it('lists existing definitions', async () => {
    render(<ScheduledReportsModal onClose={() => {}} onDone={() => {}} />);
    expect(await screen.findByText('Daily users CSV')).toBeInTheDocument();
    expect(screen.getByText('delivered')).toBeInTheDocument();
  });

  it('creates a definition with name + cadence + recipient', async () => {
    render(<ScheduledReportsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('Daily users CSV');
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Weekly staff list' } });
    fireEvent.change(screen.getByLabelText('Cadence'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('Recipient email'), { target: { value: 'hr@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add report' }));
    await waitFor(() => expect(superAdminApi.createScheduledReport as any).toHaveBeenCalledWith({ name: 'Weekly staff list', reportKey: 'users', cadence: 'weekly', recipientEmail: 'hr@x.com' }));
  });

  it('toggles, runs, and deletes a definition', async () => {
    render(<ScheduledReportsModal onClose={() => {}} onDone={() => {}} />);
    await screen.findByText('Daily users CSV');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(superAdminApi.toggleScheduledReport as any).toHaveBeenCalledWith('s1', false));
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(superAdminApi.runScheduledReportNow as any).toHaveBeenCalledWith('s1'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(superAdminApi.deleteScheduledReport as any).toHaveBeenCalledWith('s1'));
  });
});
