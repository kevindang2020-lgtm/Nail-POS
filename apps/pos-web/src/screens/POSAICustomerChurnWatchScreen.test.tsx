// POSAICustomerChurnWatchScreen — Churn Watch guide (Nov 1 2026). Title, caution, search box and Search stay; with nothing
// evaluated the screen says Data Unavailable (not zero); metrics drive the queue; tabs, priority and dates are server queries;
// the evidence overlay shows the rule's evidence and inputs; Mark reviewed sends the version and never anything else;
// a role without the churn permission sees no review actions; the check renders in the POS language.
// Kevin decision 2: the status shown is Customer Retention's (verdict) and links there; the assistant's signals are supporting only.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { cw, navigate, perms } = vi.hoisted(() => ({
  cw: { summary: vi.fn(), customers: vi.fn(), customer: vi.fn(), review: vi.fn(), history: vi.fn(), check: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), perms: { deny: [] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posChurnWatchApi', () => ({ posChurnWatchApi: cw }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSAICustomerChurnWatchScreen } from './POSAICustomerChurnWatchScreen';

const SUM = { metrics: { evaluated: 5, needsReview: 1, higherPriority: 2, insufficientHistory: 1, upcomingBooking: 1, reviewed: 0, noSignal: 1 }, unavailable: false, freshness: { state: 'up_to_date', lastEvaluatedAt: '2026-11-02T14:00:00Z' },
  definitions: { verdictSource: 'customer_retention', riskDays: 60, approachingDays: 45 } };
const ROW = { id: 'c1', name: 'Hal High', phone: null, state: 'higher_priority', verdict: { source: 'customer_retention', segment: 'at_risk', state: 'higher_priority', daysAway: 100, since: '2026-09-23' },
  supporting: { source: 'assistant_signals', reasons: ['100 days since last visit vs a ~30-day norm (3x+ overdue)'], evaluatedAt: '2026-11-02T14:00:00Z' },
  lastVisitAt: '2026-07-25T15:00:00Z', daysSinceLast: 100, typicalIntervalDays: 30, hasUpcoming: false, nextAppointmentDate: null, review: null };
const LIST = { items: [ROW], total: 1, page: 1, pageSize: 25, totalPages: 1, unavailable: false, period: { today: '2026-11-02' } };
const EV = { customerId: 'c1', evaluated: true, verdict: { source: 'customer_retention', segment: 'at_risk', state: 'higher_priority', daysAway: 100, since: '2026-09-23' },
  supporting: { source: 'assistant_signals', reasons: ['100 days since last visit vs a ~30-day norm (3x+ overdue)', '3 cancellations on record'], since: '2026-11-01T14:00:00Z' },
  inputs: { completedVisits: 3, firstVisitAt: '2026-05-26T15:00:00Z', lastVisitAt: '2026-07-25T15:00:00Z', typicalIntervalDays: 30, daysSinceLast: 100, hasUpcoming: false, nextAppointmentDate: null, canceledCount: 3, noShowCount: 0, membershipCanceled: false },
  rule: { version: 'ci-2026-11-02b', evaluatedAt: '2026-11-02T14:00:00Z' }, review: null, history: [] };
const mount = () => render(<MemoryRouter initialEntries={['/tenant/ai/customer-profile/churn']}><POSAICustomerChurnWatchScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(cw), navigate]) f.mockReset();
  perms.deny = [];
  cw.summary.mockResolvedValue(SUM); cw.customers.mockResolvedValue(LIST); cw.customer.mockResolvedValue(EV);
});

describe('POSAICustomerChurnWatchScreen', () => {
  it('keeps the title, caution, search box and Search; shows the six metrics', async () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Churn Watch' })).toBeInTheDocument();
    expect(screen.getAllByText(/never shown to customers, never a certainty/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText('Search by name, phone, or email')).toBeInTheDocument();
    expect(await screen.findByTestId('kpi-higher')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-evaluated')).toHaveTextContent('5');
  });

  it('each row\'s status is Customer Retention\'s (segment + days away) and links there; the assistant\'s reason is labelled supporting', async () => {
    mount();
    expect(await screen.findByTestId('cwx-verdict')).toHaveTextContent('At risk · 100 days away');
    expect(screen.getByTestId('cwx-level')).toHaveTextContent('Higher priority');
    expect(screen.getByText('Customer Retention status')).toBeInTheDocument();
    expect(screen.getByText('Supporting reason')).toBeInTheDocument();
    expect(screen.getByTestId('cwx-supporting')).toHaveTextContent('3x+ overdue');
    expect(screen.getByTestId('cwx-verdict-source')).toHaveTextContent('Customer Retention\'s classification (At risk from 60 days, Approaching from 45 days)');
    fireEvent.click(screen.getByTestId('cwx-retention-link'));
    expect(navigate).toHaveBeenCalledWith('/tenant/customers/retention');
  });

  it('with no assistant evaluation the Retention status still shows; supporting reasons say "press Refresh", never zero', async () => {
    cw.summary.mockResolvedValue({ ...SUM, freshness: { state: 'never' } });
    cw.customers.mockResolvedValue({ ...LIST, items: [{ ...ROW, supporting: null }] });
    mount();
    expect(await screen.findByTestId('cwx-unavailable')).toHaveTextContent(/supporting reasons/);
    expect(screen.getByTestId('kpi-higher')).toHaveTextContent('2');
    expect(await screen.findByTestId('cwx-verdict')).toHaveTextContent('At risk');
    expect(screen.getByTestId('cwx-supporting')).toHaveTextContent('—');
  });

  it('metric cards, tabs and dates drive server queries', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('kpi-higher'));
    await waitFor(() => expect(cw.customers).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'needs_review', priority: 'higher', page: 1 })));
    fireEvent.click(screen.getByTestId('tab-reviewed'));
    await waitFor(() => expect(cw.customers).toHaveBeenLastCalledWith(expect.objectContaining({ tab: 'reviewed' })));
    fireEvent.click(screen.getByTestId('preset-last_30'));
    await waitFor(() => expect(cw.customers).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last_30' })));
  });

  it('the evidence overlay shows the rule\'s reasons and inputs; Mark reviewed sends only the review', async () => {
    cw.review.mockResolvedValue({ customerId: 'c1', action: 'reviewed' });
    mount();
    fireEvent.click((await screen.findAllByTestId('cwx-view'))[0]);
    expect(await screen.findByTestId('ov-verdict')).toHaveTextContent('At risk · 100 days since the last completed visit');
    expect(screen.getByText('Supporting reasons (the assistant\'s signals — not the verdict)')).toBeInTheDocument();
    expect(await screen.findByTestId('ov-evidence')).toHaveTextContent('3 cancellations on record');
    expect(screen.getByTestId('ov-note')).toHaveTextContent(/not a confirmed decision to leave/);
    fireEvent.click(screen.getByTestId('cwx-mark-reviewed'));
    await waitFor(() => expect(cw.review).toHaveBeenCalledWith('c1', { action: 'reviewed', expectedVersion: 0 }));
    expect(await screen.findByTestId('cwx-notice')).toHaveTextContent(/Nothing was sent or changed/);
  });

  // extras Churn Watch 07 (round 10): the opt-out checks from the messaging opt-out store are shown before anyone reaches out
  it('shows a customer who texted STOP in the queue and the overlay states the text / e-mail consent; nothing is sent', async () => {
    cw.customers.mockResolvedValue({ ...LIST, items: [{ ...ROW, contactConsent: { smsOptedOut: true, smsOptedOutAt: '2026-10-01T10:00:00.000Z', emailOptedOut: true, emailScope: 'marketing' } }] });
    cw.customer.mockResolvedValue({ ...EV, contactConsent: { smsOptedOut: true, smsOptedOutAt: '2026-10-01T10:00:00.000Z', emailOptedOut: true, emailScope: 'marketing' } });
    mount();
    expect(await screen.findByTestId('cwx-row-sms-stop')).toHaveTextContent('Texted STOP — no follow-up texts');
    fireEvent.click((await screen.findAllByTestId('cwx-view'))[0]);
    expect(await screen.findByTestId('ov-consent')).toHaveTextContent('Texted STOP: follow-up and marketing texts are blocked (booking codes still go) · Unsubscribed from marketing e-mail');
    expect(cw.review).not.toHaveBeenCalled();
  });
  it('no opt-out → texts / e-mail allowed; an older server without consent → nothing claimed', async () => {
    cw.customer.mockResolvedValue({ ...EV, contactConsent: { smsOptedOut: false, smsOptedOutAt: null, emailOptedOut: false, emailScope: null } });
    const { unmount } = mount();
    expect(screen.queryByTestId('cwx-row-sms-stop')).toBeNull();
    fireEvent.click((await screen.findAllByTestId('cwx-view'))[0]);
    expect(await screen.findByTestId('ov-consent')).toHaveTextContent('Texts allowed · E-mail allowed');
    unmount();
    cw.customer.mockResolvedValue(EV);
    mount();
    fireEvent.click((await screen.findAllByTestId('cwx-view'))[0]);
    await screen.findByTestId('ov-verdict');
    expect(screen.queryByTestId('ov-consent')).toBeNull();
  });

  it('a role without the churn permission sees the evidence but no review actions', async () => {
    perms.deny = ['pos.ai_customer_profile.churn'];
    mount();
    fireEvent.click((await screen.findAllByTestId('cwx-view'))[0]);
    expect(await screen.findByTestId('ov-evidence')).toBeInTheDocument();
    expect(screen.queryByTestId('cwx-mark-reviewed')).toBeNull();
    expect(screen.queryByTestId('cwx-note')).toBeNull();
  });

  it('Check Churn Watch System explains the agreement with Customer Intelligence', async () => {
    cw.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T14:05:00Z', reused: false, checks: [
      { key: 'bookings_since_evaluation', state: 'WARNING', count: 1 }, { key: 'intelligence_agreement', state: 'PASSED', detail: { coarseChurnWatch: 3, possible: 1, elevated: 1, high: 1 } }] });
    mount();
    fireEvent.click(screen.getByTestId('cwx-check'));
    expect(await screen.findByTestId('chk-intelligence_agreement')).toHaveTextContent('counts 3; the assistant\'s supporting signals find 1 possible, 1 elevated and 1 high');
    expect(screen.getByTestId('chk-bookings_since_evaluation-state')).toHaveTextContent('Warning');
  });
});
