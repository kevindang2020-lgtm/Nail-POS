import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { compareMock, center } = vi.hoisted(() => ({ compareMock: vi.fn(), center: { branchScorecard: vi.fn(), branchExplain: vi.fn(), branchCheck: vi.fn(), branchSnapshots: vi.fn(), branchSnapshot: vi.fn(), saveBranchSnapshot: vi.fn(), signOffBranchSnapshot: vi.fn() } }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { compareBranches: compareMock, center } }));
import { POSAiBranchCompareScreen } from './POSAiBranchCompareScreen';

const render1 = () => render(<MemoryRouter><POSAiBranchCompareScreen /></MemoryRouter>);

const ROW = (o: any) => ({ status: 'active', timeZone: 'UTC', averageTicketCents: 5000, totalBookings: 10, completed: 9, completionRate: 90, noShowPercent: 2, cancelledPercent: 1, customers: 10, returningCustomers: 5, rank: { perTechnicianHour: null, perOperatingHour: null, returningRate: null }, ...o });
const SC = { preset: 'month', range: null, financialsIncluded: true, notes: [], rows: [
  ROW({ branchId: 'b1', branchName: 'Marlton', likeForLike: { peers: [{ branchId: 'b3', branchName: 'Cherry Hill', mixOverlapPercent: 80 }, { branchId: 'b4', branchName: 'Voorhees', mixOverlapPercent: 70 }], rankPerTechnicianHour: 2, of: 3, mix: [{ category: 'Manicure', sharePercent: 60 }], reason: null }, trendFlags: [{ family: 'revenue', metricId: 'net_sales', unit: 'cents', triggered: 2, openIncidents: 1, latestValue: 30000, threshold: 50000, operator: 'lt', latestAt: '2026-11-05T15:00:00Z', route: '/tenant/ai/business/alerts' }], netSalesCents: 500000, ticketsCount: 100, technicianHours: 100, operatingHours: 200, netPerTechnicianHourCents: 5000, netPerOperatingHourCents: 2500, returningRate: 50, rank: { perTechnicianHour: 2, perOperatingHour: 1, returningRate: 1 } }),
  ROW({ branchId: 'b2', branchName: 'Deptford', likeForLike: { peers: [], rankPerTechnicianHour: null, of: 1, mix: [], reason: 'no_opening_hours' }, netSalesCents: 200000, ticketsCount: 50, technicianHours: 20, operatingHours: null, netPerTechnicianHourCents: 10000, netPerOperatingHourCents: null, returningRate: 30, rank: { perTechnicianHour: 1, perOperatingHour: null, returningRate: 2 } }) ],
  advice: [{ branchId: 'b2', branchName: 'Deptford', kind: 'no_opening_hours', severity: 'info', message: 'x', basis: {}, route: '/tenant/management/locations' }] };
beforeEach(() => { center.branchScorecard.mockReset().mockResolvedValue({ ...SC, rows: [], advice: [] }); center.branchExplain.mockReset();
  center.branchSnapshots.mockReset().mockResolvedValue({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 }); center.branchSnapshot.mockReset(); center.saveBranchSnapshot.mockReset(); center.signOffBranchSnapshot.mockReset(); });

describe('AI Branch Comparison screen', () => {
  it('A3: the fair scorecard ranks per technician hour; the advisor speaks the screen language; Explain renders the measured bridge', async () => {
    compareMock.mockResolvedValue({ preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 700000, ticketsCount: 150, averageTicketCents: 4667, totalBookings: 20, completed: 18, completionRate: 90, branches: 2 }, drilldownRoute: '/tenant/reports/sales', notes: [], branches: [] });
    center.branchScorecard.mockResolvedValue(SC);
    center.branchExplain.mockResolvedValue({ a: 'Marlton', b: 'Deptford', preset: 'month', range: null, lines: [], bridge: { volumeCents: 200000, priceCents: 100000, totalCents: 300000 } });
    render1();
    const rows = await screen.findAllByTestId('bcx-s-row');
    expect(rows[1]).toHaveTextContent('Deptford');
    expect(rows[1]).toHaveTextContent('$100.00 · #1');
    expect(screen.getByTestId('bcx-advice')).toHaveTextContent('Deptford has no opening hours set');
    // AI BRANCH COMPARISON 04: like-for-like group from the server — rank among similar branches, or why there is none
    const like = screen.getAllByTestId('bcx-s-like');
    expect(like[0]).toHaveTextContent('#2 of 3 per technician hour · similar to Cherry Hill, Voorhees');
    expect(like[1]).toHaveTextContent('No opening hours set');
    // AI BRANCH COMPARISON 09: the existing alert rules' flags, worded, linking to Alerts
    const tf = screen.getAllByTestId('bcx-trend');
    expect(tf).toHaveLength(1);
    expect(tf[0]).toHaveTextContent(/Revenue\s+Marlton: Net sales crossed its rule 2 time\(s\) — latest \$300\.00 against \$500\.00/);
    expect(tf[0]).toHaveTextContent('1 still open.');
    expect(within(tf[0]).getByRole('link', { name: 'Open alerts' }).getAttribute('href')).toBe('/tenant/ai/business/alerts');
    fireEvent.click(screen.getByTestId('bcx-explain'));
    fireEvent.click(await screen.findByTestId('bcx-e-run'));
    expect(center.branchExplain).toHaveBeenCalledWith({ preset: 'month', a: 'b1', b: 'b2' });
    const lines = await screen.findByTestId('bcx-e-lines');
    expect(lines).toHaveTextContent('Marlton took $3,000.00 more than Deptford.');
    expect(lines).toHaveTextContent('$2,000.00 of that comes from 50 more paid tickets (100 vs 50)');
    expect(lines).toHaveTextContent('These are measured differences, not causes');
  });

  it('AI BRANCH COMPARISON 06: the explanation shows the figures it rests on, their source, the salon days and the as-of time; hidden revenue stays —', async () => {
    compareMock.mockResolvedValue({ preset: 'week', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: false, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: null, ticketsCount: null, averageTicketCents: null, totalBookings: 20, completed: 18, completionRate: 90, branches: 2 }, drilldownRoute: '/tenant/reports/sales', notes: [], branches: [] });
    center.branchScorecard.mockResolvedValue(SC);
    const side = (id: string, name: string) => ({ branchId: id, branchName: name, timeZone: 'America/New_York', range: { from: '2026-11-02', to: '2026-11-08' } });
    center.branchExplain.mockResolvedValue({ a: 'Marlton', b: 'Deptford', preset: 'week', range: null, lines: [], bridge: null,
      evidence: { asOf: '2026-11-06T20:00:00Z', preset: 'week', a: side('b1', 'Marlton'), b: side('b2', 'Deptford'), financialsIncluded: false,
        figures: [{ key: 'net_sales', unit: 'cents', a: null, b: null, source: 'sales_report', hidden: true },
          { key: 'technician_hours', unit: 'hours', a: 50, b: 10, source: 'time_clock', hidden: false },
          { key: 'operating_hours', unit: 'hours', a: 50, b: null, source: 'opening_hours', hidden: false },
          { key: 'no_show_rate', unit: 'percent', a: 9, b: 2, source: 'booking_report', hidden: false }],
        sources: [{ source: 'sales_report', route: '/tenant/reports/sales' }, { source: 'time_clock', route: '/tenant/team/time-clock' }] } });
    render1();
    fireEvent.click(await screen.findByTestId('bcx-explain'));
    fireEvent.click(await screen.findByTestId('bcx-e-run'));
    const ev = await screen.findByTestId('bcx-e-evidence');
    expect(within(ev).getByTestId('bcx-ev-days')).toHaveTextContent('Marlton: 2026-11-02 – 2026-11-08 (America/New_York)');
    expect(within(ev).getByTestId('bcx-ev-asof')).toHaveTextContent(/Read .*2026/);
    const rows = within(ev).getAllByTestId('bcx-ev-row');
    const byKey = (k: string) => rows.find((r) => r.getAttribute('data-key') === k)!;
    expect(byKey('net_sales')).toHaveTextContent(/Net sales\s*—\s*—\s*Sales Report/);
    expect(byKey('technician_hours')).toHaveTextContent('Time clock shifts');
    expect(byKey('operating_hours').textContent).toContain('N/A');          // unknown, never 0
    expect(byKey('no_show_rate')).toHaveTextContent(/9%\s*2%/);
    expect(within(ev).getByRole('link', { name: 'Time clock shifts' }).getAttribute('href')).toBe('/tenant/team/time-clock');
  });

  it('AI BRANCH COMPARISON 14: save sends only the period + a name (the server freezes its own figures); a saved comparison shows its frozen figures and append-only sign-off notes', async () => {
    compareMock.mockResolvedValue({ preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 0, truncated: false, page: 1, pageSize: 25, totalItems: 0, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 0, ticketsCount: 0, averageTicketCents: null, totalBookings: 0, completed: 0, completionRate: null, branches: 0 }, drilldownRoute: '/tenant/reports/sales', notes: [], branches: [] });
    const sum = { id: 'snap1', title: 'Week 45', preset: 'month', range: null, asOf: '2026-11-06T20:00:00Z', savedBy: 'Pat Owner', savedAt: '2026-11-06T20:00:00Z', branches: 2, financialsIncluded: true, signOffs: 0, lastDecision: null };
    const detail = { ...sum, totals: { netSalesCents: 400000 }, rows: [{ branchId: 'b1', branchName: 'Marlton', netSalesCents: 300000, totalBookings: 70, completed: 60, completionRate: 86 }], signOffList: [], canSignOff: true, immutable: true };
    center.saveBranchSnapshot.mockResolvedValue(detail);
    center.branchSnapshot.mockResolvedValue(detail);
    center.signOffBranchSnapshot.mockResolvedValue({ ...detail, signOffs: 1, lastDecision: 'needs_follow_up', signOffList: [{ id: 's1', decision: 'needs_follow_up', note: 'Ask about no-shows', reviewer: 'Pat Owner', at: '2026-11-07T15:00:00Z' }] });
    render1();
    expect(await screen.findByTestId('bcx-snaps')).toHaveTextContent('No saved comparisons yet');
    center.branchSnapshots.mockResolvedValue({ items: [sum], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });
    fireEvent.click(screen.getByTestId('bcx-snap-save'));
    fireEvent.change(screen.getByTestId('bcx-snap-name'), { target: { value: 'Week 45' } });
    fireEvent.click(screen.getByTestId('bcx-snap-confirm'));
    await waitFor(() => expect(center.saveBranchSnapshot).toHaveBeenCalledWith({ preset: 'month', title: 'Week 45' }));     // no figures sent
    const dlg = await screen.findByTestId('bcx-snap-dlg');
    expect(within(dlg).getByTestId('bcx-snap-frozen')).toHaveTextContent('saved by Pat Owner. They do not change.');
    expect(within(dlg).getByTestId('bcx-snap-trow')).toHaveTextContent(/Marlton\s*\$3,000\.00\s*70\s*60\s*86%/);
    expect(within(dlg).getByTestId('bcx-snap-nosign')).toHaveTextContent('Not signed off yet');
    fireEvent.click(within(dlg).getByTestId('bcx-snap-sign'));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Write a short note');
    expect(center.signOffBranchSnapshot).not.toHaveBeenCalled();
    fireEvent.change(within(dlg).getByTestId('bcx-snap-decision'), { target: { value: 'needs_follow_up' } });
    fireEvent.change(within(dlg).getByTestId('bcx-snap-text'), { target: { value: 'Ask about no-shows' } });
    fireEvent.click(within(dlg).getByTestId('bcx-snap-sign'));
    await waitFor(() => expect(center.signOffBranchSnapshot).toHaveBeenCalledWith('snap1', { decision: 'needs_follow_up', note: 'Ask about no-shows' }));
    expect(await within(dlg).findByTestId('bcx-snap-signoff')).toHaveTextContent(/Needs follow-up\s*Ask about no-shows\s*— Pat Owner/);
    expect(await screen.findAllByTestId('bcx-snap-row')).toHaveLength(1);
  });

  it('AI BRANCH COMPARISON 14: without financial view the saved figures show — and signing off is not offered', async () => {
    compareMock.mockResolvedValue({ preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: false, branchCount: 0, truncated: false, page: 1, pageSize: 25, totalItems: 0, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: null, ticketsCount: null, averageTicketCents: null, totalBookings: 0, completed: 0, completionRate: null, branches: 0 }, drilldownRoute: '/tenant/reports/sales', notes: [], branches: [] });
    const sum = { id: 'snap2', title: null, preset: 'week', range: null, asOf: '2026-11-06T20:00:00Z', savedBy: 'Pat Owner', savedAt: '2026-11-06T20:00:00Z', branches: 1, financialsIncluded: false, signOffs: 1, lastDecision: 'approved' };
    center.branchSnapshots.mockResolvedValue({ items: [sum], page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });
    center.branchSnapshot.mockResolvedValue({ ...sum, totals: {}, rows: [{ branchId: 'b1', branchName: 'Marlton', netSalesCents: null, totalBookings: 70, completed: 60, completionRate: 86 }], signOffList: [], canSignOff: false, immutable: true });
    render1();
    const row = await screen.findByTestId('bcx-snap-row');
    expect(within(row).getByTestId('bcx-snap-last')).toHaveTextContent('Approved');
    fireEvent.click(within(row).getByRole('button'));
    const dlg = await screen.findByTestId('bcx-snap-dlg');
    expect(await within(dlg).findByTestId('bcx-snap-trow')).toHaveTextContent(/Marlton\s*—\s*70/);
    expect(within(dlg).getByTestId('bcx-snap-cannot')).toBeInTheDocument();
    expect(within(dlg).queryByTestId('bcx-snap-signform')).toBeNull();
  });

  it('renders a per-branch row with totals and normalized revenue-per-completed', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 1,
      totals: { netSalesCents: 700000, ticketsCount: 150, averageTicketCents: 4667, totalBookings: 180, completed: 150, completionRate: 83, branches: 2 },
      drilldownRoute: '/tenant/reports/sales', notes: ['Comparison covers only branches you are authorized to view.'],
      branches: [
        { branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100, totalBookings: 120, completed: 100, cancelledPercent: 8, noShowPercent: 5, revenuePerCompletedAppointmentCents: 5000, completionRate: 83 },
        { branchId: 'b2', branchName: 'Deptford', status: 'active', netSalesCents: 200000, averageTicketCents: 4000, ticketsCount: 50, totalBookings: 60, completed: 50, cancelledPercent: 10, noShowPercent: 6, revenuePerCompletedAppointmentCents: 4000, completionRate: 83 },
      ],
    });
    render1();
    expect(await screen.findByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText('Deptford')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00')).toBeInTheDocument(); // avg ticket / rev-per-completed for b1
  });

  it('extras (Nov 11 2026): fewer than 5 bookings is marked a small sample; definitions are one tap away', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 60000, ticketsCount: 13, averageTicketCents: 4615, totalBookings: 14, completed: 12, completionRate: 86, branches: 2 }, drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [
        { branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 50000, averageTicketCents: 5000, ticketsCount: 10, totalBookings: 11, completed: 10, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 5000, completionRate: 91 },
        { branchId: 'b2', branchName: 'Deptford', status: 'active', netSalesCents: 10000, averageTicketCents: 3333, ticketsCount: 3, totalBookings: 3, completed: 2, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 5000, completionRate: 67 },
      ],
    });
    render1();
    await screen.findByText('Deptford');
    const small = screen.getAllByTestId('bcx-small');
    expect(small).toHaveLength(1);
    expect(small[0]).toHaveAttribute('title', expect.stringContaining('Only 3 bookings'));
    expect(screen.getByTestId('bcx-defs')).toHaveTextContent('Completion — Completed ÷ Bookings');
  });

  it('shows dashes for revenue columns when financials are restricted', async () => {
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: false, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: null, ticketsCount: null, averageTicketCents: null, totalBookings: 40, completed: 36, completionRate: 90, branches: 1 },
      drilldownRoute: '/tenant/reports/sales', notes: ['Revenue columns are hidden because you do not have financial-view permission.'],
      branches: [{ branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: null, averageTicketCents: null, ticketsCount: null, totalBookings: 40, completed: 36, cancelledPercent: 5, noShowPercent: 4, revenuePerCompletedAppointmentCents: null, completionRate: 90 }],
    });
    render1();
    expect(await screen.findByText('Marlton')).toBeInTheDocument();
    expect(screen.getByText(/do not have financial-view/i)).toBeInTheDocument();
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0); // operational column still present
  });
  it('guide: totals strip, N/A for a branch with no bookings, search / period / inactive go to the server, a row opens its figures', async () => {
    const { fireEvent } = await import('@testing-library/react');
    compareMock.mockResolvedValue({
      preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 2,
      totals: { netSalesCents: 0, ticketsCount: 0, averageTicketCents: null, totalBookings: 0, completed: 0, completionRate: null, branches: 1 },
      drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [{ branchId: 'b3', branchName: 'Cherry Hill', status: 'active', netSalesCents: 0, averageTicketCents: null, ticketsCount: 0, totalBookings: 0, completed: 0, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: null, completionRate: null }],
    });
    render1();
    expect(await screen.findByText('Cherry Hill')).toBeInTheDocument();
    expect(screen.getByTestId('bcx-completion')).toHaveTextContent('N/A');
    expect(screen.getByTestId('bcx-k-branches')).toHaveTextContent('2 inactive hidden');
    fireEvent.change(screen.getByTestId('bcx-search'), { target: { value: 'cherry' } });
    fireEvent.submit(screen.getByTestId('bcx-search').closest('form')!);
    fireEvent.click(screen.getByTestId('bcx-preset-quarter'));
    fireEvent.click(screen.getByTestId('bcx-inactive'));
    expect(compareMock).toHaveBeenLastCalledWith({ preset: 'quarter', q: 'cherry', includeInactive: 'true', page: 1, pageSize: 25 });
    fireEvent.click(screen.getByTestId('bcx-row'));
    expect(await screen.findByTestId('bcx-detail')).toHaveTextContent('Cherry Hill');
  });
  it('AI BRANCH COMPARISON 08: the previous-period toggle asks the server, names both periods and shows the change per KPI and branch', async () => {
    const base = { preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 500000, ticketsCount: 100, averageTicketCents: 5000, totalBookings: 20, completed: 18, completionRate: 90, branches: 1 }, drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [{ branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100, totalBookings: 20, completed: 18, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 27778, completionRate: 90 }] };
    compareMock.mockReset().mockImplementation(async (q: any) => (q.compare === 'prior' ? { ...base, comparison: { basis: 'previous_equal_period', preset: 'month', range: null, priorRange: null,
      totals: { netSalesCents: 450000, ticketsCount: 90, totalBookings: 25, completed: 20, completionRate: 80 }, byBranch: { b1: { netSalesCents: 450000, ticketsCount: 90, totalBookings: 25, completed: 20, completionRate: 80 } } } } : base));
    render1();
    await screen.findAllByTestId('bcx-row');
    expect(screen.queryByTestId('bcx-compare-basis')).toBeNull();
    expect(compareMock.mock.calls[0][0].compare).toBeUndefined();
    fireEvent.click(screen.getByTestId('bcx-compare'));
    expect(await screen.findByTestId('bcx-compare-basis')).toHaveTextContent('compared with last month, the 1st to the same day');
    expect(compareMock).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'month', compare: 'prior' }));
    expect(screen.getByTestId('bcx-k-net')).toHaveTextContent('+$500.00 vs previous');
    expect(screen.getByTestId('bcx-k-bookings')).toHaveTextContent('−5 vs previous');
    expect(screen.getByTestId('bcx-k-completion')).toHaveTextContent('+10 pts vs previous');
    expect(screen.getByTestId('bcx-d-net')).toHaveTextContent('+$500.00');
    expect(screen.getByTestId('bcx-d-bookings')).toHaveTextContent('−5');
    fireEvent.click(screen.getByTestId('bcx-compare'));
    await screen.findAllByTestId('bcx-row');
    expect(screen.queryByTestId('bcx-d-net')).toBeNull();
  });
});

describe('AI BRANCH COMPARISON 01 — comparison readiness', () => {
  const base = { preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 1, truncated: false, page: 1, pageSize: 25, totalItems: 1, totalPages: 1, inactiveHidden: 0,
    totals: { netSalesCents: 500000, ticketsCount: 100, averageTicketCents: 5000, totalBookings: 20, completed: 18, completionRate: 90, branches: 1 }, drilldownRoute: '/tenant/reports/sales', notes: [],
    branches: [{ branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 500000, averageTicketCents: 5000, ticketsCount: 100, totalBookings: 20, completed: 18, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 27778, completionRate: 90 }] };
  it('shows the server readiness before the table: level, coverage over all matched branches, live as-of, and each reason', async () => {
    compareMock.mockReset().mockResolvedValue({ ...base, readiness: { level: 'limited', coveragePercent: 67, branches: 3, withActivity: 2, noActivity: 1, smallSample: 1, financialCoverage: true, partialPeriod: false, source: 'live_reports', asOf: '2026-11-03T18:00:00Z', reasons: ['branch_without_activity', 'small_sample'] } });
    render1();
    const r = await screen.findByTestId('bcx-ready');
    expect(r).toHaveAttribute('data-level', 'limited');
    expect(r).toHaveTextContent('Compare with care');
    expect(screen.getByTestId('bcx-ready-cov')).toHaveTextContent('2 of 3 branches had bookings or sales in this period (67%)');
    expect(screen.getByTestId('bcx-ready-why')).toHaveTextContent('1 branch(es) had no bookings or sales · 1 branch(es) had fewer than 5 bookings');
    expect(r.compareDocumentPosition(await screen.findByTestId('bcx-table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();   // before the ranking table
  });
  it('not ready says rankings mean nothing; an older server without readiness shows nothing', async () => {
    compareMock.mockReset().mockResolvedValue({ ...base, readiness: { level: 'not_ready', coveragePercent: 50, branches: 2, withActivity: 1, noActivity: 1, smallSample: 0, financialCoverage: true, partialPeriod: false, source: 'live_reports', asOf: '2026-11-03T18:00:00Z', reasons: ['too_few_with_activity', 'branch_without_activity'] } });
    const v = render1();
    expect(await screen.findByTestId('bcx-ready')).toHaveTextContent('Not enough data to compare');
    expect(screen.getByTestId('bcx-ready-why')).toHaveTextContent('rankings would mean nothing');
    v.unmount();
    compareMock.mockReset().mockResolvedValue(base);
    render1();
    await screen.findAllByTestId('bcx-row');
    expect(screen.queryByTestId('bcx-ready')).toBeNull();
  });
});

describe('AI Business Assistant 09 — multi-branch fairness notes', () => {
  it('a branch opens with its share of the salon totals and the denominators, plus the larger-branch note; N/A when the total is 0', async () => {
    const base = { preset: 'month', range: null, asOf: '2026-11-03T18:00:00Z', partialCurrentPeriod: false, financialsIncluded: true, branchCount: 2, truncated: false, page: 1, pageSize: 25, totalItems: 2, totalPages: 1, inactiveHidden: 0,
      totals: { netSalesCents: 800000, ticketsCount: 160, averageTicketCents: 5000, totalBookings: 200, completed: 180, completionRate: 90, branches: 2 }, drilldownRoute: '/tenant/reports/sales', notes: [],
      branches: [{ branchId: 'b1', branchName: 'Marlton', status: 'active', netSalesCents: 600000, averageTicketCents: 5000, ticketsCount: 120, totalBookings: 150, completed: 135, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 4444, completionRate: 90 },
        { branchId: 'b2', branchName: 'Deptford', status: 'active', netSalesCents: 200000, averageTicketCents: 5000, ticketsCount: 40, totalBookings: 50, completed: 45, cancelledPercent: 0, noShowPercent: 0, revenuePerCompletedAppointmentCents: 4444, completionRate: 90 }] };
    compareMock.mockReset().mockResolvedValue(base);
    const v = render1();
    fireEvent.click((await screen.findAllByTestId('bcx-row'))[1]);
    const d = await screen.findByTestId('bcx-detail');
    expect(within(d).getByTestId('bcx-share-net')).toHaveTextContent('25% of $8,000.00');
    expect(within(d).getByTestId('bcx-share-bookings')).toHaveTextContent('25% (50 of 200)');
    expect(within(d).getByTestId('bcx-fair-note')).toHaveTextContent('totals over all 2 branches');
    expect(within(d).getByTestId('bcx-fair-note')).toHaveTextContent('naturally has higher totals');
    expect(screen.getByTestId('bcx-defs')).toHaveTextContent('Fairness');
    v.unmount();
    compareMock.mockReset().mockResolvedValue({ ...base, totals: { ...base.totals, netSalesCents: 0, totalBookings: 0 } });
    render1();
    fireEvent.click((await screen.findAllByTestId('bcx-row'))[0]);
    expect(await screen.findByTestId('bcx-share-net')).toHaveTextContent('N/A');
    expect(screen.getByTestId('bcx-share-bookings')).toHaveTextContent('N/A');
  });
});
