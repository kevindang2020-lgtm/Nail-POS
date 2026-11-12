// POSAICustomerProfileOverviewScreen.tsx — AI Center → Customer Intelligence (/tenant/ai/customer-profile).
// Customer Intelligence guide (Nov 1 2026). Rebuilt IN PLACE: the title, the subtitle, Refresh, "How to use this", the update
// time and all six cards (with their own labels) stay. The cards now come from a full, set-based scan with the assistant's own
// rules, are clickable, and reconcile on screen ("Why these numbers?": every scanned profile is in exactly one state — which
// is why 15 scanned can be 1 active and 0 inactive). Added: real freshness, Check Customer Intelligence System, a Customer Search
// shortcut, the connected views, the authorized customer list (search · status · flag · date field + presets + calendar · sort ·
// numbered pages), a customer overlay (classification + evidence + the Customer Search profile + links to the owning modules)
// and scan history. Nothing here merges, books, texts, changes points or edits a profile.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCustomerIntelligenceApi, type IntelligenceQuery } from '../api/posCustomerIntelligenceApi';
import { posCustomerSearchApi } from '../api/posCustomerSearchApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const URL_KEYS = ['status', 'flag', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const STATES = ['active', 'rebooking_soon', 'due_for_return', 'inactive', 'long_term_inactive', 'insufficient_history'];
const STATUS_FILTERS = ['active', 'rebooking_soon', 'due_for_return', 'inactive_all', 'inactive', 'long_term_inactive', 'insufficient_history', 'never_served', 'not_scanned'];
// Kevin, Nov 12 2026 (decision 2): churn belongs to Customer Retention — no churn flag or filter of this page's own; the card
// shows Retention's at-risk count (summary.retention) and each row Retention's segment (row.retention), both linking there.
const FLAGS = ['rebooking', 'upcoming', 'duplicate'];
const RETENTION_ROUTE = '/tenant/customers/retention';
const RET_TONE: Record<string, string> = { at_risk: 'bad', approaching: 'warn', active: 'ok', never_visited: '' };
const DATE_FIELDS = ['last_visit', 'created', 'next_appointment', 'profile_updated'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const SORTS = ['last_visit', 'recently_added', 'name', 'visits', 'days_since'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const STATUS_TONE: Record<string, string> = { active: 'ok', rebooking_soon: '', due_for_return: 'warn', inactive: 'warn', long_term_inactive: 'bad', insufficient_history: '' };
const FRESH_TONE: Record<string, string> = { up_to_date: 'ok', stale: 'warn', failed: 'bad', never: 'warn', running: '' };
const KNOWN_ERRORS = ['AI_CUSTOMER_PROFILE_DISABLED', 'CUSTOMER_NOT_FOUND', 'INTELLIGENCE_INVALID_PERIOD', 'INTELLIGENCE_SEARCH_TOO_SHORT', 'INTELLIGENCE_SCAN_FAILED', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN_ERRORS.includes(code)) return t('cix.err.' + code);
  if (isForbidden(e)) return t('cix.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}

export function POSAICustomerProfileOverviewScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v && !(k === 'flag' && !FLAGS.includes(v))) o[k] = v; } return o; }, [sp]);   // an old ?flag=churn_watch link is ignored
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const query: IntelligenceQuery = { ...f, q: q || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };
  const [sum, setSum] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [cal, setCal] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [history, setHistory] = useState<any>(null);
  const seq = useRef(0);
  const autoScanned = useRef(false);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setErr(null);
    try {
      const [s, l] = await Promise.all([posCustomerIntelligenceApi.summary(), posCustomerIntelligenceApi.customers(query)]);
      if (mine !== seq.current) return null;
      setSum(s); setList(l); return s;
    } catch (e) { if (mine === seq.current) setErr(errText(e, 'cix.loadFailed')); return null; }
    finally { if (mine === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query: the object is rebuilt every render
  }, [JSON.stringify(query)]);
  const refresh = useCallback(async () => {
    setBusy(true); setNotice(null);
    try { const r = await posCustomerIntelligenceApi.scan(); setNotice(r?.reused ? t('cix.scanReused') : t('cix.scanDone', { n: fmtNumber(r?.scan?.scanned ?? 0) })); }
    catch (e) { setErr(errText(e, 'cix.err.INTELLIGENCE_SCAN_FAILED')); }
    finally { setBusy(false); await load(); }
  }, [load]);
  useEffect(() => {
    void load().then((s) => {
      // the cards are only as good as the last scan: a never-run or stale scan runs once on open (rate-limited server-side)
      if (!autoScanned.current && s && ['never', 'stale'].includes(s.freshness?.state)) { autoScanned.current = true; void refresh(); }
    });
  }, [load, refresh]);

  const c = sum?.cards; const b = sum?.breakdown; const fr = sum?.freshness;
  const anyFilter = URL_KEYS.some((k) => f[k] && k !== 'page' && k !== 'pageSize') || !!q;
  const sel = (key: string, label: string, options: [string, string][], testId: string, anyLabel: string) => (
    <label className="rvw-f"><span>{label}</span>
      <select data-testid={testId} value={f[key] ?? ''} onChange={(e) => setF({ [key]: e.target.value || null })}>
        <option value="">{anyLabel}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></label>
  );
  const card = (testId: string, label: string, value: number | null | undefined, sub: string, onClick?: () => void, tone?: 'gold' | 'warn') => (
    <KpiCard testId={testId} label={label} loading={loading && !sum} tone={tone} value={value == null ? '—' : fmtNumber(value)} sub={sub} onClick={onClick} />
  );

  return (
    <div className="work rvw cix" data-testid="customer-intelligence-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.customer_intelligence')}</h1><div className="sub mb-3">{t('pos.tenant_wide_customer_profile_signals')}</div></div>
        <div className="rvw-actions">
          <span className={'chip ' + (FRESH_TONE[fr?.state] ?? '')} data-testid="cix-freshness" title={fr ? t('cix.rule', { v: fr.ruleVersion }) : undefined}>
            {busy ? t('cix.fresh.running') : fr ? t('cix.fresh.' + fr.state, { at: when(fr.lastSuccessAt, true) }) : '…'}</span>
          <button className="btn ghost" data-testid="cix-search-shortcut" onClick={() => nav('/tenant/ai/customer-profile/search')}>{t('cix.customerSearch')}</button>
          <button className="btn ghost" data-testid="cix-check" onClick={() => { setHealth('loading'); posCustomerIntelligenceApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'cix.loadFailed') })); }}>{t('cix.check')}</button>
          <button className="btn" data-testid="cix-refresh" onClick={() => void refresh()} disabled={busy}>{busy ? t('pos.refreshing') : t('pos.refresh')}</button>
        </div>
      </div>
      {notice ? <div className="panel" role="status" data-testid="cix-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={() => void load()} /> : null}
      <section className="panel" data-testid="cix-howto-panel" style={{ padding: 14, marginTop: 10 }}>
        <div className="p-h" style={{ padding: 0, marginBottom: 6 }}>{t('pos.how_to_use_this')}</div>
        <div className="sub">{t('pos.these_counts_come_from_a_scan_bpi3')}{' '}<strong>{t('pos.churn_watch')}</strong> {t('pos.for_the_explained_evidence_backed_risk_1s1y')}{' '}<strong>{t('pos.duplicate_review')}</strong> {t('pos.to_merge_or')}{' '}<strong>{t('pos.rebooking')}</strong> / <strong>{t('pos.recommendations')}</strong> {t('pos.for_per_customer_actions_press')}{' '}<strong>{t('pos.refresh')}</strong> {t('pos.to_recompute')}</div>
      </section>

      <div className="rvw-kpis" data-testid="cix-cards">
        {card('kpi-dup', t('pos.duplicate_candidate_groups'), c?.duplicateGroups, c && c.duplicateGroups == null ? t('cix.dupNotScanned') : t('pos.needs_review'), () => nav('/tenant/ai/customer-profile/duplicates'), 'gold')}
        {card('kpi-active', t('pos.active_customers'), c?.active, c ? t('pos.withupcomingappointment_with_upcoming', { withUpcomingAppointment: String(c.withUpcoming) }) : '', () => setF({ status: 'active', flag: null }))}
        {card('kpi-inactive', t('pos.inactive_customers'), c?.inactive, t('pos.no_recent_completed_visit'), () => setF({ status: 'inactive_all', flag: null }))}
        {card('kpi-churn', t('cpx.kpi.retAtRisk'), sum ? (sum.retention ? sum.retention.atRisk : null) : undefined, t('cix.ret.sub'), () => nav(RETENTION_ROUTE), sum?.retention?.atRisk ? 'warn' : undefined)}
        {card('kpi-rebook', t('pos.rebooking_opportunities'), c?.rebooking, t('pos.no_future_appointment'), () => setF({ flag: 'rebooking', status: null }))}
        {card('kpi-scanned', t('pos.customers_scanned'), c?.scanned, t('pos.full_directory'), () => setWhy(true))}
      </div>
      <div className="sub" data-testid="cix-retention-source">{t('cpx.ret.source')} <button type="button" className="aic-link" data-testid="cix-retention-link" onClick={() => nav(RETENTION_ROUTE)}>{t('cpx.ret.open')}</button></div>
      <p className="sub" data-testid="cix-updated">{sum?.scan ? t('cix.updated', { at: when(sum.scan.finishedAt, true), ms: fmtNumber(sum.scan.durationMs ?? 0) }) : !loading ? t('cix.noScanYet') : ''}
        {b ? <> · <button className="link" data-testid="cix-why" onClick={() => setWhy(true)}>{t('cix.whyNumbers')}</button></> : null}</p>

      <div className="rvw-tabs" role="tablist" data-testid="cix-views">
        <button role="tab" aria-selected className="btn ghost on" data-testid="view-customers" onClick={() => setF({ status: null, flag: null })}>{t('cix.view.customers')}</button>
        <button role="tab" aria-selected={false} className="btn ghost" data-testid="view-duplicates" onClick={() => nav('/tenant/ai/customer-profile/duplicates')}>{t('pos.duplicate_review')}</button>
        <button role="tab" aria-selected={false} className="btn ghost" data-testid="view-churn" onClick={() => nav('/tenant/ai/customer-profile/churn')}>{t('pos.churn_watch')}</button>
        <button role="tab" aria-selected={false} className="btn ghost" data-testid="view-rebooking" onClick={() => nav('/tenant/ai/customer-profile/rebooking')}>{t('pos.rebooking')}</button>
        <button role="tab" aria-selected={false} className="btn ghost" data-testid="view-recs" onClick={() => nav('/tenant/ai/customer-profile/recommendations')}>{t('pos.recommendations')}</button>
        <button role="tab" aria-selected={false} className="btn ghost" data-testid="view-history" onClick={() => posCustomerIntelligenceApi.scans({ pageSize: 10 }).then(setHistory).catch((e) => setErr(errText(e, 'cix.loadFailed')))}>{t('cix.view.history')}</button>
      </div>

      <form className="panel rvw-filters" data-testid="cix-searchbar" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setF({}, false); }}>
        <input className="rvw-search" data-testid="cix-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('cix.searchPh')} aria-label={t('cix.searchPh')} />
        <button className="btn" type="submit" data-testid="cix-search-btn">{t('pos.search')}</button>
      </form>
      <section className="panel rvw-filters" data-testid="cix-filters">
        {sel('status', t('cix.f.status'), STATUS_FILTERS.map((s) => [s, t('cix.status.' + s)] as [string, string]), 'flt-status', t('cix.all'))}
        {sel('flag', t('cix.f.flag'), FLAGS.map((s) => [s, t('cix.flag.' + s)] as [string, string]), 'flt-flag', t('cix.all'))}
        <label className="rvw-f"><span>{t('cix.f.sort')}</span>
          <select data-testid="flt-sort" value={f.sort ?? 'last_visit'} onChange={(e) => setF({ sort: e.target.value === 'last_visit' ? null : e.target.value })}>
            {SORTS.map((s) => <option key={s} value={s}>{t('cix.sort.' + s)}</option>)}
          </select></label>
        <div className="rvw-dates" data-testid="cix-dates">
          <label className="rvw-f"><span>{t('cix.f.dateField')}</span>
            <select data-testid="flt-datefield" value={f.dateField ?? 'last_visit'} onChange={(e) => setF({ dateField: e.target.value === 'last_visit' ? null : e.target.value })}>
              {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('cix.date.' + d)}</option>)}
            </select></label>
          <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('cix.preset.all')}</button>
          {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: p, from: null, to: null })}>{t('cix.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('cix.preset.custom')}</button>
        </div>
        {anyFilter ? <button className="btn ghost" data-testid="flt-clear" onClick={() => { setDraft(''); setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>{t('cix.clearAll')}</button> : null}
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? deviceToday()}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
      </section>

      <section className="panel rvw-feed" data-testid="cix-customers">
        <div className="p-h">{t('cix.customers')}<span className="sub rvw-scope" data-testid="cix-count">{list ? t('cix.count', { n: fmtNumber(list.total), order: t('cix.sort.' + (list.applied?.sort ?? 'last_visit')) }) : ''}</span></div>
        {loading && !list ? <div className="state">{t('pos.loading_customer_intelligence')}</div>
          : !list ? null
          : list.items.length === 0 ? <Empty title={anyFilter ? t('cix.noMatch') : t('cix.empty')} />
          : <div className="rvw-table-wrap"><table className="tbl rvw-table">
            <thead><tr><th>{t('cix.col.customer')}</th><th>{t('cix.col.history')}</th><th>{t('cix.col.next')}</th><th>{t('cix.col.technician')}</th><th>{t('cix.col.status')}</th><th>{t('cix.col.benefits')}</th><th /></tr></thead>
            <tbody>{list.items.map((r: any) => (
              <tr key={r.id} data-testid="cix-row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }}>
                <td><b>{r.name || '—'}</b><div className="sub">{r.phone ?? t('cix.notProvided')}</div></td>
                <td>{r.completedVisits == null ? '—' : t('cix.visitsLine', { n: fmtNumber(r.completedVisits), last: when(r.lastVisitAt) })}</td>
                <td className="nowrap">{r.nextAppointmentDate ?? t('cix.none')}</td>
                <td>{r.lastTechnician ? t('cix.lastTech', { n: r.lastTechnician }) : '—'}{r.preferredTechnician ? <div className="sub">{t('cix.prefTech', { n: r.preferredTechnician })}</div> : null}</td>
                <td>{!r.scanned ? <span className="chip">{t('cix.status.not_scanned')}</span> : <span className={'chip ' + (STATUS_TONE[r.status] ?? '')}>{t(r.neverServed ? 'cix.status.never_served' : 'cix.status.' + r.status)}</span>}
                  {r.retention ? <button type="button" className={'chip ' + (RET_TONE[r.retention.segment] ?? '')} data-testid="cix-retention" title={t('cpx.ret.open')} onClick={(e) => { e.stopPropagation(); nav(RETENTION_ROUTE); }}>{t('cpx.ret.seg.' + r.retention.segment)}</button> : null}{r.rebooking ? <span className="chip">{t('cix.flag.rebooking')}</span> : null}{r.duplicate ? <span className="chip warn">{t('cix.flag.duplicate')}</span> : null}</td>
                <td>{r.loyalty ? t('cix.points', { n: fmtNumber(r.loyalty.points) }) : '—'}{r.member ? <span className="chip ok">{t('cix.member')}</span> : null}</td>
                <td><button className="btn ghost sm" data-testid="cix-view" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{t('cix.view')}</button></td>
              </tr>))}</tbody></table></div>}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: String(p) }, true)} />
          <label className="rvw-f"><span>{t('cix.rows')}</span>
            <select data-testid="cix-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
              {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
        </div>
        {list ? <p className="sub">{list.contact === 'full' ? t('cix.contactFull') : t('cix.contactMasked')} · {t('cix.readOnly')}</p> : null}
      </section>

      {why && b ? <FitDialog wide testId="cix-why-dialog" title={t('cix.why.title')} onClose={() => setWhy(false)} footer={<button className="btn ghost" onClick={() => setWhy(false)}>{t('cix.close')}</button>}>
        <p>{t('cix.why.intro', { n: fmtNumber(b.scanned) })}</p>
        <table className="tbl" data-testid="cix-breakdown"><tbody>
          {STATES.map((s) => <tr key={s} data-testid={`why-${s}`}><td>{t('cix.status.' + s)}</td><td className="num">{fmtNumber(b.states[s] ?? 0)}</td><td className="sub">{t('cix.why.def.' + s, { d: sum.definitions.inactiveDays, l: sum.definitions.longTermInactiveDays, m: sum.definitions.minVisitsForCadence })}</td></tr>)}
          <tr><td><b>{t('cix.why.total')}</b></td><td className="num"><b data-testid="why-sum">{fmtNumber(b.sumOfStates)}</b></td><td className="sub">{b.sumOfStates === b.scanned ? t('cix.why.matches') : t('cix.why.mismatch')}</td></tr>
        </tbody></table>
        <p className="sub" data-testid="why-insufficient">{t('cix.why.insufficient', { never: fmtNumber(b.neverServed), under: fmtNumber(b.underCadence), m: sum.definitions.minVisitsForCadence })}</p>
        <p className="sub">{t('cix.why.cards')}</p>
        <p className="sub">{t('cix.why.excluded', { a: fmtNumber(b.archivedExcluded), n: fmtNumber(b.newSinceScan) })}</p>
      </FitDialog> : null}
      {history ? <FitDialog wide testId="cix-history" title={t('cix.view.history')} onClose={() => setHistory(null)} footer={<button className="btn ghost" onClick={() => setHistory(null)}>{t('cix.close')}</button>}>
        {history.items.length === 0 ? <Empty title={t('cix.noScanYet')} /> : <table className="tbl"><thead><tr><th>{t('cix.hist.when')}</th><th>{t('cix.hist.status')}</th><th>{t('cix.hist.scanned')}</th><th>{t('cix.hist.by')}</th></tr></thead>
          <tbody>{history.items.map((s: any) => <tr key={s.id} data-testid="cix-scan-row"><td>{when(s.startedAt, true)}</td><td>{t('cix.hist.' + s.status)}</td><td className="num">{fmtNumber(s.scanned)}</td><td>{s.actor ?? t('cix.hist.' + s.trigger)}</td></tr>)}</tbody></table>}
        <Pager info={{ page: history.page, pageSize: history.pageSize, totalItems: history.total, totalPages: history.totalPages }} onPage={(p) => posCustomerIntelligenceApi.scans({ page: p, pageSize: 10 }).then(setHistory).catch(() => undefined)} />
      </FitDialog> : null}
      {openId ? <CustomerOverlay id={openId} onClose={() => setOpenId(null)} nav={nav} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function CustomerOverlay({ id, onClose, nav }: { id: string; onClose: () => void; nav: (to: string) => void }) {
  const [ci, setCi] = useState<any>(null);
  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setCi(null); setP(null); setErr(null);
    posCustomerIntelligenceApi.customer(id).then(setCi).catch((e) => setErr(errText(e, 'cix.loadFailed')));
    posCustomerSearchApi.profile(id).then(setP).catch(() => setP(false));
  }, [id]);
  const go = (to: string) => { onClose(); nav(to); };
  const k = ci?.classification; const idn = p?.identity;
  return (
    <FitDialog wide testId="cix-overlay" title={idn?.name || t('cix.ov.title')} subtitle={k ? t('cix.status.' + (k.status === 'insufficient_history' && k.completedVisits === 0 ? 'never_served' : k.status)) : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        <button className="btn ghost" data-testid="ov-customer" onClick={() => go(`/tenant/customers/profiles?customerId=${encodeURIComponent(id)}`)}>{t('cix.ov.openCustomer')}</button>
        <button className="btn ghost" data-testid="ov-timeline" onClick={() => go(`/tenant/ai/customer-profile/timeline?customer=${encodeURIComponent(id)}`)}>{t('cix.ov.timeline')}</button>
        <button className="btn ghost" data-testid="ov-book" onClick={() => go(`/booking/new?customerId=${encodeURIComponent(id)}&from=customer-intelligence`)}>{t('cix.ov.book')}</button>
        {ci?.duplicateGroups?.length ? <button className="btn ghost" data-testid="ov-dups" onClick={() => go('/tenant/ai/customer-profile/duplicates')}>{t('pos.duplicate_review')}</button> : null}
        <button className="btn ghost" onClick={onClose}>{t('cix.close')}</button>
      </div>}>
      {err ? <div className="err">{err}</div> : !ci ? <div className="state">{t('cix.loading')}</div> : <>
        {!ci.scanned ? <p className="warn" data-testid="ov-not-scanned">{t('cix.ov.notScanned')}</p> : <dl className="rvw-dl" data-testid="ov-classification">
          <dt>{t('cix.ov.visits')}</dt><dd>{t('cix.visitsLine', { n: fmtNumber(k.completedVisits), last: when(k.lastVisitAt) })}{k.firstVisitAt ? ` · ${t('cix.ov.first', { d: when(k.firstVisitAt) })}` : ''}</dd>
          <dt>{t('cix.ov.interval')}</dt><dd>{k.typicalIntervalDays ? t('cix.ov.days', { n: k.typicalIntervalDays }) : t('cix.ov.noCadence')}</dd>
          <dt>{t('cix.ov.next')}</dt><dd>{k.nextAppointmentDate ?? t('cix.none')}</dd>
          <dt>{t('cix.ov.evidence')}</dt><dd data-testid="ov-evidence">{k.evidence.length ? k.evidence.join(' · ') : '—'}</dd>
          {k.rebooking ? <><dt>{t('cix.flag.rebooking')}</dt><dd>{k.rebookingReason ?? ''}</dd></> : null}
          <dt>{t('cix.ov.computed')}</dt><dd>{when(k.computedAt, true)}</dd>
        </dl>}
        {p ? <dl className="rvw-dl" data-testid="ov-profile">
          <dt>{t('cix.ov.contact')}</dt><dd>{idn.phone ?? t('cix.notProvided')} · {idn.email ?? t('cix.notProvided')}</dd>
          <dt>{t('cix.ov.prefTech')}</dt><dd>{p.preferences?.technician?.name ? `${p.preferences.technician.name} (${t('cix.ov.recorded')})` : t('cix.ov.noneRecorded')}</dd>
          <dt>{t('cix.ov.loyalty')}</dt><dd>{p.sources?.loyalty === 'unavailable' ? t('cix.unavailable') : p.loyalty?.enrolled ? t('cix.points', { n: fmtNumber(p.loyalty.points) }) : t('cix.ov.notEnrolled')}</dd>
          <dt>{t('cix.ov.membership')}</dt><dd>{p.sources?.memberships === 'unavailable' ? t('cix.unavailable') : p.memberships?.find((m: any) => m.status === 'active')?.plan ?? t('cix.none')}</dd>
        </dl> : p === false ? <p className="sub">{t('cix.ov.profileUnavailable')}</p> : null}
        <p className="sub">{t('cix.ov.readOnly')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="cix-health" title={t('cix.check')} subtitle={data && data !== 'loading' && !data.error ? t('cix.health.overall', { s: t('cix.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('cix.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('cix.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('cix.health.readOnly')}{data.reused ? ` ${t('cix.health.recent')}` : ''}</p>
        {data.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('cix.health.' + x.state)}</span> <b>{t('cix.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{x.key === 'eligibility' && x.detail ? t('cix.health.eligibility', { s: fmtNumber(x.detail.scanned), a: fmtNumber(x.detail.active), i: fmtNumber(x.detail.inactiveCard), n: fmtNumber(x.detail.neverServed), u: fmtNumber(x.detail.underCadence), r: fmtNumber(x.detail.rebookingSoon + x.detail.dueForReturn) }) : t('cix.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
