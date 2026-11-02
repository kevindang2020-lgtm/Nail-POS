// POSAICustomerProfileOverviewScreen — Customer Intelligence guide (Nov 1 2026). The title, subtitle, Refresh, "How to use this"
// and the six cards (their own labels) stay; the cards come from the scan and are clickable; "Why these numbers?" shows that
// every scanned profile is in exactly one state (15 scanned / 1 active / 0 inactive is explained, not "fixed"); an unscanned
// Duplicate Review shows an em dash, not 0; a never-scanned salon scans once on open; Refresh is a rate-limited scan; the list
// filters are server queries; the overlay shows the classification evidence and opens the owning modules.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { ci, cs, navigate } = vi.hoisted(() => ({
  ci: { summary: vi.fn(), scan: vi.fn(), customers: vi.fn(), customer: vi.fn(), scans: vi.fn(), check: vi.fn() }, cs: { profile: vi.fn() }, navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posCustomerIntelligenceApi', () => ({ posCustomerIntelligenceApi: ci }));
vi.mock('../api/posCustomerSearchApi', () => ({ posCustomerSearchApi: cs }));
import { POSAICustomerProfileOverviewScreen } from './POSAICustomerProfileOverviewScreen';

const SUM = (o: any = {}) => ({
  cards: { duplicateGroups: null, active: 1, withUpcoming: 0, inactive: 0, churnWatch: 0, rebooking: 0, scanned: 15 },
  breakdown: { scanned: 15, states: { active: 1, rebooking_soon: 0, due_for_return: 0, inactive: 0, long_term_inactive: 0, insufficient_history: 14 }, neverServed: 13, underCadence: 1, sumOfStates: 15, archivedExcluded: 0, liveNow: 15, newSinceScan: 0 },
  definitions: { ruleVersion: 'ci-2026-11-02', inactiveDays: 90, longTermInactiveDays: 180, minVisitsForCadence: 3 },
  scan: { finishedAt: '2026-11-02T14:00:00Z', durationMs: 12, scanned: 15 }, freshness: { state: 'up_to_date', lastSuccessAt: '2026-11-02T14:00:00Z', ruleVersion: 'ci-2026-11-02' }, ...o });
const ROW = { id: 'c1', name: 'Regular Rhee', phone: '(•••) •••-0103', scanned: true, status: 'active', neverServed: false, completedVisits: 4, lastVisitAt: '2026-10-28T15:00:00Z', nextAppointmentDate: null,
  churnWatch: false, rebooking: false, duplicate: false, lastTechnician: 'Lan Nguyễn', preferredTechnician: null, loyalty: { points: 65 }, member: false };
const LIST = { items: [ROW], total: 1, page: 1, pageSize: 25, totalPages: 1, applied: { sort: 'last_visit' }, period: { today: '2026-11-02' }, contact: 'masked' };
const mount = () => render(<MemoryRouter initialEntries={['/tenant/ai/customer-profile']}><POSAICustomerProfileOverviewScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(ci), ...Object.values(cs), navigate]) f.mockReset();
  ci.summary.mockResolvedValue(SUM()); ci.customers.mockResolvedValue(LIST); ci.scan.mockResolvedValue({ reused: false, scan: { scanned: 15 } });
});

describe('POSAICustomerProfileOverviewScreen', () => {
  it('keeps the title, subtitle, Refresh, How to use this and all six cards; an unscanned Duplicate Review is "—", not 0', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Customer Intelligence' })).toBeInTheDocument();
    expect(screen.getByText('Tenant-wide customer-profile signals')).toBeInTheDocument();
    expect(screen.getByTestId('cix-howto-panel')).toHaveTextContent('How to use this');
    for (const id of ['kpi-dup', 'kpi-active', 'kpi-inactive', 'kpi-churn', 'kpi-rebook', 'kpi-scanned']) expect(await screen.findByTestId(id)).toBeInTheDocument();
    expect(screen.getByTestId('kpi-scanned')).toHaveTextContent('15');
    expect(screen.getByTestId('kpi-dup')).toHaveTextContent('—');
    expect(ci.scan).not.toHaveBeenCalled();                                   // fresh: no scan on open
  });

  it('"Why these numbers?" reconciles 15 scanned / 1 active / 0 inactive from the real states', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('cix-why'));
    expect(await screen.findByTestId('why-sum')).toHaveTextContent('15');
    expect(screen.getByTestId('why-insufficient_history')).toHaveTextContent('14');
    expect(screen.getByTestId('why-insufficient')).toHaveTextContent(/13 never served \+ 1 with fewer than 3/);
  });

  it('Refresh runs a scan and reloads; a never-scanned salon scans once on open', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('cix-refresh'));
    await waitFor(() => expect(ci.scan).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('cix-notice')).toHaveTextContent('15 customers classified');
    ci.scan.mockClear(); ci.summary.mockResolvedValue(SUM({ freshness: { state: 'never' }, cards: null, breakdown: null, scan: null }));
    mount();
    await waitFor(() => expect(ci.scan).toHaveBeenCalledTimes(1));
  });

  it('cards and filters drive server queries; the duplicate card opens Duplicate Review', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('kpi-inactive'));
    await waitFor(() => expect(ci.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive_all', page: 1 })));
    fireEvent.click(screen.getByTestId('kpi-churn'));
    await waitFor(() => expect(ci.customers).toHaveBeenLastCalledWith(expect.objectContaining({ flag: 'churn_watch' })));
    fireEvent.click(screen.getByTestId('preset-last_90'));
    await waitFor(() => expect(ci.customers).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last_90' })));
    fireEvent.change(screen.getByTestId('cix-search'), { target: { value: 'gel manicure' } });
    fireEvent.click(screen.getByTestId('cix-search-btn'));
    await waitFor(() => expect(ci.customers).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'gel manicure' })));
    fireEvent.click(screen.getByTestId('kpi-dup'));
    expect(navigate).toHaveBeenCalledWith('/tenant/ai/customer-profile/duplicates');
  });

  it('the overlay shows the classification evidence and the recorded preference, and opens the owning modules', async () => {
    ci.customer.mockResolvedValue({ customerId: 'c1', scanned: true, duplicateGroups: [], classification: { status: 'active', completedVisits: 4, firstVisitAt: '2026-08-01T15:00:00Z', lastVisitAt: '2026-10-28T15:00:00Z',
      typicalIntervalDays: 30, nextAppointmentDate: null, evidence: ['Within normal ~30-day interval'], churnWatch: false, rebooking: false, computedAt: '2026-11-02T14:00:00Z' } });
    cs.profile.mockResolvedValue({ identity: { name: 'Regular Rhee', phone: '(•••) •••-0103', email: null }, preferences: { technician: null }, loyalty: { enrolled: true, points: 65 }, memberships: [], sources: {} });
    mount();
    fireEvent.click((await screen.findAllByTestId('cix-view'))[0]);
    expect(await screen.findByTestId('ov-evidence')).toHaveTextContent('Within normal ~30-day interval');
    expect(within(await screen.findByTestId('ov-profile')).getByText('None recorded')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ov-timeline'));
    expect(navigate).toHaveBeenCalledWith('/tenant/ai/customer-profile/timeline?customer=c1');
  });

  it('Check Customer Intelligence System spells out who is counted where', async () => {
    ci.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T14:05:00Z', reused: false, checks: [
      { key: 'eligibility', state: 'PASSED', count: 15, detail: { scanned: 15, active: 1, inactiveCard: 0, neverServed: 13, underCadence: 1, rebookingSoon: 0, dueForReturn: 0 } },
      { key: 'coverage', state: 'WARNING', count: 2 }] });
    mount();
    fireEvent.click(await screen.findByTestId('cix-check'));
    expect(await screen.findByTestId('chk-eligibility')).toHaveTextContent('15 scanned = 1 active + 0 inactive (card) + 0 due or rebooking soon + 13 never served + 1 with too few visits.');
    expect(screen.getByTestId('chk-coverage-state')).toHaveTextContent('Warning');
  });
});
