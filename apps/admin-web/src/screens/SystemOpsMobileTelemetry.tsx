// SystemOpsMobileTelemetry — BUILD_PLAN Phase 13 (Constitution 6 §116–119): the mobile apps' sanitized analytics, error
// and performance counts on System Operations. A simple count view (this API instance's counters since it started);
// the persisted, fleet-wide mobile dashboard is Phase 14. Every name shown is from the shared allowlist — never PII.
import { useEffect, useState } from 'react';
import type { MobileTelemetryView } from '@aipowersalon/api-contracts';
import { superAdminApi } from '../api/superAdminApi';

const ms = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} ms`);

export function SystemOpsMobileTelemetry() {
  const [view, setView] = useState<MobileTelemetryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => superAdminApi.systemMobileTelemetry())
      .then((v) => { if (live) setView(v as MobileTelemetryView); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load mobile telemetry'); });
    return () => { live = false; };
  }, []);
  return (
    <section>
      <h2>Mobile apps</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>Counts from this API instance since it started (allow-listed events only).</p>
      {error && <div role="alert">{error}</div>}
      {view && view.apps.length === 0 && <p>No mobile telemetry received yet.</p>}
      {view && view.apps.length > 0 && (
        <table>
          <thead><tr><th>App</th><th>Platform</th><th>Events</th><th>Errors</th><th>Launch p95</th><th>API p95</th></tr></thead>
          <tbody>
            {view.apps.map((r) => (
              <tr key={`${r.app}-${r.platform}`} data-testid={`mobile-row-${r.app}-${r.platform}`}>
                <td>{r.app}</td><td>{r.platform}</td>
                <td>{Object.values(r.events).reduce((a, b) => a + b, 0)}</td>
                <td>{r.errors}</td>
                <td>{ms(r.perf.launch_to_first_screen?.p95Ms)}</td>
                <td>{ms(r.perf.api_latency?.p95Ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
