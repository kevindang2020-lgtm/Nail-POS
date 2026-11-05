import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { posApiKeysApi } from '../api/posApiWebhooksApi';
import { MemoryRouter } from 'react-router-dom';
import { TenantApiWebhooksScreen } from './TenantApiWebhooksScreen';

const { stepUp } = vi.hoisted(() => ({ stepUp: vi.fn() }));
vi.mock('../api/posStepUpApi', () => ({ posStepUpApi: { stepUp } }));
vi.mock('../api/posApiWebhooksApi', () => ({
  posApiKeysApi: {
    list: vi.fn().mockResolvedValue([{ id: 'k1', name: 'Production API Key', prefix: 'ak_live_Q7x2', masked: 'ak_live_Q7x2••••••••', environment: 'live', scopes: ['services.read'], status: 'active', createdByUserId: null, lastUsedIso: null, expiresIso: null, createdIso: '2026-04-01T00:00:00Z' }]),
    create: vi.fn().mockResolvedValue({ id: 'k2', name: 'New Key', prefix: 'ak_live_AB12', masked: 'ak_live_AB12••••••••', environment: 'live', scopes: [], status: 'active', createdByUserId: null, lastUsedIso: null, expiresIso: null, createdIso: null, secret: 'ak_live_AB12verysecret' }),
    rotate: vi.fn(),
    revoke: vi.fn().mockResolvedValue({ id: 'k1', revoked: true }),
  },
  posWebhooksApi: {
    list: vi.fn().mockResolvedValue([{ id: 'w1', name: 'Appointments → CRM', url: 'https://hooks.example.com/crm', events: ['appointment.created'], status: 'active', hasSecret: true, lastDeliveryIso: null, lastSuccessIso: null, lastFailureIso: null, failureCount: 0, createdIso: null }]),
    create: vi.fn(), pause: vi.fn(), resume: vi.fn(), disable: vi.fn(), rotateSecret: vi.fn(),
    test: vi.fn().mockResolvedValue({ id: 'w1', delivered: true, detail: 'Signed test event delivered (HTTP 200).' }),
  },
}));

describe('TenantApiWebhooksScreen', () => {
  it('lists masked keys and webhooks', async () => {
    render(<MemoryRouter><TenantApiWebhooksScreen /></MemoryRouter>);
    expect(await screen.findByText('APIs & Webhooks')).toBeInTheDocument();
    expect(await screen.findByText('Production API Key')).toBeInTheDocument();
    expect(screen.getByText('ak_live_Q7x2••••••••')).toBeInTheDocument();
    expect(await screen.findByText('Appointments → CRM')).toBeInTheDocument();
    expect(screen.getByText('https://hooks.example.com/crm')).toBeInTheDocument();
  });

  it('creates a key and reveals the raw secret exactly once', async () => {
    render(<MemoryRouter><TenantApiWebhooksScreen /></MemoryRouter>);
    await screen.findByText('Production API Key');
    fireEvent.click(screen.getByRole('button', { name: '+ Create API Key' }));
    fireEvent.change(screen.getByPlaceholderText('Key name'), { target: { value: 'New Key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/ak_live_AB12verysecret/)).toBeInTheDocument();
    expect(screen.getByText(/copy it now, it won't be shown again/i)).toBeInTheDocument();
  });

  it('runs an honest webhook test (no faked delivery)', async () => {
    const mod = await import('../api/posApiWebhooksApi');
    render(<MemoryRouter><TenantApiWebhooksScreen /></MemoryRouter>);
    await screen.findByText('Appointments → CRM');
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect((mod.posWebhooksApi.test as any)).toHaveBeenCalledWith('w1');
    expect(await screen.findByText(/Signed test event delivered/)).toBeInTheDocument();
  });
  // Security Deep Scan C7: POST /pos/api-keys is a step-up route
  it('creating a key that needs a step-up opens the password prompt, then reveals the secret after the one retry', async () => {
    (posApiKeysApi.create as any).mockRejectedValueOnce(Object.assign(new Error('step up'), { status: 403, code: 'STEP_UP_REQUIRED' }));
    stepUp.mockResolvedValue({ ok: true });
    render(<MemoryRouter><TenantApiWebhooksScreen /></MemoryRouter>);
    await screen.findByText('Production API Key');
    fireEvent.click(screen.getByRole('button', { name: '+ Create API Key' }));
    fireEvent.change(screen.getByPlaceholderText('Key name'), { target: { value: 'New Key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText(/Issuing API keys and webhook secrets needs your password/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/ak_live_AB12verysecret/)).toBeInTheDocument();
    await waitFor(() => expect(stepUp).toHaveBeenCalledWith({ password: 'pw' }));
  });
});
