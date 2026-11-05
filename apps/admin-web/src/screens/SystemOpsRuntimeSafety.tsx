// System Operations → Runtime safety — BUILD_PLAN Phase 11 (Constitution 4 §116, §131, §133, §139, §12).
//
// What the switches outside the database say right now, from GET /super-admin/system/runtime-safety:
//   • emergency maintenance (MAINTENANCE_BREAK_GLASS) as the answering instance reads it
//   • the database schema against this image's migrations (latest, applied, pending, edited-after-run)
//   • the per-tenant rate limiter (on/off, store, budget) and whether Redis is configured / required
//   • card payments the stranded-attempt sweep handed to a person (needs review / could not be verified)
// §332 no fake green: if the read fails the panel says so; it never shows "0 stranded" for a request that failed.
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';

import type { RuntimeSafety, SchemaVersionStatus, BreakGlassMode } from '@aipowersalon/api-contracts/platform';

export const SCHEMA_LABEL: Record<SchemaVersionStatus, string> = {
  ok: 'Up to date', pending: 'Migrations pending', ahead: 'Database is ahead of this build', drift: 'Migration files edited after they ran', unknown: 'Unknown',
};
export const BREAK_GLASS_LABEL: Record<BreakGlassMode, string> = { off: 'Off', read_only: 'READ-ONLY — changes are refused', full: 'FULL — the platform is closed' };
export const RESOLUTION_LABEL: Record<string, string> = {
  provider_approved_unrecorded: 'Charged by the processor, not recorded here',
  provider_ambiguous: 'Several unrecorded charges of this amount',
  provider_no_inquiry: 'Processor has no status lookup',
  processor_not_connected: 'Processor not connected',
  provider_unreachable: 'Processor unreachable',
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const BAD = 'var(--aps-bad, #cf222e)', WARN = 'var(--aps-warn, #9a6700)', GOOD = 'var(--aps-good, #1a7f37)';

export function SystemOpsRuntimeSafety() {
  const [r, setR] = useState<RuntimeSafety | 'failed' | null>(null);
  const load = useCallback(() => {
    // A missing or throwing client call is the "could not load" state too, never a blank or an all-clear.
    try { (superAdminApi.systemRuntimeSafety() as Promise<RuntimeSafety>).then(setR).catch(() => setR('failed')); }
    catch { setR('failed'); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  if (r === null) return <div className="panel" data-testid="runtime-safety"><div className="state">Loading runtime safety…</div></div>;
  if (r === 'failed') return <div className="panel" data-testid="runtime-safety"><div className="err" data-testid="runtime-safety-failed">Could not load runtime safety (maintenance switch, schema version, stranded payments) — this is not the same as "all clear".</div></div>;

  const sp = r.strandedPayments;
  return (
    <div data-testid="runtime-safety">
      {r.breakGlass.mode !== 'off' && (
        <div className="err" role="alert" data-testid="break-glass-banner">
          Emergency maintenance is ON: {BREAK_GLASS_LABEL[r.breakGlass.mode]}. {r.breakGlass.message} Clear MAINTENANCE_BREAK_GLASS on the host to reopen.
        </div>
      )}
      <h2>Runtime safety</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        <div className="panel" data-testid="break-glass">
          <div className="t">Emergency maintenance</div>
          <div style={{ fontWeight: 600, color: r.breakGlass.mode === 'off' ? GOOD : BAD }}>{BREAK_GLASS_LABEL[r.breakGlass.mode]}</div>
          {r.breakGlass.problem && <div className="s" style={{ color: WARN }}>{r.breakGlass.problem}</div>}
          <div className="s muted">MAINTENANCE_BREAK_GLASS — works without the database</div>
        </div>
        <div className="panel" data-testid="schema-version">
          <div className="t">Database schema</div>
          <div style={{ fontWeight: 600, color: r.schema.status === 'ok' ? GOOD : r.schema.status === 'unknown' ? WARN : BAD }}>{SCHEMA_LABEL[r.schema.status]}</div>
          <div className="s">Latest: <code>{r.schema.latest ?? '—'}</code> · {when(r.schema.latestAppliedAt)}</div>
          <div className="s muted">{r.schema.applied} applied · {r.schema.files} in this build</div>
          {r.schema.pending.length > 0 && <div className="s" data-testid="schema-pending">Pending: {r.schema.pending.join(', ')}</div>}
          {r.schema.unknown.length > 0 && <div className="s">Not in this build: {r.schema.unknown.join(', ')}</div>}
          {r.schema.mismatches.length > 0 && <div className="s" data-testid="schema-mismatches">Edited after running: {r.schema.mismatches.join(', ')}</div>}
          {r.schema.error && <div className="s" style={{ color: WARN }}>{r.schema.error}</div>}
        </div>
        <div className="panel" data-testid="rate-limiter">
          <div className="t">Per-salon rate limit</div>
          <div style={{ fontWeight: 600, color: r.rateLimiter.enabled ? GOOD : WARN }}>{r.rateLimiter.enabled ? `On (${r.rateLimiter.store})` : 'Off'}</div>
          <div className="s muted">{r.rateLimiter.maxPerWindow.toLocaleString()} requests / {Math.round(r.rateLimiter.windowMs / 1000)} s per location</div>
        </div>
        <div className="panel" data-testid="redis">
          <div className="t">Redis</div>
          <div style={{ fontWeight: 600, color: r.redis.configured ? GOOD : r.redis.requiredBecause.length ? BAD : WARN }}>{r.redis.configured ? 'Configured' : 'Not configured'}</div>
          {r.redis.requiredBecause.length > 0 && <div className="s">Required: {r.redis.requiredBecause.join('; ')}</div>}
        </div>
      </div>

      <h3 style={{ fontSize: 14 }}>Card payments needing review</h3>
      {sp.error ? <div className="err" data-testid="stranded-failed">{sp.error}</div> : (
        <>
          <div className="s muted" data-testid="stranded-summary">
            {sp.needsReview} need review · {sp.unverifiedCards} could not be verified · attempts are swept after {sp.thresholdMinutes} min. Nothing is charged, voided or refunded automatically.
          </div>
          {sp.recent.length === 0 ? <div className="state">No stranded card payments.</div> : (
            <table className="tbl" data-testid="stranded-table"><thead><tr><th>Salon</th><th>Amount</th><th>What the processor said</th><th>Found</th><th>Ticket</th></tr></thead>
              <tbody>{sp.recent.map((x) => (
                <tr key={x.id}>
                  <td>{x.tenantName ?? x.tenantId}</td>
                  <td>{money(x.amountCents)}</td>
                  <td>{x.kind === 'card_payment' ? 'Could not be verified (still being checked)' : RESOLUTION_LABEL[x.resolution ?? ''] ?? x.resolution ?? '—'}</td>
                  <td>{when(x.strandedAt)}</td>
                  <td><code>{x.ticketId.slice(0, 8)}</code></td>
                </tr>
              ))}</tbody></table>
          )}
        </>
      )}
    </div>
  );
}
