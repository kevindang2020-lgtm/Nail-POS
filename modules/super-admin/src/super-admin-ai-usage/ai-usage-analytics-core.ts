// Pure engine for AI usage analytics. Turns raw grouped aggregates into the four analytics modules + the tenant table.
// Percentages reconcile to 100 over the chosen denominator (requests). No secret or raw prompt flows through here.

export interface UsageSeries {
  trend: { date: string; tokens: number }[];
  costRequests: { date: string; costCents: number; requests: number }[];
  byProvider: { provider: string; requests: number }[];
  byFeature: { feature: string; requests: number }[];
  tenants: { tenantId: string; tenantName: string | null; tokens: number; minutes: number; calls: number; costCents: number; requests: number; failed: number }[];
}

const FEATURE_LABEL: Record<string, string> = {
  ai_receptionist: 'AI Receptionist', receptionist: 'AI Receptionist', ai_insights: 'AI Insights', insights: 'AI Insights',
  ai_reports: 'AI Reports', reports: 'AI Reports', smart_reminders: 'Smart Reminders', reminders: 'Smart Reminders',
  automation_rules: 'Automation Rules', automation: 'Automation Rules',
};
const featureLabel = (k: string) => FEATURE_LABEL[k] || k.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const provLabel = (k: string) => ({ openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', retell: 'Retell' }[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Unknown'));

const mix = (rows: { key: string; requests: number }[]) => {
  const total = rows.reduce((a, r) => a + r.requests, 0);
  return rows.filter((r) => r.requests > 0).sort((a, b) => b.requests - a.requests)
    .map((r) => ({ label: r.key, value: r.requests, pct: total > 0 ? Math.round((r.requests / total) * 1000) / 10 : 0 }));
};

export function buildUsageAnalytics(s: UsageSeries) {
  return {
    trend: { available: s.trend.length > 0, points: s.trend },
    costRequests: { available: s.costRequests.length > 0, points: s.costRequests },
    byProvider: { available: s.byProvider.length > 0, segments: mix(s.byProvider.map((p) => ({ key: provLabel(p.provider), requests: p.requests }))) },
    byFeature: { available: s.byFeature.length > 0, segments: mix(s.byFeature.map((f) => ({ key: featureLabel(f.feature), requests: f.requests }))) },
    tenants: s.tenants.map((t) => ({
      tenant: t.tenantName || t.tenantId, tokens: t.tokens, minutes: t.minutes, calls: t.calls, costCents: t.costCents,
      failed: t.failed, status: t.failed > 5 ? 'Warning' : 'Active',
    })).sort((a, b) => b.costCents - a.costCents),
  };
}
