// POSAIPlansScreen — AI Plans guide (Nov 1 2026). The five plan cards stay; each shows the one honest state (a lapsed trial is
// "Trial expired", never "On trial"), the trial end date, a plain note when no bundle discount exists, and Start trial / Cancel
// ask for confirmation first; a re-trial refusal says the free trial was already used.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
const { api } = vi.hoisted(() => ({ api: { plans: vi.fn(), startPlanTrial: vi.fn(), cancelPlan: vi.fn() } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: api }));
import { POSAIPlansScreen } from './POSAIPlansScreen';

const plan = (o: any = {}) => ({ code: 'plan_money_owner', name: 'Money & Owner', description: 'Protect the money.', essential: false, fullCents: 15700, discountCents: 0, effectiveCents: 15700,
  subscribed: false, status: null, trialAvailable: true, state: 'trial_available', trialEndsAt: null, cancelledAt: null, canCancel: false,
  packages: [{ code: 'ai_ocr_receipt_scanner', name: 'AI OCR Receipt Scanner', monthlyPriceCents: 2900, usageUnit: 'scans', posArea: null }], ...o });
const mount = () => render(<MemoryRouter><POSAIPlansScreen /></MemoryRouter>);
beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); });

describe('POSAIPlansScreen', () => {
  it('a lapsed plan trial reads "Trial expired" with its end date — not "On trial"; Cancel is offered', async () => {
    api.plans.mockResolvedValue({ plans: [plan({ state: 'trial_expired', status: 'trialing', subscribed: false, trialAvailable: false, canCancel: true, trialEndsAt: '2026-10-20T15:00:00Z' })] });
    mount();
    expect(await screen.findByTestId('plan-state-plan_money_owner')).toHaveTextContent('Trial expired');
    expect(screen.queryByText('On trial')).toBeNull();
    expect(screen.getByTestId('plan-trial-plan_money_owner')).toHaveTextContent(/Trial ended Oct 20, 2026/);
    expect(screen.getByTestId('plan-cancel-plan_money_owner')).toBeInTheDocument();
  });
  it('no bundle discount says so plainly; Start trial confirms first', async () => {
    api.plans.mockResolvedValue({ plans: [plan()] }); api.startPlanTrial.mockResolvedValue({ ok: true, activated: 3 });
    mount();
    expect(await screen.findByTestId('plan-nodiscount-plan_money_owner')).toHaveTextContent(/No bundle discount/);
    fireEvent.click(screen.getByTestId('plan-trial-start-plan_money_owner'));
    expect(api.startPlanTrial).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-confirm-plan_money_owner')).toHaveTextContent('$157');
    fireEvent.click(screen.getByTestId('plan-confirm-go-plan_money_owner'));
    await waitFor(() => expect(api.startPlanTrial).toHaveBeenCalledWith('plan_money_owner'));
  });
  it('a refused re-trial says the free trial was already used', async () => {
    api.plans.mockResolvedValue({ plans: [plan()] }); api.startPlanTrial.mockRejectedValue({ status: 400, message: 'trial_already_used' });
    mount();
    fireEvent.click(await screen.findByTestId('plan-trial-start-plan_money_owner'));
    fireEvent.click(screen.getByTestId('plan-confirm-go-plan_money_owner'));
    expect(await screen.findByText(/free trial was already used/)).toBeInTheDocument();
  });
  it('SUNMI §07: five tabs — Packages here; the other four open the ONE AI Usage screen at their view', async () => {
    api.plans.mockResolvedValue({ plans: [plan()] });
    const Where = () => <div data-testid="where">{useLocation().pathname + useLocation().search}</div>;
    render(<MemoryRouter initialEntries={['/tenant/ai/plans']}><Routes><Route path="/tenant/ai/plans" element={<POSAIPlansScreen />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['Packages', 'Individual AI', 'My Subscriptions', 'Billing History', 'Usage & Limits']);
    expect(screen.getByTestId('plx-tab-packages')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('plan-card-plan_money_owner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plx-tab-billing'));
    expect(await screen.findByTestId('where')).toHaveTextContent('/tenant/ai/usage?view=billing');
  });
  it('SUNMI purchase-overlap preview: assistants already owned on their own are named with their price, and Start trial warns before confirming', async () => {
    api.plans.mockResolvedValue({ plans: [plan({ overlap: { owned: [{ code: 'ai_ocr_receipt_scanner', name: 'AI OCR Receipt Scanner', status: 'active', monthlyPriceCents: 2900 }], ownedMonthlyCents: 2900 } })] });
    mount();
    expect(await screen.findByTestId('plan-overlap-plan_money_owner')).toHaveTextContent(/already have 1 of these assistants on their own: AI OCR Receipt Scanner\. They cost \$29\/mo now/);
    fireEvent.click(screen.getByTestId('plan-trial-start-plan_money_owner'));
    expect(await screen.findByTestId('plan-confirm-overlap-plan_money_owner')).toHaveTextContent(/does not cancel/);
    expect(api.startPlanTrial).not.toHaveBeenCalled();
  });
});

