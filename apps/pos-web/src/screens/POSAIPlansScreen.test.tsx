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
  it('extras AI Plans 07: the state badge is the server\'s re-read after Start trial — never taken from the trial request\'s response', async () => {
    // the trial call answers "trialing", but the server's plan list still says available (e.g. activation pending): no badge
    api.plans.mockResolvedValue({ plans: [plan()] }); api.startPlanTrial.mockResolvedValue({ ok: true, planCode: 'plan_money_owner', status: 'trialing', activated: 0 });
    mount();
    fireEvent.click(await screen.findByTestId('plan-trial-start-plan_money_owner'));
    fireEvent.click(screen.getByTestId('plan-confirm-go-plan_money_owner'));
    await waitFor(() => expect(api.plans).toHaveBeenCalledTimes(2));            // re-read from the server
    expect(screen.queryByTestId('plan-state-plan_money_owner')).toBeNull();     // no "On trial" / "Active" from the response
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
  it('extras AI Plans 04: the Start-trial confirm shows the server charge effect — nothing today, the price after the trial, what could be paid twice, unused credits; a guard refusal is said before anything starts', async () => {
    api.plans.mockResolvedValue({ plans: [plan({ effectiveCents: 12900, overlap: { owned: [{ code: 'ai_ocr_receipt_scanner', name: 'AI OCR Receipt Scanner', status: 'active', monthlyPriceCents: 2900 }], ownedMonthlyCents: 2900 },
      charge: { refusal: null, chargedTodayCents: 0, afterTrialMonthlyCents: 12900, possibleDoubleMonthlyCents: 2900, creditsRemainingCents: 2500 } })] });
    mount();
    fireEvent.click(await screen.findByTestId('plan-trial-start-plan_money_owner'));
    const c = await screen.findByTestId('plan-confirm-charge-plan_money_owner');
    expect(c).toHaveTextContent('Charged today: $0'); expect(c).toHaveTextContent('After the trial: $129 a month');
    expect(c).toHaveTextContent('up to $29 a month could be paid twice'); expect(c).toHaveTextContent('Account credits not yet used: $25');
    expect(screen.queryByTestId('plan-charge-refusal-plan_money_owner')).toBeNull();
    expect(api.startPlanTrial).not.toHaveBeenCalled();
  });
  it('extras AI Plans #03: the server\'s price check is shown — a verified saving, an overstated "Save", or no saving versus buying separately', async () => {
    api.plans.mockResolvedValue({ plans: [
      plan({ code: 'p_ok', fullCents: 10000, discountCents: 2000, effectiveCents: 8000, priceCheck: { standaloneCents: 10000, realSavingsCents: 2000, claimedSavingsCents: 2000, state: 'verified' } }),
      plan({ code: 'p_over', fullCents: 12000, discountCents: 2400, effectiveCents: 9600, priceCheck: { standaloneCents: 10000, realSavingsCents: 400, claimedSavingsCents: 2400, state: 'overstated' } }),
      plan({ code: 'p_none', fullCents: 12000, discountCents: 0, effectiveCents: 12000, priceCheck: { standaloneCents: 10000, realSavingsCents: -2000, claimedSavingsCents: 0, state: 'no_saving' } }),
      plan({ code: 'p_old' }),
    ] });
    mount();
    const ok = await screen.findByTestId('plan-pricecheck-p_ok');
    expect(ok).toHaveAttribute('data-state', 'verified');
    expect(ok).toHaveTextContent('Bought separately: $100/mo · you really save $20/mo');
    expect(screen.getByTestId('plan-pricecheck-p_over')).toHaveTextContent('the real saving is $4/mo, not the $24 shown');
    expect(screen.getByTestId('plan-pricecheck-p_none')).toHaveTextContent('costs $20/mo more than buying them separately');
    expect(screen.queryByTestId('plan-pricecheck-p_old')).toBeNull();   // an older server sends no check: nothing is invented
  });
  it('extras AI Plans #05: Access (commercial) and Setup (technical) are shown apart; a not-ready member says why', async () => {
    api.plans.mockResolvedValue({ plans: [
      plan({ code: 'plan_booking_calls', name: 'Booking & Calls', state: 'active', status: 'active', subscribed: true, canCancel: true,
        packages: [{ code: 'ai_booking_assistant', name: 'AI Booking Assistant', monthlyPriceCents: 4900, usageUnit: 'messages', posArea: null }, { code: 'ai_phone_call_assistant', name: 'AI Phone Call Assistant', monthlyPriceCents: 9900, usageUnit: 'minutes', posArea: null }],
        readiness: { state: 'setup_required', provider: { state: 'connected', reason: null }, checkedAt: '2026-11-12T15:00:00Z', packages: [{ code: 'ai_booking_assistant', state: 'ready', reason: null }, { code: 'ai_phone_call_assistant', state: 'setup_required', reason: 'receptionist_not_set_up' }] } }),
      plan({ code: 'plan_checkin_queue', name: 'Check-In & Queue', readiness: { state: 'provider_down', provider: { state: 'not_connected', reason: 'no_provider_connected' }, checkedAt: '2026-11-12T15:00:00Z', packages: [{ code: 'ai_ocr_receipt_scanner', state: 'provider_down', reason: 'no_provider_connected' }] } }),
      plan({ code: 'plan_money_owner', readiness: { state: 'ready', provider: { state: 'connected', reason: null }, checkedAt: '2026-11-12T15:00:00Z', packages: [{ code: 'ai_ocr_receipt_scanner', state: 'ready', reason: null }] } }),
    ] });
    mount();
    expect(await screen.findByTestId('plan-access-plan_booking_calls')).toHaveTextContent('Access: Active');
    expect(screen.getByTestId('plan-ready-plan_booking_calls')).toHaveTextContent('Setup: Setup required');
    expect(screen.getByTestId('plan-ready-why-plan_booking_calls')).toHaveTextContent('AI Phone Call Assistant: set up and test the AI receptionist first');
    expect(screen.getByTestId('plan-ready-why-plan_booking_calls')).toHaveTextContent('Your plan stays active — this is about setup, not billing.');
    expect(screen.getByTestId('plan-ready-plan_checkin_queue')).toHaveTextContent('Setup: Provider down');
    expect(screen.getByTestId('plan-ready-why-plan_checkin_queue')).toHaveTextContent('no AI provider is connected');
    expect(screen.getByTestId('plan-ready-why-plan_checkin_queue')).not.toHaveTextContent('Your plan stays active');   // not subscribed
    expect(screen.getByTestId('plan-ready-plan_money_owner')).toHaveTextContent('Setup: Ready');
    expect(screen.queryByTestId('plan-ready-why-plan_money_owner')).toBeNull();
  });
});
