// PendingTimeOffPanel.tsx — time-off requests waiting for a manager (GET /pos/technicians/time-off/pending), with
// Approve / Decline in place (merge Oct 12 2026, other chat's phase 3 on our vocabulary). Renders nothing when there is
// nothing to decide, so the roster stays uncluttered; a failed load says so instead of pretending nothing is waiting.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { posWorkforceApi, type TimeOffEntry } from '../api/posWorkforceApi';
import { workforceLabel } from './TechnicianWorkforcePanel';
import { useRealtime } from '../realtime/useRealtime';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';

const fmt = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtInZone(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export function PendingTimeOffPanel({ names, onChanged }: { names: Record<string, string>; onChanged?: () => void }) {
  const [rows, setRows] = useState<TimeOffEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();
  const load = useCallback(() => posWorkforceApi.pendingTimeOff()
    .then((r) => { setRows(Array.isArray(r) ? r : []); setErr(null); })
    .catch(() => setErr(tx('pos.could_not_load_time_off_requests'))), []);
  useEffect(() => { void load(); }, [load]);
  useRealtime('technicians', load);
  const decide = async (t: TimeOffEntry, decision: 'approved' | 'rejected', note?: string) => {
    setBusy(t.id); setErr(null);
    try { await posWorkforceApi.decideTimeOff(t.technicianId, t.id, decision, note); await load(); onChanged?.(); }
    catch (e: any) { setErr(e?.message || tx('pos.could_not_record_the_decision')); await load(); }
    finally { setBusy(null); }
  };
  if (rows.length === 0 && !err) return askUi;
  return (
    <section className="panel" aria-label={tx('pos.time_off_requests')} style={{ marginBottom: 12 }}>
      {askUi}
      <h2 style={{ marginTop: 0 }}>{tx('pos.time_off_requests')}{' '}<span className="s">· {rows.length} {tx('pos.waiting')}</span></h2>
      {err ? <div className="err" style={{ marginBottom: 8 }}>{err}</div> : null}
      {rows.map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <strong>{names[t.technicianId] || tx('pos.technician')}</strong>
          <span className="s">{workforceLabel(t.kind)} · {fmt(t.startsAt)} → {fmt(t.endsAt)}{t.reason ? ` · ${t.reason}` : ''}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <button className="btn" disabled={busy === t.id} onClick={() => decide(t, 'approved')}>{tx('pos.approve')}</button>
            <button className="btn ghost" disabled={busy === t.id} onClick={() => ask(tx('admin.workforce.askDeclineTimeOff'), (note) => { void decide(t, 'rejected', note); }, { confirmLabel: tx('pos.decline'), inputLabel: tx('admin.workforce.reason') })}>{tx('pos.decline')}</button>
          </span>
        </div>
      ))}
    </section>
  );
}
