import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
const { stateMock } = vi.hoisted(() => ({ stateMock: vi.fn() }));
vi.mock('../api/posUsageLimitsApi', () => ({ posUsageLimitsApi: { state: stateMock } }));
import { POSUsageLimitsScreen } from './POSUsageLimitsScreen';
beforeEach(() => stateMock.mockReset());

const lim = (metric: string, o: any) => ({ metric, planConfigured: true, used: o.used ?? null, effectiveValue: o.effectiveValue ?? null, effectiveSource: o.effectiveSource || 'plan', enforcement: 'hard', evaluation: { status: o.status, usedPct: o.usedPct ?? null, allowed: o.allowed ?? true } });
const state = {
  tenantId: 't1', plan: { text: 'pro', name: 'Pro', code: 'pro' },
  limits: [
    lim('technicians', { used: 12, effectiveValue: null, status: 'unlimited' }),
    lim('branches', { used: 4, effectiveValue: 5, usedPct: 80, status: 'warning' }),
    lim('devices', { used: 5, effectiveValue: 5, usedPct: 100, status: 'blocked', allowed: false }),
  ],
};

describe('POSUsageLimitsScreen', () => {
  it('shows the plan, and per-metric used/limit/status', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSUsageLimitsScreen />);
    expect(await screen.findByRole('heading', { name: 'Usage & Limits' })).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Technicians')).toBeInTheDocument();
    expect(screen.getAllByText('Unlimited').length).toBeGreaterThan(0);
    expect(screen.getByText('Near limit')).toBeInTheDocument();    // branches warning
    expect(screen.getByText('At limit')).toBeInTheDocument();      // devices blocked
  });
  it('counts at/near-limit metrics', async () => {
    stateMock.mockResolvedValue(state);
    render(<POSUsageLimitsScreen />);
    await screen.findByText('Pro');
    // branches(warning) + devices(blocked) = 2 at/near limit
    expect(screen.getByText('At / Near Limit').closest('.kpi')?.querySelector('.v')?.textContent).toBe('2');
  });
});
