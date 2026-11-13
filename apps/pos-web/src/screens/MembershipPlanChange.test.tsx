// MembershipPlanChange.test — extras Membership Overview 13 · 10: preview a plan change before publishing. The preview shows
// the changed terms, current members by version (they keep their terms) and what new members pay; Publish is the only write,
// sends carryForward, and is blocked while the server reports no change / an archived plan.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { previewVersion: vi.fn(), publishVersion: vi.fn() } }));
vi.mock('../api/posMembershipsApi', () => ({ posMembershipsApi: api }));
import { PlanChangePanel } from './MembershipPlanChange';

const PV = { planId: 'pl1', blockers: [], currentVersionNumber: 2, nextVersionNumber: 3, readOnly: true,
  changes: [{ field: 'priceCents', from: 4900, to: 5900 }, { field: 'trialDays', from: 7, to: 0 }],
  benefits: { current: 2, proposed: 2, carriedForward: true },
  currentSubscribers: { total: 3, keepTheirTerms: true, byVersion: [{ versionNumber: 2, priceCents: 4900, billingInterval: 'month', members: 1, current: true }, { versionNumber: 1, priceCents: 3900, billingInterval: 'month', members: 2, current: false }] },
  futureSubscribers: { priceCents: 5900, billingInterval: 'month', priceDeltaCents: 1000 } };
beforeEach(() => { api.previewVersion.mockReset(); api.publishVersion.mockReset(); });

describe('Plan change preview (Membership Overview 13 · 10)', () => {
  it('previews only the fields typed (carryForward), shows current vs future members, then publishes on request', async () => {
    api.previewVersion.mockResolvedValue(PV);
    api.publishVersion.mockResolvedValue({ versionId: 'v3', versionNumber: 3 });
    const done = vi.fn();
    render(<PlanChangePanel planId="pl1" onPublished={done} />);
    fireEvent.change(screen.getByTestId('pc-price'), { target: { value: '59.00' } });
    fireEvent.change(screen.getByTestId('pc-trial'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('pc-preview'));
    await screen.findByTestId('pc-result');
    expect(api.previewVersion).toHaveBeenCalledWith('pl1', { carryForward: true, priceCents: 5900, trialDays: 0 });
    expect(screen.getByTestId('pc-changes')).toHaveTextContent(/Price\s*\$49\.00\s*\$59\.00/);
    expect(screen.getByTestId('pc-changes')).toHaveTextContent(/Trial days\s*7\s*0/);
    expect(screen.getByTestId('pc-current')).toHaveTextContent('Current members: 3 — they keep the terms they joined on');
    expect(screen.getByTestId('pc-current')).toHaveTextContent('v1 · $39.00 / month · 2 member(s)');
    expect(screen.getByTestId('pc-future')).toHaveTextContent('People who join after publishing pay $59.00 / month. That is $10.00 more than now.');
    expect(screen.getByTestId('pc-benefits')).toHaveTextContent('all 2 carried forward');
    expect(api.publishVersion).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('pc-publish'));
    await waitFor(() => expect(done).toHaveBeenCalledWith(3));
    expect(api.publishVersion).toHaveBeenCalledWith('pl1', { carryForward: true, priceCents: 5900, trialDays: 0 });
  });
  it('a blocker disables Publish; editing a field clears the old preview; a refusal shows the error', async () => {
    api.previewVersion.mockResolvedValueOnce({ ...PV, changes: [], blockers: ['no_change'] });
    render(<PlanChangePanel planId="pl1" onPublished={() => undefined} />);
    fireEvent.click(screen.getByTestId('pc-preview'));
    expect(await screen.findByTestId('pc-blocker-no_change')).toHaveTextContent('Nothing changed');
    expect(screen.getByTestId('pc-publish')).toBeDisabled();
    fireEvent.change(screen.getByTestId('pc-fee'), { target: { value: '10' } });
    expect(screen.queryByTestId('pc-result')).toBeNull();
    api.previewVersion.mockRejectedValueOnce(Object.assign(new Error('Price cannot be negative'), { status: 400 }));
    fireEvent.click(screen.getByTestId('pc-preview'));
    expect(await screen.findByTestId('pc-error')).toBeInTheDocument();
    expect(api.publishVersion).not.toHaveBeenCalled();
  });
});
