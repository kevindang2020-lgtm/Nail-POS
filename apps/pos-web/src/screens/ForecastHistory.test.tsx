// ForecastHistory.test — AI Analytics & Forecasting guide (Nov 2 2026): the forecast history (search, type, status, presets, custom
// range, pages, newest first), forecast vs actual, and the read-only system check with part + last success on every check.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { sumMock, runsMock, runMock, checkMock } = vi.hoisted(() => ({ sumMock: vi.fn(), runsMock: vi.fn(), runMock: vi.fn(), checkMock: vi.fn() }));
vi.mock('../api/posAiForecastingApi', () => ({ posAiForecastingApi: { center: { summary: sumMock, runs: runsMock, run: runMock, check: checkMock } } }));
import { ForecastHistory, ForecastCheckButton } from './ForecastHistory';

const RUN = { runId: '77760000-0000-4000-8000-000000000101', domain: 'appointments', model: 'seasonal_naive', modelVersion: 'forecast-v1', branch: 'Main', product: null,
  generatedAt: '2026-10-01T15:00:00.000Z', days: 7, firstDay: '2026-10-02', lastDay: '2026-10-08', status: 'evaluated', matured: 7, realized: 7, wape: 0.2308, coverage: 0.4286, backtestWape: 0.2 };
const page = (items: any[], o: any = {}) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, domains: ['appointments', 'revenue', 'product_demand'], period: { today: '2026-11-02' }, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  sumMock.mockResolvedValue({ counters: { runs: 3, runs30d: 2, awaitingActual: 2, evaluatedDays: 7 }, lastRun: { appointments: '2026-10-31T15:00:00.000Z', revenue: null }, domains: ['appointments', 'revenue'] });
  runsMock.mockResolvedValue(page([RUN, { ...RUN, runId: 'r2', domain: 'revenue', status: 'awaiting', realized: 0, wape: null, coverage: null }]));
});

describe('Forecast history', () => {
  it('FH-UI-01 counters, rows newest first with status, error and coverage; never-run type says never', async () => {
    render(<ForecastHistory />);
    const rows = await screen.findAllByTestId('fch-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('23.1%');
    expect(rows[0]).toHaveTextContent('42.9%');
    expect(within(rows[0]).getByTestId('fch-status-chip')).toHaveTextContent('Fully compared');
    expect(within(rows[1]).getByTestId('fch-status-chip')).toHaveTextContent('Waiting for actuals');
    expect(rows[1]).toHaveTextContent('—');
    expect(screen.getByTestId('fch-kpi-awaiting')).toHaveTextContent('2');
    expect(screen.getByTestId('fch-lastrun')).toHaveTextContent('Revenue: never');
    expect(runsMock).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'newest', page: 1, pageSize: 25 }));
  });
  it('FH-UI-02 search, type, status, preset, rows per page and pages reach the server; Clear resets', async () => {
    runsMock.mockResolvedValue(page([RUN], { total: 60, totalPages: 3 }));
    render(<ForecastHistory />);
    await screen.findAllByTestId('fch-row');
    fireEvent.change(screen.getByTestId('fch-search'), { target: { value: 'seasonal' } });
    fireEvent.submit(screen.getByTestId('fch-search').closest('form')!);
    await waitFor(() => expect(runsMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'seasonal' })));
    fireEvent.change(screen.getByTestId('fch-type'), { target: { value: 'revenue' } });
    fireEvent.change(screen.getByTestId('fch-status'), { target: { value: 'awaiting' } });
    fireEvent.click(screen.getByTestId('fch-preset-last_30'));
    await waitFor(() => expect(runsMock).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'seasonal', domain: 'revenue', status: 'awaiting', preset: 'last_30', page: 1 })));
    fireEvent.change(screen.getByTestId('fch-rows'), { target: { value: '50' } });
    await waitFor(() => expect(runsMock).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50 })));
    fireEvent.click(screen.getByTestId('fch-clear'));
    await waitFor(() => expect(runsMock).toHaveBeenLastCalledWith(expect.objectContaining({ domain: 'all', status: 'all', q: undefined })));
  });
  it('FH-UI-03 empty: no forecasts says why; filtered says no match; a load failure is an error, not "no forecasts"', async () => {
    runsMock.mockResolvedValue(page([]));
    const { unmount } = render(<ForecastHistory />);
    expect(await screen.findByText(/No forecast has been kept yet/)).toBeInTheDocument();
    unmount();
    runsMock.mockRejectedValue({ status: 500, message: 'x' });
    render(<ForecastHistory />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No forecast has been kept yet/)).toBeNull();
  });
  it('FH-UI-04 a refused range shows the guide text', async () => {
    render(<ForecastHistory />);
    await screen.findAllByTestId('fch-row');
    runsMock.mockRejectedValue({ status: 400, code: 'FC_INVALID_PERIOD' });
    fireEvent.click(screen.getByTestId('fch-preset-today'));
    expect(await screen.findByText(/From date must be on or before the To date/)).toBeInTheDocument();
  });
  it('FH-UI-05 View: forecast vs actual per day; a day not yet compared says so', async () => {
    runMock.mockResolvedValue({ run: RUN, days: [
      { step: 1, date: '2026-10-02', forecast: 10, lower: 8, upper: 12, actual: 10, error: 0, inside: true, state: 'evaluated' },
      { step: 2, date: '2026-10-03', forecast: 10, lower: 8, upper: 12, actual: null, error: null, inside: null, state: 'awaiting' },
    ] });
    render(<ForecastHistory />);
    fireEvent.click((await screen.findAllByTestId('fch-view'))[0]);
    const days = await screen.findAllByTestId('fch-day');
    expect(runMock).toHaveBeenCalledWith(RUN.runId);
    expect(days[0]).toHaveTextContent('Yes');
    expect(days[1]).toHaveTextContent('Waiting for actual');
    expect(screen.getByTestId('fch-run')).toHaveTextContent('Backtest error at the time: 20.0%');
  });
});

describe('Check AI Analytics & Forecasting System', () => {
  it('HL-UI-01 shows every check with its part, what it means and when it last passed; read-only note', async () => {
    checkMock.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-02T15:00:00.000Z', reused: false, checks: [
      { key: 'duplicate_appointments', component: 'data_quality', state: 'WARNING', count: 2, lastPassedAt: null },
      { key: 'backtest', component: 'model', state: 'PASSED', count: 0, lastPassedAt: '2026-11-02T15:00:00.000Z' },
    ] });
    render(<ForecastCheckButton />);
    fireEvent.click(screen.getByTestId('fch-check'));
    const dup = await screen.findByTestId('fch-chk-duplicate_appointments');
    expect(dup).toHaveTextContent('Duplicate appointments');
    expect(dup).toHaveTextContent(/booked twice with the same technician/);
    expect(dup).toHaveTextContent('Part: Appointment data quality');
    expect(dup).toHaveTextContent('Has not passed yet');
    expect(screen.getByTestId('fch-chk-backtest')).toHaveTextContent(/Last passed:/);
    expect(screen.getByTestId('fch-health')).toHaveTextContent(/Read-only/);
  });
  it('HL-UI-02 a failed check request is shown as an error, never as a pass', async () => {
    checkMock.mockRejectedValue({ status: 403 });
    render(<ForecastCheckButton />);
    fireEvent.click(screen.getByTestId('fch-check'));
    expect(await screen.findByText(/cannot see the forecast history/)).toBeInTheDocument();
  });
});
