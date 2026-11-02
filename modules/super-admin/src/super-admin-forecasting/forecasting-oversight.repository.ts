// forecasting-oversight.repository.ts — platform (Super Admin) oversight over the forecasting module. Reads ONLY aggregate
// operational health from forecast_points across tenants: adoption, run volume, realized-accuracy distribution, data
// sufficiency. It deliberately never returns predicted point values or any raw business figures — accuracy percentages and
// counts are operational metadata, not tenant business data. The in-memory impl mirrors the Kysely impl for tests.
export interface PlatformTotals {
  tenants: number; runs: number; points: number; evaluated: number;
  realizedWape: number | null; coverage: number | null;
}
export interface DomainRow { domain: string; runs: number; evaluated: number; realizedWape: number | null }
export interface AccuracyBucket { bucket: string; tenants: number }
export interface TenantHealthRow {
  tenantId: string; domains: number; runs: number; points: number; evaluated: number;
  realizedWape: number | null; coverage: number | null; lastGeneratedAt: string | null; lowConfidence: boolean;
}

export interface ForecastingOversightRepositoryPort {
  platformTotals(): Promise<PlatformTotals>;
  byDomain(): Promise<DomainRow[]>;
  accuracyDistribution(): Promise<AccuracyBucket[]>;
  tenantHealth(limit: number, offset: number): Promise<{ rows: TenantHealthRow[]; total: number }>;
}

interface Pt {
  tenantId: string; branchId: string; runId: string; domain: string;
  realized: number | null; absError: number | null; within: boolean | null;
  dataQuality: string | null; confidence: string | null; generatedAt: string;
}

const wape = (absErr: number, absAct: number): number | null => (absAct > 0 ? Math.round((absErr / absAct) * 1000) / 1000 : null);

export class InMemoryForecastingOversightRepository implements ForecastingOversightRepositoryPort {
  constructor(private pts: Pt[] = []) {}
  seed(pts: Pt[]) { this.pts = pts; }

  async platformTotals(): Promise<PlatformTotals> {
    const ev = this.pts.filter((p) => p.realized != null);
    const absErr = ev.reduce((a, p) => a + (p.absError ?? 0), 0);
    const absAct = ev.reduce((a, p) => a + Math.abs(p.realized ?? 0), 0);
    const cov = ev.length ? ev.filter((p) => p.within).length / ev.length : null;
    return {
      tenants: new Set(this.pts.map((p) => p.tenantId)).size,
      runs: new Set(this.pts.map((p) => p.runId)).size,
      points: this.pts.length,
      evaluated: ev.length,
      realizedWape: ev.length ? wape(absErr, absAct) : null,
      coverage: cov == null ? null : Math.round(cov * 1000) / 1000,
    };
  }

  async byDomain(): Promise<DomainRow[]> {
    const domains = [...new Set(this.pts.map((p) => p.domain))].sort();
    return domains.map((domain) => {
      const dp = this.pts.filter((p) => p.domain === domain);
      const ev = dp.filter((p) => p.realized != null);
      return {
        domain, runs: new Set(dp.map((p) => p.runId)).size, evaluated: ev.length,
        realizedWape: ev.length ? wape(ev.reduce((a, p) => a + (p.absError ?? 0), 0), ev.reduce((a, p) => a + Math.abs(p.realized ?? 0), 0)) : null,
      };
    });
  }

  private bucketFor(w: number | null): string {
    if (w == null) return 'not_evaluated';
    if (w <= 0.1) return 'excellent';
    if (w <= 0.2) return 'good';
    if (w <= 0.4) return 'fair';
    return 'poor';
  }

  async accuracyDistribution(): Promise<AccuracyBucket[]> {
    const byTenant = new Map<string, { absErr: number; absAct: number; ev: number }>();
    for (const p of this.pts) {
      const t = byTenant.get(p.tenantId) ?? { absErr: 0, absAct: 0, ev: 0 };
      if (p.realized != null) { t.absErr += p.absError ?? 0; t.absAct += Math.abs(p.realized); t.ev += 1; }
      byTenant.set(p.tenantId, t);
    }
    const order = ['excellent', 'good', 'fair', 'poor', 'not_evaluated'];
    const counts = new Map<string, number>(order.map((b) => [b, 0]));
    for (const t of byTenant.values()) {
      const w = t.ev > 0 ? wape(t.absErr, t.absAct) : null;
      const b = this.bucketFor(w);
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return order.map((bucket) => ({ bucket, tenants: counts.get(bucket) ?? 0 }));
  }

  async tenantHealth(limit: number, offset: number): Promise<{ rows: TenantHealthRow[]; total: number }> {
    const tenants = [...new Set(this.pts.map((p) => p.tenantId))].sort();
    const rows = tenants.map((tenantId): TenantHealthRow => {
      const tp = this.pts.filter((p) => p.tenantId === tenantId);
      const ev = tp.filter((p) => p.realized != null);
      const cov = ev.length ? ev.filter((p) => p.within).length / ev.length : null;
      return {
        tenantId, domains: new Set(tp.map((p) => p.domain)).size, runs: new Set(tp.map((p) => p.runId)).size,
        points: tp.length, evaluated: ev.length,
        realizedWape: ev.length ? wape(ev.reduce((a, p) => a + (p.absError ?? 0), 0), ev.reduce((a, p) => a + Math.abs(p.realized ?? 0), 0)) : null,
        coverage: cov == null ? null : Math.round(cov * 1000) / 1000,
        lastGeneratedAt: tp.map((p) => p.generatedAt).sort().slice(-1)[0] ?? null,
        lowConfidence: tp.some((p) => p.confidence === 'insufficient_data' || p.dataQuality === 'insufficient_data'),
      };
    });
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }
}
