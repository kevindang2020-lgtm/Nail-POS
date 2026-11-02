// ai-business.vitest.spec.ts — slice 1: metric-registry integrity + permission-aware read-only service.
// Covers: registry well-formedness, drilldown routes are real pos-web routes, permission filtering (owner vs limited),
// unknown metric/category handling, per-metric permission enforcement, and freshness partial-day flagging.
import { describe, it, expect } from 'vitest';
import { AI_BUSINESS_METRICS, getMetric, listMetricIds, metricsByCategory } from './ai-business-metrics';
import { AiBusinessService } from './ai-business.service';
import { AiBusinessError, AiBusinessErrorCode, type AiBusinessContext } from './ai-business.dto';

// A real OWNER token carries every coarse capability, so it sees all metrics.
const OWNER: AiBusinessContext = {
  tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'OWNER',
  permissions: ['ai.use', 'reports.view', 'reports.export', 'customers.view', 'customers.edit', 'technicians.view'],
};
// A limited user: can use AI, but has NO reports/customers access → must not see revenue/appointment/customer metrics.
const LIMITED: AiBusinessContext = {
  tenantId: 't1', branchId: 'b1', userId: 'u2', role: 'RECEPTION', permissions: ['ai.use'],
};
const ANON: AiBusinessContext = { tenantId: '', branchId: '', userId: '', role: '', permissions: [] };

const svc = new AiBusinessService();

describe('metric registry integrity', () => {
  it('every metric is well-formed and uniquely identified', () => {
    const ids = listMetricIds();
    expect(ids.length).toBe(AI_BUSINESS_METRICS.length);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    for (const m of AI_BUSINESS_METRICS) {
      expect(m.id).toMatch(/^[a-z0-9_]+$/);
      expect(m.displayName.length).toBeGreaterThan(0);
      expect(m.formula.length).toBeGreaterThan(0);
      expect(m.requiredPermission.startsWith('pos.')).toBe(true);
      expect(m.dataSource.length).toBeGreaterThan(0);
      expect(m.comparisons.length).toBeGreaterThan(0);
      expect(m.version).toBeGreaterThanOrEqual(1);
    }
  });

  it('money metrics declare explicit refund/void/tip/tax treatment (spec §9)', () => {
    for (const m of AI_BUSINESS_METRICS) {
      if (m.unit === 'currency_cents') {
        expect(m.money, `${m.id} must declare money treatment`).toBeDefined();
        expect(m.money!.refunds).toBeDefined();
        expect(m.money!.tips).toBeDefined();
        expect(m.money!.taxes).toBeDefined();
      }
    }
  });

  it('every drilldown points at a real pos-web tenant route', () => {
    for (const m of AI_BUSINESS_METRICS) {
      expect(m.drilldownRoute.startsWith('/tenant/')).toBe(true);
    }
  });

  it('includes the six required matrix metrics (spec §58)', () => {
    for (const id of ['net_sales', 'completed_appointments', 'new_customers', 'customer_retention', 'technician_utilization', 'ai_booking_conversion']) {
      expect(getMetric(id), `missing required metric ${id}`).toBeDefined();
    }
  });

  it('categorizes metrics', () => {
    expect(metricsByCategory('revenue').length).toBeGreaterThan(0);
    expect(metricsByCategory('customers').every((m) => m.category === 'customers')).toBe(true);
  });
});

describe('permission-aware listing', () => {
  it('owner sees every metric', () => {
    const res = svc.listMetrics(OWNER);
    expect(res.total).toBe(AI_BUSINESS_METRICS.length);
  });

  it('limited user (ai.use only) sees no revenue/customer metrics', () => {
    const res = svc.listMetrics(LIMITED);
    const ids = res.metrics.map((m) => m.id);
    expect(ids).not.toContain('net_sales');
    expect(ids).not.toContain('new_customers');
    expect(res.total).toBe(0); // none of the current metrics are ai.use-only
  });

  it('category filter narrows the pool', () => {
    const rev = svc.listMetrics(OWNER, 'revenue');
    expect(rev.metrics.every((m) => m.category === 'revenue')).toBe(true);
  });

  it('unknown category is a stable METRIC_NOT_FOUND error', () => {
    expect(() => svc.listMetrics(OWNER, 'nonsense')).toThrowError(AiBusinessError);
    try { svc.listMetrics(OWNER, 'nonsense'); } catch (e) {
      expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND);
    }
  });

  it('unauthenticated context is rejected', () => {
    try { svc.listMetrics(ANON); expect.fail('should throw'); } catch (e) {
      expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION);
    }
  });
});

describe('single metric + per-metric permission', () => {
  it('owner can read a revenue definition', () => {
    const m = svc.getMetricDefinition(OWNER, 'net_sales');
    expect(m.id).toBe('net_sales');
    expect(m.money?.tips).toBe('excluded');
  });

  it('limited user is denied a revenue definition (INSUFFICIENT_PERMISSION)', () => {
    try { svc.getMetricDefinition(LIMITED, 'net_sales'); expect.fail('should throw'); } catch (e) {
      expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION);
    }
  });

  it('unknown metric id is METRIC_NOT_FOUND', () => {
    try { svc.getMetricDefinition(OWNER, 'does_not_exist'); expect.fail('should throw'); } catch (e) {
      expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.METRIC_NOT_FOUND);
    }
  });
});

describe('data freshness (spec §24)', () => {
  it('flags a partial current day and echoes the registry class', () => {
    const f = svc.getDataFreshness(OWNER, 'net_sales', { includesCurrentDay: true });
    expect(f.metricId).toBe('net_sales');
    expect(f.class).toBe('near_realtime');
    expect(f.partialCurrentDay).toBe(true);
    expect(f.note).toBeTruthy();
  });

  it('no partial-day note when the current day is excluded', () => {
    const f = svc.getDataFreshness(OWNER, 'net_sales', { includesCurrentDay: false });
    expect(f.partialCurrentDay).toBe(false);
    expect(f.note).toBeNull();
  });

  it('freshness enforces per-metric permission too', () => {
    try { svc.getDataFreshness(LIMITED, 'net_sales'); expect.fail('should throw'); } catch (e) {
      expect((e as AiBusinessError).code).toBe(AiBusinessErrorCode.INSUFFICIENT_PERMISSION);
    }
  });
});
