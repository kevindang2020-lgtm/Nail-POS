import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { overviewMock, tenantsMock } = vi.hoisted(() => ({ overviewMock: vi.fn(), tenantsMock: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { aiForecastingOverview: overviewMock, aiForecastingTenants: tenantsMock } }));
import { AiForecastingScreen } from './AiForecastingScreen';

describe('AiForecastingScreen', () => {
  it('renders aggregate KPIs, the privacy note, and tenant health', async () => {
    overviewMock.mockResolvedValue({
      kpis: { activeTenants: 3, forecastRuns: 12, storedForecastPoints: 200, evaluatedPoints: 40, platformRealizedWape: 0.14, platformIntervalCoverage: 0.82 },
      byDomain: [{ domain: 'appointments', runs: 8, evaluated: 30, realizedWape: 0.12 }],
      accuracyDistribution: [{ bucket: 'good', tenants: 2 }, { bucket: 'not_evaluated', tenants: 1 }],
      note: 'Realized accuracy computed over 40 matured forecast point(s).',
      privacyNote: 'Aggregate operational health only. No tenant forecast values or raw business data are exposed here.',
    });
    tenantsMock.mockResolvedValue({ rows: [{ tenantId: 'aaaaaaaa-1111-1111-1111-111111111111', domains: 2, runs: 5, points: 60, evaluated: 20, realizedWape: 0.13, coverage: 0.8, lastGeneratedAt: null, lowConfidence: false }], total: 1 });

    render(<AiForecastingScreen />);
    await waitFor(() => expect(screen.getByText('AI Forecasting Oversight')).toBeInTheDocument());
    expect(screen.getByText('14.0%')).toBeInTheDocument();               // platform WAPE
    expect(screen.getByText(/No tenant forecast values/i)).toBeInTheDocument();
    expect(screen.getAllByText(/aaaaaaaa…/).length).toBeGreaterThanOrEqual(1);   // masked tenant id (the redesign shows it in two places)
    expect(screen.queryByText(/aaaaaaaa-1111-1111-1111-111111111111/)).toBeNull();   // the full id is never shown
  });
});
