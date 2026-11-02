// SchedUsageCard.tsx — usage of the AI Scheduling Optimizer package over a period (runs, recommendations, applied,
// explanations, AI-written explanation cost) and CSV exports of recommendations / runs / insights (ai_scheduling.export).
import { useEffect, useState } from 'react';
import type { SchedUsageSummary } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api, type SchedExportKind } from '../../api/posAiSchedulingOptimizerApi';
import { P, type Can, card, cardHead, btnGhost, input, muted, errText, Stat, row, schedErrorText, today, addDays } from './schedUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function SchedUsageCard({ tick, can }: { tick: number; can: Can }) {
  const [to, setTo] = useState(today());
  const [from, setFrom] = useState(addDays(today(), -30));
  const [u, setU] = useState<SchedUsageSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exErr, setExErr] = useState<string | null>(null);

  useEffect(() => { api.usage(from, to).then((r) => { setU(r); setErr(null); }).catch((e) => setErr(schedErrorText(e, 'ops.sched.err.usage'))); }, [from, to, tick]);

  const download = async (kind: SchedExportKind) => {
    setExErr(null);
    try {
      const csv = await api.exportCsv(kind, from, to);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `ai-scheduling-${kind}-${from}-to-${to}.csv`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { setExErr(schedErrorText(e, 'ops.sched.err.export')); }
  };

  return (
    <section style={card} aria-label={t('pos.usage_and_export')}>
      <div style={cardHead}>{t('pos.usage_export')}</div>
      <div style={{ ...row, marginBottom: 8 }}>
        <input type="date" aria-label={t('pos.usage_from')} value={from} onChange={(e) => setFrom(e.target.value)} style={input} />
        <input type="date" aria-label={t('pos.usage_to')} value={to} onChange={(e) => setTo(e.target.value)} style={input} />
      </div>
      {err ? <div style={errText}>{err}</div> : !u ? <div style={muted}>{t('pos.loading')}</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
          <Stat label={t('pos.optimizer_runs')} value={String(u.runs)} />
          <Stat label={t('pos.recommendations')} value={String(u.recommendations)} />
          <Stat label={t('pos.applied')} value={String(u.applied)} />
          <Stat label={t('pos.explanations')} value={String(u.explanations)} />
          <Stat label={t('pos.ai_explanation_cost')} value={`$${(u.llmCostMicroUsd / 1_000_000).toFixed(2)}`} />
        </div>
      )}
      {can(P.export) ? (
        <div style={{ ...row, marginTop: 10 }}>
          <button style={btnGhost} onClick={() => download('recommendations')}>{t('pos.export_recommendations_csv')}</button>
          <button style={btnGhost} onClick={() => download('runs')}>{t('pos.export_runs_csv')}</button>
          <button style={btnGhost} onClick={() => download('insights')}>{t('pos.export_insights_csv')}</button>
        </div>
      ) : <div style={{ ...muted, marginTop: 8 }}>{t('pos.exports_need_the_export_permission')}</div>}
      {exErr ? <div role="alert" style={errText}>{exErr}</div> : null}
    </section>
  );
}
