// SmsVerificationPanel.test.tsx — P5 pins for the tenant widget (§9/§10/§38/§43).
// Fakes posSmsPlanApi and drives the real panel: usage numbers + progress render · the overage line shows
// count × snapshot rate = estimate · upgrade is a two-step inline Review → Confirm that posts the packageId ·
// the no-package state is HONEST (verification keeps working, unbilled) and still offers self-service choices
// when Super Admin has made any available · with no package AND no self-service options, no upgrade UI at all.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SmsVerificationPanel from './SmsVerificationPanel';
import { posSmsPlanApi } from '../api/posSmsPlanApi';

vi.mock('../api/posSmsPlanApi', () => ({
  posSmsPlanApi: { plan: vi.fn(), upgrade: vi.fn() },
}));
const mocked = posSmsPlanApi as unknown as { plan: ReturnType<typeof vi.fn>; upgrade: ReturnType<typeof vi.fn> };

const GROWTH = { id: 'p2', code: 'sms_growth', name: 'Package 2 — Growth', description: null, monthlyPriceCents: 4900, includedVerificationCount: 2000, overageEnabled: true, overageUnitPriceCents: 3, hardLimitEnabled: false };
const BAL_OK = { hasPackage: true, packageName: 'Package 2 — Growth', packageCode: 'sms_growth', cycleStart: '2026-07-01', cycleEnd: '2026-07-31', includedAllowance: 2000, usedIncluded: 1425, remainingIncluded: 575, overageCount: 0, overageUnitPriceCents: 3, overageEnabled: true, hardLimitEnabled: false, failedCount: 0, estimatedOverageCents: 0, warningThresholdPercent: 80, criticalThresholdPercent: 95, monthlyPriceCents: 4900 } as const;

beforeEach(() => { mocked.plan.mockReset(); mocked.upgrade.mockReset(); });

describe('SmsVerificationPanel', () => {
  it('§10: renders the usage line, progress, and next reset from balance()', async () => {
    mocked.plan.mockResolvedValue({ balance: BAL_OK, packages: [GROWTH] });
    render(<SmsVerificationPanel />);
    expect(await screen.findByText(/1,425 \/ 2,000 used · 71% · 575 remaining/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('71');
    expect(screen.getByText(/Next reset:/)).toBeTruthy();
  });

  it('over-limit view: overage count × rate = estimated charge, in exact cents', async () => {
    mocked.plan.mockResolvedValue({ balance: { ...BAL_OK, usedIncluded: 2000, remainingIncluded: 0, overageCount: 175, estimatedOverageCents: 525 }, packages: [] });
    render(<SmsVerificationPanel />);
    expect(await screen.findByText(/Overage: 175 × \$0\.03 = \$5\.25 estimated/)).toBeTruthy();
  });

  it('§9 upgrade: Review → Confirm posts the chosen packageId; success note states the effective policy', async () => {
    mocked.plan.mockResolvedValue({ balance: BAL_OK, packages: [GROWTH] });
    mocked.upgrade.mockResolvedValue({ ok: true, effective: 'immediate' });
    render(<SmsVerificationPanel />);
    fireEvent.click(await screen.findByText('Review Change'));
    expect(screen.getByText(/Downgrades start next billing cycle; upgrades apply immediately/)).toBeTruthy();
    fireEvent.click(screen.getByText('Confirm Change'));
    await waitFor(() => expect(mocked.upgrade).toHaveBeenCalledWith('p2'));
    expect(await screen.findByText(/effective immediately/)).toBeTruthy();
  });

  it('§43: base price and estimated total render in exact dollars', async () => {
    mocked.plan.mockResolvedValue({ balance: { ...BAL_OK, overageCount: 3, estimatedOverageCents: 9 }, packages: [] });
    render(<SmsVerificationPanel />);
    expect(await screen.findByText('Base $49.00/mo + $0.09 overage · Estimated total $49.09')).toBeTruthy();
  });

  it('§31: warning banner at ≥warn%, the exact spec text with the live percentage', async () => {
    mocked.plan.mockResolvedValue({ balance: { ...BAL_OK, usedIncluded: 1700, remainingIncluded: 300 }, packages: [] });
    render(<SmsVerificationPanel />);
    expect(await screen.findByText('You have used 85% of your monthly SMS verification allowance.')).toBeTruthy();
  });

  it('§31 at 100%: hard limit says "limit reached"; soft/overage says "Overage charges now apply."', async () => {
    mocked.plan.mockResolvedValue({ balance: { ...BAL_OK, usedIncluded: 2000, remainingIncluded: 0, overageEnabled: false, hardLimitEnabled: true }, packages: [] });
    const { unmount } = render(<SmsVerificationPanel />);
    expect(await screen.findByText('SMS verification limit reached.')).toBeTruthy();
    unmount();
    mocked.plan.mockResolvedValue({ balance: { ...BAL_OK, usedIncluded: 2000, remainingIncluded: 0, overageCount: 3, estimatedOverageCents: 9 }, packages: [] });
    render(<SmsVerificationPanel />);
    expect(await screen.findByText('Overage charges now apply.')).toBeTruthy();
  });

  it('no package: HONEST copy — verification keeps working and is not billed; choices still offered when available', async () => {
    mocked.plan.mockResolvedValue({ balance: { hasPackage: false }, packages: [GROWTH] });
    render(<SmsVerificationPanel />);
    expect(await screen.findByText(/Verification keeps working and is not billed/i)).toBeTruthy();
    expect(screen.getByText('Choose a Package')).toBeTruthy();
  });

  it('no package and nothing self-service: no upgrade UI, no fabricated readiness', async () => {
    mocked.plan.mockResolvedValue({ balance: { hasPackage: false }, packages: [] });
    render(<SmsVerificationPanel />);
    await screen.findByText(/not billed/i);
    expect(screen.queryByText('Choose a Package')).toBeNull();
    expect(screen.queryByText('Review Change')).toBeNull();
    expect(screen.getByText(/Twilio connection — check it under Communications/)).toBeTruthy();
  });
  it('wave 3 PAYI §77: plain-SMS usage is reported in SEGMENTS, beside (not merged into) the verification balance', async () => {
    mocked.plan.mockResolvedValue({ balance: BAL_OK, packages: [], messaging: { periodStart: '2026-10-01', periodEnd: '2026-11-01', messages: 120, segments: 143, delivered: 118, failed: 2, unknownSegments: 3 } });
    render(<SmsVerificationPanel />);
    const block = await screen.findByLabelText('Text messages this month');
    expect(block.textContent).toMatch(/120 messages/);
    expect(block.textContent).toMatch(/143 segments/);
    expect(block.textContent).toMatch(/3 not sized by the carrier/);
  });
});
