// Pure, DB-free engine for AI Usage & Configuration. Builds the usage KPIs from pre-aggregated usage numbers and
// validates provider input. Honest rendering: metrics with no backing column (avg latency, safety/quality flags,
// provider health) are surfaced as available:false rather than fabricated. No secret ever flows through here.

export interface UsageAggregate {
  activeTenants: number;
  totalTokens: number;
  totalMinutes: number;
  receptionistCalls: number;
  costCents: number;
  modelRequests: number;
  failedRequests: number;
  allowanceUsedPct: number | null;      // from tenant_usage_limits, or null if not modelled
  overageEvents: number | null;
  activeFeatures: number;
  avgLatencyMs: number | null;          // no latency column in usage logs → null
  safetyFlags: number | null;           // no safety/quality-flag store → null
  providerHealthPct: number | null;     // no provider health monitor → null
}

export interface Kpi { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean }

const n = (v: number) => v.toLocaleString();
const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildUsageKpis(a: UsageAggregate): Kpi[] {
  const kpi = (key: string, label: string, value: string | null, extra: Partial<Kpi> = {}): Kpi => ({ key, label, value, available: value !== null, ...extra });
  const tokensMins = `${a.totalTokens >= 1e6 ? (a.totalTokens / 1e6).toFixed(2) + 'M' : n(a.totalTokens)} tokens · ${n(a.totalMinutes)} mins`;
  return [
    kpi('usage_by_tenant', 'AI Usage by Tenant', `${n(a.activeTenants)} active`),
    kpi('tokens_minutes', 'Tokens / Minutes Used', tokensMins),
    kpi('receptionist_calls', 'AI Receptionist Calls', n(a.receptionistCalls)),
    kpi('ai_costs', 'AI Costs', money(a.costCents)),
    kpi('model_requests', 'Model Usage Requests', n(a.modelRequests)),
    kpi('failed_requests', 'Failed AI Requests', n(a.failedRequests), { unfavorableIfUp: true }),
    kpi('avg_latency', 'Avg Response Latency', a.avgLatencyMs === null ? null : `${(a.avgLatencyMs / 1000).toFixed(2)}s`),
    kpi('allowances_used', 'Tenant Allowances Used', a.allowanceUsedPct === null ? null : `${a.allowanceUsedPct}%`),
    kpi('overage_events', 'Overage Events', a.overageEvents === null ? null : n(a.overageEvents), { unfavorableIfUp: true }),
    kpi('safety_flags', 'Safety / Quality Flags', a.safetyFlags === null ? null : n(a.safetyFlags), { unfavorableIfUp: true }),
    kpi('provider_health', 'Provider Health', a.providerHealthPct === null ? null : `${a.providerHealthPct}%`),
    kpi('active_features', 'Active AI Features', `${n(a.activeFeatures)} enabled`),
  ];
}

const PROVIDER_KEYS = new Set(['openai', 'anthropic', 'google', 'retell', 'azure_openai', 'mistral', 'custom']);

export interface ProviderInput { providerKey?: string | null; displayName?: string | null; apiKey?: string | null; defaultModel?: string | null; status?: string | null }

export function validateProviderInput(input: ProviderInput, opts: { requireKey?: boolean } = {}): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.providerKey ?? '').trim()) errors.push('A provider is required.');
  else if (!PROVIDER_KEYS.has(String(input.providerKey))) errors.push('Unknown provider.');
  if (!String(input.displayName ?? '').trim()) errors.push('A display name is required.');
  if (opts.requireKey && !String(input.apiKey ?? '').trim()) errors.push('An API key is required.');
  if (input.status && !['active', 'inactive', 'error', 'disabled'].includes(String(input.status))) errors.push('Invalid status.');
  return { errors };
}
