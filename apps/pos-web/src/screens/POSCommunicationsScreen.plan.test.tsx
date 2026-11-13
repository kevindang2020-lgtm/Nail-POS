// extras Communications 09: the texting subscription is wired into the inbox hub (server plan, usage never merged).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const plan = vi.hoisted(() => ({ plan: vi.fn(), upgrade: vi.fn() }));
vi.mock('../api/posSmsPlanApi', () => ({ posSmsPlanApi: plan }));
import { SmsPlanCard } from './POSCommunicationsScreen';

beforeEach(() => plan.plan.mockReset());

describe('SmsPlanCard (extras Communications 09)', () => {
  it('shows this month\'s texts / segments and the booking-code allowance side by side; Open plan goes to the plan', async () => {
    plan.plan.mockResolvedValue({ balance: { hasPackage: true, packageName: 'Starter', packageCode: 'starter', cycleStart: '2026-11-01', cycleEnd: '2026-11-30', includedAllowance: 500, usedIncluded: 120, remainingIncluded: 380,
      overageCount: 0, overageUnitPriceCents: 2, overageEnabled: false, hardLimitEnabled: true, failedCount: 0, estimatedOverageCents: 0, warningThresholdPercent: 80, criticalThresholdPercent: 95, monthlyPriceCents: 1500 },
      packages: [], messaging: { periodStart: '2026-11-01', periodEnd: '2026-11-30', messages: 42, segments: 57, delivered: 40, failed: 2, unknownSegments: 0 } });
    const onOpen = vi.fn();
    render(<MemoryRouter><SmsPlanCard onOpen={onOpen} /></MemoryRouter>);
    expect(await screen.findByTestId('ci-sms-plan-usage')).toHaveTextContent('This month: 42 texts, 57 segments (40 delivered, 2 failed).');
    expect(screen.getByTestId('ci-sms-plan-package')).toHaveTextContent('Starter: 380 of 500 booking codes left this cycle.');
    fireEvent.click(screen.getByTestId('ci-sms-plan-open')); expect(onOpen).toHaveBeenCalled();
  });
  it('a failed read says so; no package / no usage are said plainly', async () => {
    plan.plan.mockRejectedValueOnce(new Error('down'));
    const { unmount } = render(<MemoryRouter><SmsPlanCard onOpen={() => {}} /></MemoryRouter>);
    expect(await screen.findByTestId('ci-sms-plan-error')).toBeInTheDocument(); unmount();
    plan.plan.mockResolvedValue({ balance: { hasPackage: false }, packages: [], messaging: null });
    render(<MemoryRouter><SmsPlanCard onOpen={() => {}} /></MemoryRouter>);
    expect(await screen.findByTestId('ci-sms-plan-usage')).toHaveTextContent('not available');
    expect(screen.getByTestId('ci-sms-plan-package')).toHaveTextContent('No booking-code package');
  });
});
