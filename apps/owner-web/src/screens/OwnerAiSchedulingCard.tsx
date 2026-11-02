// OwnerAiSchedulingCard.tsx — BUILD_PLAN Phase 7 (ai_scheduling_optimizer): the Owner App's AI Scheduling Optimizer branch
// comparison, inside Branch Performance. Per branch for the chosen period: utilization and idle time (the one canonical
// utilization formula, server-side), open recommendations, changes applied (manual vs automated counted apart), customer
// proposals still waiting, open conflicts and when the optimizer last ran. Read-only; the optimizer is run from the POS.
// Honest empty / error states; a 403 (no owner.dashboard.view) or 402 (no package) hides the card.
import { useCallback, useEffect, useState } from 'react';
import { ownerAiSchedulingApi, type SchedOwnerSummary } from '../api/ownerAiSchedulingApi';
import type { OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector, periodLabel } from '../components/PeriodSelector';
import { fmtDateTime } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

const DAYS: Partial<Record<OwnerPeriod, number>> = { today: 1, week: 7, month: 30, quarter: 90 };
const OPTIONS: OwnerPeriod[] = ['today', 'week', 'month', 'quarter'];
const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)}%`);
const mins = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n)} min`);
const ago = (iso: string | null) => { if (!iso) return 'never'; return fmtDateTime(iso) || '—'; };

export function OwnerAiSchedulingCard() {
  const [period, setPeriod] = useState<OwnerPeriod>('week');
  const [data, setData] = useState<SchedOwnerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const days = DAYS[period] ?? 7;

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerAiSchedulingApi.summary(days)
      .then((d) => setData(d))
      .catch((e: any) => { if (e?.status === 403 || e?.status === 402) setHidden(true); else setError(e?.message || 'Could not load the scheduling comparison.'); })
      .finally(() => setLoading(false));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  if (hidden) return null;
  const branches = data?.branches ?? [];
  const lowest = branches.reduce<typeof branches[number] | null>((w, b) => (b.utilizationPct != null && (w == null || (w.utilizationPct ?? Infinity) > b.utilizationPct) ? b : w), null);
  const total = (k: 'openRecommendations' | 'applied' | 'automated' | 'pendingProposals' | 'openConflicts') => branches.reduce((a, b) => a + (b[k] ?? 0), 0);

  return (
    <section data-testid="owner-ai-scheduling" style={{ marginTop: 18 }}>
      <div className="owner-sechead"><div className="h">AI Scheduling Optimizer</div><div className="d">{periodLabel(period)}</div></div>
      <PeriodSelector value={period} onChange={setPeriod} options={OPTIONS} />
      {error ? (
        <div className="owner-state" role="alert"><div className="muted" style={{ marginBottom: 10 }}>{error}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : loading && !data ? (
        <div className="owner-state owner-text-muted">Loading…</div>
      ) : branches.length === 0 ? (
        <div className="owner-state" data-testid="ai-sched-empty">No optimizer activity for this period.</div>
      ) : (
        <>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Changes applied</div><div className="val">{total('applied')}</div><div className="sub owner-text-muted">{total('automated')} automated (safe actions)</div></div>
            <div className="owner-kpi"><div className="label">Waiting for review</div><div className="val">{total('openRecommendations')}</div><div className="sub owner-text-muted">{total('pendingProposals')} waiting on a customer</div></div>
            <div className="owner-kpi"><div className="label">Open conflicts</div><div className="val">{total('openConflicts')}</div><div className="sub owner-text-muted">all branches</div></div>
          </div>
          {lowest && branches.length > 1 ? <div className="owner-text-muted" data-testid="ai-sched-lowest" style={{ fontSize: 12, marginBottom: 8 }}>Lowest utilization: {lowest.name} ({pct(lowest.utilizationPct)}).</div> : null}
          <div className="owner-drill">
            {branches.map((b) => (
              <div className="owner-drillrow" key={b.branchId} data-testid="ai-sched-branch">
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{b.name}</div>
                  <div className="mt">Utilization {pct(b.utilizationPct)} · idle {mins(b.idleMin)}</div>
                  <div className="mt">{b.applied} applied ({b.automated} automated) · {b.openRecommendations} to review · {b.pendingProposals} waiting on customers · last run {ago(b.lastRunAt)}</div>
                </div>
                <span className="owner-statusbadge" style={{ background: b.openConflicts > 0 ? 'var(--owner-danger-bg)' : 'var(--owner-surface-soft)', color: b.openConflicts > 0 ? 'var(--owner-danger)' : 'inherit' }}>
                  {b.openConflicts > 0 ? `${b.openConflicts} conflict${b.openConflicts === 1 ? '' : 's'}` : 'No conflicts'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
