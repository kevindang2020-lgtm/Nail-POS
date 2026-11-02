import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
import { api } from '../api/client';
import { SystemOpsCapacity } from './SystemOpsCapacity';

const T = '00000000-0000-4000-8000-000000000001';
const load = { windowMinutes: 15, totals: { requests: 1000, dbMs: 40_000, activeTenants: 2 },
  top: [{ tenantId: T, tenantName: 'Alpha Nails', requests: 800, dbMs: 30_000, slowQueries: 3, requestShare: 0.8, dbShare: 0.75 }],
  dominant: { tenantId: T, tenantName: 'Alpha Nails', requests: 800, dbMs: 30_000, slowQueries: 3, requestShare: 0.8, dbShare: 0.75 } };
const cost = { from: '2026-10-02', to: '2026-10-08', days: 7, note: 'Estimates.',
  prices: [{ key: 'cost.unit_price.sms.message', label: 'SMS — per message', usd: 0, unknown: true }],
  perProvider: [{ provider: 'sms:twilio', unit: 'message', quantity: 120, estimatedMicros: 0, unknownQuantity: 120, status: 'UNKNOWN' },
                { provider: 'ai:openai', unit: 'token', quantity: 5000, estimatedMicros: 2500, unknownQuantity: 4000, status: 'PARTIAL' }],
  perTenant: [] };
const quota = { tenantId: T, tenantName: 'Alpha Nails', usage: { storage_bytes: 10, jobs_in_flight: 0 },
  limits: [{ kind: 'api_requests_per_min', limit: 600, source: 'platform' }, { kind: 'jobs_in_flight', limit: 1, source: 'tenant' }, { kind: 'storage_bytes', limit: null, source: 'none' }, { kind: 'ai_budget_daily_micro_usd', limit: null, source: 'none' }] };

describe('System Operations → Capacity (Phase 11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => url.endsWith('/load') ? Promise.resolve(load) : url.endsWith('/cost') ? Promise.resolve(cost)
      : url.endsWith('/webhooks') ? Promise.resolve({ since: '2026-10-08T00:00:00Z', scope: 'this API process', providers: [{ provider: 'twilio', received: 4, verified: 2, rejected: 2, duplicate: 0, processed: 2 }] })
      : url.includes('/quotas/') ? Promise.resolve(quota) : Promise.reject(new Error('404')));
    (api.put as any).mockResolvedValue(quota);
  });
  it('load: top salons with shares, and the over-half banner', async () => {
    render(<SystemOpsCapacity />);
    expect(await screen.findByTestId('noisy-banner')).toHaveTextContent('Alpha Nails is 80% of platform load');
    expect(screen.getByText('800 (80%)')).toBeInTheDocument();
  });
  it('cost: an unpriced provider reads UNKNOWN, never $0; prices are saved with a reason', async () => {
    render(<SystemOpsCapacity />);
    expect(await screen.findByTestId('cost-sms:twilio')).toHaveTextContent('Unknown — no price set');
    expect(screen.getByTestId('cost-ai:openai')).toHaveTextContent('$0.0025 + unknown part');
    fireEvent.click(screen.getByRole('button', { name: 'Unit prices…' }));
    fireEvent.change(screen.getByLabelText('cost.unit_price.sms.message'), { target: { value: '0.0079' } });
    const save = screen.getByRole('button', { name: 'Save prices' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Price change reason'), { target: { value: 'from the October Twilio invoice' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/super-admin/system/cost/prices', { prices: [{ key: 'cost.unit_price.sms.message', usd: 0.0079 }], reason: 'from the October Twilio invoice' }));
  });
  it('quotas: look up a salon, keep the existing override, set a new one, empty = inherit', async () => {
    render(<SystemOpsCapacity />);
    fireEvent.change(screen.getByLabelText('Quota salon id'), { target: { value: T } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('jobs in flight')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Override storage_bytes'), { target: { value: '5000000' } });
    fireEvent.change(screen.getByLabelText('Quota change reason'), { target: { value: 'runaway uploads from one kiosk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save quota' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`/super-admin/system/quotas/tenants/${T}`, { reason: 'runaway uploads from one kiosk', api_requests_per_min: null, jobs_in_flight: 1, storage_bytes: 5000000 }));
  });
  it('webhooks per provider; a failed load says so instead of showing zeros', async () => {
    (api.get as any).mockImplementation((url: string) => url.endsWith('/webhooks') ? Promise.resolve({ since: '2026-10-08T00:00:00Z', scope: 'this API process', providers: [{ provider: 'twilio', received: 4, verified: 2, rejected: 2, duplicate: 0, processed: 2 }] }) : Promise.reject(new Error('boom')));
    render(<SystemOpsCapacity />);
    expect(await screen.findByTestId('load-failed')).toBeInTheDocument();
    expect(await screen.findByText('twilio')).toBeInTheDocument();
  });
});
