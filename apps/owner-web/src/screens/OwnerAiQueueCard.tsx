// OwnerAiQueueCard.tsx — BUILD_PLAN Phase 6 (ai_queue_assignment): the Owner App's AI queue branch comparison, inside
// Branch Performance. Per branch for the chosen period: average and longest wait, how often staff accepted the AI's
// suggestion (auto-assignments are counted on their own — bug 13 used to log them as "accepted"), how many guests the
// AI auto-assigned, and open queue alerts. Read-only; the AI is run from the POS. A plain "no data" / "not available"
// state instead of empty numbers; a 403 (no owner.dashboard.view) hides the card. CSV export is built here, safely.
import { useCallback, useEffect, useState } from 'react';
import { ownerAiQueueApi, type OwnerAiQueueSummary } from '../api/ownerAiQueueApi';
import type { OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector, periodLabel } from '../components/PeriodSelector';
import { buildAiQueueSummaryCsv } from './aiQueueSummaryCsv';

const DAYS: Partial<Record<OwnerPeriod, number>> = { today: 1, week: 7, month: 30, quarter: 90 };
const OPTIONS: OwnerPeriod[] = ['today', 'week', 'month', 'quarter'];
const mins = (m: number | null | undefined) => (m == null ? '—' : `${Math.round(m)} min`);
/** the API sends acceptance as a 0–1 share */
const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 100)}%`);

export function OwnerAiQueueCard() {
  const [period, setPeriod] = useState<OwnerPeriod>('week');
  const [data, setData] = useState<OwnerAiQueueSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const days = DAYS[period] ?? 7;

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerAiQueueApi.summary(days)
      .then((d) => { setData(d); })
      .catch((e: any) => { if (e?.status === 403) setHidden(true); else setError(e?.message || 'Could not load the AI queue comparison.'); })
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const download = () => {
    if (!data) return;
    const shownDays = data.days || days;   // the server clamps ?days= (1–90) — label the file with what it used
    const blob = new Blob([buildAiQueueSummaryCsv(data, shownDays)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ai-queue-branches-${shownDays}d.csv`; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  if (hidden) return null;
  const branches = data?.branches ?? [];
  // the branch guests waited longest at, called out (the reason an owner opens this card)
  const slowest = branches.reduce<typeof branches[number] | null>((w, b) => (b.avgWaitMinutes != null && (w == null || (w.avgWaitMinutes ?? -1) < b.avgWaitMinutes) ? b : w), null);

  return (
    <section data-testid="owner-ai-queue" style={{ marginTop: 18 }}>
      <div className="owner-sechead"><div className="h">AI Queue Assignment</div><div className="d">{periodLabel(period)}</div></div>
      <PeriodSelector value={period} onChange={setPeriod} options={OPTIONS} />
      {error ? (
        <div className="owner-state" role="alert"><div className="muted" style={{ marginBottom: 10 }}>{error}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : loading && !data ? (
        <div className="owner-state owner-text-muted">Loading…</div>
      ) : branches.length === 0 ? (
        <div className="owner-state" data-testid="ai-queue-empty">No queue activity for this period.</div>
      ) : (
        <>
          {data?.totals && (
            <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
              <div className="owner-kpi"><div className="label">Average wait</div><div className="val">{mins(data.totals.avgWaitMinutes)}</div><div className="sub owner-text-muted">{data.totals.served ?? 0} served · longest {mins(data.totals.longestWaitMinutes)}</div></div>
              <div className="owner-kpi"><div className="label">Suggestions accepted</div><div className="val">{pct(data.totals.acceptanceRate)}</div><div className="sub owner-text-muted">{data.totals.autoAssigned ?? 0} auto-assigned</div></div>
              <div className="owner-kpi"><div className="label">Open alerts</div><div className="val">{data.totals.openAlerts ?? 0}</div><div className="sub owner-text-muted">all branches</div></div>
            </div>
          )}
          {slowest && branches.length > 1 && <div className="owner-text-muted" data-testid="ai-queue-slowest" style={{ fontSize: 12, marginBottom: 8 }}>Longest average wait: {slowest.name} ({mins(slowest.avgWaitMinutes)}).</div>}
          <div className="owner-drill">
            {branches.map((b) => (
              <div className="owner-drillrow" key={b.branchId} data-testid="ai-queue-branch">
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{b.name}</div>
                  <div className="mt">{b.served} served · avg wait {mins(b.avgWaitMinutes)} · longest {mins(b.longestWaitMinutes)}</div>
                  <div className="mt">Accepted {pct(b.acceptanceRate)}{b.staffDecisions ? ` of ${b.staffDecisions} staff decision${b.staffDecisions === 1 ? '' : 's'}` : ''} · {b.autoAssigned} auto-assigned</div>
                </div>
                <span className="owner-statusbadge" style={{ background: b.openAlerts > 0 ? 'var(--owner-danger-bg)' : 'var(--owner-surface-soft)', color: b.openAlerts > 0 ? 'var(--owner-danger)' : 'inherit' }}>
                  {b.openAlerts > 0 ? `${b.openAlerts} open alert${b.openAlerts === 1 ? '' : 's'}` : 'No alerts'}
                </span>
              </div>
            ))}
          </div>
          <button className="owner-chip" style={{ marginTop: 10, padding: '6px 12px' }} onClick={download}>Download CSV</button>
        </>
      )}
    </section>
  );
}
