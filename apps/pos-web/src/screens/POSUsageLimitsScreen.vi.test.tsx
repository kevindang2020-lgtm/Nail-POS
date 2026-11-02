// POSUsageLimitsScreen.vi.test — English + Vietnamese POS mandate (WP-C3): Usage & limits reads in Vietnamese (metric names,
// statuses); the plan name is data. Same mocked API as POSUsageLimitsScreen.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
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

afterEach(async () => { await setLanguage('en'); });

describe('POSUsageLimitsScreen in Vietnamese', () => {
  it('metric names and statuses are Vietnamese', async () => {
    await setLanguage('vi');
    stateMock.mockResolvedValue(state);
    const { container } = render(<POSUsageLimitsScreen />);
    await screen.findByText('Thợ');
    for (const en of ['Technicians', 'Branches', 'Devices', 'Unlimited']) expect(screen.queryByText(en), en).toBeNull();
    expect(leftoverEnglish(container, ['Pro', 'pro']).join(' | ')).toBe('');
  });
});
