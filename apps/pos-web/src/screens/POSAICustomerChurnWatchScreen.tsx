// POSAICustomerChurnWatchScreen.tsx — AI Center → Customer Profile → Churn Watch (/tenant/ai/customer-profile/churn).
// Churn Watch guide (Nov 1 2026). Rebuilt IN PLACE: the title, the internal-only caution ("never shown to customers, never a
// certainty"), the search box (name · phone · email) and the Search button stay. Added: the six metrics (Data Unavailable — not
// zero — when nothing has been evaluated), Refresh (the shared Customer Intelligence evaluation), Check Churn Watch System,
// Needs Review / Reviewed / History tabs, priority, a date field with presets and a From/To month calendar, sort, numbered pages,
// and the Retention Evidence overlay: the rule's evidence and inputs, the review state, Mark reviewed / Defer / Reopen / note,
// and links to the owning modules. Churn Watch never texts, books, edits a customer or changes points.
// Kevin, Nov 12 2026 (decision 2): THE status on every row is Customer Retention's classification (row.verdict: segment + days
// away, read by the server from the Retention module) and links to it; the assistant's signals show only as labelled supporting
// reasons — never a level, a verdict or a filter.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posChurnWatchApi, type ChurnQuery } from '../api/posChurnWatchApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const URL_KEYS = ['tab', 'priority', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const TABS = ['needs_review', 'reviewed', 'all_signals', 'insufficient', 'no_signal'];
const DATE_FIELDS = ['signal_since', 'last_visit', 'next_appointment', 'created', 'reviewed', 'evaluated'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const SORTS = ['priority', 'signal_newest', 'last_visit', 'days_since', 'name'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const SEGMENT_TONE: Record<string, string> = { approaching: 'warn', at_risk: 'bad', active: 'ok', never_visited: '' };
const RETENTION_ROUTE = '/tenant/customers/retention';
const FLAGGED_SEGMENTS = ['approaching', 'at_risk'];
const verdictLine = (v: any) => (!v ? '—' : v.daysAway == null ? t('cwx.level.' + v.segment) : t('cwx.verdict.line', { seg: t('cwx.level.' + v.segment), n: fmtNumber(v.daysAway) }));
const KNOWN_ERRORS = ['AI_CUSTOMER_PROFILE_DISABLED', 'CUSTOMER_NOT_FOUND', 'CHURN_INVALID_PERIOD', 'CHURN_SEARCH_TOO_SHORT', 'CHURN_NO_SIGNAL', 'CHURN_STALE_VERSION', 'CHURN_NOTE_REQUIRED', 'INTELLIGENCE_SCAN_FAILED', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN_ERRORS.includes(code)) return t('cwx.err.' + code);
  if (isForbidden(e)) return t('cwx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}

export function POSAICustomerChurnWatchScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v) o[k] = v; } return o; }, [sp]);
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const tab = f.tab ?? 'needs_review';
  const query: ChurnQuery = { ...f, tab, q: q || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };
  const [sum, setSum] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [histPage, setHistPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setErr(null);
    try {
      const [s, l] = await Promise.all([posChurnWatchApi.summary(), posChurnWatchApi.customers(query)]);
      if (mine === seq.current) { setSum(s); setList(l); }
    } catch (e) { if (mine === seq.current) setErr(errText(e, 'cwx.loadFailed')); }
    finally { if (mine === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query: the object is rebuilt every render
  }, [JSON.stringify(query)]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!showHistory) return;
    posChurnWatchApi.history({ page: histPage, pageSize: 25 }).then(setHist).catch((e) => setErr(errText(e, 'cwx.loadFailed')));
  }, [showHistory, histPage]);
  const refresh = async () => {
    setBusy(true); setNotice(null);
    try { const r = await posChurnWatchApi.refresh(); setNotice(r?.reused ? t('cwx.refreshReused') : t('cwx.refreshDone', { n: fmtNumber(r?.scan?.scanned ?? 0) })); }
    catch (e) { setErr(errText(e, 'cwx.err.INTELLIGENCE_SCAN_FAILED')); }
    finally { setBusy(false); await load(); }
  };
  const m = sum?.metrics; const fr = sum?.freshness;
  const anyFilter = ['priority', 'dateField', 'preset', 'sort'].some((k) => f[k]) || !!q;
  const metric = (testId: string, label: string, v: number | undefined, onClick?: () => void, tone?: 'warn' | 'bad' | 'gold') => (
    <KpiCard testId={testId} label={label} loading={loading && !sum} tone={tone} value={v == null ? '—' : fmtNumber(v)} onClick={onClick} />
  );

  return (
    <div className="work rvw cwx" data-testid="churn-watch-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.churn_watch')}</h1><div className="sub mb-3">{t('pos.a_cautious_internal_risk_signal_never_1igm')}</div></div>
        <div className="rvw-actions">
          <span className={'chip ' + (fr?.state === 'up_to_date' ? 'ok' : fr?.state === 'failed' ? 'bad' : 'warn')} data-testid="cwx-freshness">
            {busy ? t('cwx.fresh.running') : fr ? t('cwx.fresh.' + fr.state, { at: when(fr.lastEvaluatedAt, true) }) : '…'}</span>
          <button className="btn ghost" data-testid="cwx-check" onClick={() => { setHealth('loading'); posChurnWatchApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'cwx.loadFailed') })); }}>{t('cwx.check')}</button>
          <button className="btn" data-testid="cwx-refresh" disabled={busy} onClick={() => void refresh()}>{busy ? t('pos.refreshing') : t('pos.refresh')}</button>
        </div>
      </div>
      {notice ? <div className="panel" role="status" data-testid="cwx-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={() => void load()} /> : null}
      {fr?.state === 'never' ? <p className="warn" data-testid="cwx-unavailable">{t('cwx.unavailableNote')}</p> : null}
      {sum?.definitions ? <div className="sub" data-testid="cwx-verdict-source">{t('cwx.verdict.source', { r: sum.definitions.riskDays, a: sum.definitions.approachingDays })} <button type="button" className="aic-link" data-testid="cwx-retention-link" onClick={() => nav(RETENTION_ROUTE)}>{t('cwx.verdict.open')}</button></div> : null}

      <div className="rvw-kpis" data-testid="cwx-metrics">
        {metric('kpi-evaluated', t('cwx.kpi.evaluated'), m?.evaluated)}
        {metric('kpi-needs', t('cwx.kpi.needsReview'), m?.needsReview, () => setF({ tab: 'needs_review', priority: 'normal' }), 'warn')}
        {metric('kpi-higher', t('cwx.kpi.higher'), m?.higherPriority, () => setF({ tab: 'needs_review', priority: 'higher' }), 'bad')}
        {metric('kpi-insufficient', t('cwx.kpi.insufficient'), m?.insufficientHistory, () => setF({ tab: 'insufficient', priority: null }))}
        {metric('kpi-upcoming', t('cwx.kpi.upcoming'), m?.upcomingBooking)}
        {metric('kpi-reviewed', t('cwx.kpi.reviewed'), m?.reviewed, () => setF({ tab: 'reviewed', priority: null }), 'gold')}
      </div>

      <form className="panel rvw-filters" data-testid="cwx-searchbar" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setF({}, false); }}>
        <input className="rvw-search" data-testid="cwx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('pos.search_by_name_phone_or_email')} aria-label={t('pos.search_by_name_phone_or_email')} />
        <button className="btn" type="submit" data-testid="cwx-search-btn">{t('pos.search')}</button>
        <span className="sub">{t('cwx.searchHint')}</span>
      </form>

      <div className="rvw-tabs" role="tablist" data-testid="cwx-tabs">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={!showHistory && tab === x} className={'btn ghost' + (!showHistory && tab === x ? ' on' : '')} data-testid={`tab-${x}`} onClick={() => { setShowHistory(false); setF({ tab: x === 'needs_review' ? null : x }); }}>{t('cwx.tab.' + x)}</button>)}
        <button role="tab" aria-selected={showHistory} className={'btn ghost' + (showHistory ? ' on' : '')} data-testid="tab-history" onClick={() => setShowHistory(true)}>{t('cwx.tab.history')}</button>
      </div>

      {showHistory ? (
        <section className="panel rvw-feed" data-testid="cwx-history">
          {!hist ? <div className="state">{t('cwx.loading')}</div> : hist.items.length === 0 ? <Empty title={t('cwx.noHistory')} /> : (
            <table className="tbl rvw-table"><thead><tr><th>{t('cwx.hist.when')}</th><th>{t('cwx.col.customer')}</th><th>{t('cwx.hist.action')}</th><th>{t('cwx.col.signal')}</th><th>{t('cwx.hist.note')}</th><th>{t('cwx.hist.by')}</th></tr></thead>
              <tbody>{hist.items.map((e: any) => <tr key={e.id} data-testid="cwx-hist-row"><td className="nowrap">{when(e.at, true)}</td><td>{e.name ?? '—'}</td><td>{t('cwx.action.' + e.type)}</td><td>{e.level ? t('cwx.level.' + e.level) : '—'}</td><td>{e.note ?? ''}</td><td>{e.actor ?? '—'}</td></tr>)}</tbody></table>)}
          {hist ? <Pager info={{ page: hist.page, pageSize: hist.pageSize, totalItems: hist.total, totalPages: hist.totalPages }} onPage={setHistPage} /> : null}
        </section>
      ) : <>
        <section className="panel rvw-filters" data-testid="cwx-filters">
          <label className="rvw-f"><span>{t('cwx.f.priority')}</span>
            <select data-testid="flt-priority" value={f.priority ?? ''} onChange={(e) => setF({ priority: e.target.value || null })}>
              <option value="">{t('cwx.all')}</option><option value="higher">{t('cwx.priority.higher')}</option><option value="normal">{t('cwx.priority.normal')}</option>
            </select></label>
          <label className="rvw-f"><span>{t('cwx.f.sort')}</span>
            <select data-testid="flt-sort" value={f.sort ?? ''} onChange={(e) => setF({ sort: e.target.value || null })}>
              <option value="">{t('cwx.sortDefault')}</option>{SORTS.map((s) => <option key={s} value={s}>{t('cwx.sort.' + s)}</option>)}
            </select></label>
          <div className="rvw-dates" data-testid="cwx-dates">
            <label className="rvw-f"><span>{t('cwx.f.dateField')}</span>
              <select data-testid="flt-datefield" value={f.dateField ?? 'signal_since'} onChange={(e) => setF({ dateField: e.target.value === 'signal_since' ? null : e.target.value })}>
                {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('cwx.date.' + d)}</option>)}
              </select></label>
            <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('cwx.preset.all')}</button>
            {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: p, from: null, to: null })}>{t('cwx.preset.' + p)}</button>)}
            <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('cwx.preset.custom')}</button>
          </div>
          {anyFilter ? <button className="btn ghost" data-testid="flt-clear" onClick={() => { setDraft(''); setQ(''); setF({ priority: null, dateField: null, preset: null, from: null, to: null, sort: null }); }}>{t('cwx.clearAll')}</button> : null}
          {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? deviceToday()}
            onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
        </section>
        <section className="panel rvw-feed" data-testid="cwx-results">
          <div className="p-h">{t('cwx.tab.' + tab)}<span className="sub rvw-scope" data-testid="cwx-count">{list ? t('cwx.count', { n: fmtNumber(list.total) }) : ''}</span></div>
          {loading && !list ? <div className="state">{t('pos.evaluating_churn_risk')}</div>
            : !list ? null
            : list.items.length === 0 ? <Empty title={anyFilter ? t('cwx.noMatch') : t('cwx.empty.' + tab)} />
            : <div className="rvw-table-wrap"><table className="tbl rvw-table">
              <thead><tr><th>{t('cwx.col.customer')}</th><th>{t('cwx.col.lastVisit')}</th><th>{t('cwx.col.daysSince')}</th><th>{t('cwx.col.interval')}</th><th>{t('cwx.col.upcoming')}</th><th>{t('cwx.col.signal')}</th><th>{t('cwx.col.reason')}</th><th>{t('cwx.col.review')}</th><th /></tr></thead>
              <tbody>{list.items.map((r: any) => (
                <tr key={r.id} data-testid="cwx-row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }}>
                  <td><b>{r.name || '—'}</b><div className="sub">{r.phone ?? t('cwx.notProvided')}</div></td>
                  <td className="nowrap">{when(r.lastVisitAt)}</td>
                  <td className="num">{r.daysSinceLast == null ? '—' : fmtNumber(r.daysSinceLast)}</td>
                  <td>{r.typicalIntervalDays ? t('cwx.days', { n: r.typicalIntervalDays }) : t('cwx.notEstablished')}</td>
                  <td className="nowrap">{r.nextAppointmentDate ?? t('cwx.none')}</td>
                  <td><span className={'chip ' + (SEGMENT_TONE[r.verdict?.segment] ?? '')} data-testid="cwx-level">{t('cwx.state.' + r.state)}</span><div className="sub" data-testid="cwx-verdict">{verdictLine(r.verdict)}{r.verdict?.since ? ` · ${when(r.verdict.since)}` : ''}</div></td>
                  <td className="sub" data-testid="cwx-supporting">{r.supporting?.reasons?.[0] ?? '—'}</td>
                  <td>{r.review ? <span className={'chip ' + (r.review.current ? 'ok' : 'warn')}>{t('cwx.review.' + r.review.status)}{r.review.dueOn ? ` · ${r.review.dueOn}` : ''}</span> : '—'}</td>
                  <td><button className="btn ghost sm" data-testid="cwx-view" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{t('cwx.viewEvidence')}</button></td>
                </tr>))}</tbody></table></div>}
          <div className="rvw-pager">
            <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: String(p) }, true)} />
            <label className="rvw-f"><span>{t('cwx.rows')}</span>
              <select data-testid="cwx-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
                {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
          </div>
          <p className="sub">{t('cwx.internalOnly')}</p>
        </section>
      </>}

      {openId ? <EvidenceOverlay id={openId} onClose={() => setOpenId(null)} onChanged={(msg) => { setNotice(msg); void load(); }} nav={nav} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function EvidenceOverlay({ id, onClose, onChanged, nav }: { id: string; onClose: () => void; onChanged: (msg: string) => void; nav: (to: string) => void }) {
  const can = useCan();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'defer' | 'note'>('view');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const reload = useCallback(() => { setErr(null); posChurnWatchApi.customer(id).then(setD).catch((e) => setErr(errText(e, 'cwx.loadFailed'))); }, [id]);
  useEffect(() => { reload(); }, [reload]);
  const act = async (action: string, extra: { note?: string; dueOn?: string } = {}) => {
    setBusy(true); setActErr(null);
    try { await posChurnWatchApi.review(id, { action, expectedVersion: d?.review?.version ?? 0, ...extra }); setMode('view'); setNote(''); setDue(''); reload(); onChanged(t('cwx.saved.' + action)); }
    catch (e) { setActErr(errText(e, 'cwx.saveFailed')); }
    finally { setBusy(false); }
  };
  const go = (to: string) => { onClose(); nav(to); };
  const v = d?.verdict; const sp = d?.supporting; const i = d?.inputs; const flagged = !!v && FLAGGED_SEGMENTS.includes(v.segment);
  const manage = can('pos.ai_customer_profile.churn');
  return (
    <FitDialog wide testId="cwx-overlay" busy={busy} title={t('cwx.ov.title')} subtitle={v ? `${t('cwx.state.' + v.state)} · ${t('cwx.level.' + v.segment)}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {mode !== 'view' ? <>
          <button className="btn ghost" onClick={() => setMode('view')} disabled={busy}>{t('pos.cancel')}</button>
          {mode === 'defer' ? <button className="btn" data-testid="cwx-defer-save" disabled={busy} onClick={() => void act('deferred', { note: note.trim() || undefined, dueOn: due || undefined })}>{t('cwx.defer')}</button>
            : <button className="btn" data-testid="cwx-note-save" disabled={busy || !note.trim()} onClick={() => void act('note', { note: note.trim() })}>{t('cwx.addNote')}</button>}
        </> : <>
          {flagged && manage && !d?.review?.current ? <button className="btn" data-testid="cwx-mark-reviewed" onClick={() => void act('reviewed')}>{t('cwx.markReviewed')}</button> : null}
          {flagged && manage && !d?.review?.current ? <button className="btn ghost" data-testid="cwx-defer" onClick={() => setMode('defer')}>{t('cwx.defer')}</button> : null}
          {d?.review && manage ? <button className="btn ghost" data-testid="cwx-reopen" onClick={() => void act('reopened')}>{t('cwx.reopen')}</button> : null}
          {manage ? <button className="btn ghost" data-testid="cwx-note" onClick={() => setMode('note')}>{t('cwx.addNote')}</button> : null}
          <button className="btn ghost" data-testid="ov-profile" onClick={() => go(`/tenant/customers/profiles?customerId=${encodeURIComponent(id)}`)}>{t('cwx.ov.profile')}</button>
          <button className="btn ghost" data-testid="ov-history" onClick={() => go(`/tenant/ai/customer-profile/timeline?customer=${encodeURIComponent(id)}&family=appointment`)}>{t('cwx.ov.appointments')}</button>
          <button className="btn ghost" data-testid="ov-rebooking" onClick={() => go('/tenant/ai/customer-profile/rebooking')}>{t('cwx.ov.rebooking')}</button>
          <button className="btn ghost" data-testid="ov-recs" onClick={() => go('/tenant/ai/customer-profile/recommendations')}>{t('cwx.ov.recommendations')}</button>
          <button className="btn ghost" data-testid="ov-close" onClick={onClose}>{t('cwx.close')}</button>
        </>}
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('cwx.loading')}</div> : <>
        {actErr ? <p className="err" role="alert" data-testid="cwx-act-err">{actErr}</p> : null}
        <p className="warn" data-testid="ov-note">{t('cwx.ov.caution')}</p>
        <h4>{t('cwx.ov.verdict')}</h4>
        <div data-testid="ov-verdict">{v.daysAway == null ? t('cwx.level.' + v.segment) : t('cwx.ov.verdictLine', { seg: t('cwx.level.' + v.segment), n: fmtNumber(v.daysAway) })}
          {v.since ? <div className="sub">{t('cwx.ov.verdictSince', { d: when(v.since) })}</div> : null}
          <button type="button" className="aic-link" data-testid="ov-retention" onClick={() => go(RETENTION_ROUTE)}>{t('cwx.verdict.open')}</button></div>
        {!d.evaluated ? <p className="sub" data-testid="ov-not-evaluated">{t('cwx.ov.notEvaluated')}</p> : <>
          <h4>{t('cwx.ov.evidence')}</h4>
          <ul data-testid="ov-evidence">{sp.reasons.map((x: string, k: number) => <li key={k}>{x}</li>)}</ul>
          <dl className="rvw-dl" data-testid="ov-inputs">
            <dt>{t('cwx.ov.visits')}</dt><dd>{t('cwx.ov.visitsLine', { n: fmtNumber(i.completedVisits), first: when(i.firstVisitAt), last: when(i.lastVisitAt) })}</dd>
            <dt>{t('cwx.col.interval')}</dt><dd>{i.typicalIntervalDays ? t('cwx.days', { n: i.typicalIntervalDays }) : t('cwx.notEstablished')}</dd>
            <dt>{t('cwx.col.daysSince')}</dt><dd>{i.daysSinceLast ?? '—'}</dd>
            <dt>{t('cwx.col.upcoming')}</dt><dd>{i.hasUpcoming ? i.nextAppointmentDate : t('cwx.none')}</dd>
            <dt>{t('cwx.ov.canceled')}</dt><dd>{t('cwx.ov.cancelLine', { c: fmtNumber(i.canceledCount), n: fmtNumber(i.noShowCount) })}</dd>
            <dt>{t('cwx.ov.membership')}</dt><dd>{i.membershipCanceled ? t('cwx.ov.membershipCanceled') : t('cwx.none')}</dd>
            <dt>{t('cwx.ov.since')}</dt><dd>{when(sp.since, true)}</dd>
            <dt>{t('cwx.ov.rule')}</dt><dd className="sub">{d.rule ? t('cwx.ov.ruleLine', { v: d.rule.version, at: when(d.rule.evaluatedAt, true) }) : '—'}</dd>
          </dl>
        </>}
        {d.review ? <p data-testid="ov-review">{t('cwx.ov.reviewLine', { s: t('cwx.review.' + d.review.status), at: when(d.review.at, true), l: d.review.levelAtReview ? t('cwx.level.' + d.review.levelAtReview) : '—' })}{d.review.dueOn ? ` · ${t('cwx.ov.until', { d: d.review.dueOn })}` : ''}{!d.review.current ? ` · ${t('cwx.ov.reviewExpired')}` : ''}</p> : null}
        {mode !== 'view' ? <div className="dupx-form">
          <label className="rvw-f"><span>{mode === 'note' ? t('cwx.noteRequired') : t('cwx.noteOptional')}</span><textarea data-testid="cwx-note-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {mode === 'defer' ? <label className="rvw-f"><span>{t('cwx.deferUntil')}</span><input type="date" data-testid="cwx-due" value={due} onChange={(e) => setDue(e.target.value)} /></label> : null}
        </div> : null}
        <h4>{t('cwx.ov.history')}</h4>
        {d.history.length ? d.history.map((e: any) => <div key={e.id} className="rvw-ev">{when(e.at, true)} · <b>{t('cwx.action.' + e.type)}</b>{e.actor ? ` · ${e.actor}` : ''}{e.note ? ` · ${e.note}` : ''}</div>) : <p className="sub">—</p>}
        <p className="sub">{t('cwx.ov.noActions')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="cwx-health" title={t('cwx.check')} subtitle={data && data !== 'loading' && !data.error ? t('cwx.health.overall', { s: t('cwx.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('cwx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('cwx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('cwx.health.readOnly')}{data.reused ? ` ${t('cwx.health.recent')}` : ''}</p>
        {data.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('cwx.health.' + x.state)}</span> <b>{t('cwx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{x.key === 'intelligence_agreement' && x.detail ? t('cwx.health.agreement', { c: fmtNumber(x.detail.coarseChurnWatch), p: fmtNumber(x.detail.possible), e: fmtNumber(x.detail.elevated), h: fmtNumber(x.detail.high) }) : t('cwx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
