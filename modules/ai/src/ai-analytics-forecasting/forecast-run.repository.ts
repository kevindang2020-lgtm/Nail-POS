// forecast-run.repository.ts — persistence boundary for forecast points. The Kysely impl writes to the PRIMARY db; the
// in-memory impl mirrors it for tests. A once-per-day guard (hasRunOn) keeps forecast reads from bloating the table.
// Marking realized values + computing accuracy is what turns in-run backtests into DURABLE realized accuracy over time.
export interface ForecastPointInput { horizonStep: number; targetDate: string; point: number; lower: number; upper: number }
export interface ForecastRunInput {
  domain: 'appointments' | 'revenue' | 'product_demand';
  entityId?: string | null;
  model: string;
  modelVersion: string;
  intervalLevel: number;
  confidence: string | null;
  dataQuality: string | null;
  backtestWape: number | null;
  points: ForecastPointInput[];
}
export interface MaturedPoint { id: string; targetDate: string; point: number; lower: number; upper: number }
export interface AccuracyAgg { evaluated: number; mae: number | null; wape: number | null; coverage: number | null }

export interface ForecastRunRepositoryPort {
  hasRunOn(tenantId: string, branchId: string, domain: string, generatedDate: string, entityId?: string | null): Promise<boolean>;
  recordRun(tenantId: string, branchId: string, input: ForecastRunInput): Promise<{ runId: string; count: number }>;
  listUnrealizedMatured(tenantId: string, branchId: string, domain: string, onOrBefore: string, entityId?: string | null): Promise<MaturedPoint[]>;
  setRealized(tenantId: string, pointId: string, realized: number, absError: number, withinInterval: boolean): Promise<void>;
  accuracy(tenantId: string, branchId: string, domain: string, entityId?: string | null): Promise<AccuracyAgg>;
}

interface Row extends ForecastPointInput {
  id: string; runId: string; tenantId: string; branchId: string; domain: string; entityId: string | null;
  realized: number | null; absError: number | null; withinInterval: boolean | null; generatedDate: string;
}

let seq = 0;
const uid = (p: string) => `${p}_${++seq}`;
const scope = (e?: string | null) => e ?? '__branch__';

export class InMemoryForecastRunRepository implements ForecastRunRepositoryPort {
  private rows: Row[] = [];

  async hasRunOn(tenantId: string, branchId: string, domain: string, generatedDate: string, entityId?: string | null): Promise<boolean> {
    return this.rows.some((r) => r.tenantId === tenantId && r.branchId === branchId && r.domain === domain && scope(r.entityId) === scope(entityId) && r.generatedDate === generatedDate);
  }

  async recordRun(tenantId: string, branchId: string, input: ForecastRunInput): Promise<{ runId: string; count: number }> {
    const runId = uid('run');
    const today = new Date().toISOString().slice(0, 10);
    for (const p of input.points) {
      this.rows.push({
        id: uid('pt'), runId, tenantId, branchId, domain: input.domain, entityId: input.entityId ?? null,
        horizonStep: p.horizonStep, targetDate: p.targetDate, point: p.point, lower: p.lower, upper: p.upper,
        realized: null, absError: null, withinInterval: null, generatedDate: today,
      });
    }
    return { runId, count: input.points.length };
  }

  async listUnrealizedMatured(tenantId: string, branchId: string, domain: string, onOrBefore: string, entityId?: string | null): Promise<MaturedPoint[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId && r.branchId === branchId && r.domain === domain && scope(r.entityId) === scope(entityId) && r.realized === null && r.targetDate <= onOrBefore)
      .map((r) => ({ id: r.id, targetDate: r.targetDate, point: r.point, lower: r.lower, upper: r.upper }));
  }

  async setRealized(tenantId: string, pointId: string, realized: number, absError: number, withinInterval: boolean): Promise<void> {
    const r = this.rows.find((x) => x.id === pointId && x.tenantId === tenantId);
    if (r) { r.realized = realized; r.absError = absError; r.withinInterval = withinInterval; }
  }

  async accuracy(tenantId: string, branchId: string, domain: string, entityId?: string | null): Promise<AccuracyAgg> {
    const ev = this.rows.filter((r) => r.tenantId === tenantId && r.branchId === branchId && r.domain === domain && scope(r.entityId) === scope(entityId) && r.realized !== null);
    if (ev.length === 0) return { evaluated: 0, mae: null, wape: null, coverage: null };
    const absErr = ev.reduce((a, r) => a + (r.absError ?? 0), 0);
    const absAct = ev.reduce((a, r) => a + Math.abs(r.realized ?? 0), 0);
    const covered = ev.filter((r) => r.withinInterval).length;
    return {
      evaluated: ev.length,
      mae: Math.round((absErr / ev.length) * 100) / 100,
      wape: absAct > 0 ? Math.round((absErr / absAct) * 1000) / 1000 : 0,
      coverage: Math.round((covered / ev.length) * 1000) / 1000,
    };
  }
}
