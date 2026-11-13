// POSAICustomerSearchScreen — Customer Search guide (Nov 1 2026): the title, subtitle, search box and Search button stay; Search
// sends the term to the server (never into the URL); filters, date field and page size are server queries; the KPI cards drill
// into filters; rows open the Customer 360° overlay whose actions go to the owning modules; an unavailable section says so
// instead of looking empty; Check Customer Search System shows each area's state and next step; a 403 shows the role message.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, navigate, ret } = vi.hoisted(() => ({
  api: { summary: vi.fn(), customers: vi.fn(), options: vi.fn(), profile: vi.fn(), check: vi.fn() }, navigate: vi.fn(), ret: { customer: vi.fn() } }));
vi.mock('../api/posRetentionApi', () => ({ posRetentionApi: ret }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posCustomerSearchApi', () => ({ posCustomerSearchApi: api }));
vi.mock('./AICustomerProfilePanel', () => ({ AICustomerProfilePanel: ({ customerId }: { customerId: string }) => <div data-testid="ai-panel">{customerId}</div> }));
import { POSAICustomerSearchScreen } from './POSAICustomerSearchScreen';

const SUM = { kpis: { customers: 8, createdInPeriod: 2, active: 3, neverVisited: 4, withUpcomingAppointment: 1, sharedContactProfiles: 2, archived: 1 },
  definitions: { activeDays: 90 }, period: { preset: 'month', from: '2026-11-01', to: '2026-11-30', today: '2026-11-02' }, scope: {} };
const ROW = (o: any = {}) => ({ id: 'c1', name: 'Nguyễn Thị Hằng', preferredName: null, phone: '(•••) •••-0101', phoneVerified: true, email: 'h•••@example.com', lifecycle: 'active', visits: 2,
  lastVisitAt: '2026-10-28T15:00:00Z', createdAt: '2026-01-10T15:00:00Z', nextAppointment: { id: 'a1', date: '2026-11-05', time: '10:00', status: 'booked' },
  lastTechnician: { id: 't1', name: 'Lan Tran' }, homeBranch: { id: 'b1', name: 'Main' }, sharedContactProfiles: 0, member: false, matchedBy: null, ...o });
const page = (items: unknown[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, pageCount: 1, sort: 'newest', today: '2026-11-02', fullContact: false, freshness: { lastCustomerChangeAt: '2026-11-01T10:00:00Z' }, ...o });
const PROFILE = {
  identity: { id: 'c1', name: 'Nguyễn Thị Hằng', phone: '(•••) •••-0101', phoneVerified: true, email: null, createdAt: '2026-01-10T15:00:00Z', updatedAt: '2026-10-01T15:00:00Z', archivedAt: null, homeBranch: { name: 'Main' }, preferredBranch: null, lifecycle: 'active', fullContact: false },
  visits: { completed: 2, firstAt: '2026-09-20T15:00:00Z', lastAt: '2026-10-28T15:00:00Z' },
  appointments: { upcoming: [{ id: 'a1', date: '2026-11-05', time: '10:00', status: 'booked', technician: { id: 't1', name: 'Lan Tran' }, branch: { name: 'Main' } }], history: [], canceled: 0, noShows: 0 },
  services: [{ id: 'l1', service: 'Gel Manicure', minutes: 45, technician: { name: 'Lan Tran' }, at: '2026-10-28T15:00:00Z', ticketNumber: 12 }],
  preferences: { technician: null }, loyalty: null, memberships: [], duplicates: [{ id: 'c9', name: 'Hang N', samePhone: true, sameEmail: false, createdAt: '2026-02-01T00:00:00Z', decision: null }],
  sources: { visits: 'ok', booking: 'ok', services: 'ok', loyalty: 'unavailable', memberships: 'ok', duplicates: 'ok' }, today: '2026-11-02',
};
const mount = (url = '/tenant/ai/customer-profile/search') => render(<MemoryRouter initialEntries={[url]}><POSAICustomerSearchScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(api), navigate]) f.mockReset();
  api.summary.mockResolvedValue(SUM); api.customers.mockResolvedValue(page([ROW(), ROW({ id: 'c2', name: 'Hang Nguyen', lifecycle: 'never', visits: 0, nextAppointment: null })]));
  api.options.mockResolvedValue({ technicians: [{ id: 't1', name: 'Lan Tran' }], services: [{ id: 's1', name: 'Gel Manicure' }], branches: [{ branchId: 'b1', name: 'Main' }] });
  api.profile.mockResolvedValue(PROFILE);
});

describe('POSAICustomerSearchScreen', () => {
  it('keeps the title, subtitle, search box and Search button; shows the directory and the server KPIs', async () => {
    mount();
    expect(await screen.findAllByTestId('csx-row')).toHaveLength(2);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('csx-search')).toBeInTheDocument(); expect(screen.getByTestId('csx-search-btn')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('kpi-customers')).toHaveTextContent('8'));
    expect(screen.getByTestId('kpi-active')).toHaveTextContent('90');
    expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 25 }));
    expect(api.customers.mock.calls.slice(-1)[0][0].q).toBeUndefined();
  });
  it('Search sends the term to the server and never puts it in the URL', async () => {
    mount();
    await screen.findAllByTestId('csx-row');
    fireEvent.change(screen.getByTestId('csx-search'), { target: { value: '(609) 555-0101' } });
    fireEvent.click(screen.getByTestId('csx-search-btn'));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ q: '(609) 555-0101', page: 1 })));
    expect(window.location.search).not.toContain('555');
  });
  it('filters, date field and page size are server queries; a KPI card drills into its filter', async () => {
    mount();
    await screen.findAllByTestId('csx-row');
    fireEvent.change(screen.getByTestId('flt-status'), { target: { value: 'inactive' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive' })));
    fireEvent.change(screen.getByTestId('flt-datefield'), { target: { value: 'last_visit' } });
    fireEvent.click(screen.getByTestId('preset-month'));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ dateField: 'last_visit', preset: 'month' })));
    fireEvent.change(screen.getByTestId('csx-pagesize'), { target: { value: '100' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 100 })));
    fireEvent.click(screen.getByTestId('kpi-shared'));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'duplicate' })));
  });
  it('a row opens the 360° overlay; an unreadable section says unavailable; actions go to the owning modules', async () => {
    mount();
    fireEvent.click((await screen.findAllByTestId('csx-row'))[0]);
    expect(await screen.findByTestId('csx-overlay')).toBeInTheDocument();
    expect(api.profile).toHaveBeenCalledWith('c1');
    expect(await screen.findByTestId('ov-unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ov-tab-appointments'));
    fireEvent.click(screen.getByTestId('ov-view-booking'));
    expect(navigate).toHaveBeenLastCalledWith('/booking?date=2026-11-05');
    fireEvent.click(screen.getByTestId('ov-book'));
    expect(navigate).toHaveBeenLastCalledWith(expect.stringMatching(/^\/booking\/new\?customerId=c1/));
    fireEvent.click(screen.getByTestId('ov-duplicates'));
    expect(navigate).toHaveBeenLastCalledWith('/tenant/ai/customer-profile/duplicates');
    fireEvent.click(screen.getByTestId('ov-tab-ai'));
    expect(screen.getByTestId('ai-panel')).toHaveTextContent('c1');
    fireEvent.click(screen.getByTestId('ov-close'));
    await waitFor(() => expect(screen.queryByTestId('csx-overlay')).toBeNull());
    expect(screen.getAllByTestId('csx-row')).toHaveLength(2);
  });
  it('Customer Search 10 · 03: the 360° overlay has a Retention tab read from Customer Retention (loaded on open, never re-derived); a 403 says so', async () => {
    ret.customer.mockResolvedValueOnce({ customerId: 'c1', segment: 'at_risk', segmentReason: { code: 'away_past_threshold' }, daysAway: 75, thresholds: { riskDays: 60, approachingDays: 45 },
      lastVisitAt: '2026-08-19T15:00:00Z', visits: 4, priority: { score: 82, band: 'high' }, upcomingBookings: [], outreach: [{ campaignId: 'k1', at: '2026-10-01T15:00:00Z', status: 'delivered' }], asOf: '2026-11-02' })
      .mockRejectedValueOnce({ status: 403 });
    mount();
    fireEvent.click((await screen.findAllByTestId('csx-row'))[0]);
    await screen.findByTestId('csx-overlay');
    expect(ret.customer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ov-tab-retention'));
    expect(await screen.findByTestId('ov-ret-segment')).toHaveTextContent('At Risk 60+ days — 75 days since the last completed visit (At Risk from 60).');
    expect(ret.customer).toHaveBeenCalledWith('c1');
    expect(screen.getByTestId('ov-ret-priority')).toHaveTextContent('82 · High');
    expect(screen.getByTestId('ov-ret')).toHaveTextContent(/Nothing here sends a message/);
    fireEvent.click(screen.getByTestId('ov-ret-open'));
    expect(navigate).toHaveBeenLastCalledWith('/tenant/customers/retention');
    fireEvent.click(screen.getByTestId('ov-tab-identity'));
    fireEvent.click(screen.getByTestId('ov-tab-retention'));
    expect(await screen.findByTestId('ov-ret-error')).toHaveTextContent('You cannot view Customer Retention for this salon.');
  });
  it('Check Customer Search System shows each area with its state and next step — localized from the numbers, never the server\'s English', async () => {
    api.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00Z', rateLimited: false, checks: [
      { key: 'directory', state: 'READY', evidence: 'SERVER ENGLISH', action: null, detail: { live: 8, archived: 1 } },
      { key: 'duplicate_signals', state: 'WARNING', evidence: 'SERVER ENGLISH', action: 'SERVER ENGLISH', detail: { n: 2 } },
      { key: 'indexes', state: 'FAILED', evidence: 'The check could not run: boom', action: 'x', detail: { failedToRun: 1 } }] });
    mount();
    await screen.findAllByTestId('csx-row');
    fireEvent.click(screen.getByTestId('csx-check'));
    expect(await screen.findByTestId('chk-duplicate_signals-detail')).toHaveTextContent('2 profile(s) share a phone or email with another profile. Review them in Duplicate Review');
    expect(screen.getByTestId('chk-directory-detail')).toHaveTextContent('8 live and 1 archived customer records');
    expect(screen.getByTestId('chk-indexes-detail')).toHaveTextContent('The check could not run.');
    expect(screen.queryByText(/SERVER ENGLISH/)).toBeNull();
  });
  it('no matches offers Clear all; a 403 shows the role message (never an empty directory)', async () => {
    api.customers.mockResolvedValue(page([]));
    mount('/tenant/ai/customer-profile/search?status=archived');
    expect(await screen.findByTestId('flt-clear')).toBeInTheDocument();
    api.customers.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    fireEvent.click(screen.getByTestId('csx-refresh'));
    expect(await screen.findByText(/cannot search customers/i)).toBeInTheDocument();
  });
  it('Customer Search 05: the last filters (never the search text) come back when the screen is opened again in this tab', async () => {
    sessionStorage.clear();
    const first = mount();
    await screen.findAllByTestId('csx-row');
    fireEvent.change(screen.getByTestId('flt-status'), { target: { value: 'inactive' } });
    fireEvent.change(screen.getByTestId('csx-search'), { target: { value: '8565550101' } });
    fireEvent.click(screen.getByTestId('csx-search-btn'));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive', q: '8565550101' })));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('aps.csx.filters') ?? '{}')).toEqual({ status: 'inactive' }));
    expect(sessionStorage.getItem('aps.csx.filters')).not.toContain('8565550101');
    first.unmount(); api.customers.mockClear();
    mount();
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive', q: undefined })));
    expect(await screen.findByTestId('csx-restored')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('flt-clear'));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('aps.csx.filters') ?? '{}')).toEqual({}));
    sessionStorage.clear();
  });
});
