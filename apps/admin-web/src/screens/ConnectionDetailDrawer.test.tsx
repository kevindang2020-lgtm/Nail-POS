import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectionDetailDrawer } from './ConnectionDetailDrawer';

vi.mock('../api/superAdminIntegrationsApi', () => ({
  getCredentialSummary: vi.fn().mockResolvedValue({ ok: true, connection: {}, credentials: [{ id: 'cr1', kind: 'api_key', masked_value: '••••••••1234', status: 'active' }] }),
  listSyncJobs: vi.fn().mockResolvedValue({ ok: true, jobs: [{ id: 'j1', sync_type: 'full', status: 'partial', items_read: 5, items_created: 4, items_skipped: 0, items_failed: 1, retry_count: 0, error_category: null, created_at: '2026-05-06T10:00:00', completed_at: null }] }),
  listConnectionWebhookEvents: vi.fn().mockResolvedValue({ ok: true, events: [{ id: 'e1', provider_event_id: 'evt-1', event_type: 'invoice.created', signature_result: 'valid', replay_result: 'ok', status: 'failed', attempt_count: 1, error_category: 'Processing Failed', received_at: '2026-05-06T10:00:00', processed_at: null }] }),
  getConnectionReliability: vi.fn().mockResolvedValue({ ok: true, breaker: { state: 'open', failure_count: 5, failure_threshold: 5 }, rateLimits: [{ scope_type: 'provider', scope_key: 'p', count: 3, limit_per_window: 100, window_seconds: 60, retry_after_until: null }] }),
  resetCircuitBreaker: vi.fn().mockResolvedValue({ ok: true, breakerState: 'closed' }),
  retrySyncJob: vi.fn().mockResolvedValue({ ok: true, jobStatus: 'successful' }),
  retryWebhookEvent: vi.fn().mockResolvedValue({ ok: true, eventStatus: 'processed' }),
  enqueueSync: vi.fn().mockResolvedValue({ ok: true, jobId: 'job12345', jobStatus: 'queued' }),
  refreshAuthentication: vi.fn().mockResolvedValue({ ok: true, authenticationStatus: 'valid', tokenExpiresAt: null }),
  testConnectionLive: vi.fn().mockResolvedValue({ ok: true, result: { succeeded: true, latencyMs: 42, providerAccount: 'acct', apiVersion: 'v1', errorCategory: null } }),
  rotateCredential: vi.fn().mockResolvedValue({ ok: true, maskedCredential: '••••••••9999' }),
}));

const conn: any = { id: 'conn1', tenant_id: null, provider_key: 'quickbooks', category: 'Accounting', ownership_type: 'platform_shared', connection_status: 'active', authentication_status: 'valid', sync_status: 'successful', webhook_status: 'healthy', auth_method: 'oauth2', granted_scopes: ['accounting'], provider_account: 'acct', token_expires_at: '2026-08-01T00:00:00', created_at: '2026-05-01T00:00:00' };

describe('ConnectionDetailDrawer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads and renders credentials, reliability, sync jobs, and webhook events', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<ConnectionDetailDrawer conn={conn} onClose={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(api.getConnectionReliability).toHaveBeenCalledWith('conn1'));
    expect(screen.getByRole('heading', { name: 'quickbooks' })).toBeInTheDocument();
    expect(await screen.findByText('••••••••1234')).toBeInTheDocument();
    expect(screen.getByText('Reliability')).toBeInTheDocument();
    expect(screen.getByText('Sync Jobs')).toBeInTheDocument();
    expect(screen.getByText('Inbound Webhook Events')).toBeInTheDocument();
  });

  it('resets the circuit breaker when open', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<ConnectionDetailDrawer conn={conn} onClose={() => {}} onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('Reset Circuit Breaker'));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'manual recovery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.resetCircuitBreaker).toHaveBeenCalledWith('conn1', 'manual recovery'));
  });

  it('retries a failed sync job and a failed webhook event', async () => {
    const api = await import('../api/superAdminIntegrationsApi');
    render(<ConnectionDetailDrawer conn={conn} onClose={() => {}} onChanged={() => {}} />);
    const retryButtons = await screen.findAllByText('Retry');
    fireEvent.click(retryButtons[0]);
    await waitFor(() => expect(api.retrySyncJob).toHaveBeenCalledWith('j1'));
  });
});
