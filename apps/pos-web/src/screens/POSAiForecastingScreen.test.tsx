import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { apptMock, revMock, nsMock, accMock } = vi.hoisted(() => ({ apptMock: vi.fn(), revMock: vi.fn(), nsMock: vi.fn(), accMock: vi.fn() }));
vi.mock('../api/posAiForecastingApi', () => ({ posAiForecastingApi: { appointments: apptMock, revenue: revMock, noShowRisk: nsMock, accuracy: accMock } }));
import { POSAiForecastingScreen } from './POSAiForecastingScreen';

const horizon = (v: number) => Array.from({ length: 3 }, (_, i) => ({ step: i + 1, date: `2026-03-0${i + 1}`, point: v, lower: v - 2, upper: v + 2 }));

beforeEach(() => {
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

  it('switches to the No-Show risk tab and shows non-punitive actions', async () => {
    render(<POSAiForecastingScreen />);
    await screen.findByText('Seasonal naive');
    fireEvent.click(screen.getByText('No-Show Risk'));
    expect(await screen.findByText('Jane')).toBeInTheDocument();
    expect(screen.getByText(/Request customer confirmation/)).toBeInTheDocument();
  });
});
