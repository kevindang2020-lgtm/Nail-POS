// QA for the full Alerts page: summary KPIs, alert rows with severity/status badges, severity filter wiring,
// opening the detail panel + marking read, and the Sync action.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  alerts: vi.fn(), alertsSummary: vi.fn(), alert: vi.fn(), alertStatus: vi.fn(), alertNote: vi.fn(),
  alertsMarkAllRead: vi.fn(), alertsSync: vi.fn(),
} }));
import { superAdminApi } from '../api/superAdminApi';
import { AlertsScreen } from './AlertsScreen';

const row = (over: any = {}) => ({ id: 'al1', tenantId: 't1', tenantName: 'Luxe Nails & Spa', title: 'Payment setup needed', message: 'No gateway', type: 'payment', severity: 'high', status: 'unread', relatedModule: '/payment-gateways', relatedRecordId: 't1', createdAt: new Date(Date.now() - 120000).toISOString(), notes: [], ...over });
const summary = { total: 3, unread: 2, critical: 1, high: 1, payment: 1, system: 1, security: 0, support: 0 };

describe('AlertsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (superAdminApi.alerts as any).mockResolvedValue({ rows: [row()], total: 1 });
    (superAdminApi.alertsSummary as any).mockResolvedValue(summary);
    (superAdminApi.alert as any).mockResolvedValue(row());
    (superAdminApi.alertStatus as any).mockResolvedValue({ ok: true, alert: row({ status: 'read' }) });
    (superAdminApi.alertsSync as any).mockResolvedValue({ ok: true, created: 4 });
  });

  it('renders summary KPIs and an alert row with severity + status badges', async () => {
    render(<MemoryRouter><AlertsScreen /></MemoryRouter>);
    expect(await screen.findByText('Payment setup needed')).toBeInTheDocument();
    expect(screen.getByText('Total Alerts')).toBeInTheDocument();
    expect(screen.getAllByText('High').length).toBeGreaterThan(0);   // severity badge (also a filter option)
    expect(screen.getAllByText('Unread').length).toBeGreaterThan(0); // KPI + badge + option
  });

  it('filters by severity via the backend', async () => {
    render(<MemoryRouter initialEntries={['/alerts?source=overview-recent-alerts']}><AlertsScreen /></MemoryRouter>);
    await screen.findByText('Payment setup needed');
    (superAdminApi.alerts as any).mockClear();
    fireEvent.change(screen.getByDisplayValue('All severities'), { target: { value: 'critical' } });
    await waitFor(() => expect(superAdminApi.alerts).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' })));
  });

  it('opens detail and marks the alert read', async () => {
    render(<MemoryRouter><AlertsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Payment setup needed'));
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Read' }));
    await waitFor(() => expect(superAdminApi.alertStatus).toHaveBeenCalledWith('al1', 'read'));
  });

  it('Sync materializes alerts from platform signals', async () => {
    render(<MemoryRouter><AlertsScreen /></MemoryRouter>);
    await screen.findByText('Payment setup needed');
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }));
    await waitFor(() => expect(superAdminApi.alertsSync).toHaveBeenCalled());
  });
});
