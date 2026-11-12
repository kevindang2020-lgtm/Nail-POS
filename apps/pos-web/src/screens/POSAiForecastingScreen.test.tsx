import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { apptMock, revMock, nsMock, accMock, readyMock } = vi.hoisted(() => ({ apptMock: vi.fn(), revMock: vi.fn(), nsMock: vi.fn(), accMock: vi.fn(), readyMock: vi.fn() }));
vi.mock('../api/posAiForecastingApi', () => ({ posAiForecastingApi: { appointments: apptMock, revenue: revMock, noShowRisk: nsMock, accuracy: accMock, readiness: readyMock,
  center: { summary: vi.fn().mockResolvedValue({ counters: { runs: 0, runs30d: 0, awaitingActual: 0, evaluatedDays: 0 }, lastRun: {}, domains: ['appointments'] }), runs: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 1, domains: ['appointments'] }), run: vi.fn(), check: vi.fn() } } }));
import { POSAiForecastingScreen } from './POSAiForecastingScreen';

const horizon = (v: number) => Array.from({ length: 3 }, (_, i) => ({ step: i + 1, date: `2026-03-0${i + 1}`, point: v, lower: v - 2, upper: v + 2 }));

beforeEach(() => {
  readyMock.mockResolvedValue({ appointments: { historyDays: 30, minimum: 14, ready: true, daysShort: 0 }, revenue: { historyDays: 30, minimum: 14, ready: true, daysShort: 0 }, sources: { appointments: 'booking_calendar', revenue: 'sales_report' } });
  apptMock.mockResolvedValue({ method: 'seasonal_naive', confidence: 'high', dataQuality: 'healthy', horizonDays: 3, accuracy: { wape: 0.12, folds: 30 }, horizon: horizon(20), selectionReason: 'lowest WAPE', disclaimer: 'decision-support' });
  revMock.mockResolvedValue({ method: 'holt_linear', confidence: 'moderate', dataQuality: 'healthy', horizonDays: 3, accuracy: null, forecastTotalCents: 90000, horizon: horizon(30000).map((h) => ({ step: h.step, date: h.date, pointCents: 30000, lowerCents: 28000, upperCents: 32000 })), selectionReason: 'x', disclaimer: 'not guaranteed income' });
  nsMock.mockResolvedValue({ modelVersion: 'v1', disclaimer: 'no sensitive attributes', items: [
    { appointmentId: 'a1', customerName: 'Jane', startTime: '2026-07-10T15:00:00.000Z', level: 'high', confidence: 'moderate', score: 0.5, reasons: [{ label: 'Not confirmed' }], permittedActions: ['Request customer confirmation'] },
  ] });
  accMock.mockResolvedValue({ domain: 'appointments', evaluated: 12, mae: 3.2, wape: 0.11, coverage: 0.83, modelVersion: 'forecast-v1', note: 'ok' });
});

describe('POSAiForecastingScreen', () => {
  it('renders the appointment forecast with model + accuracy', async () => {
    render(<POSAiForecastingScreen />);
    expect(await screen.findByText('Seasonal naive')).toBeInTheDocument();
    expect(screen.getByText('12.0%')).toBeInTheDocument(); // backtest WAPE
    expect(await screen.findByText('Tracked accuracy')).toBeInTheDocument();
    expect(await screen.findByText('11.0%')).toBeInTheDocument(); // realized WAPE strip
  });

  it('extras row 08: each day is a tappable / focusable point read out as text, a trend sentence summarizes the chart, and a full-screen view keeps every point', async () => {
    apptMock.mockResolvedValue({ method: 'seasonal_naive', confidence: 'high', dataQuality: 'healthy', horizonDays: 3, accuracy: { wape: 0.12, folds: 30 },
      horizon: [{ step: 1, date: '2026-03-01', point: 18, lower: 15, upper: 21 }, { step: 2, date: '2026-03-02', point: 25, lower: 20, upper: 30 }, { step: 3, date: '2026-03-03', point: 22, lower: 18, upper: 27 }], selectionReason: 'lowest WAPE', disclaimer: 'decision-support' });
    render(<POSAiForecastingScreen />);
    await screen.findByText('Seasonal naive');
    expect(screen.getByTestId('fc-trend')).toHaveTextContent('From 2026-03-01 to 2026-03-03 the forecast rises from 18 to 22; the highest day is 2026-03-02 at 25. The 80% range across the period runs from 15 to 30.');
    const pts = screen.getAllByTestId('fc-point');
    expect(pts).toHaveLength(3);
    expect(pts[1].getAttribute('aria-label')).toBe('2026-03-02: forecast 25 (80% range 20 – 30)');
    expect(screen.getByTestId('fc-point-readout')).toHaveTextContent('Tap or focus a point');
    fireEvent.click(pts[1]);
    expect(screen.getByTestId('fc-point-readout')).toHaveTextContent('2026-03-02: forecast 25 (80% range 20 – 30)');
    fireEvent.keyDown(pts[2], { key: 'Enter' });
    expect(screen.getByTestId('fc-point-readout')).toHaveTextContent('2026-03-03: forecast 22');
    fireEvent.click(screen.getByTestId('fc-fullscreen'));
    const full = await screen.findByTestId('fc-full');
    expect(full.querySelectorAll('[data-testid="fc-point"]')).toHaveLength(3);
  });

  it('switches to the No-Show risk tab and shows non-punitive actions', async () => {
    render(<POSAiForecastingScreen />);
    await screen.findByText('Seasonal naive');
    fireEvent.click(screen.getByText('No-Show Risk'));
    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText(/Request customer confirmation/)).toBeInTheDocument();
  });
  it('shows how much verified history each forecast has — the number the forecast is refused on (AI Analytics & Forecasting guide, Nov 2026)', async () => {
    apptMock.mockRejectedValue({ status: 422, message: 'Need at least 14 days' }); accMock.mockResolvedValue({ evaluated: 0 });
    readyMock.mockResolvedValue({ appointments: { domain: 'appointments', historyDays: 9, minimum: 14, ready: false, daysShort: 5, firstDay: '2026-10-24', lastDay: '2026-11-01', zeroDays: 2 },
      revenue: { domain: 'revenue', restricted: true }, sources: { appointments: 'booking_calendar', revenue: 'sales_report' } });
    render(<POSAiForecastingScreen />);
    // SUNMI addendum (Nov 8 2026): the six readiness cards of the selected mode — real numbers only
    expect(await screen.findByTestId('fcx-r-available')).toHaveTextContent('9 days');
    expect(screen.getByTestId('fcx-r-available')).toHaveTextContent('from 2026-10-24');
    expect(screen.getByTestId('fcx-r-required')).toHaveTextContent('14 days');
    expect(screen.getByTestId('fcx-r-valid')).toHaveTextContent('7 days');   // 9 days, 2 of them with no record
    expect(screen.getByTestId('fcx-r-ready')).toHaveTextContent(/Not ready.*5 more day\(s\) needed/);
    expect(screen.getByTestId('fcx-r-quality')).toHaveTextContent(/2 days with no records.*Last record 2026-11-01/);
    expect(screen.getByTestId('fcx-r-last')).toHaveTextContent(/Never/i);
    expect(screen.getByTestId('fcx-readiness')).toHaveTextContent(/booking calendar/);
    expect(screen.getByTestId('fcx-ready-cards').children).toHaveLength(6);
    // Revenue: a role without the financial permission is told so, not shown zeros
    fireEvent.click(screen.getByRole('button', { name: /^Revenue$/ }));
    expect(await screen.findByTestId('fcx-restricted')).toHaveTextContent(/cannot see revenue/);
  });
  it('extras AI Analytics Forecasting 03: the server\'s workload-vs-technician-hours gap is shown per day, read-only, with a link to the Scheduling Optimizer', async () => {
    window.history.replaceState(null, '', '/');   // an earlier test left ?tab=noshow in the address
    apptMock.mockResolvedValue({ method: 'seasonal_naive', confidence: 'high', dataQuality: 'healthy', horizonDays: 2, accuracy: null, horizon: horizon(10).slice(0, 2), selectionReason: 'x', disclaimer: 'd',
      capacity: { avgAppointmentMinutes: 45, durationSample: 120, durationWindowDays: 56, basis: 'b', days: [
        { date: '2026-03-01', expectedMinutes: 540, lowerMinutes: 450, upperMinutes: 630, scheduledMinutes: 420, technicians: 1, gapMinutes: -120, state: 'short' },
        { date: '2026-03-02', expectedMinutes: 300, lowerMinutes: 240, upperMinutes: 360, scheduledMinutes: 660, technicians: 2, gapMinutes: 360, state: 'ok' }] } });
    render(<POSAiForecastingScreen />);
    const panel = await screen.findByTestId('fc-cap');
    expect(screen.getByTestId('fc-cap-basis')).toHaveTextContent('One appointment ≈ 45 min (average of 120 booked appointments, last 56 days).');
    expect(screen.getByTestId('fc-cap-summary')).toHaveTextContent('1 of 2 days may need more technician hours than are scheduled.');
    const rows = screen.getAllByTestId('fc-cap-row');
    expect(rows[0]).toHaveTextContent('9 h'); expect(rows[0]).toHaveTextContent('7 h'); expect(rows[0]).toHaveTextContent('−2 h'); expect(rows[0]).toHaveTextContent('Short');
    expect(rows[1]).toHaveTextContent('+6 h'); expect(rows[1]).toHaveTextContent('Covered'); expect(rows[1]).toHaveTextContent('2 technicians');
    expect(screen.getByTestId('fc-cap-optimizer').getAttribute('href')).toBe('/tenant/ai/scheduling-optimizer');
    expect(panel.querySelectorAll('button')).toHaveLength(0);   // nothing to press but the link: no shift is created here
  });
  it('extras AI Analytics Forecasting 03: without duration history the hours are "—" and the state is Unknown; no capacity → no panel', async () => {
    window.history.replaceState(null, '', '/');
    apptMock.mockResolvedValue({ method: 'seasonal_naive', confidence: 'high', dataQuality: 'healthy', horizonDays: 1, accuracy: null, horizon: horizon(10).slice(0, 1), selectionReason: 'x', disclaimer: 'd',
      capacity: { avgAppointmentMinutes: null, durationSample: 0, durationWindowDays: 56, days: [{ date: '2026-03-01', expectedMinutes: null, lowerMinutes: null, upperMinutes: null, scheduledMinutes: 0, technicians: 0, gapMinutes: null, state: 'unknown' }] } });
    const { unmount } = render(<POSAiForecastingScreen />);
    await screen.findByTestId('fc-cap');
    expect(screen.getByTestId('fc-cap-basis')).toHaveTextContent('No booked appointment durations yet');
    expect(screen.getByTestId('fc-cap-row')).toHaveTextContent('Unknown');
    unmount();
    apptMock.mockResolvedValue({ method: 'seasonal_naive', confidence: 'high', dataQuality: 'healthy', horizonDays: 1, accuracy: null, horizon: horizon(10).slice(0, 1), selectionReason: 'x', disclaimer: 'd' });
    render(<POSAiForecastingScreen />);
    await screen.findByText('Seasonal naive');
    expect(screen.queryByTestId('fc-cap')).toBeNull();
  });
});
