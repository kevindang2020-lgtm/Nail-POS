import { describe, it, expect } from 'vitest';
import { buildUsageAnalytics, type UsageSeries } from './ai-usage-analytics-core';

const series = (): UsageSeries => ({
  trend: [{ date: '2026-05-05', tokens: 201000 }, { date: '2026-05-06', tokens: 186000 }],
  costRequests: [{ date: '2026-05-05', costCents: 42000, requests: 3200 }, { date: '2026-05-06', costCents: 38000, requests: 2900 }],
  byProvider: [{ provider: 'openai', requests: 452 }, { provider: 'anthropic', requests: 240 }, { provider: 'google', requests: 186 }, { provider: 'retell', requests: 114 }],
  byFeature: [{ feature: 'ai_receptionist', requests: 346 }, { feature: 'ai_insights', requests: 215 }],
  tenants: [
    { tenantId: 't1', tenantName: 'VIP Nail Club', tokens: 452100, minutes: 2540, calls: 3420, costCents: 234560, requests: 5000, failed: 12 },
    { tenantId: 't2', tenantName: 'Gel Polish Plus', tokens: 361780, minutes: 1980, calls: 2860, costCents: 187620, requests: 4200, failed: 3 },
  ],
});

describe('ai-usage-analytics engine', () => {
  it('shapes trend + cost/requests as available series', () => {
    const a = buildUsageAnalytics(series());
    expect(a.trend.available).toBe(true);
    expect(a.trend.points).toHaveLength(2);
    expect(a.costRequests.points[0].requests).toBe(3200);
  });

  it('computes provider mix with labels + percentages summing ~100', () => {
    const a = buildUsageAnalytics(series());
    expect(a.byProvider.segments[0].label).toBe('OpenAI');
    const sum = a.byProvider.segments.reduce((s, x) => s + x.pct, 0);
    expect(Math.round(sum)).toBe(100);
  });

  it('labels features and sorts descending', () => {
    const a = buildUsageAnalytics(series());
    expect(a.byFeature.segments[0].label).toBe('AI Receptionist');
    expect(a.byFeature.segments[0].value).toBeGreaterThanOrEqual(a.byFeature.segments[1].value);
  });

  it('builds the tenant table sorted by cost, flags Warning on high failures', () => {
    const a = buildUsageAnalytics(series());
    expect(a.tenants[0].tenant).toBe('VIP Nail Club'); // higher cost first
    expect(a.tenants[0].status).toBe('Warning');       // 12 failed > 5
    expect(a.tenants[1].status).toBe('Active');
  });

  it('marks empty series NotConnected', () => {
    const a = buildUsageAnalytics({ trend: [], costRequests: [], byProvider: [], byFeature: [], tenants: [] });
    expect(a.trend.available).toBe(false);
    expect(a.byProvider.available).toBe(false);
  });
});
