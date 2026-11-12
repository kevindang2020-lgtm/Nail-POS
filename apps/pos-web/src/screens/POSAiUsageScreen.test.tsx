// POSAiUsageScreen — AI Usage & Limits Complete Build Guide (Oct 30 2026): the four KPIs (cost restricted without the
// billing role), server states on the cards (a lapsed trial says Trial expired and offers no Cancel), one click on a card
// opens Package Details while the card's button keeps its own action, start trial needs a confirmation and sends an
// idempotency key, the 80/90/100 % alert strip, and the numbered pager asks the server for the next page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
const { api } = vi.hoisted(() => ({ api: { summary: vi.fn(), packages: vi.fn(), detail: vi.fn(), history: vi.fn(), exportHistory: vi.fn(), startTrial: vi.fn(), cancel: vi.fn(), acknowledge: vi.fn(), check: vi.fn() } }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: api, posAiUsageApi: {} }));
import { MemoryRouter } from 'react-router-dom';
import { POSAiUsageScreen as Screen } from './POSAiUsageScreen';
// the screen navigates (Open Module / Billing), so it needs a router — this test rendered without one and failed on the untouched tree
const POSAiUsageScreen = () => <MemoryRouter><Screen /></MemoryRouter>;

const card = (o: Record<string, unknown>) => ({ code: 'ai_marketing_assistant', name: 'AI Marketing Assistant', description: 'Creates campaigns.', category: 'growth', posArea: 'Marketing', known: true, state: 'active', storedStatus: 'active',
  globallyEnabled: true, disabledReason: null, price: { cents: 5900, currency: 'USD', period: 'monthly', monthlyEquivalentCents: 5900, source: 'subscription' },
  usage: { used: 400, limit: 500, unit: 'generations', percent: 80, level: 'warn_80', periodStart: '2026-10-20T00:00:00Z', periodEnd: '2026-11-20T00:00:00Z', remaining: 100 },
  overage: { enabled: false, unitPriceCents: 8, estimatedCents: 0 }, trial: { days: 14, startsAt: null, endsAt: null, daysLeft: null, eligible: false },
  lastPaymentStatus: 'paid', subscribedAt: '2026-10-01T00:00:00Z', cancelledAt: null, actions: ['view_details', 'cancel', 'open_module'], primaryAction: 'open_module', openAlert: 80, ...o });
const ITEMS = [card({}), card({ code: 'ai_business_assistant', name: 'AI Business Assistant', state: 'trial_expired', storedStatus: 'trialing', actions: ['view_details', 'upgrade'], primaryAction: 'upgrade',
  usage: { used: null, limit: 1000, unit: 'messages', percent: null, level: 'not_metered', periodStart: null, periodEnd: null, remaining: null } }),
  card({ code: 'ai_review_reputation_assistant', name: 'AI Review Assistant', state: 'trial_available', storedStatus: null, actions: ['view_details', 'start_trial'], primaryAction: 'start_trial',
    trial: { days: 14, startsAt: null, endsAt: null, daysLeft: null, eligible: true }, usage: { used: null, limit: 1000, unit: 'generations', percent: null, level: 'not_metered', periodStart: null, periodEnd: null, remaining: null } })];
const SUM = { asOf: '2026-10-30T15:00:00Z', kpis: { totalPackages: 15, activeSubscriptions: 4, pastDue: 1, trialsAndPending: 3, trialing: 1, trialExpired: 1, disabled: 1 },
  cost: { visible: true, currency: 'USD', recurringMonthlyCents: 22600, estimatedOverageCents: 0, basis: 'subscription_records', lines: [], trials: [], overageLines: [], lastBillingEventAt: null, billingEvents: 0 },
  alerts: [{ id: 'a1', code: 'ai_marketing_assistant', name: 'AI Marketing Assistant', threshold: 80, used: 400, limit: 500, unit: 'generations', periodStart: null, at: null }], canManage: true, canSeeBilling: true };
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.summary.mockResolvedValue(SUM);
  api.packages.mockImplementation(async (q: any) => ({ items: q.page === 2 ? [] : ITEMS, page: q.page ?? 1, pageSize: 8, totalItems: 16, totalPages: 2, counts: { all: 16, active: 4 }, sort: 'catalog', status: 'all' }));
  api.detail.mockImplementation(async (code: string) => ({ package: ITEMS.find((c) => c.code === code), usage: { daily: [], timeZone: 'America/New_York' }, billing: { visible: true, events: [] }, history: [], alerts: [],
    settings: { globallyEnabled: true, disabledReason: null, storedStatus: null, usageLimit: 1000, overageEnabled: false, limitSource: 'catalog' }, canManage: true, canSeeBilling: true }));
  api.startTrial.mockResolvedValue({ ok: true, duplicate: false, status: 'trialing' });
});

describe('POSAiUsageScreen', () => {
  it('shows the four KPIs, the alert strip and server states on the cards', async () => {
    render(<POSAiUsageScreen />);
    expect(await screen.findByTestId('aiu-kpi-cost')).toHaveTextContent('$226.00');
    expect(screen.getByTestId('aiu-kpi-total')).toHaveTextContent('15');
    expect(await screen.findByTestId('aiu-alerts')).toHaveTextContent('80%');
    const cards = await screen.findAllByTestId('aiu-card');
    expect(within(cards[1]!).getByTestId('aiu-state')).toHaveTextContent('Trial expired');
    expect(within(cards[1]!).queryByText('Cancel Package')).toBeNull();
    expect(within(cards[0]!).getByTestId('aiu-usage')).toHaveTextContent('400 / 500 generations');
  });

  it('a card click opens Details; Start Trial needs a confirmation and sends a request key', async () => {
    render(<POSAiUsageScreen />);
    const cards = await screen.findAllByTestId('aiu-card');
    fireEvent.click(cards[2]!);
    const d = await screen.findByTestId('aiu-detail');
    fireEvent.click(within(d).getByTestId('aiu-trial'));
    expect(await within(d).findByTestId('aiu-confirm-box')).toHaveTextContent(/Nothing is charged now/);
    fireEvent.click(within(d).getByTestId('aiu-confirm'));
    await waitFor(() => expect(api.startTrial).toHaveBeenCalledWith('ai_review_reputation_assistant', expect.objectContaining({ confirm: true, idempotencyKey: expect.any(String) })));
  });

  it('Extras · AI Usage Limits 07: Details shows the server\'s price comparison (kept below today\'s list); Start Trial shows today\'s list price before confirming', async () => {
    const kept = card({ price: { cents: 5900, currency: 'USD', period: 'monthly', monthlyEquivalentCents: 5900, source: 'subscription', comparison: { listMonthlyCents: 6900, storedMonthlyCents: 5900, status: 'kept_below_list', deltaMonthlyCents: -1000 } } });
    const fresh = { ...ITEMS[2]!, price: { cents: 3900, currency: 'USD', period: 'monthly', monthlyEquivalentCents: 3900, source: 'catalog_list', comparison: { listMonthlyCents: 3900, storedMonthlyCents: null, status: 'list', deltaMonthlyCents: null } } };
    api.packages.mockResolvedValue({ items: [kept, fresh], page: 1, pageSize: 8, totalItems: 2, totalPages: 1, counts: { all: 2 }, sort: 'catalog', status: 'all' });
    api.detail.mockImplementation(async (code: string) => ({ package: code === kept.code ? kept : fresh, usage: { daily: [], timeZone: 'America/New_York' }, billing: { visible: true, events: [] }, history: [], alerts: [],
      settings: { globallyEnabled: true, disabledReason: null, storedStatus: null, usageLimit: 1000, overageEnabled: false, limitSource: 'catalog' }, canManage: true, canSeeBilling: true }));
    const r = render(<POSAiUsageScreen />);
    fireEvent.click((await screen.findAllByTestId('aiu-card'))[0]!);
    expect(await screen.findByTestId('aiu-price-compare')).toHaveTextContent('Your price $59.00/mo is kept — $10.00 below today\'s list price of $69.00/mo.');
    r.unmount();
    render(<POSAiUsageScreen />);
    fireEvent.click((await screen.findAllByTestId('aiu-card'))[1]!);
    const d = await screen.findByTestId('aiu-detail');
    fireEvent.click(within(d).getByTestId('aiu-trial'));
    expect(await within(d).findByTestId('aiu-confirm-price')).toHaveTextContent('Today\'s catalog list price: $39.00/mo.');
  });

  it('Extras · AI Usage Limits 02: Subscription tab explains why — the server gate reason and the facts behind it, in words', async () => {
    api.detail.mockImplementation(async (code: string) => ({ package: ITEMS.find((c) => c.code === code), usage: { daily: [], timeZone: 'America/New_York' }, billing: { visible: true, events: [] }, history: [], alerts: [],
      settings: { globallyEnabled: true, disabledReason: null, storedStatus: 'trialing', usageLimit: 1000, overageEnabled: false, limitSource: 'subscription' }, canManage: true, canSeeBilling: true,
      why: { entitled: false, gate: { allowed: false, reason: 'trial_expired' }, forYou: { allowed: false, reason: 'trial_expired' }, state: 'trial_expired',
        platform: { enabled: true, disabledReason: null }, subscription: { status: 'trialing', provider: null, lastPaymentStatus: null, period: 'monthly', priceSource: 'subscription' },
        trial: { startsAt: '2026-10-14T15:00:00Z', endsAt: '2026-10-28T15:00:00Z', daysLeft: null },
        plans: [{ code: 'plan_ops', name: 'Operations', status: null, trialEndsAt: null, cancelledAt: null }], lastVerified: null } }));
    render(<POSAiUsageScreen />);
    fireEvent.click((await screen.findAllByTestId('aiu-card'))[1]!);
    const d = await screen.findByTestId('aiu-detail');
    fireEvent.click(within(d).getByTestId('aiu-tab-subscription'));
    const w = await within(d).findByTestId('aiu-why');
    expect(w).toHaveTextContent('Why it is blocked');
    expect(within(w).getByTestId('aiu-why-gate')).toHaveTextContent('The AI access check says: the free trial has ended');
    expect(within(w).queryByTestId('aiu-why-you')).toBeNull();           // same answer for the user: not repeated
    expect(within(w).getByTestId('aiu-why-sub')).toHaveTextContent('On trial · ');
    expect(within(w).getByTestId('aiu-why-trial')).toHaveTextContent(/^Ended Oct 28, 2026$/);
    expect(within(w).getByTestId('aiu-why-plans')).toHaveTextContent('Operations · not subscribed');
    expect(within(w).getByTestId('aiu-why-verified')).toHaveTextContent('No billing event recorded yet');
    expect(w.textContent).not.toMatch(/trial_expired|trialing/);           // codes never raw
    expect(api.startTrial).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('Extras · AI Usage Limits 03: the Usage tab shows the server\'s pace estimate in words — labelled an estimate, nothing bought', async () => {
    const withProj = (proj: unknown, overage = false) => card({ usage: { used: 400, limit: 500, unit: 'generations', percent: 80, level: 'warn_80', periodStart: '2026-10-20T00:00:00Z', periodEnd: '2026-11-20T00:00:00Z', remaining: 100, projection: proj },
      overage: { enabled: overage, unitPriceCents: 8, estimatedCents: 0 } });
    const show = async (c: unknown) => {
      api.detail.mockImplementation(async () => ({ package: c, usage: { daily: [], timeZone: 'America/New_York' }, billing: { visible: true, events: [] }, history: [], alerts: [],
        settings: { globallyEnabled: true, disabledReason: null, storedStatus: 'active', usageLimit: 500, overageEnabled: false, limitSource: 'subscription' }, canManage: true, canSeeBilling: true }));
      render(<POSAiUsageScreen />);
      fireEvent.click((await screen.findAllByTestId('aiu-card'))[0]!);
      const d = await screen.findByTestId('aiu-detail');
      fireEvent.click(within(d).getByTestId('aiu-tab-usage'));
      return within(d).findByTestId('aiu-projection');
    };
    const p1 = await show(withProj({ basis: 'period_pace', elapsedShare: 0.5, projectedUsed: 800, verdict: 'likely_over', projectedOverageCents: null, atLimit: 'blocked' }));
    expect(p1).toHaveTextContent('Estimate: at this period\'s pace you would use about 800 generations of 500 generations (50% of the period gone) — more than the plan includes. Overage is off: AI calls stop at the limit until the next period.');
    expect(p1).toHaveTextContent('nothing is bought or changed');
    cleanup();
    const p2 = await show(withProj({ basis: 'period_pace', elapsedShare: 0.5, projectedUsed: 800, verdict: 'likely_over', projectedOverageCents: 2400, atLimit: 'overage' }, true));
    expect(p2).toHaveTextContent('Overage is on: about $24.00 extra at the overage price.');
    cleanup();
    const p3 = await show(withProj({ basis: 'period_pace', elapsedShare: 0.1, projectedUsed: null, verdict: 'too_early', projectedOverageCents: null, atLimit: 'blocked' }));
    expect(p3).toHaveTextContent('only 10% of this period has passed — too early to estimate');
    expect(api.startTrial).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('the cost KPI is restricted without the billing role, and the pager asks for page 2', async () => {
    api.summary.mockResolvedValue({ ...SUM, cost: { visible: false }, canSeeBilling: false });
    render(<POSAiUsageScreen />);
    expect(await screen.findByTestId('aiu-kpi-cost')).toHaveTextContent('Restricted');
    fireEvent.click(await screen.findByRole('button', { name: 'Page 2' }));
    await waitFor(() => expect(api.packages).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  });
  it('Check AI Usage & Subscriptions shows read-only evidence for the screenshot contradictions (AI Usage Limits guide, Nov 1 2026)', async () => {
    api.check.mockResolvedValue({ overall: 'FAILED', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [{ key: 'no_use_after_trial', state: 'FAILED', count: 3 }, { key: 'trial_rows_current', state: 'WARNING', count: 1 }] });
    render(<POSAiUsageScreen />);
    fireEvent.click(await screen.findByTestId('aiu-check'));
    expect(await screen.findByTestId('chk-no_use_after_trial')).toHaveTextContent(/succeeded after the trial ended/);
    expect(screen.getByTestId('chk-trial_rows_current')).toHaveTextContent(/still stored as "trialing"/);
    expect(api.check).toHaveBeenCalledTimes(1);
  });
  it('Extras · AI Usage Limits 06: the check words a usage spike, a request counted twice and a quiet meter — and says nothing was changed', async () => {
    api.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [
      { key: 'usage_spike', state: 'WARNING', count: 1, detail: { packages: ['ai_business_assistant'] } }, { key: 'duplicate_usage_events', state: 'WARNING', count: 2 }, { key: 'metering_stale', state: 'INSUFFICIENT_DATA', count: 0 }] });
    render(<POSAiUsageScreen />);
    fireEvent.click(await screen.findByTestId('aiu-check'));
    expect(await screen.findByTestId('chk-usage_spike')).toHaveTextContent(/Sudden usage spike.*3× its usual daily amount.*limits and records are unchanged/);
    expect(screen.getByTestId('chk-duplicate_usage_events')).toHaveTextContent(/One request counted twice · 2.*nothing was removed or refunded/);
    expect(screen.getByTestId('chk-metering_stale')).toHaveTextContent(/Not enough data.*No live package/);
    expect(api.startTrial).not.toHaveBeenCalled(); expect(api.cancel).not.toHaveBeenCalled();
  });
  it('Extras · AI Usage Limits 04: the check names an assistant paid on its own and inside a paid plan, for review — nothing is cancelled', async () => {
    api.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', reused: false, checks: [
      { key: 'bundle_overlap', state: 'WARNING', count: 1, detail: { overlaps: [{ code: 'ai_fraud_money_protection', name: 'AI Fraud & Money Protection', plans: ['Money & Owner'], paidOnItsOwnSince: '2026-10-01T15:00:00Z' }] } }] });
    render(<POSAiUsageScreen />);
    fireEvent.click(await screen.findByTestId('aiu-check'));
    const c = await screen.findByTestId('chk-bundle_overlap');
    expect(c).toHaveTextContent(/Paid twice for the same assistant · 1.*nothing was cancelled or refunded/);
    expect(within(c).getByTestId('chk-bundle-overlaps')).toHaveTextContent('AI Fraud & Money ProtectionIn plan: Money & Owner · paid on its own since Oct 1, 2026');
    expect(api.cancel).not.toHaveBeenCalled();
  });
  it('AI Plans tabs (SUNMI §07): ?view=subscriptions lists active subscriptions; ?view=billing opens cost & invoices — only for a role that may see cost', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/tenant/ai/usage?view=subscriptions']}><Screen /></MemoryRouter>);
    await waitFor(() => expect(api.packages).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' })));
    unmount();
    render(<MemoryRouter initialEntries={['/tenant/ai/usage?view=billing']}><Screen /></MemoryRouter>);
    expect(await screen.findByTestId('aiu-cost')).toBeInTheDocument();
    cleanup();
    api.summary.mockResolvedValue({ ...SUM, cost: { visible: false }, canSeeBilling: false });
    render(<MemoryRouter initialEntries={['/tenant/ai/usage?view=billing']}><Screen /></MemoryRouter>);
    await screen.findByTestId('aiu-kpis'); expect(screen.queryByTestId('aiu-cost')).toBeNull();
  });
});

