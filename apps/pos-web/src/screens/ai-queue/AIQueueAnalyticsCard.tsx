// AIQueueAnalyticsCard.tsx — how recommendations land, waits, by technician / hour, recent decisions, CSV export
// (BUILD_PLAN Phase 6, contract §C). Auto-assignments are counted on their own line (audit bug 13: they used to be
// logged as "accepted" and inflated the acceptance rate). Export is shown only to roles holding
// `ai_queue_assignment.export`; the server checks it again and makes the CSV formula-injection safe.
// Round 2: reads the ops service's real shape — `{ range, timeZone, decisions (+autoAssigned, staffTotal,
// topFeedbackCodes, byHour), waits { served, avgMinutes, longestMinutes … }, byTechnician { chosenByStaff, autoAssigned,
// overriddenTo, served, avgWaitMinutes }, byHour { served, decisions, autoAssigned }, alerts }`; rates are 0–1 over STAFF
// decisions. Usage = `{ calls, byStatus, byAction, costMicroUsd, recommendations, explanations }`.
import { useCallback, useEffect, useState } from 'react';
import type { DecisionAnalytics, QueueAssignmentDecisionRecord } from '@aipowersalon/api-contracts/tenant';
import { posAIQueueAssignmentApi as api, type AqAnalytics, type AqUsage, type AqExportType } from '../../api/posAIQueueAssignmentApi';
import { card, cardHead, input, btnGold, btnGhost, muted, errText, okText, pct, mins, pretty, errMsg, when, DECISION_LABEL, Stat } from './aiQueueUi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

const day = (d: Date) => d.toISOString().slice(0, 10);
const weekAgo = () => { const d = new Date(); d.setDate(d.getDate() - 6); return day(d); };

/** Hand the CSV to the browser as a download (no server round trip, no new window). */
export function downloadCsv(filename: string, csv: string): boolean {
  try {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
}

export function AIQueueAnalyticsCard({ tick, can, techName }: { tick: number; can: (p: string) => boolean; techName: (id: string | null | undefined) => string }) {
  const [from, setFrom] = useState(weekAgo());
  const [to, setTo] = useState(day(new Date()));
  const [a, setA] = useState<AqAnalytics | null>(null);
  const [da, setDa] = useState<DecisionAnalytics | null>(null);
  const [recent, setRecent] = useState<QueueAssignmentDecisionRecord[] | null>(null);
  const [usage, setUsage] = useState<AqUsage | null>(null);
  const [type, setType] = useState<AqExportType>('decisions');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const range = { from, to };
    const [r1, r2, r3, r4] = await Promise.allSettled([api.analytics(range), api.decisionAnalytics(range), api.decisionHistory({ ...range, limit: 20 }), api.usage(range)]);
    if (r1.status === 'fulfilled') setA(r1.value); else setErr(errMsg(r1.reason, tx('growth.aiQueue.err.analytics')));
    if (r2.status === 'fulfilled') setDa(r2.value);
    setRecent(r3.status === 'fulfilled' ? r3.value : []);
    if (r4.status === 'fulfilled') setUsage(r4.value);
  }, [from, to]);
  useEffect(() => { void load(); }, [load, tick]);

  const exportNow = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.exportCsv(type, { from, to });
      setMsg(downloadCsv(r.filename, r.csv) ? tx('pos.downloaded_filename', { filename: String(r.filename) }) : tx('pos.filename_is_ready_but_this_device_hwha', { filename: String(r.filename) }));
    } catch (e) { setErr(errMsg(e, tx('growth.aiQueue.err.export'))); } finally { setBusy(false); }
  };

  const d = a?.decisions;
  const byTech = a?.byTechnician || [];
  const byHour = a?.byHour || [];
  const maxHour = Math.max(1, ...byHour.map((h) => h.served));
  return (
    <div style={card}>
      <div style={cardHead}>
        <span>{tx('pos.how_recommendations_land')}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontWeight: 400 }}>
          <input aria-label={tx('pos.from_date')} type="date" style={{ ...input, height: 30 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span style={muted}>{tx('pos.to')}</span>
          <input aria-label={tx('pos.to_date')} type="date" style={{ ...input, height: 30 }} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {err ? <div role="alert" style={{ ...errText, marginBottom: 8 }}>{err}</div> : null}
      {msg ? <div role="status" style={{ ...okText, marginBottom: 8 }}>{msg}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
        <Stat label={tx('pos.accepted_2')} value={pct(d?.acceptanceRate ?? da?.acceptanceRate)} />
        <Stat label={tx('pos.overridden_2')} value={pct(d?.overrideRate ?? da?.overrideRate)} />
        <Stat label={tx('pos.rejected_2')} value={pct(d?.rejectionRate ?? da?.rejectionRate)} />
        <Stat label={tx('pos.auto_assigned_2')} value={String(d?.autoAssigned ?? 0)} />
        <Stat label={tx('pos.staff_decisions')} value={String(d?.staffTotal ?? da?.total ?? 0)} />
        <Stat label={tx('pos.guests_served')} value={String(a?.waits?.served ?? 0)} />
        <Stat label={tx('pos.avg_wait')} value={mins(a?.waits?.avgMinutes)} />
        <Stat label={tx('pos.longest_wait_2')} value={mins(a?.waits?.longestMinutes)} />
      </div>
      {d?.topFeedbackCodes?.length ? <div style={{ ...muted, marginBottom: 4 }}>{tx('pos.what_staff_said_was_wrong')}{' '}{d.topFeedbackCodes.slice(0, 4).map((r) => `${pretty(r.code)} (${r.count})`).join(' · ')}</div> : null}
      {(d?.topRejectionReasons ?? da?.topRejectionReasons)?.length ? <div style={{ ...muted, marginBottom: 8 }}>{tx('pos.top_reasons_for_rejecting')}{' '}{(d?.topRejectionReasons ?? da?.topRejectionReasons ?? []).slice(0, 4).map((r) => `${r.reason} (${r.count})`).join(' · ')}</div> : null}
      {da?.byDay?.length ? <div style={{ ...muted, marginBottom: 8 }} aria-label={tx('pos.decisions_by_day')}>{tx('pos.by_day')}{' '}{da.byDay.slice(-7).map((x) => `${x.date.slice(5)} ${x.accepted}/${x.total}`).join(' · ')}</div> : null}
      {byTech.length ? (
        <div style={{ marginBottom: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: '#8A857E' }}><th>{tx('pos.technician')}</th><th>{tx('pos.served')}</th><th>{tx('pos.avg_wait')}</th><th>{tx('pos.chosen_by_staff')}</th><th>{tx('pos.auto_assigned_2')}</th><th>{tx('pos.overridden_to')}</th></tr></thead>
            <tbody>{byTech.map((t) => <tr key={t.technicianId} style={{ borderTop: '1px solid var(--line)' }}><td>{t.name || techName(t.technicianId)}</td><td>{t.served}</td><td>{mins(t.avgWaitMinutes)}</td><td>{t.chosenByStaff}</td><td>{t.autoAssigned}</td><td>{t.overriddenTo}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {byHour.length ? (
        <div aria-label={tx('pos.guests_by_hour')} style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60, marginBottom: 10 }}>
          {byHour.map((h) => <div key={h.hour} title={tx('pos.hour_00_served_served_decisions_decisions_r843', { hour: String(h.hour), served: String(h.served), decisions: String(h.decisions) })} style={{ flex: 1, background: '#C89B5A', height: `${Math.max(4, (h.served / maxHour) * 100)}%`, borderRadius: 3 }} />)}
        </div>
      ) : null}
      {a?.alerts ? <div style={{ ...muted, marginBottom: 4 }}>{tx('pos.alerts_this_period')}{' '}{a.alerts.total}{a.alerts.autoResolved ? tx('pos.autoresolved_cleared_on_their_own_2', { autoResolved: String(a.alerts.autoResolved) }) : ''}</div> : null}
      {usage ? <div style={{ ...muted, marginBottom: 8 }}>{tx('pos.ai_calls_this_period')}{' '}{usage.calls} · {usage.explanations} {tx('pos.explanation_2')}{enPlural(usage.explanations === 1 ? '' : 's')} · {usage.recommendations} {tx('pos.recommendation_2')}{enPlural(usage.recommendations === 1 ? '' : 's')}{usage.costMicroUsd ? tx('pos.cost_v0', { v0: String((usage.costMicroUsd / 1_000_000).toFixed(2)) }) : ''}</div> : null}

      <div style={{ fontWeight: 700, fontSize: 12.5, margin: '6px 0' }}>{tx('pos.recent_decisions')}</div>
      {recent == null ? <div style={muted}>{tx('pos.loading')}</div> : recent.length === 0 ? <div style={muted}>{tx('pos.no_decisions_in_this_period')}</div> : (
        <div style={{ display: 'grid', gap: 3, maxHeight: 200, overflow: 'auto' }}>
          {recent.map((r) => <div key={r.id} style={{ fontSize: 12.5 }}><b>{DECISION_LABEL[r.decision] || pretty(r.decision)}</b>{r.chosenTechnicianId ? ` → ${techName(r.chosenTechnicianId)}` : ''}{r.reason ? <span style={muted}> · {r.reason}</span> : null}<span style={muted}> · {when(r.createdAt)}</span></div>)}
        </div>
      )}

      {can('ai_queue_assignment.export') ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
          <span style={muted}>{tx('pos.export')}</span>
          <select aria-label={tx('pos.export_type')} style={input} value={type} onChange={(e) => setType(e.target.value as AqExportType)}>
            <option value="decisions">{tx('pos.decisions')}</option><option value="alerts">{tx('pos.alerts')}</option><option value="history">{tx('pos.queue_history')}</option>
          </select>
          <button style={btnGold} disabled={busy} onClick={exportNow}>{tx('pos.download_csv')}</button>
          <button style={btnGhost} disabled={busy} onClick={() => void load()}>{tx('pos.refresh')}</button>
        </div>
      ) : null}
    </div>
  );
}
