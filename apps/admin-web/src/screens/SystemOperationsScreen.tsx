// Super-Admin → System Operations — Constitution 11 §140–156, §330–333.
//
// One control-plane view over what the health aggregator persists: an overall status, a card per component (§142:
// status, reason, owner, runbook — no giant tables on the overview), open platform alerts, and SLOs with their error
// budgets. Everything shown comes from GET /super-admin/system/overview; nothing is computed or invented here.
//
// Two rules this screen must never break:
//   • §332 no fake green — an UNKNOWN component is shown as unknown, and a stale payload puts a warning banner above
//     everything, because a stopped aggregator must not look like a healthy platform.
//   • §80 / §397.27 — every SLO target is PROPOSED until validated; the badge is shown beside each one so no number on
//     this page reads as a measured commitment.
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { SystemOpsRuntimeSafety } from './SystemOpsRuntimeSafety';
import { SystemOpsCapacity } from './SystemOpsCapacity';
import { SystemOpsMobileTelemetry } from './SystemOpsMobileTelemetry';   // BUILD_PLAN Phase 13 (C6 §116–119)
import type { SloValidation } from '@aipowersalon/api-contracts/platform';   // BUILD_PLAN Phase 14 C (§80)

type Status = 'HEALTHY' | 'DEGRADED' | 'OUTAGE' | 'UNKNOWN' | 'MAINTENANCE';
type Card = { key: string; name: string; criticality: string; owner: string | null; runbook: string | null; status: Status; reason: string | null; stale: boolean; computedAt: string | null; lastChangeAt: string | null };
type Slo = { id: string; name: string; status: 'proposed' | 'validated'; target: number; sli: number | null; total: number; bad: number; budgetRemaining: number | null; burnRateFast: number | null; alert: 'page' | 'ticket' | null };
type Overview = {
  generatedAt: string; overall: Status; stale: boolean; components: Card[];
  alerts: { open: number; bySeverity: Record<string, number>; recent: Array<{ id: string; title: string; severity: string; component: string; createdAt: string }> };
  slos: Slo[];
  /** BUILD_PLAN Phase 14 C (§80): each SLO's verdict from persisted production data. Absent from an older API. */
  sloValidations?: SloValidation[];
};
type Change = { status: Status; previous: Status | null; reason: string; at: string };
type ApiRoutes = { windowMinutes: number; failing: Array<{ method: string; route: string; total: number; serverErrors: number }>; slowest: Array<{ method: string; route: string; total: number; avgMs: number; maxMs: number }> };

export const STATUS_LABEL: Record<Status, string> = { HEALTHY: 'Healthy', DEGRADED: 'Degraded', OUTAGE: 'Outage', UNKNOWN: 'Unknown', MAINTENANCE: 'Maintenance' };
const TONE: Record<Status, string> = { HEALTHY: 'var(--aps-good, #1a7f37)', DEGRADED: 'var(--aps-warn, #9a6700)', OUTAGE: 'var(--aps-bad, #cf222e)', UNKNOWN: 'var(--aps-ink-soft, #6e7781)', MAINTENANCE: 'var(--aps-info, #0969da)' };
const pct = (v: number | null, digits = 2) => (v === null ? '—' : `${(v * 100).toFixed(digits)}%`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** §80: the evidence-based verdict — "Proposed" until enough days of real traffic exist, never a guess. */
export function validationLabel(v: SloValidation | undefined): string {
  if (!v) return 'Not evaluated yet';
  if (v.status === 'validated') return `Validated — met over ${v.daysWithData} days`;
  if (v.status === 'breached') return `Breached — ${v.sli === null ? 'missed' : `${(v.sli * 100).toFixed(2)}%`} over ${v.daysWithData} days`;
  return `Proposed — ${v.daysWithData} of ${v.requiredDays} days of data`;
}

export function budgetLabel(remaining: number | null): string {
  if (remaining === null) return 'No traffic yet';
  if (remaining < 0) return `Overspent by ${Math.round(-remaining * 100)}%`;
  return `${Math.round(remaining * 100)}% remaining`;
}

export function SystemOperationsScreen() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<Change[] | null>(null);
  const [api, setApi] = useState<ApiRoutes | 'failed' | null>(null);

  const load = useCallback(() => {
    (superAdminApi.systemOperationsOverview() as Promise<Overview>)
      .then((r) => { setO(r); setError(null); })
      .catch((e: any) => setError(e?.message || 'Failed to load System Operations.'));
    // §143: the API section is secondary — if it fails the overview still renders, and the section says it FAILED.
    // (A first version fell back to empty lists, which rendered "No server errors in the last hour" — a claim the
    // failed request never checked. Fake green on the page built to prevent it.)
    (superAdminApi.systemOperationsApi() as Promise<ApiRoutes>).then(setApi).catch(() => setApi('failed'));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const showHistory = (key: string) => {
    if (open === key) { setOpen(null); return; }
    setOpen(key); setHistory(null);
    (superAdminApi.systemComponentHistory(key) as Promise<{ changes: Change[] }>).then((r) => setHistory(r.changes)).catch(() => setHistory([]));
  };

  if (error) return <div className="work"><div className="vh"><h1>System Operations</h1></div><div className="err" role="alert">{error}</div></div>;
  if (!o) return <div className="work"><div className="state">Loading System Operations…</div></div>;

  return (
    <div className="work">
      <div className="vh"><h1>System Operations</h1><div className="sub">Updated {when(o.generatedAt)} · refreshes every 30 s</div></div>

      {o.stale && (
        <div className="err" role="alert" data-testid="stale-banner">
          Health data is stale — the health aggregator may have stopped. Components it has not refreshed are shown as Unknown, not Healthy.
        </div>
      )}

      <div className="panel" data-testid="overall">
        <div className="t">Platform</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: TONE[o.overall] }}>{STATUS_LABEL[o.overall]}</div>
        <div className="s">{o.alerts.open ? `${o.alerts.open} open alert${o.alerts.open === 1 ? '' : 's'}` : 'No open alerts'}</div>
      </div>

      <SystemOpsRuntimeSafety />
      <SystemOpsCapacity />
      <SystemOpsMobileTelemetry />

      <h2>Components</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {o.components.map((c) => (
          <div key={c.key} className="panel" data-testid={`card-${c.key}`}>
            <div className="t">{c.name} <span className="muted" style={{ fontSize: 11 }}>{c.criticality.toLowerCase()}</span></div>
            <div style={{ fontWeight: 600, color: TONE[c.status] }} data-testid={`status-${c.key}`}>{STATUS_LABEL[c.status]}</div>
            {c.status !== 'HEALTHY' && c.reason && <div className="s">Reason: {c.reason}</div>}
            <div className="s muted">Owner: {c.owner ?? '—'} · Changed {when(c.lastChangeAt)}</div>
            {c.runbook && c.status !== 'HEALTHY' && <div className="s">Runbook: <code>{c.runbook}</code></div>}
            <button type="button" className="btn-link" onClick={() => showHistory(c.key)}>{open === c.key ? 'Hide history' : 'History'}</button>
            {open === c.key && (
              <ul data-testid={`history-${c.key}`} style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12 }}>
                {history === null ? <li>Loading…</li> : history.length === 0 ? <li>No changes in 30 days</li> :
                  history.map((h, i) => <li key={i}>{when(h.at)} — {h.previous ? STATUS_LABEL[h.previous] + ' → ' : ''}{STATUS_LABEL[h.status]} ({h.reason})</li>)}
              </ul>
            )}
          </div>
        ))}
      </div>

      <h2>Open alerts</h2>
      {o.alerts.recent.length === 0 ? <div className="state">No open platform alerts.</div> : (
        <table className="tbl"><thead><tr><th>Severity</th><th>Alert</th><th>Component</th><th>Raised</th></tr></thead>
          <tbody>{o.alerts.recent.map((a) => <tr key={a.id}><td>{a.severity}</td><td>{a.title}</td><td>{a.component}</td><td>{when(a.createdAt)}</td></tr>)}</tbody>
        </table>
      )}

      <h2>API — last hour</h2>
      <div data-testid="api-section">
        {api === null ? <div className="state">Loading…</div> : api === 'failed' ? <div className="err" data-testid="api-failed">Could not load API routes — this is not the same as "no errors".</div> : (
          <>
            <h3 style={{ fontSize: 14 }}>Top failing routes</h3>
            {api.failing.length === 0 ? <div className="state">No server errors in the last hour.</div> : (
              <table className="tbl"><thead><tr><th>Route</th><th>Server errors</th><th>Requests</th></tr></thead>
                <tbody>{api.failing.map((r) => <tr key={r.method + r.route}><td><code>{r.method} {r.route}</code></td><td>{r.serverErrors}</td><td>{r.total}</td></tr>)}</tbody></table>
            )}
            <h3 style={{ fontSize: 14 }}>Slowest routes</h3>
            {api.slowest.length === 0 ? <div className="state">Not enough traffic yet.</div> : (
              <table className="tbl"><thead><tr><th>Route</th><th>Average</th><th>Slowest</th><th>Requests</th></tr></thead>
                <tbody>{api.slowest.map((r) => <tr key={r.method + r.route}><td><code>{r.method} {r.route}</code></td><td>{r.avgMs} ms</td><td>{r.maxMs} ms</td><td>{r.total}</td></tr>)}</tbody></table>
            )}
          </>
        )}
      </div>

      <h2>Service level objectives</h2>
      <p className="muted" style={{ fontSize: 12 }}>Targets marked <b>Proposed</b> are starting points to measure against — not commitments and not measured results.</p>
      <table className="tbl" data-testid="slo-table">
        <thead><tr><th>Objective</th><th>Target</th><th>Last 30 days</th><th>Error budget</th><th>Burn (1 h)</th><th>Validation</th></tr></thead>
        <tbody>{o.slos.map((s) => (
          <tr key={s.id} data-testid={`slo-${s.id}`}>
            <td>{s.name} {s.status === 'proposed' && <span className="badge" data-testid={`proposed-${s.id}`}>Proposed</span>}</td>
            <td>{pct(s.target, 1)}</td>
            <td>{s.sli === null ? 'No traffic yet' : `${pct(s.sli)} of ${s.total.toLocaleString()}`}</td>
            <td>{budgetLabel(s.budgetRemaining)}</td>
            <td>{s.burnRateFast === null ? '—' : `${s.burnRateFast.toFixed(1)}×`}{s.alert ? ` · ${s.alert}` : ''}</td>
            <td data-testid={`validation-${s.id}`}>{validationLabel(o.sloValidations?.find((v) => v.id === s.id))}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
