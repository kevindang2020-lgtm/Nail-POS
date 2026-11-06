import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type PosAiPackage, type AiCenterOverview, type CallIntelSummary, type AiAssistantControl, type AiRevenueSummary, type WorkflowStat } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabelOrNull, humanizeCode } from '../i18n/status-label';
import { fmtMoney, displayLocale, fmtInZone } from '../i18n/format';
import { growthCode } from './growthLabels';
import { posAiUsageScreenApi } from '../api/posAiUsageApi';
import { stateLabel, DetailDialog, HistoryDialog } from './POSAiUsageScreen';
import { useCan } from '../components/usePermissions';

// POSAICenterScreen.tsx — T16 AI Center › AI Command Center. Reads the REAL tenant AI access state from
// /tenant/ai/packages (the same gate decision the backend enforces): every AI assistant with its live subscription
// status, usage vs. limit, and lock/trial state. Conversation-level intelligence (call analytics, sentiment, activity
// log, automation run history) needs an AI activity feed that isn't tracked yet — those panels say so honestly and link
// to where the work happens, rather than showing invented numbers.

const fmtMin = (min: number | null) => min == null ? '—' : `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
const fmtDur = (sec: number | null) => sec == null ? '—' : `${Math.floor(sec / 60)}m ${sec % 60}s`;
const CONTROL_MODE_OPTIONS: { v: string; l: string }[] = [
  { v: 'disabled', get l() { return t('pos.disabled'); } }, { v: 'observe_only', get l() { return t('pos.observe_only'); } }, { v: 'recommendation_only', get l() { return t('pos.recommendation_only'); } }, { v: 'draft_only', get l() { return t('pos.draft_only'); } }, { v: 'confirm_before_action', get l() { return t('pos.confirm_before_action'); } }, { v: 'approval_required', get l() { return t('pos.approval_required'); } }, { v: 'approved_automation', get l() { return t('pos.approved_automation'); } },
];
const money = (c?: number) => fmtMoney(c || 0, { whole: true });
const CAT_LABEL: Record<string, string> = { get front_desk() { return t('growth.aiCenter.category.front_desk'); }, get operations() { return t('growth.aiCenter.category.operations'); }, get insights() { return t('growth.aiCenter.category.insights'); }, get growth() { return t('growth.aiCenter.category.growth'); }, get finance() { return t('growth.aiCenter.category.finance'); } };

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };

// AI Center guide (Nov 3 2026, P0): when the live reconcile is available, the pill is the HONEST state plus the AI-call
// gate's decision — an ended trial whose record still says "trialing" is never shown as Trial or Running.
function statusOf(p: PosAiPackage, live?: any): { label: string; tone: string } {
  if (live) {
    const lbl = stateLabel(live.state);
    return { label: lbl, tone: live.gate?.allowed ? 'ok' : live.state === 'available' || live.state === 'trial_available' ? '' : 'warn' };
  }
  const st = p.subscription?.status;
  if (st === 'active') return { label: t('pos.active_3'), tone: 'ok' };
  if (st === 'trialing') return { label: t('pos.trial'), tone: 'warn' };
  if (p.accessible) return { label: t('pos.active_3'), tone: 'ok' };
  if (p.trialAvailable) return { label: t('pos.trial_available'), tone: '' };
  return { label: p.lockLabel || t('growth.aiCenter.locked'), tone: 'warn' };
}

export function POSAICenterScreen() {
  const nav = useNavigate();
  const [pkgs, setPkgs] = useState<PosAiPackage[] | null>(null);
  const [ov, setOv] = useState<AiCenterOverview | null>(null);
  const [ci, setCi] = useState<CallIntelSummary | null>(null);
  const [modes, setModes] = useState<AiAssistantControl[] | null>(null);
  const [rev, setRev] = useState<AiRevenueSummary | null>(null);
  const [runs, setRuns] = useState<Record<string, WorkflowStat> | null>(null);
  const [modeNote, setModeNote] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [rc, setRc] = useState<any | null | undefined>(undefined); // undefined = loading, null = unavailable
  const [chk, setChk] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);
  // AI Center guide §07: every assistant opens the full details overlay; Activity history opens the searchable log in place
  const [dlg, setDlg] = useState<null | { kind: 'detail'; code: string } | { kind: 'history'; code?: string }>(null);
  const [note, setNote] = useState<string | null>(null);
  const can = useCan();

  useEffect(() => {
    posAiApi.packages().then((d) => setPkgs(d?.packages || [])).catch((e: any) => setError(e?.message || t('pos.failed_to_load_ai_center')));
    posAiApi.centerOverview().then(setOv).catch(() => setOv(null)); // canonical aggregate; honest tracked/untracked
    posAiApi.callIntelligenceSummary().then(setCi).catch(() => setCi(null)); // real call-intel summary (empty until webhook producer wired)
    posAiApi.controlModes().then(setModes).catch(() => setModes(null)); // human-controlled AI operating model (§3)
    posAiApi.aiRevenueSummary().then(setRev).catch(() => setRev(null)); // AI-attributed revenue (real store)
    posAiApi.workflowRunsSummary().then(setRuns).catch(() => setRuns(null)); // automation run stats (real store)
    posAiUsageScreenApi.reconcile().then(setRc).catch(() => setRc(null)); // honest per-assistant state + gate decision
  }, [tick]);
  const runCheck = async () => { setChecking(true); try { setChk(await posAiUsageScreenApi.check()); } catch (e: any) { setChk({ error: e?.message || 'error' }); } finally { setChecking(false); } };
  const liveOf = useMemo(() => new Map<string, any>((rc?.rows || []).map((r: any) => [r.code, r])), [rc]);

  const groups = useMemo(() => {
    const g: Record<string, PosAiPackage[]> = {};
    for (const p of pkgs || []) { const c = p.category || 'other'; (g[c] ||= []).push(p); }
    return g;
  }, [pkgs]);

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!pkgs) return <div className="work"><div className="state">{t('pos.loading_ai_center')}</div></div>;

  const active = pkgs.filter((p) => p.subscription?.status === 'active' || (p.accessible && p.subscription?.status !== 'trialing'));
  const trialing = pkgs.filter((p) => p.subscription?.status === 'trialing');
  const totalUsed = pkgs.reduce((a, p) => a + (p.used || 0), 0);
  const monthlyCost = pkgs.filter((p) => p.subscription?.status === 'active').reduce((a, p) => a + (p.monthlyPriceCents || 0), 0);
  const kpis = rc ? [
    { l: t('aic.kpi.paid'), v: String(rc.now.paidActive) },
    { l: t('aic.kpi.trial'), v: String(rc.now.trialing) },
    { l: t('aic.kpi.canRun'), v: `${rc.now.canRunNow} / ${rc.now.catalog}` },
    { l: t('aic.kpi.runs'), v: Number(rc.monthEvents).toLocaleString(displayLocale()) },
    { l: t('aic.kpi.blocked'), v: Number(rc.monthBlocked).toLocaleString(displayLocale()) },
    { l: t('aic.kpi.errors'), v: Number(rc.monthErrors).toLocaleString(displayLocale()) },
    { l: t('aic.kpi.cost'), v: money(monthlyCost) },
    { l: t('pos.bookings_by_ai'), v: ov?.kpis.bookingsCapturedByAi.tracked ? String(ov.kpis.bookingsCapturedByAi.value) : '—', note: !ov?.kpis.bookingsCapturedByAi.tracked },
  ] : [
    { l: t('pos.active_assistants'), v: String(active.length) },
    { l: t('pos.on_trial'), v: String(trialing.length) },
    { l: t('pos.available'), v: String(pkgs.length) },
    { l: t('pos.ai_usage_mo'), v: totalUsed.toLocaleString() },
    { l: t('pos.monthly_ai_cost'), v: money(monthlyCost) },
    { l: t('pos.customer_sentiment'), v: ov?.kpis.customerSentiment.tracked ? `${ov.kpis.customerSentiment.value}/5` : '—', note: !ov?.kpis.customerSentiment.tracked },
    { l: t('pos.bookings_by_ai'), v: ov?.kpis.bookingsCapturedByAi.tracked ? String(ov.kpis.bookingsCapturedByAi.value) : '—', note: !ov?.kpis.bookingsCapturedByAi.tracked },
    { l: t('pos.ai_conversations'), v: ov?.kpis.aiConversationsToday.tracked ? String(ov.kpis.aiConversationsToday.value) : '—', note: !ov?.kpis.aiConversationsToday.tracked },
  ];

  return (
    <div className="work">
      <div className="vh flex justify-between gap-3 flex-col sm:flex-row" style={{ display: 'flex', alignItems: 'flex-start' }}><div><h1>{t('pos.ai_center')}</h1>
        <div className="sub mb-3">{t('pos.manage_ai_assistants_automations_and_intelligence_1tgd')}</div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn w-fit whitespace-nowrap" onClick={() => nav('/tenant/ai/plans')}>{t('pos.view_plans_bundles')}</button>
          <button className="btn ghost w-fit whitespace-nowrap" onClick={() => setTick((x) => x + 1)}>{t('aic.refresh')}</button>
          <button className="btn ghost w-fit whitespace-nowrap" disabled={checking} onClick={runCheck}>{checking ? t('aic.checking') : t('aic.check')}</button>
          <button className="btn ghost w-fit whitespace-nowrap" onClick={() => setDlg({ kind: 'history' })} data-testid="aic-history">{t('aic.history')}</button>
        </div></div>

      {rc === null ? <div className="state" role="alert" style={{ marginBottom: 10 }}>{t('aic.unavailable')}</div> : null}
      {rc ? (
        <section style={{ ...cardBox, marginBottom: 12 }} data-testid="aic-recon">
          {rc.staleTrialRows > 0 || rc.old.running !== rc.now.canRunNow ? (<>
            <div style={headStyle}>{t('aic.recon.title')}</div>
            <div className="s">{t('aic.recon.body', { old: rc.old.onTrial, stale: rc.staleTrialRows, trial: rc.now.trialing, paid: rc.now.paidActive, run: rc.now.canRunNow })}</div>
          </>) : <div className="s">{t('aic.recon.ok')}</div>}
          <div className="s" style={{ marginTop: 6, color: '#8A7A66' }}>{t('aic.recon.gate', { mode: t('aic.mode.' + rc.enforcement.featureRoutes) })}</div>
        </section>
      ) : null}
      {chk ? (
        <section style={{ ...cardBox, marginBottom: 12 }} data-testid="aic-check">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><div style={headStyle}>{t('aic.check.title')}</div><button className="btn ghost" onClick={() => setChk(null)}>{t('aic.check.close')}</button></div>
          {chk.error ? <div className="err">{chk.error}</div> : (chk.checks || []).map((c: any) => (
            <div key={c.key} style={{ display: 'flex', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
              <span className={'pill ' + (c.state === 'PASSED' ? 'ok' : 'warn')}>{t('aiux.state.' + c.state)}</span>
              <div><div style={{ fontWeight: 700, fontSize: 13 }}>{t('aiux.k.' + c.key)}</div><div className="s">{t(`aiux.d.${c.key}.${c.state}`)}</div></div>
            </div>
          ))}
        </section>
      ) : null}

      <div className="kpis">{kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v" style={(c as any).note ? { color: '#8A7A66' } : undefined}>{c.v}</div>{(c as any).note ? <div className="s" style={{ color: '#8A7A66' }}>{t('pos.activity_feed_pending')}</div> : null}</div>))}</div>

      {/* AI Command Center — real assistants by area */}
      <section style={cardBox} className='mb-3'>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div style={headStyle}>{t('pos.ai_command_center')}</div>
          <span className="pill ok" >{rc ? rc.now.canRunNow : active.length + trialing.length} {t('pos.running')}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-1">
          {Object.keys(groups).sort().map((cat) => (
            <div key={cat} className='border rounded-md border-[var(--line)] p-2'>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8A7A66', textTransform: 'uppercase', letterSpacing: 0.4, margin: '4px 0 6px' }}>{CAT_LABEL[cat] || cat}</div>
              {groups[cat].map((p) => {
                const live = liveOf.get(p.code);
                const st = statusOf(p, live);
                const limit = p.subscription?.usageLimit || p.includedUsageLimit || 0;
                const usedPct = limit > 0 ? Math.min(100, Math.round((p.used / limit) * 100)) : 0;
                return (
                  <div key={p.code} role="button" tabIndex={0} data-testid={`aic-card-${p.code}`} aria-label={t('aic.openDetails', { name: p.name })}
                    onClick={() => setDlg({ kind: 'detail', code: p.code })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDlg({ kind: 'detail', code: p.code }); } }}
                    style={{ borderBottom: '1px solid var(--line)', padding: '8px 4px', cursor: 'pointer', minHeight: 44 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                      <span className={'pill ' + st.tone} >{st.label}</span>
                    </div>
                    {live && !live.gate?.allowed && ['active', 'trialing'].includes(live.state) ? <div className="s" style={{ color: '#A33' }}>{t('aic.reason', { r: humanizeCode(live.gate.reason) })}</div> : null}
                    {limit > 0 ? (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ display: 'flex', fontSize: 11, color: '#8A7A66' }}><span>{p.used.toLocaleString()} / {limit.toLocaleString()} {growthCode(p.usageUnit)}</span><span >{usedPct}%</span></div>
                        <div style={{ height: 6, background: '#EFE6D6', borderRadius: 3, marginTop: 2 }}><div style={{ width: `${usedPct}%`, height: 6, background: '#A96F22', borderRadius: 3 }} /></div>
                      </div>
                    ) : <div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{p.trialAvailable ? t('pos.usageunit_trial_available', { usageUnit: growthCode(p.usageUnit) }) : t('growth.aiCenter.perMonth', { amount: money(p.monthlyPriceCents) })}</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Intelligence modules — honest "needs activity feed" with links */}
      <div className='mb-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'>
        {[
          { t: t('pos.ai_insights_recommendations'), d: t('pos.sentiment_trend_conversion_trend_staffing_revenue_obyq'), r: '/tenant/ai/customer-insights', b: t('growth.aiCenter.openInsights') },
        ].map((m) => (
          <div key={m.t} style={cardBox}>
            <div style={headStyle}>{m.t}</div>
            <div style={{ fontSize: 12, color: '#8A7A66' }}>{m.d} <span style={{ color: 'var(--danger, #B4673B)' }}>{t('pos.not_connected_yet')}</span></div>
            <button onClick={() => nav(m.r)} style={{ marginTop: 8, height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: '#FFFCF6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{m.b}</button>
          </div>
        ))}
      </div>

      {/* Recent AI Activity Log — real rows from ai_usage_logs (empty state is honest, not invented) */}
      <section className='mb-3' style={cardBox}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <div style={headStyle}>{t('pos.recent_ai_activity_log')}</div>
          <span className="pill" style={{ color: '#8A7A66' }}>{ov ? t('growth.aiCenter.logged', { count: String(ov.activity.length) }) : '—'}</span>
        </div>
        {ov && ov.kpis.suggestedUpsellRevenueCents.tracked ? (
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 4 }}>
            {t('pos.ai_influenced_revenue_today')}{' '}{money(ov.kpis.suggestedUpsellRevenueCents.value || 0)} {t('pos.accepted_ai_suggestions_separate_from_collected_1ug2')}
          </div>
        ) : null}
        {ov && ov.kpis.aiTimeSavedMinutes.tracked ? (
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 4 }}>
            {t('pos.ai_time_saved')}{fmtMin(ov.kpis.aiTimeSavedMinutes.value)} {t('pos.today')}{' '}<span style={{ fontStyle: 'italic' }}>{t('pos.estimate_2')}{' '}{growthCode(ov.kpis.aiTimeSavedMinutes.source)})</span>
          </div>
        ) : null}
        {ov && (ov.callIntelligence.callsHandled.tracked) ? (
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 4 }}>
            {t('pos.call_intelligence')}{' '}{ov.callIntelligence.callsHandled.value} {t('pos.ai_handled_2')}{' '}{ov.callIntelligence.recovered.value} {t('pos.recovered')}{ov.callIntelligence.callToBookingRatePct.tracked ? t('pos.value_call_to_booking', { value: String(ov.callIntelligence.callToBookingRatePct.value) }) : ''} {t('pos.today_3')}
          </div>
        ) : ov ? (
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 4 }}>{t('pos.call_intelligence_no_calls_logged_today_7c9t')}{' '}<code>{t('pos.tenant_ai_call_intelligence_events')}</code>.</div>
        ) : null}
        {ov && (ov.automation.successRatePct.tracked || ov.automation.sentToday.tracked) ? (
          <div style={{ fontSize: 11.5, color: '#8A7A66', marginBottom: 6 }}>
            {t('pos.automation_messaging')}{' '}{ov.automation.sentToday.tracked ? t('pos.value_sent_today', { value: String(ov.automation.sentToday.value) }) : t('pos.sent_4')} · {ov.automation.successRatePct.tracked ? t('pos.value_success_7d', { value: String(ov.automation.successRatePct.value) }) : t('pos.success_rate_pending')}
          </div>
        ) : null}
        {ov && ov.activity.length > 0 ? (
          <div className="overflow-x-auto w-full">
            <div style={{ display: 'grid', gridTemplateColumns: '90px minmax(220px, max-content) 150px 100px', gap: '6px 24px', fontSize: 12, justifyContent: 'start', minWidth: 'max-content' }}>
              <div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.time')}</div><div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.assistant')}</div><div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.action')}</div><div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.status')}</div>
              {ov.activity.map((a, i) => (
                <Fragment key={i}>
                  <div>{fmtInZone(a.at, { hour: 'numeric', minute: '2-digit' })}</div>
                  <div style={{ fontWeight: 600 }}>{a.assistant}</div>
                  <div>{growthCode(a.action, 'aiAction')}</div>
                  <div><span className={'pill ' + (a.status === 'success' ? 'ok' : a.status.startsWith('blocked') ? 'warn' : '')}>{growthCode(a.status)}</span></div>
                </Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#8A7A66' }}>{ov ? t('pos.no_ai_activity_logged_yet_ai_1ons') : t('pos.loading')}</div>
        )}
      </section>

      {/* AI Receptionist & Call Intelligence — real summary from call_intelligence_events (honest empty states) */}
      <section className='mb-3' style={cardBox}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={headStyle}>{t('pos.ai_receptionist_call_intelligence')}</div>
          <span className="pill" style={{ color: '#8A7A66' }}>{ci ? t('pos.totaltoday_calls_today', { totalToday: String(ci.totalToday) }) : '—'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8A7A66', marginBottom: 6 }}>{t('pos.missed_calls_queue')}{' '}{ci ? `(${ci.missedToday})` : ''}</div>
            {ci && ci.missedQueue.length > 0 ? ci.missedQueue.map((m, i) => (
              <div key={i} style={{ display: 'flex', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
                <span>{m.callerPhone || t('pos.unknown_caller')}</span>
                <span style={{ color: '#8A7A66' }}>{fmtInZone(m.at, { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            )) : <div style={{ fontSize: 12, color: '#8A7A66' }}>{ci ? t('pos.no_missed_calls_today') : t('pos.loading')}</div>}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8A7A66', marginBottom: 6 }}>{t('pos.recovered_bookings')}{' '}{ci ? `(${ci.recoveredToday})` : ''}</div>
            {ci && ci.recovered.length > 0 ? ci.recovered.map((r, i) => (
              <div key={i} style={{ display: 'flex', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
                <span>{r.appointmentId ? t('growth.aiCenter.apptRef', { id: r.appointmentId.slice(0, 8) }) : t('pos.recovered_2')}</span>
                <span style={{ color: '#8A7A66' }}>{fmtInZone(r.at, { hour: 'numeric', minute: '2-digit' })}</span>
              </div>
            )) : <div style={{ fontSize: 12, color: '#8A7A66' }}>{ci ? t('pos.no_recovered_bookings_today') : t('pos.loading')}</div>}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8A7A66', marginBottom: 6 }}>{t('pos.call_summary')}</div>
            <div style={{ fontSize: 12, display: 'grid', gap: 3 }}>
              <div style={{ display: 'flex' }}><span>{t('pos.total_calls')}</span><span style={{ fontWeight: 700 }}>{ci ? ci.totalToday : '—'}</span></div>
              <div style={{ display: 'flex' }}><span>{t('pos.answered_by_ai')}</span><span style={{ fontWeight: 700 }}>{ci ? ci.aiHandledToday : '—'}</span></div>
              <div style={{ display: 'flex' }}><span>{t('pos.missed_calls')}</span><span style={{ fontWeight: 700 }}>{ci ? ci.missedToday : '—'}</span></div>
              <div style={{ display: 'flex' }}><span>{t('pos.avg_duration')}</span><span style={{ fontWeight: 700 }}>{fmtDur(ci ? ci.avgDurationSeconds : null)}</span></div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#8A7A66', marginBottom: 6 }}>{t('pos.conversion_stats')}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#A96F22', fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{ci && ci.callToBookingRatePct != null ? `${ci.callToBookingRatePct}%` : '—'}</div>
            <div style={{ fontSize: 11.5, color: '#8A7A66' }}>{t('pos.call_to_booking_rate')}{ci && ci.callToBookingRatePct == null ? t('pos.no_answered_calls_today') : ''}</div>
          </div>
        </div>
      </section>

      {/* AI Booking Assistant — real headline from appointments */}
      <section style={cardBox}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={headStyle}>{t('pos.ai_booking_assistant')}</div>
          <span className="pill" style={{ color: '#8A7A66' }}>{t('pos.today_2')}</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: t('pos.bookings_completed'), m: ov?.bookingAssistant.completed },
            { l: t('pos.captured_by_ai'), m: ov?.bookingAssistant.aiBookings },
            { l: t('pos.rebookings'), m: ov?.bookingAssistant.rebookings },
            { l: t('pos.appointment_fill_rate'), m: ov?.bookingAssistant.fillRatePct },
          ].map((x) => (
            <div key={x.l}>
              <div style={{ fontSize: 11.5, color: '#8A7A66' }}>{x.l}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: (x as any).pending ? '#8A7A66' : '#A96F22', fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{(x as any).pending ? '—' : (x.m && x.m.tracked ? x.m.value + (x.m.unit || '') : '—')}</div>
              {(x as any).pending ? <div style={{ fontSize: 10.5, color: '#8A7A66' }}>{(x as any).pending}</div> : null}
            </div>
          ))}
        </div>
      </section>

      {/* Automation Workflows — Appointment Reminders is real (appointment_reminder_attempts); others honestly pending */}
      <section className='mb-3' style={cardBox}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}><div style={headStyle}>{t('pos.automation_workflows')}</div></div>
        {ov ? (
          <div className="overflow-x-auto w-full">
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, max-content) 110px 120px', gap: '6px 24px', fontSize: 12, justifyContent: 'start', minWidth: 'max-content' }}>
              <div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.workflow')}</div><div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.sent_today')}</div><div style={{ fontWeight: 700, color: '#8A7A66' }}>{t('pos.success_rate')}</div>
              {ov.workflows.map((w) => (
                <Fragment key={w.name}>
                  <div style={{ fontWeight: 600 }}>{w.name}</div>
                  <div>{w.sentToday.tracked ? w.sentToday.value : <span style={{ color: '#8A7A66' }}>—</span>}</div>
                  <div>{w.successRatePct.tracked ? `${w.successRatePct.value}%` : <span style={{ color: '#8A7A66' }}>{t('pos.pending_2')}</span>}</div>
                </Fragment>
              ))}
            </div>
          </div>
        ) : <div style={{ fontSize: 12, color: '#8A7A66' }}>{t('pos.loading')}</div>}
        {ov && ov.campaigns.sent.tracked ? (
          <div style={{ fontSize: 11.5, color: '#3A3127', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
            {t('pos.marketing_campaigns')}{' '}<b>{ov.campaigns.sent.value}</b> {t('pos.sent_3')}{' '}<b>{ov.campaigns.bookings.value}</b> {t('pos.bookings')}{ov.campaigns.conversionPct.tracked ? t('pos.value_conversion', { value: String(ov.campaigns.conversionPct.value) }) : ''} · <b>{money(ov.campaigns.revenueCents.value || 0)}</b> {t('pos.attributed_revenue')}
          </div>
        ) : null}
        <div style={{ fontSize: 10.5, color: '#8A7A66', marginTop: 6 }}>{t('pos.appointment_reminders_is_live_from_real_io8g')}</div>
      </section>

      {/* AI Control Modes — the human-controlled operating model (§3), enforced on the backend */}
      <section className='mb-3' style={cardBox}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}><div style={headStyle}>{t('pos.ai_control_modes')}</div><span className="pill" style={{ color: '#8A7A66' }}>{t('pos.backend_enforced')}</span></div>
        {modes ? (
          <div className="overflow-x-auto w-full"><div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, max-content) 180px', gap: '6px 24px', fontSize: 12, justifyContent: 'start', minWidth: 'max-content' }}>
            {modes.slice(0, 8).map((m) => (
              <Fragment key={m.assistantKey}>
                <div style={{ fontWeight: 600 }}>{statusLabelOrNull('aiAssistant', m.assistantKey) ?? humanizeCode(m.assistantKey.replace(/^ai_/, ''))}</div>
                <div>
                  <select value={m.mode} aria-label={t('pos.control_mode_for_assistantkey', { assistantKey: String(m.assistantKey) })} style={{ fontSize: 11.5, padding: '2px 4px', border: '1px solid var(--line)', borderRadius: 6, background: '#fff', color: '#3A3127' }}
                    onChange={async (e) => {
                      const mode = e.target.value; const prev = m.mode;
                      setModes((cur) => cur ? cur.map((x) => x.assistantKey === m.assistantKey ? { ...x, mode } : x) : cur);
                      try { const updated = await posAiApi.setControlMode(m.assistantKey, mode); setModes((cur) => cur ? cur.map((x) => x.assistantKey === m.assistantKey ? updated : x) : cur); setModeNote(''); }
                      catch { setModes((cur) => cur ? cur.map((x) => x.assistantKey === m.assistantKey ? { ...x, mode: prev } : x) : cur); setModeNote(t('growth.aiCenter.modeNeedsOwner')); }
                    }}>
                    {CONTROL_MODE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                </div>
              </Fragment>
            ))}
          </div>
          </div>
        ) : <div style={{ fontSize: 12, color: '#8A7A66' }}>{t('pos.loading')}</div>}
        {modeNote ? <div style={{ fontSize: 10.5, color: 'var(--danger, #B4673B)', marginTop: 6 }}>{modeNote}</div> : null}
        <div style={{ fontSize: 10.5, color: '#8A7A66', marginTop: 6 }}>{t('pos.owners_set_each_assistant_s_mode_jazd')}</div>
      </section>

      <section className='mb-3' style={cardBox}>
        <div style={headStyle}>{t('pos.ai_attributed_revenue')}</div>
        {rev ? (
          <>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 11, color: '#8A7A66' }}>{t('pos.today_2')}</div><div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{money(rev.todayCents)}</div></div>
              <div><div style={{ fontSize: 11, color: '#8A7A66' }}>{t('pos.this_week')}</div><div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{money(rev.weekCents)}</div></div>
            </div>
            {Object.keys(rev.byKindToday || {}).length > 0 ? (
              <div style={{ marginTop: 10, fontSize: 12, color: '#6B5D4C' }}>
                {t('pos.today_by_source')}{' '}{Object.entries(rev.byKindToday).map(([k, c]) => `${growthCode(k, 'aiRevenueKind')} ${money(c)}`).join(' · ')}
              </div>
            ) : <div style={{ marginTop: 10, fontSize: 11.5, color: '#8A7A66' }}>{t('pos.no_ai_attributed_revenue_recorded_today_1fyk')}</div>}
          </>
        ) : <div style={{ fontSize: 11.5, color: '#8A7A66' }}>{t('pos.revenue_attribution_unavailable')}</div>}
      </section>

      <section className='mb-3' style={cardBox}>
        <div style={headStyle}>{t('pos.automation_runs_today')}</div>
        {runs && Object.keys(runs).length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3" style={{ gap: 10 }}>
            {Object.values(runs).map((w) => (
              <div key={w.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', background: '#FFFDF9' }}>
                <div style={{ fontSize: 11.5, color: '#8A7A66', textTransform: 'capitalize' }}>{growthCode(String(w.key), 'aiWidget')}</div>
                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{w.sentToday}</div>
                <div style={{ fontSize: 11, color: '#8A7A66' }}>{t('pos.success')}{' '}{w.successRatePct == null ? '—' : `${w.successRatePct}%`}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 11.5, color: '#8A7A66' }}>{t('pos.no_automation_runs_recorded_today_yet')}</div>}
      </section>

      <section className='mb-3' style={cardBox}>
        <div style={headStyle}>{t('pos.ai_quick_actions')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { l: t('pos.manage_subscriptions'), fn: () => nav('/tenant/account/subscription') },
            { l: t('pos.ai_reception_copilot'), fn: () => nav('/tenant/ai/reception-copilot') },
            { l: t('pos.ai_booking_assistant'), fn: () => nav('/tenant/ai/booking') },
            { l: t('pos.ai_marketing'), fn: () => nav('/tenant/ai/marketing') },
            { l: t('pos.ai_customer_insights'), fn: () => nav('/tenant/ai/customer-insights') },
            { l: t('pos.generate_report'), fn: () => nav('/reports') },
          ].map((a) => <button key={a.l} onClick={a.fn} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: '#FFFCF6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{a.l}</button>)}
        </div>
      </section>
      {note ? <div className="state" role="status" style={{ marginTop: 8 }}>{note}</div> : null}
      {dlg?.kind === 'detail' ? <DetailDialog code={dlg.code} onClose={() => setDlg(null)} onChanged={(text) => { setNote(text); setTick((x) => x + 1); }}
        openHistory={(code) => setDlg({ kind: 'history', code })} openModule={(r) => nav(r)} openBilling={() => nav('/tenant/account/subscription')} /> : null}
      {dlg?.kind === 'history' ? <HistoryDialog initialCode={dlg.code} canExport={can('reports.export') || can('subscription.manage')} onClose={() => setDlg(null)} /> : null}
    </div>
  );
}
