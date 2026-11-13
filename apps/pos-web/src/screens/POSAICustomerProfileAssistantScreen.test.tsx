// POSAICustomerProfileAssistantScreen — AI Customer Profile Assistant guide (Nov 3 2026): honest add-on header; the cards come from the
// latest Customer Intelligence scan ("Not scanned yet", never zeros); the list is a server query with masked contact; the check renders
// Customer Intelligence's localized checks (incl. the eligibility reconciliation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
const { ci, pkg } = vi.hoisted(() => ({ ci: { summary: vi.fn(), customers: vi.fn(), check: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posCustomerIntelligenceApi', () => ({ posCustomerIntelligenceApi: ci }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
const cust = vi.hoisted(() => ({ getDetail: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: cust }));
import { POSAICustomerProfileAssistantScreen } from './POSAICustomerProfileAssistantScreen';

const CARD = { package: { code: 'ai_customer_profile_assistant', name: 'AI Customer Profile Assistant', description: 'Customer insights.', category: 'Growth', posArea: 'Customers', state: 'trialing', storedStatus: 'trialing',
  disabledReason: null, price: { cents: 3900, period: 'monthly', source: 'catalog_list' }, usage: { used: 0, limit: 1000, unit: 'insights', percent: 0, level: 'ok', periodStart: null, periodEnd: '2026-11-20T00:00:00Z', remaining: 1000 },
  trial: { days: 14, endsAt: '2026-11-20T00:00:00Z', daysLeft: 17, eligible: false }, actions: ['cancel'] } };
const ROW = { id: 'c1', name: 'Linh Pham', phone: '(•••) •••-0142', scanned: true, status: 'due_for_return', neverServed: false, completedVisits: 7, lastVisitAt: '2026-09-01T15:00:00Z', daysSinceLast: 63,
  nextAppointmentDate: null, churnWatch: true, rebooking: false, duplicate: false };
const page = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
const wrap = () => render(<MemoryRouter><POSAICustomerProfileAssistantScreen /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); pkg.detail.mockResolvedValue(CARD); ci.customers.mockResolvedValue(page([ROW])); });

describe('AI Customer Profile Assistant', () => {
  it('CP-01 never scanned → "Not scanned yet", not zeros; a row with masked phone, status, visits and churn flag', async () => {
    ci.summary.mockResolvedValue({ cards: null });
    wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-active')).toHaveTextContent('Not scanned yet'));
    const row = await screen.findByTestId('as-row');
    expect(row).toHaveTextContent('Linh Pham'); expect(row).toHaveTextContent('-0142'); expect(row).toHaveTextContent('63 days ago'); expect(row.textContent).not.toContain('cix.');
  });
  it('CP-02 scanned cards; status / flag / which date / presets reach the query', async () => {
    ci.summary.mockResolvedValue({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 } });
    wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-rebooking')).toHaveTextContent('5'));
    fireEvent.change(screen.getByTestId('as-f-status'), { target: { value: 'inactive_all' } });
    fireEvent.change(screen.getByTestId('as-f-flag'), { target: { value: 'rebooking' } });
    fireEvent.change(screen.getByTestId('as-f-dateField'), { target: { value: 'created' } });
    fireEvent.click(screen.getByTestId('as-preset-last_90'));
    await waitFor(() => expect(ci.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive_all', flag: 'rebooking', dateField: 'created', preset: 'last_90', page: 1 })));
  });
  it('CP-03 the check renders the eligibility reconciliation, not a raw key', async () => {
    ci.summary.mockResolvedValue({ cards: null });
    ci.check.mockResolvedValue({ overall: 'PASSED', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'eligibility', state: 'PASSED', detail: { scanned: 40, active: 22, inactiveCard: 11, neverServed: 2, underCadence: 3, rebookingSoon: 1, dueForReturn: 1 } }] });
    wrap();
    fireEvent.click(await screen.findByTestId('as-check'));
    const k = await screen.findByTestId('as-chk-eligibility');
    expect(k.textContent).not.toContain('cix.');
    expect(k).toHaveTextContent('40');
  });
  it('extras #04 Customer Snapshot: a row opens the real Customer 360 Quick View (same detail read), read-only with Booking / History / Notes links', async () => {
    ci.summary.mockResolvedValue({ cards: null });
    cust.getDetail.mockResolvedValue({ displayName: 'Linh Pham', status: 'active', phone: '(•••) •••-0142', visitCount: 7, totalSpendCents: 42000, averageSpendCents: 6000,
      loyalty: { points: 120, earned: 150, redeemed: 30, tier: 'Silver' }, giftCards: [], recentVisits: [], notes: { allergyNotes: 'Latex' } });
    wrap();
    fireEvent.click(await screen.findByTestId('cpx-snapshot-open'));
    await waitFor(() => expect(cust.getDetail).toHaveBeenCalledWith('c1'));
    const q = await screen.findByTestId('cpx-quick');
    expect(await screen.findByText('$420.00')).toBeInTheDocument();
    expect(screen.getByTestId('cpx-book')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-visits')); expect(screen.getByTestId('cpx-history')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-notes')); expect(screen.getByTestId('cpx-edit-notes')).toBeInTheDocument();
    expect(q.textContent).not.toMatch(/cpf\.|cpx\.snapshot/);
    fireEvent.click(screen.getByTestId('cpx-full'));
    await waitFor(() => expect(screen.queryByTestId('cpx-quick')).toBeNull());
  });
  it('CPA-12 churn belongs to Customer Retention: the card and each row show Retention\'s classification and link to it; no churn rule, flag or filter of its own', async () => {
    ci.summary.mockResolvedValue({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 }, retention: { atRisk: 12, approaching: 4, active: 20, never: 2, atRiskDays: 90, source: 'customer_retention' } });
    ci.customers.mockResolvedValue(page([{ ...ROW, churnWatch: true, retention: { segment: 'approaching', daysAway: 63 } }]));
    render(<MemoryRouter initialEntries={['/tenant/ai/customer-insights']}><Routes><Route path="/tenant/ai/customer-insights" element={<POSAICustomerProfileAssistantScreen />} /><Route path="/tenant/customers/retention" element={<div data-testid="retention-page" />} /></Routes></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('as-kpi-churn')).toHaveTextContent('12'));   // Retention's at-risk count, never the assistant's own (3)
    expect(screen.getByTestId('as-kpi-churn')).toHaveTextContent('At risk (Customer Retention)');
    const row = await screen.findByTestId('as-row');
    expect(screen.getByTestId('cpx-retention')).toHaveTextContent('Approaching');
    expect(row.textContent).not.toMatch(/Churn watch/);                                        // the assistant's own churn flag is gone
    const flagOpts = Array.from((screen.getByTestId('as-f-flag') as HTMLSelectElement).options).map((o) => o.value);
    expect(flagOpts).not.toContain('churn_watch');
    expect(screen.getByTestId('cpx-retention-source')).toHaveTextContent('come from Customer Retention');
    fireEvent.click(screen.getByTestId('cpx-retention-link'));
    expect(await screen.findByTestId('retention-page')).toBeInTheDocument();                       // navigated to Customer Retention
  });
  it('CPA-12 Retention unavailable → the card says "—", never 0', async () => {
    ci.summary.mockResolvedValue({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 }, retention: null });
    wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-rebooking')).toHaveTextContent('5'));
    expect(screen.getByTestId('as-kpi-churn')).toHaveTextContent('—');
    expect(screen.getByTestId('cpx-ev-retention')).toHaveTextContent('could not be read just now');
  });
  it('CPA-03 Evidence + Freshness: each part names its source and age from the same summary; stale says how to refresh; unknown is —', async () => {
    ci.summary.mockResolvedValue({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 },
      retention: { atRisk: 12, approaching: 4, active: 20, never: 2, atRiskDays: 90, source: 'customer_retention' },
      freshness: { state: 'stale', lastSuccessAt: '2026-11-10T15:00:00Z', staleAfterMinutes: 60, minutesSinceSuccess: 3000 },
      breakdown: { newSinceScan: 3 }, duplicateReview: { lastScanAt: null, open: null } });
    wrap();
    const ev = await screen.findByTestId('cpx-evidence');
    expect(screen.getByTestId('cpx-ev-scan-state')).toHaveTextContent('Out of date · last scan Nov 10, 2026');
    expect(ev).toHaveTextContent('Older than 60 minutes');
    expect(screen.getByTestId('cpx-ev-new')).toHaveTextContent('3 customer(s) added since that scan');
    expect(screen.getByTestId('cpx-ev-retention')).toHaveTextContent('at risk after 90 days');
    expect(screen.getByTestId('cpx-ev-dup')).toHaveTextContent('has not run yet');
    expect(ci.summary).toHaveBeenCalledTimes(1);                                                // no second fetch for the evidence
  });
  it('round 10 (CPA-05): a failed REFRESH keeps the last good cards and list on screen, marked with their time; a new filter that fails shows the error alone', async () => {
    ci.summary.mockResolvedValueOnce({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 } }).mockRejectedValue({ status: 403 });
    ci.customers.mockResolvedValueOnce(page([ROW])).mockRejectedValue({ status: 403 });
    wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-scanned')).toHaveTextContent('40'));
    await screen.findByTestId('as-row');
    fireEvent.click(screen.getByTestId('as-refresh'));
    expect(await screen.findByTestId('as-list-stale')).toHaveTextContent('Showing the last good list, from');
    expect(screen.getByTestId('as-sum-stale')).toHaveTextContent('Showing the last good numbers');
    expect(screen.getByTestId('as-row')).toHaveTextContent('Linh Pham');            // the customers stay visible
    expect(screen.getByTestId('as-kpi-scanned')).toHaveTextContent('40');
    fireEvent.change(screen.getByTestId('as-f-status'), { target: { value: 'inactive_all' } });   // a different question
    await waitFor(() => expect(screen.queryByTestId('as-row')).toBeNull());
    expect(screen.queryByTestId('as-list-stale')).toBeNull();
  });
  it('CPA-05 slow network / AI outage: a dropped summary read is retried and the cards fill; a 403 is not retried; an AI package outage keeps the customer dashboard visible with Retry', { timeout: 15000 }, async () => {
    ci.summary.mockRejectedValueOnce({}).mockResolvedValue({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 } });
    const { unmount } = wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-scanned')).toHaveTextContent('40'), { timeout: 4000 });
    expect(ci.summary.mock.calls.length).toBeGreaterThanOrEqual(2);   // the failed read was tried again
    expect(screen.queryByRole('alert')).toBeNull();
    unmount(); ci.summary.mockReset();
    ci.summary.mockRejectedValue({ status: 403 });
    const b = wrap();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const n = ci.summary.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1200));                // past the first retry pause
    expect(ci.summary.mock.calls.length).toBe(n);                 // a permission answer is final — never retried
    expect(screen.getByTestId('cpx-dashboard')).toBeInTheDocument();   // the list still renders under the card error
    b.unmount(); ci.summary.mockReset(); ci.summary.mockResolvedValue({ cards: null });
    // the AI package read is down (503): the header says so with Retry, the customer dashboard under it stays
    pkg.detail.mockRejectedValueOnce({ status: 503 }).mockResolvedValue(CARD);
    wrap();
    expect(await screen.findByTestId('pkg-retry')).toBeInTheDocument();
    expect(screen.getByTestId('pkg-outage-children')).toBeInTheDocument();
    expect(await screen.findByTestId('cpx-dashboard')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pkg-retry'));
    await waitFor(() => expect(screen.queryByTestId('pkg-retry')).toBeNull());
    expect(pkg.detail.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
