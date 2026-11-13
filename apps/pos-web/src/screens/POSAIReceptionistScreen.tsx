// POSAIReceptionistScreen.tsx — AI Center → AI Receptionist (/tenant/ai/receptionist). Rebuilt in place for the AI Receptionist
// Complete Build & Repair Guide (Oct 31 2026); the original composition is preserved: title + status, the five KPI cards,
// the 8-step setup checklist, Connections, Quick Actions (same routes) and Recent Calls.
// What changed: every state comes from /pos/ai/receptionist-center/* evidence. Twilio "Connected" used to mean only that the
// PLATFORM's env credentials existed; Retell was "connected" from a saved key; steps 4/5/7/8 were hard-coded. Now:
//   • stage: Not configured → Configured → Ready for test → Test-call verified → Live (Degraded when live but a gate fails)
//   • Check AI Receptionist System — read-only, per-dependency state with evidence, impact, remedy and role
//   • KPI cards with a period (salon-local whole days) and published definitions; — when there is no denominator
//   • call history: scoped search (calls / customers / appointments / AI activity), status + outcome filters, From/To month
//     calendar with a date basis, numbered pages 10/20/50, newest first
//   • call overlay with Close: generated summary flagged, masked caller + identity status, appointments, follow-ups,
//     handoffs (requested / attempted / completed / failed), AI actions, transcript only for managers (audited), Open Booking
//   • priority list: urgent + oldest first; Front Desk prepares a follow-up task, an owner/manager confirms — texts and
//     booking changes are never executed here
//   • controls (owner/manager): arm booking actions, verify the test call (a real recorded call), activate — all gated.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posAiReceptionistCenterApi, type RcCallsQuery, type RcControlAction } from '../api/posAiReceptionistCenterApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtDateTime } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry, useDebounced, requestId } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { statusLabel, humanizeCode } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const TONE: Record<string, string> = { READY: 'ok', WARNING: 'warn', FAILED: 'bad', NOT_CONFIGURED: 'warn', DISABLED: 'muted', UNKNOWN: 'bad', BLOCKED_EXTERNAL: 'muted' };
const STEP_TONE: Record<string, string> = { verified: 'ok', configured: 'warn', blocked: 'bad', incomplete: 'muted' };
const STAGE_TONE: Record<string, string> = { live: 'ok', test_call_verified: 'ok', ready_for_test: 'warn', configured: 'warn', not_configured: 'muted', degraded: 'bad' };
const SCOPES = ['calls', 'customers', 'appointments', 'activity'] as const;
const CALL_STATUSES = ['completed', 'missed', 'abandoned', 'failed', 'handed_off', 'in_progress'] as const;
const BASES = ['call_started', 'call_ended', 'recorded', 'last_event'] as const;
const LENGTHS: Record<string, [number | undefined, number | undefined]> = { short: [undefined, 59], medium: [60, 299], long: [300, undefined] };
// URL filters (A15 Nov 6): scope, words and call filters live in the address (rp* keys) so a refresh or a shared link
// reopens the same list. LIVE_MS: the list, KPIs and priorities re-read on this interval while the tab is visible.
const LIVE_MS = 30_000;
const URL_KEYS = ['rpscope', 'rpq', 'rpstatus', 'rpoutcome', 'rpbasis', 'rpperiod', 'rpfrom', 'rpto', 'rpsort', 'rppage', 'rpsize', 'rpagent', 'rpservice', 'rpdir', 'rplen'] as const;
function readRpUrl() { try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); } }
function writeRpUrl(v: Record<string, string | number | undefined>) {
  try {
    const p = new URLSearchParams(window.location.search);
    for (const k of URL_KEYS) p.delete(k);
    for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== '' && x !== null) p.set(k, String(x));
    const qs = p.toString(); window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? '?' + qs : ''));
  } catch { /* no URL in this host */ }
}
function lengthOf(f: RcCallsQuery) { return Object.entries(LENGTHS).find(([, [a, b]]) => a === f.minSeconds && b === f.maxSeconds)?.[0] ?? ''; }
function callsFromUrl(): RcCallsQuery {
  const u = readRpUrl(); const g = (k: string) => u.get(k) ?? undefined; const len = LENGTHS[u.get('rplen') ?? ''];
  return { page: Math.max(1, Number(u.get('rppage')) || 1), pageSize: [10, 20, 50].includes(Number(u.get('rpsize'))) ? Number(u.get('rpsize')) : 10,
    sort: g('rpsort') ?? 'newest', dateBasis: (BASES as readonly string[]).includes(u.get('rpbasis') ?? '') ? u.get('rpbasis')! : 'call_started',
    status: g('rpstatus'), outcome: g('rpoutcome'), period: g('rpperiod'), from: g('rpfrom'), to: g('rpto'), agent: g('rpagent'), service: g('rpservice'), direction: g('rpdir'),
    minSeconds: len?.[0], maxSeconds: len?.[1] };
}
const PERIODS = ['today', 'week', 'month', 'year', 'custom'] as const;
const today = () => deviceToday();
const dur = (s: number | null | undefined) => (s == null ? '—' : `${Math.floor(s / 60)}m ${s % 60}s`);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const when = (x: string | null | undefined) => (x ? fmtDateTime(x) : '—');

function Badge({ s, tone, label }: { s: string; tone?: string; label?: string }) { return <span className={`rcp-badge rcp-${tone ?? TONE[s] ?? 'muted'}`} data-testid={`rcp-state-${s}`}>{label ?? t(`rcpt.state.${s}`)}</span>; }
function Metric({ id, label, value, sub }: { id: string; label: string; value: string; sub?: string }) {
  return <div className="rcp-metric" data-testid={`rcp-kpi-${id}`}><div className="rcp-metric-l">{label}</div><div className="rcp-metric-v">{value}</div>{sub ? <div className="rcp-metric-s">{sub}</div> : null}</div>;
}

// Extras · AI Receptionist 08 — Consent-Safe Call Insights: the server's counts over the KPI window (no caller data). Question
// categories are the voice AI's own labels and are marked AI-derived; service interests are recorded appointment facts.
type RcInsightCount = { label: string; count: number };
const intentLabel = (l: string) => { const k = `rcpt.intent.${l}`; const x = t(k); return x !== k ? x : humanizeCode(l); };
function CallInsights({ ins }: { ins: { questionCategories: RcInsightCount[]; callsWithCategories: number; serviceInterests: RcInsightCount[] } }) {
  const list = (rows: RcInsightCount[], label: (l: string) => string, id: string) => rows.length === 0
    ? <div className="rcp-muted" data-testid={`rcp-ins-${id}-none`}>{t('rcpt.ins.none')}</div>
    : <ol style={{ margin: 0, paddingLeft: 18 }} data-testid={`rcp-ins-${id}`}>{rows.map((r) => <li key={r.label}>{label(r.label)} <span className="rcp-muted">· {r.count}</span></li>)}</ol>;
  return (
    <div data-testid="rcp-insights" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 10 }}>
      <div>
        <div style={{ fontWeight: 700 }}>{t('rcpt.ins.questions')} <span className="rcp-muted" data-testid="rcp-ins-ai-label">· {t('rcpt.ins.aiDerived')}</span></div>
        <div className="rcp-muted">{t('rcpt.ins.questionsSub', { n: ins.callsWithCategories })}</div>
        {list(ins.questionCategories, intentLabel, 'questions')}
      </div>
      <div>
        <div style={{ fontWeight: 700 }}>{t('rcpt.ins.services')}</div>
        <div className="rcp-muted">{t('rcpt.ins.servicesSub')}</div>
        {list(ins.serviceInterests, (l) => l, 'services')}
      </div>
      <div className="rcp-muted" style={{ gridColumn: '1 / -1' }}>{t('rcpt.ins.privacy')}</div>
    </div>
  );
}

export function POSAIReceptionistScreen() {
  const nav = useNavigate(); const can = useCan(); const canManage = can('ai.manage');
  const [ready, setReady] = useState<any>(null); const [readyErr, setReadyErr] = useState<string | null>(null);
  const [period, setPeriod] = useState<{ period: string; from?: string; to?: string }>({ period: 'month' });
  const [kpi, setKpi] = useState<any>(null); const [kpiErr, setKpiErr] = useState<string | null>(null);
  const [scope, setScope] = useState<typeof SCOPES[number]>(() => { const v = readRpUrl().get('rpscope') ?? ''; return (SCOPES as readonly string[]).includes(v) ? v as typeof SCOPES[number] : 'calls'; });
  const [search, setSearch] = useState(() => readRpUrl().get('rpq') ?? ''); const dq = useDebounced(search, 300);
  const [f, setF] = useState<RcCallsQuery>(callsFromUrl);
  const [svc, setSvc] = useState(() => readRpUrl().get('rpservice') ?? ''); const dsvc = useDebounced(svc, 300);
  const [liveAt, setLiveAt] = useState<string | null>(null);
  const [list, setList] = useState<any>(null); const [listErr, setListErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [cal, setCal] = useState<null | 'kpi' | 'calls'>(null);
  const [prio, setPrio] = useState<any>(null); const [prioPage, setPrioPage] = useState(1); const [prioErr, setPrioErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | 'health' | 'history' | 'capabilities'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastCheck, setLastCheck] = useState<any>(null);

  const loadReady = useCallback(() => { setReadyErr(null); posAiReceptionistCenterApi.readiness().then(setReady).catch((e) => setReadyErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, []);
  const loadKpi = useCallback(() => { setKpiErr(null); posAiReceptionistCenterApi.kpis(period).then(setKpi).catch((e) => setKpiErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [period]);
  const loadPrio = useCallback(() => { setPrioErr(null); posAiReceptionistCenterApi.priority({ page: prioPage, pageSize: 10 }).then(setPrio).catch((e) => setPrioErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [prioPage]);
  const loadList = useCallback(async () => {
    setLoading(true); setListErr(null);
    try {
      if (scope === 'calls') setList(await posAiReceptionistCenterApi.calls({ ...f, q: dq }));
      else setList(await posAiReceptionistCenterApi.search({ scope, q: dq, page: f.page, pageSize: f.pageSize }));
    } catch (e) { setListErr(errorTextOf(e, tx('pos.something_went_wrong'))); setList(null); } finally { setLoading(false); }
  }, [scope, dq, f]);
  useEffect(() => { loadReady(); posAiReceptionistCenterApi.lastHealth().then(setLastCheck).catch((e) => setNotice(errorTextOf(e, tx('pos.something_went_wrong')))); }, [loadReady]);
  useEffect(() => { loadKpi(); }, [loadKpi]);
  useEffect(() => { loadPrio(); }, [loadPrio]);
  useEffect(() => { void loadList(); }, [loadList]);
  const firstFilter = useRef(true);
  useEffect(() => { if (firstFilter.current) { firstFilter.current = false; return; } setF((x) => ({ ...x, page: 1 })); }, [dq, scope]);
  useEffect(() => { setF((x) => (x.service === (dsvc || undefined) ? x : { ...x, service: dsvc || undefined, page: 1 })); }, [dsvc]);
  useEffect(() => {
    writeRpUrl({ rpscope: scope === 'calls' ? undefined : scope, rpq: dq || undefined, rpstatus: f.status, rpoutcome: f.outcome, rpbasis: f.dateBasis === 'call_started' ? undefined : f.dateBasis,
      rpperiod: f.period, rpfrom: f.from, rpto: f.to, rpsort: f.sort === 'newest' ? undefined : f.sort, rppage: (f.page ?? 1) > 1 ? f.page : undefined, rpsize: f.pageSize === 10 ? undefined : f.pageSize,
      rpagent: f.agent, rpservice: f.service, rpdir: f.direction, rplen: lengthOf(f) || undefined });
  }, [scope, dq, f]);
  // live updates (A15 Nov 6): re-read while the tab is visible; nothing re-orders under the user's finger — a page keeps its filters
  useEffect(() => {
    const tick = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; loadKpi(); loadPrio(); void loadList(); setLiveAt(new Date().toISOString()); };
    const h = window.setInterval(tick, LIVE_MS);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(h); document.removeEventListener('visibilitychange', onVis); };
  }, [loadKpi, loadPrio, loadList]);
  const setFilter = (patch: Partial<RcCallsQuery>) => setF((x) => ({ ...x, ...patch, page: 1 }));
  const refreshAll = () => { loadReady(); loadKpi(); loadPrio(); void loadList(); };
  const ctl = ready?.control;

  const [pending, setPending] = useState<null | { action: RcControlAction; providerCallRef?: string }>(null);
  const control = (action: RcControlAction, extra: { providerCallRef?: string } = {}) => { setNotice(null); setPending({ action, ...extra }); };
  const submitControl = async (reason: string) => {
    if (!pending) return;
    try {
      await posAiReceptionistCenterApi.control({ action: pending.action, expectedVersion: ctl?.version ?? 0, reason, providerCallRef: pending.providerCallRef ?? null, idempotencyKey: requestId() });
      setNotice(t(`rcpt.done.${pending.action}`)); setPending(null); loadReady();
    } catch (e: any) {
      const failing: string[] = e?.body?.details?.failing ?? e?.details?.failing ?? [];
      setPending(null);
      setNotice(errorTextOf(e, tx('pos.something_went_wrong')) + (failing.length ? ' ' + t('rcpt.failingGates', { list: failing.map((x) => t(`rcpt.gate.${x}`)).join(', ') }) : ''));
    }
  };

  const stage = ready?.stage ?? 'not_configured';
  return (
    <div className="work rcp" data-testid="ai-receptionist">
      <div className="vh rcp-head">
        <div>
          <h1>{t('rcpt.title')}</h1>
          <div className="sub">{t('rcpt.subtitle')}</div>
        </div>
        <div className="rcp-head-actions">
          <Badge s={stage} tone={STAGE_TONE[stage]} label={t(`rcpt.stage.${stage}`)} />
          <button className="btn" data-testid="rcp-check" onClick={() => setDialog('health')}>{t('rcpt.check')}</button>
          <span className="rcp-muted" data-testid="rcp-last-check">{lastCheck ? t('rcpt.lastCheck', { state: t(`rcpt.state.${lastCheck.overall}`), at: when(lastCheck.checkedAt) }) : t('rcpt.neverChecked')}</span>
          <button className="btn ghost" data-testid="rcp-refresh" onClick={refreshAll}>{t('rcpt.refresh')}</button>
          <button className="btn ghost" onClick={() => document.getElementById('rcp-setup')?.scrollIntoView({ behavior: 'smooth' })}>{t('rcpt.viewSetup')}</button>
        </div>
      </div>
      {notice ? <div className="rcp-notice" role="status" data-testid="rcp-notice">{notice}</div> : null}

      {/* the original five cards, with a period */}
      <section className="rcp-kpis" data-testid="rcp-kpis">
        <div className="rcp-period">
          <select aria-label={t('rcpt.period')} value={period.period} onChange={(e) => (e.target.value === 'custom' ? setCal('kpi') : setPeriod({ period: e.target.value }))} data-testid="rcp-period">
            {PERIODS.map((p) => <option key={p} value={p}>{t(`rcpt.period.${p}`)}</option>)}
          </select>
          {kpi?.window ? <span className="rcp-muted" data-testid="rcp-window">{t('rcpt.windowLabel', { from: kpi.window.from, to: kpi.window.to })}</span> : null}
        </div>
        {kpiErr ? <ErrorRetry message={kpiErr} onRetry={loadKpi} /> : (
          <div className="rcp-kpi-row">
            <Metric id="calls" label={t('rcpt.kpi.calls')} value={kpi ? String(kpi.calls) : '…'} sub={kpi && kpi.voiceMinutes != null ? t('rcpt.kpi.minutes', { n: kpi.voiceMinutes }) : undefined} />
            <Metric id="booked" label={t('rcpt.kpi.booked')} value={kpi ? pct(kpi.booked.ratePct) : '…'} sub={kpi ? t('rcpt.kpi.bookedSub', { c: kpi.booked.confirmed, r: kpi.booked.requested, p: kpi.booked.pendingVerification ?? '—' }) : undefined} />
            <Metric id="handoffs" label={t('rcpt.kpi.handoffs')} value={kpi ? pct(kpi.handoffs.ratePct) : '…'} sub={kpi ? t('rcpt.kpi.handoffsSub', { r: kpi.handoffs.requested, c: kpi.handoffs.completed, f: kpi.handoffs.failed }) : undefined} />
            <Metric id="abandoned" label={t('rcpt.kpi.abandoned')} value={kpi ? pct(kpi.abandoned.ratePct) : '…'} sub={kpi ? t('rcpt.kpi.abandonedSub', { n: kpi.abandoned.count }) : undefined} />
            <Metric id="duration" label={t('rcpt.kpi.duration')} value={kpi ? dur(kpi.avgDurationSeconds) : '…'} />
          </div>
        )}
        <div className="rcp-muted rcp-def">{t('rcpt.kpi.definition')}</div>
        {kpi?.insights ? <CallInsights ins={kpi.insights} /> : null}
      </section>

      <div className="rcp-grid" id="rcp-setup">
        {/* the original 8-step checklist — computed from evidence */}
        <section className="panel rcp-card" data-testid="rcp-checklist">
          <div className="rcp-card-head"><h2>{t('rcpt.setup')}</h2>{ready ? <b className="rcp-gold">{t('rcpt.verifiedOf', { n: ready.verifiedSteps, total: ready.steps.length })}</b> : null}</div>
          {readyErr ? <ErrorRetry message={readyErr} onRetry={loadReady} /> : !ready ? <div className="state">{t('rcpt.loading')}</div> : (
            <>
              <div className="rcp-bar"><div style={{ width: `${ready.progressPct}%` }} /></div>
              {ready.steps.map((s: any, i: number) => (
                <div key={s.key} className="rcp-step" data-testid={`rcp-step-${s.key}`}>
                  <span className={`rcp-num rcp-${STEP_TONE[s.state]}`}>{i + 1}</span>
                  <div className="rcp-step-main"><div className="rcp-step-head"><b>{t(`rcpt.step.${s.key}`)}</b><Badge s={s.state} tone={STEP_TONE[s.state]} label={t(`rcpt.stepState.${s.state}`)} /></div><div className="rcp-detail">{s.detail}</div></div>
                  {s.route && s.state !== 'verified' ? <button className="btn ghost" onClick={() => nav(s.route)}>{t('rcpt.fix')}</button> : null}
                </div>
              ))}
              <div className="rcp-muted">{t('rcpt.checkedAt', { at: when(ready.checkedAt) })}</div>
            </>
          )}
        </section>

        <div className="rcp-col">
          <section className="panel rcp-card" data-testid="rcp-connections">
            <h2>{t('rcpt.connections')}</h2>
            {ready ? (
              <dl className="rcp-conn">
                <dt>{t('rcpt.conn.twilio')}</dt><dd data-testid="rcp-conn-twilio">{t(`rcpt.conn.tw.${ready.connections.twilio}`)}</dd>
                <dt>{t('rcpt.conn.retell')}</dt><dd data-testid="rcp-conn-retell">{t(`rcpt.conn.rt.${ready.connections.retell}`)}</dd>
                <dt>{t('rcpt.conn.key')}</dt><dd data-testid="rcp-conn-key">{t(`rcpt.conn.key.${ready.connections.integrationKey}`)}</dd>
                <dt>{t('rcpt.conn.booking')}</dt><dd data-testid="rcp-conn-booking">{t(`rcpt.conn.bk.${ready.connections.booking}`)}</dd>
              </dl>
            ) : <div className="state">{t('rcpt.loading')}</div>}
            <div className="rcp-muted">{t('rcpt.connNote')}</div>
            {ready && Array.isArray(ready.capabilities) ? <button type="button" className="btn ghost" data-testid="rcp-capabilities-open" onClick={() => setDialog('capabilities')}>{t('rcpt.cap.open')}</button> : null}
            {canManage && ready ? (
              <div className="rcp-controls" data-testid="rcp-controls">
                {ctl?.bookingArmed ? <button className="btn ghost" onClick={() => control('disarm_booking')}>{t('rcpt.ctl.disarm')}</button>
                  : <button className="btn ghost" data-testid="rcp-arm" onClick={() => control('arm_booking')}>{t('rcpt.ctl.arm')}</button>}
                {ctl?.activated ? <button className="btn ghost" onClick={() => control('deactivate')}>{t('rcpt.ctl.deactivate')}</button>
                  : <button className="btn" data-testid="rcp-activate" onClick={() => control('activate')}>{t('rcpt.ctl.activate')}</button>}
                {ctl?.testCallVerifiedAt ? <button className="btn ghost" onClick={() => control('clear_test_call')}>{t('rcpt.ctl.clearTest')}</button> : null}
                <button className="btn ghost" onClick={() => setDialog('history')}>{t('rcpt.ctl.history')}</button>
              </div>
            ) : null}
          </section>

          <section className="panel rcp-card" data-testid="rcp-quick">
            <h2>{t('rcpt.quick')}</h2>
            <div className="rcp-quick">
              {[
                ['manage_agents', '/tenant/ai/receptionist/front-desk'], ['calls', '/tenant/ai/receptionist/calls'], ['business_setup', '/tenant/ai/receptionist/business-setup'],
                ['calendar', '/tenant/ai/receptionist/calendar'], ['follow_ups', '/tenant/ai/receptionist/follow-ups'], ['settings', '/tenant/ai/receptionist/settings'], ['plans', '/tenant/ai/plans'],
              ].map(([k, r]) => <button key={k} className="btn ghost" onClick={() => nav(r)}>{t(`rcpt.quick.${k}`)}</button>)}
            </div>
          </section>
        </div>
      </div>

      {/* priority list (upgrade 3) */}
      <section className="panel rcp-card" data-testid="rcp-priority">
        <div className="rcp-card-head"><h2>{t('rcpt.priority')}</h2><span className="rcp-muted">{t('rcpt.priorityNote')}</span></div>
        {prioErr ? <ErrorRetry message={prioErr} onRetry={loadPrio} /> : !prio ? <div className="state">{t('rcpt.loading')}</div> : prio.items.length === 0 ? <Empty title={t('rcpt.priorityEmpty')} /> : (
          <>
            <table className="tbl rcp-tbl"><thead><tr><th>{t('rcpt.col.item')}</th><th>{t('rcpt.col.when')}</th><th>{t('rcpt.col.next')}</th><th>{t('rcpt.col.state')}</th><th /></tr></thead>
              <tbody>{prio.items.map((x: any) => (
                <tr key={`${x.sourceType}:${x.sourceRef}`} data-testid={`rcp-prio-${x.kind}`}>
                  <td><b>{t(`rcpt.kind.${x.kind}`)}</b>{x.detail ? <div className="rcp-muted">{x.detail}</div> : null}{x.expiresAt ? <div className="rcp-muted">{t('rcpt.holdUntil', { at: when(x.expiresAt) })}</div> : null}</td>
                  <td>{when(x.at)}</td>
                  <td>{t(`rcpt.next.${x.kind}`)}</td>
                  <td>{x.action ? <Badge s={x.action.status} tone={x.action.status === 'confirmed' ? 'ok' : 'warn'} label={t(`rcpt.action.${x.action.status}`)} /> : <Badge s="recommended" tone="muted" label={t('rcpt.action.recommended')} />}</td>
                  <td className="rcp-actions">
                    {x.sourceType === 'call' ? <button className="btn ghost" onClick={() => setOpen(x.sourceRef)}>{t('rcpt.open')}</button> : null}
                    {x.canPrepare ? <button className="btn ghost" data-testid="rcp-prepare" onClick={async () => {
                      try { await posAiReceptionistCenterApi.prepare({ sourceType: x.sourceType, sourceRef: x.sourceRef, kind: 'create_follow_up', idempotencyKey: requestId() }); setNotice(t('rcpt.prepared')); loadPrio(); }
                      catch (e) { setNotice(errorTextOf(e, tx('pos.something_went_wrong'))); }
                    }}>{t('rcpt.prepare')}</button> : null}
                    {x.action?.status === 'awaiting_confirmation' && canManage ? <>
                      <button className="btn" data-testid="rcp-confirm" onClick={async () => { try { await posAiReceptionistCenterApi.decide(x.action.id, { decision: 'confirm', expectedVersion: 1 }); setNotice(t('rcpt.confirmed')); loadPrio(); } catch (e) { setNotice(errorTextOf(e, tx('pos.something_went_wrong'))); } }}>{t('rcpt.confirm')}</button>
                      <button className="btn ghost" onClick={async () => { try { await posAiReceptionistCenterApi.decide(x.action.id, { decision: 'cancel', expectedVersion: 1 }); loadPrio(); } catch (e) { setNotice(errorTextOf(e, tx('pos.something_went_wrong'))); } }}>{t('rcpt.cancel')}</button>
                    </> : null}
                  </td>
                </tr>
              ))}</tbody></table>
            <Pager info={prio.pagination} onPage={setPrioPage} />
          </>
        )}
      </section>

      {/* recent calls → full history: scoped search, filters, calendar, pages */}
      <section className="panel rcp-card" data-testid="rcp-calls">
        <div className="rcp-card-head"><h2>{t('rcpt.recent')}</h2></div>
        <div className="rcp-toolbar">
          <select aria-label={t('rcpt.scope')} value={scope} onChange={(e) => setScope(e.target.value as typeof SCOPES[number])} data-testid="rcp-scope">
            {SCOPES.map((s) => <option key={s} value={s}>{t(`rcpt.scope.${s}`)}</option>)}
          </select>
          <input className="rcp-search" data-testid="rcp-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('rcpt.searchPh')} aria-label={t('rcpt.searchPh')} />
          {scope === 'calls' ? <>
            <select aria-label={t('rcpt.f.status')} value={f.status ?? ''} onChange={(e) => setFilter({ status: e.target.value || undefined })} data-testid="rcp-f-status">
              <option value="">{t('rcpt.f.allStatus')}</option>{CALL_STATUSES.map((s) => <option key={s} value={s}>{t(`rcpt.cstat.${s}`)}</option>)}
            </select>
            <select aria-label={t('rcpt.f.outcome')} value={f.outcome ?? ''} onChange={(e) => setFilter({ outcome: e.target.value || undefined })} data-testid="rcp-f-outcome">
              <option value="">{t('rcpt.f.allOutcome')}</option>{['booked', 'booking_requested', 'question', 'handoff', 'follow_up'].map((s) => <option key={s} value={s}>{t(`rcpt.out.${s}`)}</option>)}
            </select>
            <select aria-label={t('rcpt.f.basis')} value={f.dateBasis} onChange={(e) => setFilter({ dateBasis: e.target.value })}>
              {BASES.map((b) => <option key={b} value={b}>{t(`rcpt.basis.${b}`)}</option>)}
            </select>
            <select aria-label={t('rcpt.period')} value={f.period ?? ''} onChange={(e) => (e.target.value === 'custom' ? setCal('calls') : setFilter({ period: e.target.value || undefined, from: undefined, to: undefined }))} data-testid="rcp-f-period">
              <option value="">{t('rcpt.period.any')}</option>{PERIODS.map((p) => <option key={p} value={p}>{t(`rcpt.period.${p}`)}</option>)}
            </select>
            <button className="btn ghost" data-testid="rcp-cal" onClick={() => setCal('calls')}>{f.from || f.to ? `${f.from ?? '…'} – ${f.to ?? '…'}` : t('rcpt.fromTo')}</button>
            {list?.agents?.length ? (
              <select aria-label={t('rcpt.f.agent')} value={f.agent ?? ''} onChange={(e) => setFilter({ agent: e.target.value || undefined })} data-testid="rcp-f-agent">
                <option value="">{t('rcpt.f.allAgents')}</option>{list.agents.map((a: any) => <option key={a.ref} value={a.ref}>{a.name}</option>)}
              </select>) : null}
            <input className="rcp-search" style={{ maxWidth: 160 }} value={svc} onChange={(e) => setSvc(e.target.value)} placeholder={t('rcpt.f.service')} aria-label={t('rcpt.f.service')} data-testid="rcp-f-service" />
            <select aria-label={t('rcpt.f.direction')} value={f.direction ?? ''} onChange={(e) => setFilter({ direction: e.target.value || undefined })} data-testid="rcp-f-direction">
              <option value="">{t('rcpt.f.allDirections')}</option>{['inbound', 'outbound'].map((d) => <option key={d} value={d}>{t(`rcpt.dir.${d}`)}</option>)}
            </select>
            <select aria-label={t('rcpt.f.length')} value={lengthOf(f)} onChange={(e) => { const r = LENGTHS[e.target.value]; setFilter({ minSeconds: r?.[0], maxSeconds: r?.[1] }); }} data-testid="rcp-f-length">
              <option value="">{t('rcpt.f.anyLength')}</option>{Object.keys(LENGTHS).map((k) => <option key={k} value={k}>{t(`rcpt.len.${k}`)}</option>)}
            </select>
            <select aria-label={t('rcpt.sort')} value={f.sort} onChange={(e) => setFilter({ sort: e.target.value })}>{['newest', 'oldest', 'longest'].map((s) => <option key={s} value={s}>{t(`rcpt.sort.${s}`)}</option>)}</select>
          </> : null}
          <select aria-label={t('rcpt.pageSize')} value={f.pageSize} onChange={(e) => setFilter({ pageSize: Number(e.target.value) })} data-testid="rcp-pagesize">{[10, 20, 50].map((n) => <option key={n} value={n}>{t('rcpt.perPage', { n })}</option>)}</select>
          <button className="btn ghost" onClick={() => { setSearch(''); setSvc(''); setF({ page: 1, pageSize: f.pageSize, sort: 'newest', dateBasis: 'call_started' }); }}>{t('rcpt.clear')}</button>
        </div>
        <div className="rcp-muted" data-testid="rcp-live">{t('rcpt.live', { s: LIVE_MS / 1000 })}{liveAt ? ` · ${t('rcpt.liveAt', { when: when(liveAt) })}` : ''}</div>
        {scope === 'calls' && (f.period || f.from) ? <div className="rcp-muted" data-testid="rcp-basis-note">{t('rcpt.basisNote', { basis: t(`rcpt.basis.${f.dateBasis}`) })}</div> : null}
        {listErr ? <ErrorRetry message={listErr} onRetry={() => void loadList()} /> : loading && !list ? <div className="state">{t('rcpt.loading')}</div>
          : !list || list.items.length === 0 ? <Empty title={dq || f.status || f.outcome || f.period || f.from || f.agent || f.service || f.direction || f.minSeconds != null || f.maxSeconds != null ? t('rcpt.noMatch') : scope === 'calls' ? t('rcpt.noCalls') : t('rcpt.typeToSearch')} />
          : scope === 'calls' ? (
            <table className="tbl rcp-tbl" data-testid="rcp-call-table"><thead><tr><th>{t('rcpt.col.when')}</th><th>{t('rcpt.col.caller')}</th><th>{t('rcpt.col.dialed')}</th><th>{t('rcpt.col.status')}</th><th>{t('rcpt.col.booking')}</th><th>{t('rcpt.col.handoff')}</th><th>{t('rcpt.col.duration')}</th><th /></tr></thead>
              <tbody>{list.items.map((c: any) => (
                <tr key={c.id} data-testid="rcp-call-row">
                  <td>{when(c.startedAt)}<div className="rcp-muted">{c.callRef.slice(0, 14)}</div></td>
                  <td>{c.callerMasked ?? '—'}<div className="rcp-muted">{t(`rcpt.identity.${c.identity}`)}</div></td>
                  <td>{c.dialedMasked ?? '—'}{c.direction ? <div className="rcp-muted">{t(`rcpt.dir.${c.direction}`)}</div> : null}</td>
                  <td><Badge s={c.status} tone={c.status === 'completed' ? 'ok' : c.status === 'failed' || c.status === 'abandoned' || c.status === 'missed' ? 'bad' : 'warn'} label={t(`rcpt.cstat.${c.status}`)} /></td>
                  <td>{c.bookingOutcome ?? '—'}</td><td>{c.handoffOutcome ?? '—'}</td><td>{dur(c.durationSeconds)}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(c.callRef)}>{t('rcpt.open')}</button></td>
                </tr>
              ))}</tbody></table>
          ) : scope === 'customers' ? (
            <table className="tbl rcp-tbl"><thead><tr><th>{t('rcpt.col.customer')}</th><th>{t('rcpt.col.phone')}</th><th>{t('rcpt.col.aiBookings')}</th><th /></tr></thead>
              <tbody>{list.items.map((c: any) => <tr key={c.id}><td>{c.name}{c.sharedPhone ? <div className="rcp-warn-t">{t('rcpt.sharedPhone')}</div> : null}</td><td>{c.phoneMasked ?? '—'}</td><td>{c.aiBookings}</td>
                <td><button className="btn ghost" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(c.id)}&from=ai-receptionist`)}>{t('rcpt.openBooking')}</button></td></tr>)}</tbody></table>
          ) : scope === 'appointments' ? (
            <table className="tbl rcp-tbl"><thead><tr><th>{t('rcpt.col.customer')}</th><th>{t('rcpt.col.when')}</th><th>{t('rcpt.col.status')}</th><th>{t('rcpt.col.verification')}</th></tr></thead>
              <tbody>{list.items.map((a: any) => <tr key={a.id}><td>{a.customerName ?? '—'}</td><td>{a.date} {a.startTime}</td><td>{statusLabel(['appointment', 'state'], a.status)}</td><td>{a.verification ?? '—'}</td></tr>)}</tbody></table>
          ) : (
            <table className="tbl rcp-tbl"><thead><tr><th>{t('rcpt.col.when')}</th><th>{t('rcpt.col.item')}</th><th>{t('rcpt.col.detail')}</th></tr></thead>
              <tbody>{list.items.map((a: any) => <tr key={a.id}><td>{when(a.at)}</td><td>{t(`rcpt.activity.${a.kind}`)}</td><td>{a.detail}</td></tr>)}</tbody></table>
          )}
        {list ? <Pager info={list.pagination?.totalItems == null ? { ...list.pagination, totalItems: (list.pagination.totalPages) * list.pagination.pageSize } : list.pagination} onPage={(p) => setF((x) => ({ ...x, page: p }))} /> : null}
      </section>

      {cal ? (
        <FitDialog title={t('rcpt.fromTo')} onClose={() => setCal(null)} testId="rcp-calendar">
          <RangeCalendar today={today()} initial={cal === 'kpi' ? { from: period.from, to: period.to } : { from: f.from, to: f.to }}
            onApply={(r) => { if (cal === 'kpi') setPeriod({ period: 'custom', from: r.from, to: r.to }); else setFilter({ period: 'custom', from: r.from, to: r.to }); setCal(null); }}
            onCancel={() => setCal(null)} onClear={() => { if (cal === 'kpi') setPeriod({ period: 'month' }); else setFilter({ period: undefined, from: undefined, to: undefined }); setCal(null); }} />
        </FitDialog>
      ) : null}
      {open ? <CallOverlay callRef={open} canManage={canManage} onClose={() => setOpen(null)} nav={nav}
        onVerifyTest={(ref) => { setOpen(null); control('verify_test_call', { providerCallRef: ref }); }} /> : null}
      {pending ? <ReasonDialog action={pending.action} onCancel={() => setPending(null)} onSubmit={submitControl} /> : null}
      {dialog === 'health' ? <HealthDialog onClose={() => { setDialog(null); loadReady(); posAiReceptionistCenterApi.lastHealth().then(setLastCheck).catch((e) => setNotice(errorTextOf(e, tx('pos.something_went_wrong')))); }} /> : null}
      {dialog === 'history' ? <ControlHistory onClose={() => setDialog(null)} /> : null}
      {dialog === 'capabilities' && ready && Array.isArray(ready.capabilities) ? <CapabilityMatrix rows={ready.capabilities} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

function ReasonDialog({ action, onCancel, onSubmit }: { action: RcControlAction; onCancel: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const needs = ['arm_booking', 'verify_test_call', 'activate'].includes(action);
  return (
    <FitDialog title={t(`rcpt.ctlTitle.${action}`)} subtitle={t(`rcpt.ctlNote.${action}`)} onClose={onCancel} busy={busy} testId="rcp-reason"
      footer={<div className="rcp-ov-actions"><button className="btn ghost" onClick={onCancel}>{t('rcpt.cancel')}</button>
        <button className="btn" data-testid="rcp-reason-ok" disabled={busy || (needs && reason.trim().length < 5)} onClick={async () => { setBusy(true); await onSubmit(reason.trim()); setBusy(false); }}>{t('rcpt.confirm')}</button></div>}>
      <label className="rcp-label">{t('rcpt.reasonLabel')}<textarea data-testid="rcp-reason-text" className="rcp-textarea" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></label>
      {needs ? <div className="rcp-muted">{t('rcpt.reasonMin')}</div> : null}
    </FitDialog>
  );
}

function HealthDialog({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(true);
  const run = useCallback(() => { setBusy(true); setErr(null); posAiReceptionistCenterApi.health().then(setR).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))).finally(() => setBusy(false)); }, []);
  useEffect(() => { run(); }, [run]);
  return (
    <FitDialog title={t('rcpt.check')} subtitle={t('rcpt.checkNote')} onClose={onClose} busy={busy} wide testId="rcp-health">
      {err ? <ErrorRetry message={err} onRetry={run} /> : !r ? <div className="state">{t('rcpt.checking')}</div> : (
        <div className="rcp-health">
          <div className="rcp-health-top"><b>{t('rcpt.overall')}</b> <Badge s={r.overall} /> <span className="rcp-muted">{t(`rcpt.stage.${r.stage}`)} · {when(r.checkedAt)}</span></div>
          {r.checks.map((c: any) => (
            <div key={c.id} className="rcp-hrow" data-testid={`rcp-h-${c.id}`}>
              <div className="rcp-hrow-head"><b>{c.group} · {c.label}</b><Badge s={c.state} /></div>
              <div className="rcp-detail">{c.detail}</div>
              <div className="rcp-muted">{t('rcpt.evidence', { e: c.evidence })}{c.roleRequired ? ` · ${t('rcpt.role', { r: c.roleRequired })}` : ''}</div>
              {c.impact ? <div className="rcp-warn-t">{t('rcpt.impact', { i: c.impact })}</div> : null}
              {c.remedy ? <div className="rcp-remedy">{t('rcpt.remedy', { r: c.remedy })}</div> : null}
            </div>
          ))}
          <div className="rcp-muted">{r.note}</div>
        </div>
      )}
    </FitDialog>
  );
}

function ControlHistory({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1); const [r, setR] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posAiReceptionistCenterApi.controlHistory({ page, pageSize: 10 }).then(setR).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [page]);
  return (
    <FitDialog title={t('rcpt.ctl.history')} onClose={onClose} testId="rcp-ctl-history">
      {err ? <div className="err">{err}</div> : !r ? <div className="state">{t('rcpt.loading')}</div> : r.items.length === 0 ? <Empty title={t('rcpt.noHistory')} /> : (
        <><table className="tbl rcp-tbl"><thead><tr><th>{t('rcpt.col.when')}</th><th>{t('rcpt.col.item')}</th><th>{t('rcpt.col.detail')}</th></tr></thead>
          <tbody>{r.items.map((x: any) => <tr key={x.id}><td>{when(x.at)}</td><td>{t(`rcpt.done.${x.action}`)}</td><td>{x.reason ?? '—'}</td></tr>)}</tbody></table>
        <Pager info={r.pagination} onPage={setPage} /></>
      )}
    </FitDialog>
  );
}

function CallOverlay({ callRef, canManage, onClose, nav, onVerifyTest }: { callRef: string; canManage: boolean; onClose: () => void; nav: (r: string) => void; onVerifyTest: (ref: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posAiReceptionistCenterApi.call(callRef).then(setD).catch((e) => setErr(errorTextOf(e, tx('pos.something_went_wrong')))); }, [callRef]);
  useEffect(() => { load(); }, [load]);
  const c = d?.call;
  return (
    <FitDialog title={t('rcpt.callTitle')} subtitle={c ? `${when(c.startedAt)} · ${dur(c.durationSeconds)}` : undefined} onClose={onClose} wide testId="rcp-overlay"
      footer={<div className="rcp-ov-actions">
        {d?.customer ? <button className="btn" data-testid="rcp-ov-book" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(d.customer.id)}&from=ai-receptionist`)}>{t('rcpt.openBooking')}</button> : null}
        {d?.customer ? <button className="btn ghost" onClick={() => nav(`/customers?customerId=${encodeURIComponent(d.customer.id)}`)}>{t('rcpt.viewCustomer')}</button> : null}
        <button className="btn ghost" onClick={() => nav('/tenant/communications/inbox')}>{t('rcpt.openInbox')}</button>
        {canManage && c && !c.errorCategory ? <button className="btn ghost" data-testid="rcp-ov-test" onClick={() => onVerifyTest(c.callRef)}>{t('rcpt.useAsTest')}</button> : null}
        <button className="btn ghost" data-testid="rcp-ov-close" onClick={onClose}>{t('rcpt.close')}</button>
      </div>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{t('rcpt.loading')}</div> : (
        <div className="rcp-ov">
          <section><h3>{t('rcpt.ov.summary')}</h3>
            <dl className="rcp-conn">
              <dt>{t('rcpt.ov.callId')}</dt><dd>{c.callRef}</dd>
              <dt>{t('rcpt.ov.result')}</dt><dd>{[c.bookingOutcome && `${t('rcpt.col.booking')}: ${c.bookingOutcome}`, c.handoffOutcome && `${t('rcpt.col.handoff')}: ${c.handoffOutcome}`, c.abandoned && t('rcpt.cstat.abandoned'), c.errorCategory && `${t('rcpt.cstat.failed')}: ${c.errorCategory}`].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>{t('rcpt.ov.caller')}</dt><dd data-testid="rcp-ov-caller">{d.caller.masked ?? '—'} · {t(`rcpt.identity.${d.caller.identity}`)}<div className="rcp-muted">{d.caller.explanation}</div></dd>
              <dt>{t('rcpt.ov.aiSummary')}</dt><dd>{c.summary ? <><span className="rcp-badge rcp-muted">{t('rcpt.generated')}</span> {c.summary.text}</> : t('rcpt.noSummary')}</dd>
              <dt>{t('rcpt.ov.transcript')}</dt><dd data-testid="rcp-ov-transcript">{!d.transcript ? t('rcpt.tr.none') : d.transcript.restricted ? t('rcpt.tr.restricted') : <button className="btn ghost" onClick={() => nav(d.transcript.route)}>{t('rcpt.tr.open')}</button>}</dd>
            </dl>
          </section>
          <section><h3>{t('rcpt.ov.appointments')}</h3>{d.appointments.length ? <ul>{d.appointments.map((a: any) => <li key={a.id}>{a.date} {a.startTime} · {statusLabel(['appointment', 'state'], a.status)}{a.verification ? ` · ${a.verification}` : ''}</li>)}</ul> : <div className="rcp-muted">{t('rcpt.none')}</div>}</section>
          <section><h3>{t('rcpt.ov.handoffs')}</h3>{d.handoffs.length ? <ul>{d.handoffs.map((h: any) => <li key={h.id}>{t(`rcpt.ho.${h.state}`)} · {when(h.requestedAt)}{h.failureReason ? ` · ${h.failureReason}` : ''}</li>)}</ul> : <div className="rcp-muted">{t('rcpt.none')}</div>}</section>
          <section><h3>{t('rcpt.ov.followUps')}</h3>{d.followUps.length ? <ul>{d.followUps.map((x: any) => <li key={x.id}>{x.reason} · {statusLabel('state', x.status)} · {when(x.createdAt)}</li>)}</ul> : <div className="rcp-muted">{t('rcpt.none')}</div>}</section>
          <section><h3>{t('rcpt.ov.actions')}</h3>{d.actions.length ? <ul>{d.actions.map((a: any) => <li key={a.id}>{t(`rcpt.action.${a.status}`)} · {when(a.createdAt)}</li>)}</ul> : <div className="rcp-muted">{t('rcpt.none')}</div>}
            {c.toolCalls?.length ? <div className="rcp-muted">{t('rcpt.tools', { list: c.toolCalls.map((x: any) => `${x.name}${x.ok ? '' : ' ✗'}`).join(', ') })}</div> : null}</section>
          <section><h3>{t('rcpt.ov.messages')}</h3><div className="rcp-muted">{t('rcpt.messagesNote')}</div></section>
        </div>
      )}
    </FitDialog>
  );
}

// extras AI Receptionist 04 — AI Agent Capability Matrix: the server's four facts per capability (Configured / Tested /
// Active / Allowed), each from its own evidence; null = not known here → "—". Read-only.
type CapRow = { key: string; tool: string | null; configured: boolean | null; tested: boolean | null; lastTestedAt: string | null; active: boolean | null; allowed: boolean | null };
function CapabilityMatrix({ rows, onClose }: { rows: CapRow[]; onClose: () => void }) {
  const cell = (v: boolean | null, testId: string) => <td data-testid={testId} className={v == null ? 'rcp-muted' : v ? 'rcp-ok' : 'rcp-no'}>{v == null ? '—' : v ? t('rcpt.cap.yes') : t('rcpt.cap.no')}</td>;
  return (
    <FitDialog title={t('rcpt.cap.title')} subtitle={t('rcpt.cap.sub')} onClose={onClose} testId="rcp-capabilities">
      <table className="fk-table" data-testid="rcp-cap-table">
        <thead><tr><th>{t('rcpt.cap.col.capability')}</th><th>{t('rcpt.cap.col.configured')}</th><th>{t('rcpt.cap.col.tested')}</th><th>{t('rcpt.cap.col.active')}</th><th>{t('rcpt.cap.col.allowed')}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key} data-testid="rcp-cap-row" data-cap={r.key}>
          <td>{t('rcpt.cap.k.' + r.key)}</td>{cell(r.configured, 'rcp-cap-configured')}
          <td data-testid="rcp-cap-tested" className={r.tested == null ? 'rcp-muted' : r.tested ? 'rcp-ok' : 'rcp-no'}>{r.tested == null ? '—' : r.tested ? t('rcpt.cap.testedAt', { at: r.lastTestedAt ? fmtDateTime(r.lastTestedAt) : '—' }) : t('rcpt.cap.notTested')}</td>
          {cell(r.active, 'rcp-cap-active')}{cell(r.allowed, 'rcp-cap-allowed')}</tr>)}</tbody>
      </table>
      <p className="rcp-muted">{t('rcpt.cap.note')}</p>
    </FitDialog>
  );
}
