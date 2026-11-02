// SystemOpsPaymentDevices — Secure Tap to Pay §51 (Oct 27 2026): the platform's payment-phone security panel on System
// Operations. Durable counts from PostgreSQL (registrations, trust states, revocations, claim conflicts, device security
// events by kind — deduplicated incidents — and the app versions in use), the salons with the most NEW phones in the last
// 24 h (the "unusual registration" watch list), and this API instance's raw attempt counters from /metrics. Counts only.
import { useEffect, useState } from 'react';
import type { PaymentDeviceSecuritySummary } from '@aipowersalon/api-contracts';
import { superAdminApi } from '../api/superAdminApi';

const ALERTS: Array<[keyof PaymentDeviceSecuritySummary['signals'], string]> = [
  ['unusual_registration', 'Unusual registration'], ['key_mismatch', 'Key mismatch'], ['revoked_device_attempt', 'Revoked phone calling'],
  ['request_replayed', 'Replayed request'], ['app_version_refused', 'Unsupported app version'], ['attestation_failed', 'Attestation failed'],
];

export function SystemOpsPaymentDevices() {
  const [s, setS] = useState<PaymentDeviceSecuritySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => superAdminApi.systemPaymentDevices())
      .then((v) => { if (live) setS(v as PaymentDeviceSecuritySummary); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load payment-phone counts'); });
    return () => { live = false; };
  }, []);
  return (
    <section data-testid="ops-payment-devices">
      <h2>Payment phones (Tap to Pay)</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>Every salon, last {s?.windowDays ?? 30} days. Alerts are deduplicated incidents (one per kind, salon and phone per 10 minutes); the raw attempt counters are this API instance's since it started.</p>
      {error && <div role="alert">{error}</div>}
      {s && (
        <>
          <table className="tbl">
            <thead><tr><th>New phones (24 h)</th><th>New phones ({s.windowDays} d)</th><th>Active</th><th>Pending</th><th>Revoked</th><th>Claim conflicts</th></tr></thead>
            <tbody><tr data-testid="ops-payment-devices-totals">
              <td>{s.registrations.last24h}</td><td>{s.registrations.window}</td><td>{s.devices.active ?? 0}</td><td>{s.devices.pending ?? 0}</td><td>{s.revocations}</td><td>{s.claimConflicts}</td>
            </tr></tbody>
          </table>
          <table className="tbl">
            <thead><tr><th>Security alert</th><th>Incidents</th><th>Attempts (this instance)</th></tr></thead>
            <tbody>
              {ALERTS.map(([k, label]) => (
                <tr key={k} data-testid={`ops-payment-alert-${k}`}><td>{label}</td><td>{s.signals[k] ?? 0}</td><td>{s.process?.events?.[k] ?? 0}</td></tr>
              ))}
            </tbody>
          </table>
          {s.topRegistrations && s.topRegistrations.length > 0 && (
            <table className="tbl">
              <thead><tr><th>Most new phones today</th><th>New (24 h)</th></tr></thead>
              <tbody>{s.topRegistrations.map((t) => <tr key={t.tenantId}><td>{t.tenantName || t.tenantId.slice(0, 8)}</td><td>{t.last24h}</td></tr>)}</tbody>
            </table>
          )}
          <p style={{ fontSize: 13 }} data-testid="ops-payment-versions">App versions: {s.appVersions.length ? s.appVersions.map((v) => `${v.version} (${v.devices})`).join(' · ') : '—'}</p>
        </>
      )}
    </section>
  );
}
