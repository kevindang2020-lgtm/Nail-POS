import { describe, it, expect } from 'vitest';
import { AiInsightsService } from './ai-insights.service';
import { InMemoryInsightRepo } from './ai-insights.repository';

const svc = () => new AiInsightsService(new InMemoryInsightRepo());

describe('AiInsightsService', () => {
  it('builds the overview with 12 KPIs, breakdowns, trend, tenant risk, high-priority, category panel', async () => {
    const ov = await svc().getOverview();
    expect(ov.kpis).toHaveLength(12);
    expect(ov.byCategory.length).toBeGreaterThan(0);
    expect(ov.bySeverity.length).toBeGreaterThan(0);
    expect(ov.highPriority).toHaveLength(6);
    expect(ov.categoryPanel).toHaveLength(11);
    expect(ov.tenantRisk.length).toBeGreaterThan(0);
    expect(ov.bookingsRiskChurn.available).toBe(false); // honest — no booking-level data modelled
  });

  it('paginates + filters the findings directory', async () => {
    const s = svc();
    const all = await s.getDirectory({ pageSize: 100 });
    expect(all.rows.length).toBe(all.total);
    const high = await s.getDirectory({ severity: 'high', pageSize: 100 });
    expect(high.rows.every((r) => r.severity === 'high')).toBe(true);
    const txn = await s.getDirectory({ category: 'UNUSUAL_TRANSACTION', pageSize: 100 });
    expect(txn.rows.every((r) => r.category === 'UNUSUAL_TRANSACTION')).toBe(true);
  });

  it('marks reviewed and assigns follow-up without executing any operational action', async () => {
    const s = svc();
    const dir = await s.getDirectory({ pageSize: 5 });
    const id = dir.rows[0].id;
    expect((await s.markReviewed([id], 'u1')).reviewed).toBe(1);
    expect((await s.assignFollowUp([id], 'u2')).assigned).toBe(1);
    const after = await s.get(id);
    expect(after.insight!.status).toBe('follow_up_assigned'); // only the insight's own review state changed
  });

  it('requires a reason to dismiss and preserves the insight', async () => {
    const s = svc();
    const dir = await s.getDirectory({ pageSize: 1 });
    const id = dir.rows[0].id;
    expect((await s.dismiss(id, '')).ok).toBe(false);
    expect((await s.dismiss(id, 'seasonal variation')).ok).toBe(true);
    const after = await s.get(id);
    expect(after.insight!.status).toBe('dismissed'); // preserved, not deleted
  });

  it('enforces tenant scope in the overview', async () => {
    const ov = await svc().getOverview({ tenantId: 't1' });
    // only tenant t1's insights counted → tenants flagged is 1
    expect(ov.kpis.find((k) => k.key === 'tenants_flagged')!.value).toBe('1');
  });
});
