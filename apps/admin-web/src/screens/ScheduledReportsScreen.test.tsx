import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../shell/ScopeContext', () => ({ useScope: () => ({ tenantId: null, tenantName: null }) }));
vi.mock('../api/superAdminReportBuilderApi', () => ({ reportBuilderApi: { list: vi.fn().mockResolvedValue([]) } }));

const schedule = { id: 's1', name: 'Weekly Platform CSV', source: 'analytics_export', reportDefinitionId: null, format: 'csv', rangeKey: '30d', scopeTenantId: null, frequency: 'weekly', recipients: ['ops@x.com'], deliveryMethod: 'in_app', enabled: true, nextRunAt: '2026-07-06T00:00:00.000Z', lastRunAt: null, createdByUserId: null, createdAt: '2026-06-29', updatedAt: '2026-06-29' };
const runs = [{ id: 'r1', scheduleId: 's1', status: 'success', format: 'csv', filename: 'analytics-30d.csv', byteSize: 2048, error: null, trigger: 'manual', createdAt: '2026-06-29T12:00:00.000Z' }];
const runsMock = vi.fn().mockResolvedValue(runs);
const downloadMock = vi.fn();

vi.mock('../api/superAdminScheduledReportsApi', () => ({
  useScheduledReports: () => ({ schedules: [schedule], loading: false, error: null, reload: vi.fn() }),
  scheduledReportsApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn(), runNow: vi.fn(), runDue: vi.fn(), runs: (...a: any[]) => runsMock(...a), download: (...a: any[]) => downloadMock(...a) },
}));

import { ScheduledReportsScreen } from './ScheduledReportsScreen';

describe('ScheduledReportsScreen (Super Admin · scheduled reports)', () => {
  const renderScreen = () => render(<MemoryRouter><ScheduledReportsScreen /></MemoryRouter>);

  it('renders the create form, honest delivery note, and existing schedules', () => {
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Scheduled Reports' })).toBeInTheDocument();
    expect(screen.getByText('New Schedule')).toBeInTheDocument();
    expect(screen.getByText(/email delivery is pending a mailer/i)).toBeInTheDocument();
    expect(screen.getByText('Weekly Platform CSV')).toBeInTheDocument();
    expect(screen.getByText('▶ Run due now')).toBeInTheDocument();
  });

  it('shows run history with a downloadable artifact', async () => {
    renderScreen();
    fireEvent.click(screen.getByText('Runs'));
    await waitFor(() => expect(screen.getByText('Run history')).toBeInTheDocument());
    expect(screen.getByText(/analytics-30d\.csv/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('⤓ Download'));
    expect(downloadMock).toHaveBeenCalledWith('r1');
  });
});
