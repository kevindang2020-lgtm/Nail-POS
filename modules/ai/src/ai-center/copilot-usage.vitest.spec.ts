// copilot-usage.vitest.spec.ts — the Super-Admin cross-tenant usage rollup. Tests the pure aggregation (grouping by
// action and by tenant, totals, ordering) and the honest no-database state.
import { describe, it, expect } from 'vitest';
import { aggregateCopilotUsage, CopilotUsageService } from './copilot-usage.service';

describe('aggregateCopilotUsage', () => {
  const window = { from: null, to: null };
  it('groups by action and by tenant with correct totals', () => {
    const rows = [
      { action: 'appointment.created', tenantId: 't1', count: 5 },
      { action: 'appointment.cancelled', tenantId: 't1', count: 2 },
      { action: 'appointment.created', tenantId: 't2', count: 3 },
      { action: 'message.sent', tenantId: 't2', count: 4 },
    ];
    const s = aggregateCopilotUsage(rows, window);
    expect(s.total).toBe(14);
    expect(s.byAction.find((a) => a.action === 'appointment.created')?.count).toBe(8);
    expect(s.byTenant.find((t) => t.tenantId === 't2')?.count).toBe(7);
    expect(s.byAction[0].count).toBeGreaterThanOrEqual(s.byAction[1].count); // sorted desc
  });
  it('empty input → zero total, empty breakdowns', () => {
    const s = aggregateCopilotUsage([], window);
    expect(s).toMatchObject({ available: true, total: 0, byAction: [], byTenant: [] });
  });
});

describe('CopilotUsageService without a database', () => {
  it('reports available:false rather than fabricating counts', async () => {
    const svc = new CopilotUsageService(null as any);
    const s = await svc.summary();
    expect(s.available).toBe(false);
    expect(s.total).toBe(0);
  });
});
