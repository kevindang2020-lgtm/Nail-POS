// POSAiReportsScreen — AI Business Reports guide (Nov 3 2026): the four buttons ask for a period; history with search, filters, dates and
// pages; "completed" and "content expired" shown apart; View with labelled figures; Verify Numbers; Regenerate; the system check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { reportSummary: vi.fn(), reports: vi.fn(), report: vi.fn(), generate: vi.fn(), regenerate: vi.fn(), verify: vi.fn(), compare: vi.fn(), reportCheck: vi.fn(), schedules: vi.fn(), saveSchedule: vi.fn(), executive: vi.fn() } }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { center: c } }));
import { POSAiReportsScreen } from './POSAiReportsScreen';
const row = (o: any = {}) => ({ id: 'r1', reportType: 'monthly_review', preset: 'month', status: 'completed', availability: 'viewable', period: { preset: 'month', from: '2026-11-01', to: '2026-11-03', timeZone: 'America/New_York', partial: true },
  createdAt: '2026-11-03T14:00:00Z', completedAt: '2026-11-03T14:00:02Z', requestedBy: 'Owner Kim', error: null, ...o });
const wrap = () => render(<MemoryRouter><POSAiReportsScreen /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  c.reportSummary.mockResolvedValue({ total: 9, queued: 0, running: 1, failed: 0, viewable: 3, contentExpired: 5, stuck: 0, contentDays: 7 });
  c.reports.mockResolvedValue({ items: [row(), row({ id: 'r2', reportType: 'daily_brief', preset: 'today', availability: 'content_expired', period: null })], total: 2, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
  const sch = (o: any = {}) => ({ items: [
    { id: null, reportType: 'daily_brief', preset: 'yesterday', when: 'every_day', sendHour: 7, active: false, notifyInApp: true, lastRunAt: null, lastStatus: null, lastReason: null, lastReportId: null, timeZone: 'America/New_York', ...(o.daily ?? {}) },
    { id: null, reportType: 'weekly_summary', preset: 'week', when: 'sunday', sendHour: 21, active: false, notifyInApp: true, lastRunAt: null, lastStatus: null, lastReason: null, lastReportId: null, timeZone: 'America/New_York' },
    { id: null, reportType: 'monthly_review', preset: 'month', when: 'last_day_of_month', sendHour: 21, active: false, notifyInApp: true, lastRunAt: null, lastStatus: null, lastReason: null, lastReportId: null, timeZone: 'America/New_York' }],
    timeZone: 'America/New_York', note: '' });
  c.schedules.mockResolvedValue(sch());
  c.saveSchedule.mockImplementation(async (b: any) => sch({ daily: { id: 's1', active: b.active, sendHour: b.sendHour, lastStatus: 'generated', lastRunAt: '2026-11-12T12:00:00Z' } }));
  c.report.mockResolvedValue({ ...row(), headline: [{ key: 'net_sales', value: 412500, unit: 'cents' }, { key: 'paid_tickets', value: 61, unit: 'count' }], sections: ['revenue', 'appointments'], content: { revenue: {} } });
});

describe('POSAiReportsScreen', () => {
  it('AI Business Reports 14: my automated reports — defaults off with when / for which period; turning one on and changing the hour is saved on the server; the last run is shown', async () => {
    wrap();
    const d = await screen.findByTestId('bzx-sch-daily_brief');
    expect(d).toHaveTextContent('Every day, for Yesterday');
    expect(screen.getByTestId('bzx-sch-weekly_summary')).toHaveTextContent('Every Sunday, for This week');
    expect(screen.getByTestId('bzx-sch-monthly_review')).toHaveTextContent('On the last day of each month, for This month');
    expect(screen.getByTestId('bzx-sch-last-daily_brief')).toHaveTextContent('Not made yet');
    expect(screen.getByTestId('bzx-sch')).toHaveTextContent(/America\/New_York time/);
    fireEvent.click(screen.getByTestId('bzx-sch-toggle-daily_brief'));
    expect(c.saveSchedule).toHaveBeenCalledWith({ reportType: 'daily_brief', active: true, sendHour: 7 });
    expect(await screen.findByTestId('bzx-sch-last-daily_brief')).toHaveTextContent(/Last made/);
    expect(screen.getByTestId('bzx-sch-toggle-daily_brief')).toHaveTextContent('On');
    fireEvent.change(screen.getByTestId('bzx-sch-hour-daily_brief'), { target: { value: '6' } });
    expect(c.saveSchedule).toHaveBeenLastCalledWith({ reportType: 'daily_brief', active: true, sendHour: 6 });
  });
  it('AI Business Reports 15: Executive summary shows the verified figures with their check and the growth proposals to review (from the server)', async () => {
    c.executive.mockResolvedValue({ id: 'r1', available: true, reportType: 'monthly_review', period: null, verification: { status: 'changed', reason: 'source_changed_since', checkedAt: '' }, changesAnything: false,
      facts: [{ key: 'net_sales', value: 412500, unit: 'cents', source: 'sales_report_snapshot', check: 'changed_since', salesReportNow: 415000 }, { key: 'bookings', value: 12, unit: 'count', source: 'report_section', check: 'not_checkable', salesReportNow: null }],
      opportunities: [{ kind: 'new_customers', basis: { newCustomers: 5, trendPercent: -30 }, route: '/tenant/marketing/referrals', status: 'proposed', ownerReview: true }] });
    wrap();
    fireEvent.click((await screen.findAllByTestId('bzx-r-open'))[0]);
    fireEvent.click(await screen.findByTestId('bzx-exec'));
    expect(await screen.findByTestId('bzx-exec-fact-net_sales')).toHaveTextContent(/\$4,125\.00.*Changed since — the Sales Report now shows \$4,150\.00/);
    expect(screen.getByTestId('bzx-exec-fact-bookings')).toHaveTextContent('From the report; not re-checkable');
    expect(screen.getByTestId('bzx-exec-opp-new_customers')).toHaveTextContent('New customers are down 30% (5 this period)');
    expect(screen.getByTestId('bzx-exec-result')).toHaveTextContent(/Nothing is changed, sent or started from here/);
    expect(c.executive).toHaveBeenCalledWith('r1');
  });
  it('cards are backend counts; completed and content-expired are shown apart', async () => {
    wrap();
    expect(await screen.findByTestId('bzx-r-expired')).toHaveTextContent('5');
    expect(screen.getByTestId('bzx-r-processing')).toHaveTextContent('1');
    const rows = await screen.findAllByTestId('bzx-r-row');
    expect(rows[0]).toHaveTextContent('Monthly review');
    expect(rows[0]).toHaveTextContent('Content available');
    expect(rows[1]).toHaveTextContent('Completed');
    expect(within(rows[1]).getByTestId('bzx-r-avail')).toHaveTextContent('Content no longer shown (7-day window)');
  });
  it('the four buttons stay; each asks for its period and the new report opens', async () => {
    c.generate.mockResolvedValue({ id: 'r9' });
    wrap();
    for (const t of ['daily_brief', 'weekly_summary', 'monthly_review', 'branch_comparison']) expect(screen.getByTestId(`bzx-gen-${t}`)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bzx-gen-daily_brief'));
    fireEvent.click(screen.getByTestId('bzx-gen-p-yesterday'));
    fireEvent.click(screen.getByTestId('bzx-gen-go'));
    expect(await screen.findByTestId('bzx-report')).toBeInTheDocument();
    expect(c.generate).toHaveBeenCalledWith('daily_brief', 'yesterday');
    expect(c.report).toHaveBeenCalledWith('r9');
  });
  it('search, type, status and the generated-date preset go to the server; pages reset', async () => {
    wrap();
    await screen.findAllByTestId('bzx-r-row');
    fireEvent.change(screen.getByTestId('bzx-r-search'), { target: { value: 'monthly' } });
    fireEvent.submit(screen.getByTestId('bzx-r-search').closest('form')!);
    fireEvent.change(screen.getByTestId('bzx-r-status'), { target: { value: 'content_expired' } });
    fireEvent.click(screen.getByTestId('bzx-preset-last_30'));
    expect(c.reports).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'monthly', status: 'content_expired', preset: 'last_30', page: 1, pageSize: 25, sort: 'newest' }));
  });
  it('View: the exact days, labelled figures; Verify shows each figure against the Sales Report', async () => {
    c.verify.mockResolvedValue({ status: 'changed', reason: 'period_was_in_progress', items: [{ metric: 'netSalesCents', inReport: 412500, salesReportNow: 430000, difference: 17500, matched: false }, { metric: 'ticketsCount', inReport: 61, salesReportNow: 61, difference: 0, matched: true }], sourceRoute: '/tenant/reports/sales' });
    wrap();
    fireEvent.click((await screen.findAllByTestId('bzx-r-open'))[0]);
    expect(await screen.findByTestId('bzx-report-meta')).toHaveTextContent('America/New_York');
    expect(screen.getByTestId('bzx-headline')).toHaveTextContent('Net sales');
    expect(screen.getByTestId('bzx-headline')).toHaveTextContent('$4,125.00');
    fireEvent.click(screen.getByTestId('bzx-verify'));
    expect(await screen.findByTestId('bzx-verify-result')).toHaveTextContent('Changed since the report was generated.');
    expect(screen.getByTestId('bzx-v-netSalesCents')).toHaveTextContent('$175.00');
    expect(screen.getByTestId('bzx-v-ticketsCount')).toHaveTextContent('✓');
  });
  it('a failed list is an error with retry, never "no reports yet"', async () => {
    c.reports.mockRejectedValue({ status: 500 });
    wrap();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByText('No reports yet — generate one above.')).toBeNull();
  });
  it('AI Business Assistant 10: What changed since… splits each difference into data corrections and the business change (from the server)', async () => {
    c.compare.mockResolvedValue({ status: 'compared', reason: null, samePeriod: false, older: { id: 'r3', period: null, snapshotTakenAt: null }, newer: { id: 'r1', period: null, snapshotTakenAt: null }, checkedAt: 'x',
      items: [{ metric: 'netSalesCents', olderInReport: 400000, olderNow: 401000, newerInReport: 412500, dataCorrection: 1000, businessChange: 11500 }, { metric: 'ticketsCount', olderInReport: 60, olderNow: 60, newerInReport: 61, dataCorrection: 0, businessChange: 1 }] });
    c.reports.mockResolvedValueOnce({ items: [row(), row({ id: 'r3', reportType: 'monthly_review' })], total: 2, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } })
      .mockResolvedValueOnce({ items: [row(), row({ id: 'r3' })], total: 2, page: 1, pageSize: 25, totalPages: 1 });
    wrap();
    fireEvent.click((await screen.findAllByTestId('bzx-r-open'))[0]);
    fireEvent.click(await screen.findByTestId('bzx-compare'));
    const pick = await screen.findByTestId('bzx-compare-pick');
    await within(pick).findByText(/Monthly/);
    expect(within(pick).getAllByRole('option')).toHaveLength(2);   // '—' + the other report (never itself)
    fireEvent.change(pick, { target: { value: 'r3' } });
    expect(await screen.findByTestId('bzx-compare-result')).toHaveTextContent('Business change = the newer report vs those corrected days.');
    expect(c.compare).toHaveBeenCalledWith('r1', 'r3');
    expect(screen.getByTestId('bzx-cmp-netSalesCents').textContent).toBe('Net sales$4,000.00$10.00$4,125.00$115.00');
    expect(screen.getByTestId('bzx-cmp-ticketsCount').textContent).toContain('✓');
  });
});
