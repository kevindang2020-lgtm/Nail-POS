// SuperAdminAiPlatformScreen.tsx — Constitution 10 §171–176, the AI platform control plane.
//
// THE RULE THIS SCREEN IS BUILT AROUND: the read models return `null` for a rate or latency that has not been
// measured, and null is NOT zero. A success rate computed from zero requests is unknown; rendering it as 100%
// would tell a Super Admin the platform is healthy when nothing has been measured at all. Every measured value
// here goes through `measured()`, which renders an em dash for null.
//
// §173: no provider credential is displayed, because none is in the payload — the service that builds the
// provider panel never reads one. There is nothing here to redact.
import { useCallback, useEffect, useState } from 'react';
import {
  superAdminAiPlatformApi as aiApi,
  type AiPlatformOverview, type AiProviderPanel, type AiModelPanel, type AiTenantUsagePanel, type AiRoutingPanel, type Measured,
} from '../api/superAdminAiPlatformApi';

const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';

/** Micro-USD to dollars. The platform's unit is not a human's. */
export function usd(micro: number | null | undefined): string {
  if (micro === null || micro === undefined || !Number.isFinite(micro)) return '—';
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

/**
 * The single most important function on this screen. `null` means "not measured" and must never render as a
 * number — an unmeasured success rate shown as 100% is worse than showing nothing, because it invites a
 * Super Admin to conclude the platform is fine.
 */
export function measured(value: Measured, kind: 'percent' | 'ms' = 'percent'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return kind === 'percent' ? `${Math.round(value * 100)}%` : `${Math.round(value)} ms`;
}

/** A breaker that is not HEALTHY deserves attention regardless of how it is spelled. */
export function isDegraded(status: string | undefined): boolean {
  return Boolean(status) && String(status).toUpperCase() !== 'HEALTHY';
}

export function SuperAdminAiPlatformScreen() {
  const [overview, setOverview] = useState<AiPlatformOverview | null>(null);
  const [providers, setProviders] = useState<AiProviderPanel[]>([]);
  const [models, setModels] = useState<AiModelPanel[]>([]);
  const [tenants, setTenants] = useState<AiTenantUsagePanel[]>([]);
  const [routing, setRouting] = useState<AiRoutingPanel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, p, m, t, r] = await Promise.all([aiApi.overview(), aiApi.providers(), aiApi.models(), aiApi.tenants(25), aiApi.routing()]);
      setOverview(o); setProviders(p ?? []); setModels(m ?? []); setTenants(t ?? []); setRouting(r ?? []);
    } catch (e: any) {
      setOverview(null);
      setError(e?.message || 'Could not load the AI platform control plane.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <div style={{ padding: 20 }}><h1>AI Platform</h1><p style={{ color: MUTED }}>{error}</p></div>;
  if (!overview) return <div style={{ padding: 20 }}><h1>AI Platform</h1><p style={{ color: MUTED }}>Loading…</p></div>;

  return (
    <div style={{ padding: 20, display: 'grid', gap: 18 }}>
      <header>
        <h1 style={{ margin: 0 }}>AI Platform</h1>
        <p style={{ color: MUTED, margin: '4px 0 0' }}>Providers, models, routing and spend across every tenant.</p>
      </header>

      <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Stat label="Requests today" value={String(overview.requestsToday)} />
        <Stat label="Success rate" value={measured(overview.successRate)} />
        <Stat label="Avg latency" value={measured(overview.averageLatencyMs, 'ms')} />
        <Stat label="Cost today" value={usd(overview.costTodayMicroUsd)} />
        <Stat label="Cost this month" value={usd(overview.costMonthMicroUsd)} />
        <Stat label="Active tenants" value={String(overview.activeTenants)} />
        <Stat label="Jobs running" value={String(overview.jobsRunning)} />
        <Stat label="Failures" value={String(overview.failures)} />
        <Stat label="Safety events" value={String(overview.safetyEvents)} />
      </section>

      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Providers</h2>
        {providers.length === 0 ? <p style={{ color: MUTED, margin: 0 }}>No providers are configured.</p> : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}>
              <th style={{ padding: '4px 8px 4px 0' }}>Provider</th><th style={{ padding: '4px 8px' }}>Status</th>
              <th style={{ padding: '4px 8px' }}>p50</th><th style={{ padding: '4px 8px' }}>Errors</th>
              <th style={{ padding: '4px 8px' }}>Requests</th><th style={{ padding: '4px 8px' }}>Cost</th>
            </tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>{p.provider}</td>
                  <td style={{ padding: '6px 8px', color: isDegraded(p.status) ? 'var(--danger,#9B2C2C)' : undefined }}>{p.status}</td>
                  <td style={{ padding: '6px 8px' }}>{measured(p.latencyMsP50, 'ms')}</td>
                  <td style={{ padding: '6px 8px' }}>{measured(p.errorRate)}</td>
                  <td style={{ padding: '6px 8px' }}>{p.requests}</td>
                  <td style={{ padding: '6px 8px' }}>{usd(p.costMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Models</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}>
            <th style={{ padding: '4px 8px 4px 0' }}>Model</th><th style={{ padding: '4px 8px' }}>Provider</th>
            <th style={{ padding: '4px 8px' }}>Status</th><th style={{ padding: '4px 8px' }}>Requests</th>
            <th style={{ padding: '4px 8px' }}>Cost</th><th style={{ padding: '4px 8px' }}>Quality</th>
          </tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.model} style={{ borderTop: `1px solid ${LINE}` }}>
                <td style={{ padding: '6px 8px 6px 0' }}>{m.model}</td>
                <td style={{ padding: '6px 8px' }}>{m.provider}</td>
                <td style={{ padding: '6px 8px' }}>{m.status}</td>
                <td style={{ padding: '6px 8px' }}>{m.requests}</td>
                <td style={{ padding: '6px 8px' }}>{usd(m.costMicroUsd)}</td>
                {/* qualityScore is null by design — no evaluation feeds it yet. A number here would be invented. */}
                <td style={{ padding: '6px 8px', color: MUTED }}>{measured(m.qualityScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* §175: what the router WOULD choose for each task, derived from the registries. This is the answer to
          "why did that task use that model" without reading code. */}
      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Routing</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}>
            <th style={{ padding: '4px 8px 4px 0' }}>Task</th><th style={{ padding: '4px 8px' }}>Risk</th>
            <th style={{ padding: '4px 8px' }}>Default model</th><th style={{ padding: '4px 8px' }}>Providers</th>
            <th style={{ padding: '4px 8px' }}>Max automation</th>
          </tr></thead>
          <tbody>
            {routing.map((r) => (
              <tr key={r.taskKey} style={{ borderTop: `1px solid ${LINE}` }}>
                <td style={{ padding: '6px 8px 6px 0' }}>{r.taskKey}</td>
                <td style={{ padding: '6px 8px' }}>{r.riskLevel}</td>
                {/* No default model means the router picks by tier at call time — say that, do not show blank. */}
                <td style={{ padding: '6px 8px' }}>{r.defaultModel ?? `by tier (${r.preferredTier})`}</td>
                <td style={{ padding: '6px 8px', color: MUTED }}>{r.allowedProviders.join(', ') || '—'}</td>
                <td style={{ padding: '6px 8px' }}>{r.maxAutomation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Spend by tenant</h2>
        {tenants.length === 0 ? <p style={{ color: MUTED, margin: 0 }}>No AI usage has been recorded this month.</p> : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}>
              <th style={{ padding: '4px 8px 4px 0' }}>Tenant</th><th style={{ padding: '4px 8px' }}>Requests</th>
              <th style={{ padding: '4px 8px' }}>Failures</th><th style={{ padding: '4px 8px' }}>Cost</th>
            </tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.tenantId} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>{t.tenantId}</td>
                  <td style={{ padding: '6px 8px' }}>{t.requests}</td>
                  <td style={{ padding: '6px 8px' }}>{t.failures}</td>
                  <td style={{ padding: '6px 8px' }}>{usd(t.costMicroUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: MUTED, fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20 }}>{value}</div>
    </div>
  );
}
