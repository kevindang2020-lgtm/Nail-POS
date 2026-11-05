// forecasting-oversight.vitest.spec.ts — platform oversight aggregates over an in-memory point set.
import { describe, it, expect } from 'vitest';
import { ForecastingOversightService } from './forecasting-oversight.service';
import { InMemoryForecastingOversightRepository } from './forecasting-oversight.repository';

const pt = (tenantId: string, runId: string, domain: string, realized: number | null, absError: number | null, within: boolean | null, extra: any = {}) => ({
  tenantId, branchId: 'B1', runId, domain, realized, absError, within,
  dataQuality: extra.dataQuality ?? 'healthy', confidence: extra.confidence ?? 'high', generatedAt: extra.generatedAt ?? '2026-06-01T00:00:00.000Z',
});

function svc(pts: any[]) {
  const repo = new InMemoryForecastingOversightRepository();
  repo.seed(pts);
  return new ForecastingOversightService(repo);
}

describe('overview', () => {
  it('aggregates adoption + realized accuracy platform-wide', async () => {
    // T1: excellent (wape ~0.05), T2: not evaluated
    const s = svc([
      pt('T1', 'r1', 'appointments', 100, 5, true),
      pt('T1', 'r1', 'appointments', 100, 5, true),
      pt('T2', 'r2', 'revenue', null, null, null, { confidence: 'insufficient_data', dataQuality: 'insufficient_data' }),
    ]);
    const o = await s.overview();
    expect(o.kpis.activeTenants).toBe(2);
    expect(o.kpis.forecastRuns).toBe(2);
    expect(o.kpis.evaluatedPoints).toBe(2);
    expect(o.kpis.platformRealizedWape).toBeCloseTo(0.05, 3); // 10/200
    expect(o.byDomain.map((d) => d.domain).sort()).toEqual(['appointments', 'revenue']);
  });

  it('buckets tenants by realized accuracy', async () => {
    const s = svc([
      pt('T1', 'r1', 'appointments', 100, 5, true),   // wape 0.05 → excellent
      pt('T2', 'r2', 'appointments', 100, 30, false),  // wape 0.30 → fair
      pt('T3', 'r3', 'appointments', null, null, null), // not_evaluated
    ]);
    const o = await s.overview();
    const b = Object.fromEntries(o.accuracyDistribution.map((x) => [x.bucket, x.tenants]));
    expect(b.excellent).toBe(1); expect(b.fair).toBe(1); expect(b.not_evaluated).toBe(1);
  });

  it('says so honestly when nothing has matured', async () => {
    const o = await svc([pt('T1', 'r1', 'appointments', null, null, null)]).overview();
    expect(o.kpis.platformRealizedWape).toBeNull();
    expect(o.note).toMatch(/no forecasts have matured/i);
    expect(o.privacyNote).toMatch(/no tenant forecast values/i);
  });
});

describe('tenant health', () => {
  it('returns per-tenant operational rows (counts + accuracy, no values) and paginates', async () => {
    const s = svc([
      pt('T1', 'r1', 'appointments', 100, 5, true),
      pt('T1', 'r2', 'revenue', 200, 10, true),
      pt('T2', 'r3', 'appointments', null, null, null, { confidence: 'insufficient_data' }),
    ]);
    const page = await s.tenants(10, 0);
    expect(page.total).toBe(2);
    const t1 = page.rows.find((r) => r.tenantId === 'T1')!;
    expect(t1.domains).toBe(2); expect(t1.runs).toBe(2); expect(t1.evaluated).toBe(2);
    expect(t1.realizedWape).not.toBeNull();
    const t2 = page.rows.find((r) => r.tenantId === 'T2')!;
    expect(t2.lowConfidence).toBe(true); expect(t2.realizedWape).toBeNull();
    // no predicted values are present on the row
    expect(Object.keys(t1)).not.toContain('point');
    expect(Object.keys(t1)).not.toContain('pointValue');
  });
});
