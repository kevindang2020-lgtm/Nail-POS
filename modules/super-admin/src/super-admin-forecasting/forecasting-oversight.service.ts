// forecasting-oversight.service.ts — composes the Super Admin forecasting oversight payload from aggregate repo reads.
// Aggregate-only: adoption, run volume, realized-accuracy distribution + per-domain accuracy, and per-tenant HEALTH rows
// (counts + accuracy %, never predicted values). No private business data crosses this boundary.
import type { ForecastingOversightRepositoryPort } from './forecasting-oversight.repository';

export class ForecastingOversightService {
  constructor(private readonly repo: ForecastingOversightRepositoryPort) {}

  async overview() {
    const [totals, byDomain, distribution] = await Promise.all([
      this.repo.platformTotals(), this.repo.byDomain(), this.repo.accuracyDistribution(),
    ]);
    return {
      kpis: {
        activeTenants: totals.tenants,
        forecastRuns: totals.runs,
        storedForecastPoints: totals.points,
        evaluatedPoints: totals.evaluated,
        platformRealizedWape: totals.realizedWape,   // null until forecasts mature
        platformIntervalCoverage: totals.coverage,
      },
      byDomain,
      accuracyDistribution: distribution,
      note: totals.evaluated === 0
        ? 'No forecasts have matured platform-wide yet — realized accuracy appears as target dates pass.'
        : `Realized accuracy computed over ${totals.evaluated} matured forecast point(s).`,
      privacyNote: 'Aggregate operational health only. No tenant forecast values or raw business data are exposed here; private tenant access requires an audited support session.',
    };
  }

  async tenants(limit: number, offset: number) {
    const { rows, total } = await this.repo.tenantHealth(limit, offset);
    return { rows, total, limit, offset };
  }
}
