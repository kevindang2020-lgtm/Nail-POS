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

