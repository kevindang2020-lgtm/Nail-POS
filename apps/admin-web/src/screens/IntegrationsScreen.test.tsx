import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { IntegrationsScreen } from './IntegrationsScreen';

vi.mock('../api/superAdminIntegrationsApi', () => ({
  fetchIntegrationsOverview: vi.fn().mockResolvedValue({
    available: true,
    kpis: { totalActiveIntegrations: 84, connectedTenants: 146, healthyConnections: 76, healthyPct: 90.5, failedSynchronizations: 12, failedSync24h: 3, expiredAuthTokens: 7, webhookErrors: 18, apiUsageToday: 245876, integrationsRequiringAttention: 11, successfulSyncs24h: 1932, disabledConnections: 6 },
    syncTrend: [{ label: 'May 6', date: '2026-05-06', successPct: 98, total: 300 }],
    apiUsageByIntegration: [{ integration: 'Fiserv', calls: 18500 }],
    statusBreakdown: [{ status: 'Active', count: 76 }, { status: 'Warning', count: 5 }],
    webhookHealth: [{ status: 'Healthy', count: 62 }, { status: 'Failed', count: 18 }],
  }),
  listConnectedIntegrations: vi.fn().mockResolvedValue({ available: true, integrations: [
    { key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway', status: 'active', tenantsUsing: 45, authStatus: 'valid', lastSuccessfulSync: '2026-05-06T14:30:00', failedSyncs: 0, apiUsageToday: 18542, webhookStatus: 'healthy', errorLogs: 0, modelled: true },
    { key: 'twilio', name: 'Twilio', category: 'Communication', status: 'active', tenantsUsing: 52, authStatus: 'expiring_soon', lastSuccessfulSync: '2026-05-06T14:15:00', failedSyncs: 2, apiUsageToday: 12430, webhookStatus: 'warning', errorLogs: 1, modelled: false },
  ] }),
  listWebhookEvents: vi.fn().mockResolvedValue({ available: true, events: [{ id: 'e1', eventSource: 'Twilio SMS', tenantName: 'VIP Nail Club', result: 'Delivered', retries: 0, statusCode: 200, error: null, timestamp: '2026-05-06T14:33:00' }] }),
  listAuthAlerts: vi.fn().mockResolvedValue({ available: true, alerts: [{ id: 'a1', integration: 'API Key · ak_live_AA', tenantName: 'VIP Nail Club', issue: 'Token expiring soon', expiresOn: '2026-05-10' }] }),
  listErrorLogs: vi.fn().mockResolvedValue({ available: true, errors: [{ id: 'x1', integration: 'Customer Data Imports', tenantName: 'VIP Nail Club', errorType: 'Webhook Failed', severity: 'High', lastAttempt: '2026-05-06T14:00:00', statusCode: 503, message: 'upstream', nextAction: 'Retry Sync' }] }),
  listTenantUsage: vi.fn().mockResolvedValue({ available: true, tenants: [{ tenantId: 't1', tenantName: 'VIP Nail Club', integrations: 6, status: 'Active', apiCallsToday: 32451, lastSync: '2026-05-06T14:30:00' }] }),
  listMarketplace: vi.fn().mockResolvedValue({ available: true, services: [
    { key: 'fiserv', name: 'Fiserv', category: 'Payment Gateway' }, { key: 'quickbooks', name: 'QuickBooks', category: 'Accounting' },
  ] }),
  disableConnection: vi.fn().mockResolvedValue({ ok: true, status: 'disabled' }),
  exportIntegrationReport: vi.fn().mockResolvedValue({ filename: 'integrations-2026-05-06.csv', rowCount: 11 }),
  listConnections: vi.fn().mockResolvedValue({ ok: true, connections: [] }),
  listApprovedProviders: vi.fn().mockResolvedValue({ ok: true, providers: [{ key: 'quickbooks', name: 'QuickBooks', category: 'Accounting', authMethods: ['oauth2'], defaultScopes: ['com.intuit.quickbooks.accounting'], webhookCapable: true }] }),
  createConnection: vi.fn().mockResolvedValue({ ok: true, connection: { id: 'conn1', provider_key: 'quickbooks', category: 'Accounting', connection_status: 'pending_setup' } }),
  beginOAuth: vi.fn().mockResolvedValue({ ok: true, authorizationUrl: 'https://auth.reference.local/authorize?state=abc&code_challenge=x', state: 'abc', scopes: [] }),
  completeOAuth: vi.fn().mockResolvedValue({ ok: true, authenticationStatus: 'valid', grantedScopes: [], providerAccount: 'acct', tokenExpiresAt: null }),
  configureApiKey: vi.fn().mockResolvedValue({ ok: true, maskedCredential: '\u2022\u2022\u2022\u20221234', authenticationStatus: 'valid' }),
  testConnectionLive: vi.fn().mockResolvedValue({ ok: true, result: { succeeded: true, latencyMs: 42, providerAccount: 'acct', apiVersion: 'v1', errorCategory: null } }),
  refreshAuthentication: vi.fn().mockResolvedValue({ ok: true, authenticationStatus: 'valid', tokenExpiresAt: null }),
  rotateCredential: vi.fn().mockResolvedValue({ ok: true, maskedCredential: '\u2022\u2022\u2022\u20229999' }),
  disableConnectionLifecycle: vi.fn().mockResolvedValue({ ok: true, connectionStatus: 'disabled' }),
}));

describe('IntegrationsScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the header, info banner, KPIs, controls, directory, and marketplace', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<IntegrationsScreen />);
    await waitFor(() => expect(api.fetchIntegrationsOverview).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Integrations' })).toBeInTheDocument();
    expect(screen.getByText(/manage third-party service connections/i)).toBeInTheDocument();
    expect(screen.getByText('Total Active Integrations')).toBeInTheDocument();
    expect(screen.getByText('Expired Auth Tokens')).toBeInTheDocument();
    expect(screen.getByText('Integration Controls')).toBeInTheDocument();
    expect(screen.getByText('Disable Compromised Connections')).toBeInTheDocument();
    expect((await screen.findAllByText('Fiserv')).length).toBeGreaterThan(0);
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(await screen.findByText('QuickBooks')).toBeInTheDocument();
    expect(screen.getByText('At-a-Glance Summary (Today)')).toBeInTheDocument();
  });

  it('exports the integration report from the header', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<IntegrationsScreen />);
    fireEvent.click(await screen.findByText('⬇ Export Integration Report'));
    await waitFor(() => expect(api.exportIntegrationReport).toHaveBeenCalledWith(expect.objectContaining({ format: 'csv' })));
    expect(await screen.findByText(/Exported 11 integration row/i)).toBeInTheDocument();
  });

  it('disables an active connection via the compromised-connections control (audited, reason sent)', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<IntegrationsScreen />);
    await screen.findAllByText('Fiserv');
    fireEvent.click(screen.getByText('Disable Compromised Connections'));
    await waitFor(() => expect(api.disableConnection).toHaveBeenCalledWith('fiserv', expect.any(String)));
    expect(await screen.findByText(/Disable requested for Fiserv/i)).toBeInTheDocument();
  });

  it('opens the Add Integration wizard and creates a connection through the real endpoints', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<IntegrationsScreen />);
    fireEvent.click(await screen.findByText('+ Add Integration'));
    const dialog = await screen.findByRole('dialog', { name: 'Add Integration' });
    // select provider then advance (scoped to the dialog)
    const select = await within(dialog).findByRole('combobox');
    fireEvent.change(select, { target: { value: 'quickbooks' } });
    fireEvent.click(within(dialog).getByText('Next'));
    fireEvent.click(await within(dialog).findByText('Create & continue'));
    await waitFor(() => expect(api.createConnection).toHaveBeenCalledWith(expect.objectContaining({ providerKey: 'quickbooks' })));
    // OAuth begin appears for quickbooks
    fireEvent.click(await within(dialog).findByText('Begin authorization'));
    await waitFor(() => expect(api.beginOAuth).toHaveBeenCalledWith('conn1', expect.objectContaining({ redirectUri: expect.any(String) })));
  });
});
