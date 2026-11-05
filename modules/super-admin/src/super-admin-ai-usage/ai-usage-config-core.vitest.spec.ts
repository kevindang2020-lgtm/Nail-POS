import { describe, it, expect } from 'vitest';
import { buildUsageKpis, validateProviderInput, type UsageAggregate } from './ai-usage-config-core';

const agg = (over: Partial<UsageAggregate> = {}): UsageAggregate => ({
  activeTenants: 87, totalTokens: 2_480_000, totalMinutes: 14_260, receptionistCalls: 18_642, costCents: 1_284_640,
  modelRequests: 248_420, failedRequests: 186, allowanceUsedPct: 78, overageEvents: 37, activeFeatures: 5,
  avgLatencyMs: null, safetyFlags: null, providerHealthPct: null, ...over,
});

describe('ai-usage-config engine', () => {
  it('builds the 12 usage KPIs in order with honest nulls', () => {
    const k = buildUsageKpis(agg());
    expect(k.map((x) => x.key)).toEqual([
      'usage_by_tenant', 'tokens_minutes', 'receptionist_calls', 'ai_costs', 'model_requests', 'failed_requests',
      'avg_latency', 'allowances_used', 'overage_events', 'safety_flags', 'provider_health', 'active_features',
    ]);
    const byKey = Object.fromEntries(k.map((x) => [x.key, x]));
    expect(byKey.ai_costs.value).toBe('$12,846.40');
    expect(byKey.model_requests.value).toBe('248,420');
    expect(byKey.failed_requests.unfavorableIfUp).toBe(true);
    expect(byKey.tokens_minutes.value).toContain('2.48M tokens');
    // no backing data → Not Available
    expect(byKey.avg_latency.available).toBe(false);
    expect(byKey.safety_flags.available).toBe(false);
    expect(byKey.provider_health.available).toBe(false);
  });

  it('renders latency/flags/health when data is present', () => {
    const byKey = Object.fromEntries(buildUsageKpis(agg({ avgLatencyMs: 1240, safetyFlags: 14, providerHealthPct: 99 })).map((x) => [x.key, x]));
    expect(byKey.avg_latency.value).toBe('1.24s');
    expect(byKey.safety_flags.value).toBe('14');
    expect(byKey.provider_health.value).toBe('99%');
  });

  it('validates provider input', () => {
    expect(validateProviderInput({ providerKey: '', displayName: '' }).errors.length).toBeGreaterThanOrEqual(2);
    expect(validateProviderInput({ providerKey: 'nope', displayName: 'X' }).errors.some((e) => e.includes('Unknown provider'))).toBe(true);
    expect(validateProviderInput({ providerKey: 'openai', displayName: 'OpenAI' }).errors).toHaveLength(0);
    expect(validateProviderInput({ providerKey: 'openai', displayName: 'OpenAI' }, { requireKey: true }).errors.some((e) => e.includes('API key'))).toBe(true);
  });
});
