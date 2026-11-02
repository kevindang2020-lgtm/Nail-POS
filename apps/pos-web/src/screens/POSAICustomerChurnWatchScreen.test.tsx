// POSAICustomerChurnWatchScreen — Churn Watch guide (Nov 1 2026). Title, caution, search box and Search stay; with nothing
// evaluated the screen says Data Unavailable (not zero); metrics drive the queue; tabs, priority and dates are server queries;
// the evidence overlay shows the rule's evidence and inputs; Mark reviewed sends the version and never anything else;
// a role without the churn permission sees no review actions; the check renders in the POS language.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { cw, navigate, perms } = vi.hoisted(() => ({
  cw: { summary: vi.fn(), customers: vi.fn(), customer: vi.fn(), review: vi.fn(), history: vi.fn(), check: vi.fn(), refresh: vi.fn() }, navigate: vi.fn(), perms: { deny: [] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posChurnWatchApi', () => ({ posChurnWatchApi: cw }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.includes(p) }));
import { POSAICustomerChurnWatchScreen } from './POSAICustomerChurnWatchScreen';

const SUM = { metrics: { evaluated: 5, needsReview: 1, higherPriority: 2, insufficientHistory: 1, upcomingBooking: 1, reviewed: 0, noSignal: 1 }, unavailable: false, freshness: { state: 'up_to_date', lastEvaluatedAt: '2026-11-02T14:00:00Z' } };
const ROW = { id: 'c1', name: 'Hal High', phone: null, level: 'high', state: 'higher_priority', evidence: ['100 days since last visit vs a ~30-day norm (3x+ overdue)'], signalSince: '2026-11-01T14:00:00Z',
  lastVisitAt: '2026-07-25T15:00:00Z', daysSinceLast: 100, typicalIntervalDays: 30, hasUpcoming: false, nextAppointmentDate: null, review: null };
const LIST = { items: [ROW], total: 1, page: 1, pageSize: 25, totalPages: 1, unavailable: false, period: { today: '2026-11-02' } };
const EV = { customerId: 'c1', evaluated: true, signal: { level: 'high', state: 'higher_priority', evidence: ['100 days since last visit vs a ~30-day norm (3x+ overdue)', '3 cancellations on record'], since: '2026-11-01T14:00:00Z' },
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

  it('with nothing evaluated it says Data Unavailable, never zero', async () => {
    cw.summary.mockResolvedValue({ metrics: null, unavailable: true, freshness: { state: 'never' } });
    cw.customers.mockResolvedValue({ items: [], total: 0, unavailable: true });
    mount();
    expect(await screen.findByTestId('cwx-unavailable')).toHaveTextContent(/not "no risk"/);
    expect(screen.getByTestId('kpi-needs')).toHaveTextContent('Unavailable');
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
    expect(await screen.findByTestId('ov-evidence')).toHaveTextContent('3 cancellations on record');
    expect(screen.getByTestId('ov-note')).toHaveTextContent(/not a confirmed decision to leave/);
    fireEvent.click(screen.getByTestId('cwx-mark-reviewed'));
    await waitFor(() => expect(cw.review).toHaveBeenCalledWith('c1', { action: 'reviewed', expectedVersion: 0 }));
    expect(await screen.findByTestId('cwx-notice')).toHaveTextContent(/Nothing was sent or changed/);
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
    expect(await screen.findByTestId('chk-intelligence_agreement')).toHaveTextContent('counts 3; this queue\'s rule finds 1 possible, 1 elevated and 1 high');
    expect(screen.getByTestId('chk-bookings_since_evaluation-state')).toHaveTextContent('Warning');
  });
});
