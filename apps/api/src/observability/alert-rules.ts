// alert-rules.ts — Constitution 11 §97–106, §177, §262, §349: which component states become alerts, at what severity.
//
// PURE. Given every component's effective status (already hysteresis-filtered — §103: a sustained condition, never
// one failed request), it returns the alert each component SHOULD have right now, or null. The aggregator reconciles
// that against the alerts table every tick: raise if none is open, escalate if it got worse, resolve if it cleared.
// Stateless by design, so a restart can neither duplicate an open alert nor forget to resolve one.
//
// SEVERITY (§98–101) follows impact, not the component's name:
//   OUTAGE   × CRITICAL  → critical (P1)   database down, checkout down platform-wide
//   OUTAGE   × IMPORTANT → high     (P2)   Twilio out, realtime severely delayed
//   DEGRADED × CRITICAL  → high     (P2)
//   DEGRADED × IMPORTANT → medium   (P3)
//   OUTAGE   × OPTIONAL  → medium   (P3)   AI forecasting provider down
//   DEGRADED × OPTIONAL  → low      (P4)
// UNKNOWN is NOT an alert when it means "no traffic" — payments at 3 a.m. are unknown and fine. It IS one when it
// means "we cannot see" (the source could not be read) on a CRITICAL component: the existing alerts module already
// holds that silence about payments is itself worth a human's attention.
//
// GROUPING (§104). A database outage makes the API, booking, checkout, workers and events fail too. Paging five
// times for one root cause is what §104 forbids, so a component whose DEPENDENCY is already failing gets no alert of
// its own; the root cause's alert names what it is taking down.
//
// MAINTENANCE (§105) suppresses that component only — never "all monitoring".
import type { Criticality, HealthStatus } from './health-core';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export const SEVERITY_RANK: Record<AlertSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** §104 — what fails BECAUSE something else failed. Only infrastructure roots; business workflows are leaves. */
export const DEPENDS_ON: Readonly<Record<string, readonly string[]>> = {
  api: ['database'],
  booking: ['database', 'api'],
  checkout: ['database', 'api', 'payments'],
  workers: ['database'],
  events: ['database'],
  realtime: ['redis'],
  // A synthetic probe failing because the API or database is down is a symptom, not a second incident.
  synthetic: ['api', 'database'],
};

/** Reasons that mean "we cannot see", as opposed to "nothing happened". */
export const BLIND_REASONS: ReadonlySet<string> = new Set(['not_measured', 'probe_unavailable']);

export interface ComponentState { key: string; name: string; status: HealthStatus; reason: string; criticality: Criticality; owner: string; runbook: string }
export interface DesiredAlert { component: string; severity: AlertSeverity; title: string; message: string; owner: string; runbook: string; causes: string[] }

const failing = (s: HealthStatus) => s === 'OUTAGE' || s === 'DEGRADED';

export function severityFor(status: HealthStatus, criticality: Criticality, reason: string): AlertSeverity | null {
  if (status === 'OUTAGE') return criticality === 'CRITICAL' ? 'critical' : criticality === 'IMPORTANT' ? 'high' : 'medium';
  if (status === 'DEGRADED') return criticality === 'CRITICAL' ? 'high' : criticality === 'IMPORTANT' ? 'medium' : 'low';
  if (status === 'UNKNOWN' && criticality === 'CRITICAL' && BLIND_REASONS.has(reason)) return 'high';
  return null;   // HEALTHY, MAINTENANCE, and UNKNOWN-because-idle
}

/** The alert every component should have right now. Components absent from the result should have NO open alert. */
export function desiredAlerts(components: ComponentState[], dependsOn: Readonly<Record<string, readonly string[]>> = DEPENDS_ON): DesiredAlert[] {
  const byKey = new Map(components.map((c) => [c.key, c]));
  // A component is a SUPPRESSED symptom when any dependency (transitively) is failing.
  const rootFailing = (key: string, seen = new Set<string>()): string | null => {
    for (const dep of dependsOn[key] ?? []) {
      if (seen.has(dep)) continue; seen.add(dep);
      const d = byKey.get(dep);
      if (d && failing(d.status)) return rootFailing(dep, seen) ?? dep;
    }
    return null;
  };
  const out: DesiredAlert[] = [];
  for (const c of components) {
    const severity = severityFor(c.status, c.criticality, c.reason);
    if (!severity) continue;
    if (failing(c.status) && rootFailing(c.key)) continue;              // §104: the root cause pages, not its symptoms
    const causes = components.filter((o) => o.key !== c.key && failing(o.status) && rootFailing(o.key) === c.key).map((o) => o.name).sort();
    const what = c.status === 'UNKNOWN' ? 'cannot be monitored' : c.status === 'OUTAGE' ? 'is down' : 'is degraded';
    out.push({
      component: c.key, severity, owner: c.owner, runbook: c.runbook, causes,
      title: `${c.name} ${what}`,
      message: `${c.name} ${what} (reason: ${c.reason}).` + (causes.length ? ` Also affecting: ${causes.join(', ')}.` : '') + ` Owner: ${c.owner}. Runbook: ${c.runbook}`,
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.component.localeCompare(b.component));
}
