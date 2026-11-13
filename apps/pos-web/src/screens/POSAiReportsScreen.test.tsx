// POSAiReportsScreen — AI Business Reports guide (Nov 3 2026): the four buttons ask for a period; history with search, filters, dates and
// pages; "completed" and "content expired" shown apart; View with labelled figures; Verify Numbers; Regenerate; the system check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { c } = vi.hoisted(() => ({ c: { reportSummary: vi.fn(), reports: vi.fn(), report: vi.fn(), generate: vi.fn(), regenerate: vi.fn(), verify: vi.fn(), compare: vi.fn(), reportCheck: vi.fn() } }));
vi.mock('../api/posAiBusinessApi', () => ({ posAiBusinessApi: { center: c } }));
import { POSAiReportsScreen } from './POSAiReportsScreen';
const row = (o: any = {}) => ({ id: 'r1', reportType: 'monthly_review', preset: 'month', status: 'completed', availability: 'viewable', period: { preset: 'month', from: '2026-11-01', to: '2026-11-03', timeZone: 'America/New_York', partial: true },
  createdAt: '2026-11-03T14:00:00Z', completedAt: '2026-11-03T14:00:02Z', requestedBy: 'Owner Kim', error: null, ...o });
const wrap = () => render(<MemoryRouter><POSAiReportsScreen /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  c.reportSummary.mockResolvedValue({ total: 9, queued: 0, running: 1, failed: 0, viewable: 3, contentExpired: 5, stuck: 0, contentDays: 7 });
  c.reports.mockResolvedValue({ items: [row(), row({ id: 'r2', reportType: 'daily_brief', preset: 'today', availability: 'content_expired', period: null })], total: 2, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
  c.report.mockResolvedValue({ ...row(), headline: [{ key: 'net_sales', value: 412500, unit: 'cents' }, { key: 'paid_tickets', value: 61, unit: 'count' }], sections: ['revenue', 'appointments'], content: { revenue: {} } });
});

describe('POSAiReportsScreen', () => {
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
