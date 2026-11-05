import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { aiAdminPackages: vi.fn(), aiAdminPackageTenants: vi.fn(), aiAdminUsageSummary: vi.fn(), aiAdminAssign: vi.fn(), aiAdminUpdate: vi.fn(), aiAdminCancel: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { AiSubscriptionsScreen } from './AiSubscriptionsScreen';

const pkgs = () => ({
  packages: [
    { code: 'ai_booking_assistant', name: 'AI Booking Assistant', category: 'front_desk', monthlyPriceCents: 4900, includedUsageLimit: 1000, usageUnit: 'messages', trialDays: 14, subscribers: 2, activeSubscribers: 1, byStatus: { active: 1, trialing: 1 }, mrrCents: 4900 },
    { code: 'ai_analytics_forecasting', name: 'AI Analytics / Forecasting', category: 'insights', monthlyPriceCents: 7900, includedUsageLimit: 500, usageUnit: 'runs', trialDays: 14, subscribers: 0, activeSubscribers: 0, byStatus: {}, mrrCents: 0 },
  ],
  totals: { subscribers: 2, activeSubscribers: 1, mrrCents: 4900 },
});

describe('AiSubscriptionsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (superAdminApi.aiAdminPackages as any).mockResolvedValue(pkgs());
    (superAdminApi.aiAdminUsageSummary as any).mockResolvedValue([
      { packageCode: 'ai_booking_assistant', status: 'success', calls: 120, usageAmount: 120, costMicroUsd: 1_950_000 },
      { packageCode: 'ai_booking_assistant', status: 'blocked_limit', calls: 5, usageAmount: 0, costMicroUsd: 0 },
    ]);
    (superAdminApi.aiAdminPackageTenants as any).mockResolvedValue([{ tenantId: 't1', tenantName: 'Luxe Nails', packageCode: 'ai_booking_assistant', status: 'active', usageLimit: 1000, overageEnabled: false, trialEndsAt: null }]);
    (superAdminApi.aiAdminAssign as any).mockResolvedValue({ ok: true });
    (superAdminApi.aiAdminCancel as any).mockResolvedValue({ ok: true });
  });

  it('shows the package rollup + MRR totals', async () => {
    render(<MemoryRouter><AiSubscriptionsScreen /></MemoryRouter>);
    expect(await screen.findByText('AI Booking Assistant')).toBeInTheDocument();
    expect(screen.getByText('$49 MRR')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it('surfaces AI usage cost (COGS) totals and per-package', async () => {
    render(<MemoryRouter><AiSubscriptionsScreen /></MemoryRouter>);
    await screen.findByText('AI Booking Assistant');
    // total across both rows = $1.95 across 125 calls
    expect(screen.getByText('$1.95')).toBeInTheDocument();
    expect(screen.getByText(/across 125 calls/)).toBeInTheDocument();
    // per-package line includes calls + cost for the booking package
    expect(screen.getByText(/125 calls · \$1\.95 cost/)).toBeInTheDocument();
  });

  it('opens a package and lists its subscribers', async () => {
    render(<MemoryRouter><AiSubscriptionsScreen /></MemoryRouter>);
    await screen.findByText('AI Booking Assistant');
    fireEvent.click(screen.getAllByText('Subscribers')[0]);
    expect(await screen.findByText('Luxe Nails')).toBeInTheDocument();
    expect(superAdminApi.aiAdminPackageTenants).toHaveBeenCalledWith('ai_booking_assistant');
  });

  it('assigns a package to a tenant', async () => {
    render(<MemoryRouter><AiSubscriptionsScreen /></MemoryRouter>);
    await screen.findByText('AI Booking Assistant');
    fireEvent.click(screen.getAllByText('Assign')[0]);
    fireEvent.change(await screen.findByPlaceholderText('tenant UUID'), { target: { value: 't9' } });
    fireEvent.click(screen.getByText('Assign Package'));
    await waitFor(() => expect(superAdminApi.aiAdminAssign).toHaveBeenCalledWith('t9', expect.objectContaining({ packageCode: 'ai_booking_assistant', trial: false })));
  });
});
