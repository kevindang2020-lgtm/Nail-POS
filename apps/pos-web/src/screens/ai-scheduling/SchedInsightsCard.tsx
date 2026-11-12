// SchedInsightsCard.tsx — learned insights that need a manager's approval (nothing changes on its own):
// service durations from real history (approving one makes it the duration the ENGINE uses — the catalog is untouched),
// staffing coverage gaps, and suggestions to open / close availability. Approve / reject send `expectedVersion`.
import { useEffect, useState } from 'react';
import type { SchedInsight, SchedInsightKind, SchedInsightStatus } from '@aipowersalon/api-contracts/tenant';
import { posAiSchedulingOptimizerApi as api } from '../../api/posAiSchedulingOptimizerApi';
import { P, type SchedCardProps, card, cardHead, btnGold, btnGhost, btnDanger, input, muted, errText, okText, pill, hm, pretty, row, schedErrorText, isRefetchConflict } from './schedUi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codedText } from '../../i18n/coded-text';

const KINDS: SchedInsightKind[] = ['duration', 'staffing', 'availability'];

// Service Duration Confidence (extras): the observed spread the server attaches to a duration suggestion (`observed`,
// from the stored statistics for the same key). Read from the row — a local shape so this compiles with older contracts.
type DurationSpreadView = { sampleSize: number; medianMin: number; p25Min: number; p75Min: number; p90Min: number; variability: 'too_few' | 'steady' | 'variable' | 'wide'; spreadPct: number | null };
const spreadOf = (i: SchedInsight): DurationSpreadView | null => (i.kind === 'duration' ? ((i as SchedInsight & { observed?: DurationSpreadView | null }).observed ?? null) : null);
const VAR_TONE: Record<DurationSpreadView['variability'], [string, string]> = { too_few: ['#F3ECE1', '#6C6965'], steady: ['#E5F2E8', '#2F6B3A'], variable: ['#FBF0DC', '#8A5A12'], wide: ['#FBE4E1', '#9B2C21'] };
function DurationSpread({ i }: { i: SchedInsight }) {
  const o = spreadOf(i);
  if (i.kind !== 'duration') return null;
  if (!o) return <div style={{ ...muted, flexBasis: '100%' }} data-testid="sched-duration-spread">{t('ops.sched.spread.none')}</div>;
  const [bg, fg] = VAR_TONE[o.variability];
  return (
    <div style={{ ...row, flexBasis: '100%', fontSize: 12 }} data-testid="sched-duration-spread">
      <span style={pill(bg, fg)}>{t(`ops.sched.spread.${o.variability}`)}</span>
      <span style={muted}>{t('ops.sched.spread.line', { n: String(o.sampleSize), median: String(Math.round(o.medianMin)), p25: String(Math.round(o.p25Min)), p75: String(Math.round(o.p75Min)), p90: String(Math.round(o.p90Min)) })}</span>
      {o.variability === 'wide' || o.variability === 'too_few' ? <span style={{ color: '#8A5A12' }}>{t('ops.sched.spread.check')}</span> : null}
    </div>
  );
}

function describe(i: SchedInsight, techName: (id: string | null | undefined) => string, serviceName: (id: string | null) => string): string {
  if (i.kind === 'duration') return t('pos.serviceid_v1_v2_v3_min_samplesize_ynz4', { serviceId: String(serviceName(i.serviceId)), v1: String(i.technicianId ? ` (${techName(i.technicianId)})` : ''), v2: String(i.currentMin ?? '—'), v3: String(i.suggestedMin ?? '—'), sampleSize: String(i.sampleSize), v5: String(i.reason ? ` · ${codedText(i.reasonCoded, i.reason)}` : '') });
  if (i.kind === 'staffing') return `${i.date ?? ''} ${hm(i.startTime)}–${hm(i.endTime)}: ${pretty(i.state)}${i.missingMinutes ? t('pos.missingminutes_min_short', { missingMinutes: String(i.missingMinutes) }) : ''}${i.missingSkills.length ? t('pos.needs_v0', { v0: String(i.missingSkills.join(', ')) }) : ''}${i.recommendedAction ? ` · ${codedText(i.recommendedActionCoded, i.recommendedAction)}` : ''}`;
  return `${t(i.direction === 'open' ? 'ops.sched.insight.open' : 'ops.sched.insight.close', { when: `${i.date ?? ''} ${hm(i.startTime)}–${hm(i.endTime)}`.trim() })}${i.technicianId ? ` · ${techName(i.technicianId)}` : ''}${i.serviceId ? ` · ${serviceName(i.serviceId)}` : ''}${i.reason ? ` · ${codedText(i.reasonCoded, i.reason)}` : ''}`;
}

export function SchedInsightsCard({ tick, can, techName, onChanged, services }: SchedCardProps & { services: { serviceId: string; name: string }[] }) {
  const [kind, setKind] = useState<SchedInsightKind>('duration');
  const [status, setStatus] = useState<SchedInsightStatus | ''>('review_required');
  const [list, setList] = useState<SchedInsight[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);
  const serviceName = (id: string | null) => (id ? services.find((s) => s.serviceId === id)?.name ?? t('pos.a_service') : t('pos.any_service'));

  useEffect(() => {
    api.insights({ kind, status: status || null }).then((r) => { setList(r?.items ?? []); setErr(null); }).catch((e) => setErr(schedErrorText(e, 'ops.sched.err.insights')));
  }, [kind, status, tick, reload]);

  const decide = async (i: SchedInsight, d: 'approve' | 'reject') => {
    if (d === 'reject' && !reason.trim()) { setMsg({ ok: false, text: t('pos.add_a_short_reason_to_reject') }); return; }
    setBusy(i.id + d); setMsg(null);
    try {
      await api.decideInsight(i.kind, i.id, d, { expectedVersion: i.version, reason: reason.trim() || null });
      setMsg({ ok: true, text: d === 'approve' ? (i.kind === 'duration' ? t('pos.approved_the_optimizer_now_plans_with_1q8e') : t('ops.sched.ok.approved')) : t('ops.sched.ok.rejected') });
      setReason(''); onChanged(); setReload((x) => x + 1);
    } catch (e) { setMsg({ ok: false, text: schedErrorText(e) }); if (isRefetchConflict(e)) setReload((x) => x + 1); }
    finally { setBusy(null); }
  };
  const refresh = async () => {
    setBusy('refresh'); setMsg(null);
    try { await api.refreshInsights(); setMsg({ ok: true, text: t('pos.insight_refresh_queued_new_insights_appear_ofmu') }); }
    catch (e) { setMsg({ ok: false, text: schedErrorText(e) }); } finally { setBusy(null); }
  };
  const canDecide = can(P.approve);

  return (
    <section style={card} aria-label={t('pos.insights')}>
      <div style={cardHead}>{t('pos.insights')}{' '}{canDecide ? <button style={{ ...btnGhost, marginLeft: 'auto' }} disabled={busy === 'refresh'} onClick={refresh}>{t('pos.refresh_insights')}</button> : null}</div>
      <div style={{ ...row, marginBottom: 8 }} role="tablist" aria-label={t('pos.insight_kind')}>
        {KINDS.map((k) => <button key={k} role="tab" aria-selected={kind === k} style={kind === k ? btnGold : btnGhost} onClick={() => setKind(k)}>{t(`ops.sched.kind.${k}`)}</button>)}
        <select aria-label={t('pos.insight_status')} value={status} onChange={(e) => setStatus(e.target.value as SchedInsightStatus | '')} style={input}>
          <option value="review_required">{t('pos.needs_approval')}</option><option value="approved">{t('pos.approved')}</option><option value="rejected">{t('pos.rejected_2')}</option><option value="">{t('pos.all')}</option>
        </select>
      </div>
      {canDecide ? <input aria-label={t('pos.insight_reason')} placeholder={t('pos.reason_required_to_reject')} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...input, width: '100%', marginBottom: 8 }} /> : null}
      {msg ? <div role={msg.ok ? 'status' : 'alert'} style={{ ...(msg.ok ? okText : errText), marginBottom: 6 }}>{msg.text}</div> : null}
      {err ? <div style={errText}>{err}</div> : !list ? <div style={muted}>{t('pos.loading')}</div> : list.length === 0 ? <div style={muted}>{t('pos.nothing_here')}</div> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {list.map((i) => (
            <div key={i.id} data-testid="sched-insight" style={{ ...row, fontSize: 12.5, borderBottom: '1px solid #F1E9DA', paddingBottom: 6 }}>
              <span style={{ flex: 1, minWidth: 200 }}>{describe(i, techName, serviceName)}</span>
              {i.confidence != null ? <span style={muted}>{Math.round(i.confidence * 100)}%</span> : null}
              <span style={pill('#F3ECE1', '#6C6965')}>{pretty(i.status)}</span>
              {canDecide && i.status === 'review_required' ? <>
                <button style={btnGold} disabled={!!busy} onClick={() => decide(i, 'approve')}>{t('pos.approve')}</button>
                <button style={btnDanger} disabled={!!busy} onClick={() => decide(i, 'reject')}>{t('pos.reject')}</button>
              </> : null}
              <DurationSpread i={i} />
            </div>
          ))}
        </div>
      )}
      {!canDecide ? <div style={{ ...muted, marginTop: 6 }}>{t('pos.a_manager_approves_or_rejects_insights')}</div> : null}
    </section>
  );
}
