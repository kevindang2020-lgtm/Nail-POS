// POSAIMarketingScreen — AI Marketing Assistant guide (Nov 3 2026): the seven cards in a period, Reach & Consent (opted in vs reachable),
// budget vs money spent (the photographed "$100 with 0 sent"), recommendations with their eligibility and reasons, Campaign Center's
// campaign list, Check AI Marketing System. Nothing on the page sends.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
const { c, cc } = vi.hoisted(() => ({ c: { summary: vi.fn(), recommendations: vi.fn(), eligibility: vi.fn(), estimate: vi.fn(), saveDraft: vi.fn(), check: vi.fn() }, cc: { list: vi.fn() } }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { center: c, generateDraft: vi.fn() } }));
vi.mock('../api/posCampaignCenterApi', () => ({ posCampaignCenterApi: cc }));
import { POSAIMarketingScreen } from './POSAIMarketingScreen';

const SUMMARY = {
  period: { preset: 'month', from: '2026-11-01', to: '2026-11-03', today: '2026-11-03', timeZone: 'America/New_York' }, scope: 'salon',
  cards: { activeCampaigns: 0, scheduledCampaigns: 0, draftCampaigns: 2, awaitingApproval: 1, assistantDrafts: 1, messagesSent: 0, delivered: 0, failed: 0, skippedAtSend: 0, queued: 0, simulated: 0,
    bookings: 0, completedVisits: 0, associatedRevenueCents: 0, associatedTickets: 0, actualCostCents: 0, costComplete: true, costedMessages: 0, costPerBookingCents: null },
  reach: { customers: 40, sms: { optedIn: 10, reachable: 8, noContact: 1, optedOut: 1 }, email: { optedIn: 1, reachable: 1, noContact: 0, optedOut: 0 }, reachableBoth: 1, reachableEither: 8, suppressed: { sms: 1, email: 0, total: 1, scope: 'salon' } },
  cost: { budgetsCents: 10000, campaignsWithBudget: 1, spentAllTimeCents: 0, sentAllTime: 0, costedAllTime: 0, explanation: 'budget_not_spent' },
  definitions: {}, generatedAt: '2026-11-03T15:00:00Z',
};
const RECS = { channel: 'sms', items: [
  { kind: 'rebooking', status: 'no_eligible', channel: 'sms', criteria: 'Visited before; 45–59 salon days since the last completed visit.', matched: 3, eligible: 0, excluded: { opted_out: 2, no_consent: 1 }, excludedTotal: 3, topExclusion: { reason: 'opted_out', count: 2 }, neverVisited: 4, canSaveDraft: false },
  { kind: 'winback', status: 'ready', channel: 'sms', criteria: 'At least one completed visit and none in the last 60+ salon days.', matched: 5, eligible: 4, excluded: { no_phone: 1 }, excludedTotal: 1, topExclusion: null, neverVisited: 4, estimatedCostCents: 1400, canSaveDraft: true },
  { kind: 'birthday', status: 'no_match', channel: 'sms', criteria: 'A recorded birthday in 2026-11 (salon month).', matched: 0, eligible: 0, excluded: {}, excludedTotal: 0, canSaveDraft: false, openTo: '/tenant/marketing/birthdays' },
], sendsAnything: false };
const LIST = { items: [{ id: 'c-1', name: 'Spring', status: 'completed', displayStatus: 'completed', outcome: 'completed_no_send_record', origin: 'manual', channel: 'sms', budgetCents: 10000, createdAt: '2026-10-01T10:00:00Z',
  counts: { selected: 50, selectedIsEstimate: true, eligible: null, submitted: 0, delivered: 0, booked: 0, actualCostCents: null } }], pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 }, period: { today: '2026-11-03' } };
const wrap = () => render(<MemoryRouter><POSAIMarketingScreen /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); c.summary.mockResolvedValue(SUMMARY); c.recommendations.mockResolvedValue(RECS); cc.list.mockResolvedValue(LIST); });

describe('POSAIMarketingScreen', () => {
  it('keeps the seven cards; cost per booking is N/A with no bookings; the period goes to the server', async () => {
    wrap();
    expect(await screen.findByTestId('amk-kpi-drafts')).toHaveTextContent('2');
    expect(screen.getByTestId('amk-kpi-drafts')).toHaveTextContent('1 awaiting approval');
    expect(screen.getByTestId('amk-kpi-costPerBooking')).toHaveTextContent('N/A');
    expect(c.summary).toHaveBeenLastCalledWith({ preset: 'month' });
    fireEvent.click(screen.getByTestId('amk-preset-last_30'));
    expect(c.summary).toHaveBeenLastCalledWith({ preset: 'last_30' });
  });
  it('the photographed "$100 with 0 sent": spending is $0.00, the $100.00 is shown as a budget and explained', async () => {
    wrap();
    expect(await screen.findByTestId('amk-spent')).toHaveTextContent('$0.00');
    expect(screen.getByTestId('amk-budgets')).toHaveTextContent('$100.00');
    expect(screen.getByTestId('amk-cost-expl')).toHaveTextContent('a budget is a limit, not a cost');
  });
  it('reach: opted in vs reachable, and the union', async () => {
    wrap();
    expect(await screen.findByTestId('amk-sms-in')).toHaveTextContent('10');
    expect(screen.getByTestId('amk-sms-ok')).toHaveTextContent('8');
    expect(screen.getByTestId('amk-either')).toHaveTextContent('8');
  });
  it('recommendations: status, counts, why nobody is eligible, and only a ready one offers a draft', async () => {
    wrap();
    const rb = await screen.findByTestId('amk-rec-rebooking');
    expect(within(rb).getByTestId('amk-rec-status')).toHaveTextContent('Nobody eligible');
    expect(within(rb).getByTestId('amk-rec-why')).toHaveTextContent('Opted out (STOP / unsubscribe) (2)');
    expect(within(rb).queryByText('Build a campaign')).toBeNull();
    const wb = screen.getByTestId('amk-rec-winback');
    expect(wb).toHaveTextContent('5 match · 4 eligible · 1 excluded');
    expect(within(wb).getByTestId('amk-build-winback').getAttribute('href')).toBe('/tenant/ai/marketing/builder?kind=winback&channel=sms');
    expect(screen.getByTestId('amk-rec-birthday')).toHaveTextContent('Open Birthday Campaigns');
    fireEvent.click(screen.getByTestId('amk-rch-email'));
    expect(c.recommendations).toHaveBeenLastCalledWith('email');
  });
  it('View eligibility opens the funnel for both channels', async () => {
    c.eligibility.mockResolvedValue({ kind: 'winback', channels: [{ channel: 'sms', matched: 5, eligible: 4, excluded: { no_phone: 1 }, criteria: 'x' }, { channel: 'email', matched: 5, eligible: 1, excluded: { no_consent: 4 }, criteria: 'x' }], uniqueEligible: 4 });
    wrap();
    fireEvent.click(await screen.findByTestId('amk-view-winback'));
    expect(c.eligibility).toHaveBeenCalledWith('winback', 'both');
    expect(await screen.findByTestId('amk-unique')).toHaveTextContent('4 unique people');
    expect(screen.getByTestId('amk-funnel-sms')).toHaveTextContent('No phone number');
  });
  it('the campaign list is Campaign Center\'s: search and status go to the server; a typed estimate is labelled; rows open in Campaign Center', async () => {
    wrap();
    const row = await screen.findByTestId('amk-lib-row');
    expect(row).toHaveTextContent('50 (typed estimate)');
    expect(row).toHaveTextContent('Marked completed — nothing was ever sent');
    expect(within(row).getByText('Spring').closest('a')).toHaveAttribute('href', '/tenant/marketing/campaigns?q=c-1');
    fireEvent.change(screen.getByTestId('amk-lib-search'), { target: { value: 'Spr' } });
    fireEvent.submit(screen.getByTestId('amk-lib-search').closest('form')!);
    fireEvent.change(screen.getByTestId('amk-lib-status'), { target: { value: 'completed' } });
    expect(cc.list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Spr', status: 'completed', page: 1, sort: 'newest' }));
  });
  it('Check AI Marketing System is read-only and shows failures first', async () => {
    c.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-03T15:00:00Z', reused: false, checks: [
      { key: 'send_worker', component: 'workers', state: 'WARNING', lastPassedAt: null }, { key: 'no_side_effects', component: 'security', state: 'PASSED', lastPassedAt: '2026-11-03T15:00:00Z' }] });
    wrap();
    fireEvent.click(screen.getByTestId('amk-check'));
    expect(await screen.findByTestId('amk-chk-send_worker')).toHaveTextContent('Background sending is off on this server');
    expect(screen.getByTestId('amk-health')).toHaveTextContent('Read-only');
  });
  it('Marketing Growth 07: the Dates and time zones check says what is wrong with zones and clock-change sends', async () => {
    c.check.mockResolvedValue({ overall: 'FAILED', checkedAt: '2026-11-03T15:00:00Z', reused: false, checks: [
      { key: 'date_timezone', component: 'campaigns', state: 'FAILED', count: 2, lastPassedAt: null, detail: { branches: 3, invalidZones: 1, zones: ['America/New_York', 'UTC'], scheduledOnClockChange: 1, scheduledChecked: 2 } }] });
    wrap();
    fireEvent.click(screen.getByTestId('amk-check'));
    const row = await screen.findByTestId('amk-chk-date_timezone');
    expect(row).toHaveTextContent('Dates and time zones');
    expect(row).toHaveTextContent('missing or unknown time zone');
    expect(screen.getByTestId('amk-chk-tz-detail')).toHaveTextContent('Zones: America/New_York, UTC · unknown zones: 1 · sends near a clock change: 1 of 2 scheduled');
  });
  it('Marketing Growth 12: anomaly checks name the spike, failures, duplicate claims and points drift with their evidence', async () => {
    c.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-03T15:00:00Z', reused: false, checks: [
      { key: 'anomaly_cost_spike', component: 'anomalies', state: 'WARNING', count: 1, lastPassedAt: null, detail: { last24hCents: 240, priorDailyAverageCents: 0 } },
      { key: 'anomaly_send_failures', component: 'anomalies', state: 'WARNING', count: 4, lastPassedAt: null, detail: { attempts24h: 12, failed24h: 4 } },
      { key: 'anomaly_duplicate_claims', component: 'anomalies', state: 'WARNING', count: 2, lastPassedAt: null, detail: { codesOverLimit: 1, customersOverDealLimit: 1 } },
      { key: 'anomaly_balance_drift', component: 'anomalies', state: 'WARNING', count: 1, lastPassedAt: null, detail: { profiles: 1, pointsOff: 20 } }] });
    wrap();
    fireEvent.click(screen.getByTestId('amk-check'));
    expect(await screen.findByTestId('amk-chk-anomaly_cost_spike')).toHaveTextContent('Message cost spike');
    expect(screen.getByTestId('amk-chk-anomaly_cost_spike-detail')).toHaveTextContent('Last 24 hours: $2.40 · daily average before: $0.00');
    expect(screen.getByTestId('amk-chk-anomaly_send_failures-detail')).toHaveTextContent('4 of 12 failed in the last 24 hours');
    expect(screen.getByTestId('amk-chk-anomaly_duplicate_claims-detail')).toHaveTextContent('Codes over their limit: 1 · customers over an offer limit: 1');
    expect(screen.getByTestId('amk-chk-anomaly_balance_drift')).toHaveTextContent('nothing was changed here');
    expect(screen.getByTestId('amk-chk-anomaly_balance_drift-detail')).toHaveTextContent('1 customer(s) · 20 points off');
  });
  it('AI Marketing 10 — source verification: campaign cards filter Campaign Center\'s list to their own set; message / revenue cards open Campaign Results for the same period', async () => {
    const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; };
    render(<MemoryRouter initialEntries={['/tenant/ai/marketing']}><Routes>
      <Route path="/tenant/ai/marketing" element={<POSAIMarketingScreen />} />
      <Route path="/tenant/ai/marketing/results" element={<Where />} />
    </Routes></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('amk-kpi-drafts'));
    await vi.waitFor(() => expect(cc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'all_drafts', preset: 'all' })));
    expect((screen.getByTestId('amk-lib-status') as HTMLSelectElement).value).toBe('all_drafts');
    fireEvent.click(screen.getByTestId('amk-kpi-active'));
    await vi.waitFor(() => expect(cc.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'sending' })));
    fireEvent.click(screen.getByTestId('amk-preset-last_30'));
    fireEvent.click(screen.getByTestId('amk-kpi-revenue'));
    expect(await screen.findByTestId('where')).toHaveTextContent('/tenant/ai/marketing/results?preset=last_30');
  });
  it('a failed summary is an error with retry, never zeros', async () => {
    c.summary.mockRejectedValue({ status: 500 });
    wrap();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('amk-kpi-sent')).toHaveTextContent('—');
  });
  it('Marketing Growth 09: reward liabilities are four separate lines from the server, never one total; hidden without the server saying visible', async () => {
    const LIAB = { visible: true, scope: 'salon',
      points: { members: 2, outstandingPoints: 160, ledgerPoints: 150, driftPoints: 10, earnedInPeriod: 180, usedInPeriod: 30, valueCents: null },
      tokens: { wallet: true, availableCents: 4250, deficitCents: 0, fundedAllTimeCents: 5000, allocatedAllTimeCents: 750, fundedInPeriodCents: 5000, allocatedInPeriodCents: 750 },
      referrals: { cashPaidInPeriodCents: 2000, cashPaidInPeriod: 1, pointsIssuedInPeriod: 500, vouchersRedeemedInPeriodCents: 1000, vouchersRedeemedInPeriod: 1, vouchersOpenCents: 1500, vouchersOpen: 1, vouchersPendingCents: 500, vouchersPending: 1 },
      giftCards: { outstandingCents: 9200, cards: 3 } };
    c.summary.mockResolvedValue({ ...SUMMARY, rewardLiability: LIAB });
    const { unmount } = wrap();
    const box = await screen.findByTestId('amk-liab');
    expect(within(box).getByTestId('amk-liab-points')).toHaveTextContent('160');
    expect(within(box).getByTestId('amk-liab-tokens')).toHaveTextContent('$42.50');
    expect(within(box).getByTestId('amk-liab-ref-paid')).toHaveTextContent('$20.00');
    expect(within(box).getByTestId('amk-liab-ref-redeemed')).toHaveTextContent('$10.00');
    expect(within(box).getByTestId('amk-liab-ref-open')).toHaveTextContent('$15.00');
    expect(within(box).getByTestId('amk-liab-gift')).toHaveTextContent('$92.00');
    expect(within(box).getByTestId('amk-liab-drift')).toHaveTextContent('10');
    // no grand total: $42.50 + $15.00 + $92.00 = $149.50 must not appear anywhere
    expect(box).not.toHaveTextContent('$149.50');
    unmount();
    c.summary.mockResolvedValue({ ...SUMMARY, rewardLiability: { visible: false } });
    wrap();
    await screen.findByTestId('amk-updated');
    expect(screen.queryByTestId('amk-liab')).toBeNull();
  });
  it('AI Marketing 12: the branch comparison shows the server\'s per-branch aggregates (unreported cost says so); hidden when not visible', async () => {
    c.summary.mockResolvedValue({ ...SUMMARY, branchComparison: { visible: true,
      branches: [{ branchId: 'b1', name: 'Avenue', campaigns: 1, active: 1, scheduled: 0, messagesSent: 2, delivered: 1, failed: 1, bookings: 0, associatedRevenueCents: 0, associatedTickets: 0, actualCostCents: 2 },
        { branchId: 'b2', name: 'Bridge', campaigns: 1, active: 0, scheduled: 1, messagesSent: 1, delivered: 1, failed: 0, bookings: 1, associatedRevenueCents: 4500, associatedTickets: 1, actualCostCents: null }],
      salonWide: { branchId: null, name: null, campaigns: 1, active: 0, scheduled: 0, messagesSent: 0, delivered: 0, failed: 0, bookings: 0, associatedRevenueCents: 0, associatedTickets: 0, actualCostCents: 0 } } });
    const { unmount } = wrap();
    const box = await screen.findByTestId('amk-bcmp');
    expect(within(box).getByTestId('amk-bcmp-b1')).toHaveTextContent(/Avenue\s*1\s*2\s*1\s*0\s*\$0\.00\s*\$0\.02/);
    expect(within(box).getByTestId('amk-bcmp-b2')).toHaveTextContent('$45.00');
    expect(within(box).getByTestId('amk-bcmp-b2')).toHaveTextContent(/Not reported/i);
    expect(within(box).getByTestId('amk-bcmp-salon')).toHaveTextContent('Salon-wide campaigns');
    unmount();
    c.summary.mockResolvedValue({ ...SUMMARY, branchComparison: { visible: false } });
    wrap();
    await screen.findByTestId('amk-updated');
    expect(screen.queryByTestId('amk-bcmp')).toBeNull();
  });
});
