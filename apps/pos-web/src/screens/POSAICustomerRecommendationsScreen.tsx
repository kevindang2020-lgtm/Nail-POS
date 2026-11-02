// POSAICustomerRecommendationsScreen.tsx — AI Center → Customer Profile → Service Recommendations
// (/tenant/ai/customer-profile/recommendations). Service Recommendations guide (Nov 1 2026). Rebuilt IN PLACE: the title,
// the description ("Suggestions from real visit history and your active services — never auto-booked"), the search box
// (name · phone · email) and the Search button stay. The page used to open on a blank area that only filled after picking
// ONE customer, matched services by NAME, and stored nothing; it now opens on the salon's queue of stored suggestions
// (Data Unavailable — never a misleading zero — before the first evaluation). Added: six cards, Refresh (one bounded
// evaluation), Check Service Recommendations System, Open Customer Search, View Services Catalog, Needs Review / Reviewed /
// Already Booked / All / No longer suggested / History tabs, type, service and technician filters, a date dimension with
// presets and the From/To month calendar, sort, numbered pages (newest first), evaluation history, and the 360° overlay:
// the suggestion's evidence, today's catalog price / duration / add-ons, qualified technicians, completed services and
// frequency, bookings (service-level), Hội viên, other suggestions, review and activity — with Mark reviewed / Review later
// / Not applicable / Reopen / note and "Open AI Booking Assistant", a PREFILL of POS → Booking. Nothing here books, adds to
// a ticket, changes a price or sends a message.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posServiceRecommendationsApi as api, type RecommendationQuery } from '../api/posServiceRecommendationsApi';
import { storeBookingHandoff } from '../api/posRebookingApi';
import { posCatalogApi } from '../api/posCatalogApi';
import { errorTextOf } from '../i18n/error-text';
import { statusLabel } from '../i18n/status-label';
import { fmtNumber, fmtInZone, fmtMoney } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';
import { useCan } from '../components/usePermissions';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const weeksSince = (iso?: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / (7 * 86_400_000))) : 0);
const URL_KEYS = ['tab', 'type', 'serviceId', 'technicianId', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const TABS = ['needs_review', 'reviewed', 'booked', 'all', 'superseded'];
const TYPES = ['repeat_service', 'previously_preferred'];
const DATE_FIELDS = ['generated', 'evaluated', 'last_completed', 'reviewed', 'customer_created', 'booking'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const SORTS = ['newest', 'oldest', 'recently_reviewed', 'name', 'last_completed', 'service'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const REC_TONE: Record<string, string> = { needs_review: 'warn', reviewed: 'ok', deferred: 'gold', not_applicable: '', booked: 'ok', service_inactive: 'bad', superseded: '' };
const KNOWN_ERRORS = ['AI_CUSTOMER_PROFILE_DISABLED', 'SR_NOT_FOUND', 'SR_INVALID_PERIOD', 'SR_SEARCH_TOO_SHORT', 'SR_INVALID_FILTER', 'SR_NOT_CURRENT', 'SR_ALREADY_BOOKED',
  'SR_SERVICE_INACTIVE', 'SR_TECHNICIAN_NOT_QUALIFIED', 'SR_STALE_VERSION', 'SR_NOTE_REQUIRED', 'SR_SCAN_FAILED', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN_ERRORS.includes(code)) return t('srx.err.' + code, { d: String(e?.body?.details?.nextAppointmentDate ?? '') });
  if (isForbidden(e)) return t('srx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}
/** the suggestion's reason, localized from its numbers (the evidence is never server English) */
const reason = (type: string, ev: { timesCompleted: number; lastCompletedAt: string | null }) =>
  t('srx.ev.' + type, { n: fmtNumber(ev.timesCompleted), d: when(ev.lastCompletedAt), w: fmtNumber(weeksSince(ev.lastCompletedAt)) });

export function POSAICustomerRecommendationsScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v) o[k] = v; } return o; }, [sp]);
  // a filter change returns to page 1; paging keeps everything else
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const tab = f.tab ?? 'needs_review';
  const query: RecommendationQuery = { ...f, tab, q: q || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };
  const [sum, setSum] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [histPage, setHistPage] = useState(1);
  const [scans, setScans] = useState<any>(null);
  const [scanPage, setScanPage] = useState(1);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [view, setView] = useState<'queue' | 'history' | 'scans'>('queue');
  const [services, setServices] = useState<{ serviceId: string; name: string }[] | null>(null);
  const [techName, setTechName] = useState<string | undefined>(undefined);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setErr(null);
    try {
      const [s, l] = await Promise.all([api.summary(), api.list(query)]);
      if (mine === seq.current) { setSum(s); setList(l); }
    } catch (e) { if (mine === seq.current) setErr(errText(e, 'srx.loadFailed')); }
    finally { if (mine === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query: the object is rebuilt every render
  }, [JSON.stringify(query)]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // the service filter lists the active catalog; without catalog access the filter is simply not offered
    posCatalogApi.services({ status: 'active', sort: 'name', pageSize: 100 }).then((r) => setServices((r?.items ?? []).map((s: any) => ({ serviceId: String(s.serviceId), name: String(s.name) }))))
      .catch(() => setServices([]));
  }, []);
  useEffect(() => {
    if (view === 'history') api.history({ page: histPage, pageSize: 25 }).then(setHist).catch((e) => setErr(errText(e, 'srx.loadFailed')));
    if (view === 'scans') api.scans({ page: scanPage, pageSize: 10 }).then(setScans).catch((e) => setErr(errText(e, 'srx.loadFailed')));
  }, [view, histPage, scanPage]);
  const refresh = async () => {
    setBusy(true); setNotice(null);
    try { const r = await api.refresh(); setNotice(r?.reused ? t('srx.refreshReused') : t('srx.refreshDone', { n: fmtNumber(r?.scan?.customersEvaluated ?? 0), s: fmtNumber(r?.scan?.generated ?? 0) })); }
    catch (e) { setErr(errText(e, 'srx.err.SR_SCAN_FAILED')); }
    finally { setBusy(false); await load(); }
  };
  const m = sum?.metrics; const fr = sum?.freshness;
  const anyFilter = ['type', 'serviceId', 'technicianId', 'dateField', 'preset', 'sort'].some((k) => f[k]) || !!q;
  const metric = (testId: string, label: string, v: number | undefined, onClick?: () => void, tone?: 'warn' | 'bad' | 'gold') => (
    <KpiCard testId={testId} label={label} loading={loading && !sum} tone={tone} value={sum?.unavailable ? t('srx.unavailable') : v == null ? '—' : fmtNumber(v)} onClick={onClick} />
  );
  const showTab = (x: string | null) => { setView('queue'); setF({ tab: x }); };
  const clearAll = () => { setDraft(''); setQ(''); setTechName(undefined); setF({ type: null, serviceId: null, technicianId: null, dateField: null, preset: null, from: null, to: null, sort: null }); };

  return (
    <div className="work rvw srx" data-testid="recommendations-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.service_recommendations')}</h1><div className="sub mb-3">{t('pos.suggestions_from_real_visit_history_and_uafw')}</div></div>
        <div className="rvw-actions">
          <span className={'chip ' + (fr?.state === 'up_to_date' ? 'ok' : fr?.state === 'failed' ? 'bad' : 'warn')} data-testid="srx-freshness">
            {busy ? t('srx.fresh.running') : fr ? t('srx.fresh.' + fr.state, { at: when(fr.lastEvaluatedAt, true) }) : '…'}</span>
          <button className="btn ghost" data-testid="srx-check" onClick={() => { setHealth('loading'); api.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'srx.loadFailed') })); }}>{t('srx.check')}</button>
          <button className="btn ghost" data-testid="srx-search-link" onClick={() => nav('/tenant/ai/customer-profile/search')}>{t('srx.openSearch')}</button>
          <button className="btn ghost" data-testid="srx-catalog" onClick={() => nav('/services')}>{t('srx.openCatalog')}</button>
          <button className="btn" data-testid="srx-refresh" disabled={busy} onClick={() => void refresh()}>{busy ? t('pos.refreshing') : t('pos.refresh')}</button>
        </div>
      </div>
      {notice ? <div className="panel" role="status" data-testid="srx-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={() => void load()} /> : null}
      {sum?.unavailable ? <p className="warn" data-testid="srx-unavailable">{t('srx.unavailableNote')}</p> : null}

      <div className="rvw-kpis" data-testid="srx-metrics">
        {metric('kpi-recommendations', t('srx.kpi.recommendations'), m?.recommendations, () => showTab('all'))}
        {metric('kpi-evaluated', t('srx.kpi.evaluated'), m?.customersEvaluated)}
        {metric('kpi-needs', t('srx.kpi.needs'), m?.needsReview, () => showTab(null), 'warn')}
        {metric('kpi-recent', t('srx.kpi.recent'), m?.recentlyReviewed, () => { showTab('reviewed'); }, 'gold')}
        {metric('kpi-bookings', t('srx.kpi.bookings'), m?.associatedBookings)}
        {metric('kpi-insufficient', t('srx.kpi.insufficient'), m?.insufficientHistory)}
      </div>

      <form className="panel rvw-filters" data-testid="srx-searchbar" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setF({}, false); }}>
        <input className="rvw-search" data-testid="srx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('pos.search_by_name_phone_or_email')} aria-label={t('pos.search_by_name_phone_or_email')} />
        <button className="btn" type="submit" data-testid="srx-search-btn">{t('pos.search')}</button>
        {anyFilter ? <button className="btn ghost" type="button" data-testid="flt-clear" onClick={clearAll}>{t('srx.clearAll')}</button> : null}
        <span className="sub">{t('srx.searchHint')}</span>
      </form>

      <div className="rvw-tabs" role="tablist" data-testid="srx-tabs">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={view === 'queue' && tab === x} className={'btn ghost' + (view === 'queue' && tab === x ? ' on' : '')} data-testid={`tab-${x}`} onClick={() => showTab(x === 'needs_review' ? null : x)}>{t('srx.tab.' + x)}</button>)}
        <button role="tab" aria-selected={view === 'history'} className={'btn ghost' + (view === 'history' ? ' on' : '')} data-testid="tab-history" onClick={() => setView('history')}>{t('srx.tab.history')}</button>
        <button role="tab" aria-selected={view === 'scans'} className={'btn ghost' + (view === 'scans' ? ' on' : '')} data-testid="tab-scans" onClick={() => setView('scans')}>{t('srx.evalHistory')}</button>
      </div>

      {view === 'history' ? (
        <section className="panel rvw-feed" data-testid="srx-history">
          {!hist ? <div className="state">{t('srx.loading')}</div> : hist.items.length === 0 ? <Empty title={t('srx.noHistory')} /> : (
            <table className="tbl rvw-table"><thead><tr><th>{t('srx.hist.when')}</th><th>{t('srx.col.customer')}</th><th>{t('srx.hist.service')}</th><th>{t('srx.hist.action')}</th><th>{t('srx.hist.note')}</th><th>{t('srx.hist.by')}</th></tr></thead>
              <tbody>{hist.items.map((e: any) => <tr key={e.id} data-testid="srx-hist-row"><td className="nowrap">{when(e.at, true)}</td><td>{e.name ?? '—'}</td><td>{e.service ?? '—'}</td><td>{t('srx.action.' + e.type)}</td><td>{e.note ?? ''}</td><td>{e.actor ?? '—'}</td></tr>)}</tbody></table>)}
          {hist ? <Pager info={{ page: hist.page, pageSize: hist.pageSize, totalItems: hist.total, totalPages: hist.totalPages }} onPage={setHistPage} /> : null}
        </section>
      ) : view === 'scans' ? (
        <section className="panel rvw-feed" data-testid="srx-scans">
          {!scans ? <div className="state">{t('srx.loading')}</div> : scans.items.length === 0 ? <Empty title={t('srx.fresh.never')} /> : (
            <table className="tbl rvw-table"><thead><tr><th>{t('srx.scan.when')}</th><th>{t('srx.scan.status')}</th><th>{t('srx.scan.customers')}</th><th>{t('srx.scan.suggestions')}</th><th>{t('srx.scan.duration')}</th></tr></thead>
              <tbody>{scans.items.map((s: any) => <tr key={s.id} data-testid="srx-scan-row"><td className="nowrap">{when(s.startedAt, true)}</td><td>{t('srx.scanStatus.' + s.status)}</td><td className="num">{fmtNumber(s.customersEvaluated)}</td><td className="num">{fmtNumber(s.generated)}</td><td className="num">{s.durationMs == null ? '—' : `${fmtNumber(s.durationMs)} ms`}</td></tr>)}</tbody></table>)}
          {scans ? <Pager info={{ page: scans.page, pageSize: scans.pageSize, totalItems: scans.total, totalPages: scans.totalPages }} onPage={setScanPage} /> : null}
        </section>
      ) : <>
        <section className="panel rvw-filters" data-testid="srx-filters">
          <label className="rvw-f"><span>{t('srx.f.type')}</span>
            <select data-testid="flt-type" value={f.type ?? ''} onChange={(e) => setF({ type: e.target.value || null })}>
              <option value="">{t('srx.anyType')}</option>{TYPES.map((x) => <option key={x} value={x}>{t('srx.type.' + x)}</option>)}
            </select></label>
          {services && services.length ? <label className="rvw-f"><span>{t('srx.f.service')}</span>
            <select data-testid="flt-service" value={f.serviceId ?? ''} onChange={(e) => setF({ serviceId: e.target.value || null })}>
              <option value="">{t('srx.anyService')}</option>{services.map((s) => <option key={s.serviceId} value={s.serviceId}>{s.name}</option>)}
            </select></label> : null}
          <label className="rvw-f"><span>{t('srx.f.technician')}</span>
            <TechnicianPickerButton value={f.technicianId ?? ''} valueName={techName} emptyLabel={t('srx.anyTechnician')} anyLabel={t('srx.anyTechnician')} ariaLabel={t('srx.f.technician')}
              onChange={(id, tech) => { setTechName(tech?.name); setF({ technicianId: id || null }); }} /></label>
          <label className="rvw-f"><span>{t('srx.f.sort')}</span>
            <select data-testid="flt-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value === 'newest' ? null : e.target.value })}>
              {SORTS.map((s) => <option key={s} value={s}>{t('srx.sort.' + s)}</option>)}
            </select></label>
          <div className="rvw-dates" data-testid="srx-dates">
            <label className="rvw-f"><span>{t('srx.f.dateField')}</span>
              <select data-testid="flt-datefield" value={f.dateField ?? 'generated'} onChange={(e) => setF({ dateField: e.target.value === 'generated' ? null : e.target.value })}>
                {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('srx.date.' + d)}</option>)}
              </select></label>
            <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('srx.preset.all')}</button>
            {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: p, from: null, to: null })}>{t('srx.preset.' + p)}</button>)}
            <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('srx.preset.custom')}</button>
          </div>
          {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
            onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
        </section>
        <section className="panel rvw-feed" data-testid="srx-results">
          <div className="p-h">{t('srx.tab.' + tab)}<span className="sub rvw-scope" data-testid="srx-count">{list && !list.unavailable ? t('srx.count', { n: fmtNumber(list.total) }) : ''}</span>
            {list?.freshness?.lastEvaluatedAt ? <span className="sub"> · {t('srx.asOf', { at: when(list.freshness.lastEvaluatedAt, true) })}</span> : null}</div>
          {loading && !list ? <div className="state" data-testid="srx-loading">{t('srx.loading')}</div>
            : !list ? null
            : list.unavailable ? <Empty title={t('srx.unavailableNote')} />
            : list.items.length === 0 ? <Empty title={anyFilter ? t('srx.noMatch') : t('srx.empty.' + tab)} />
            : <div className="rvw-table-wrap"><table className="tbl rvw-table">
              <thead><tr><th>{t('srx.col.customer')}</th><th>{t('srx.col.last')}</th><th>{t('srx.col.suggested')}</th><th>{t('srx.col.price')}</th><th>{t('srx.col.technician')}</th><th>{t('srx.col.booking')}</th><th>{t('srx.col.reason')}</th><th>{t('srx.col.status')}</th><th /></tr></thead>
              <tbody>{list.items.map((r: any) => (
                <tr key={r.id} data-testid="srx-row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }}>
                  <td><b>{r.name || '—'}</b><div className="sub">{r.phone ?? t('srx.notProvided')}</div></td>
                  <td>{r.lastService ?? '—'}<div className="sub">{when(r.lastVisitAt)}</div></td>
                  <td><b>{r.service.name ?? '—'}</b><div className="sub">{t('srx.type.' + r.type)}</div></td>
                  <td className="nowrap" data-testid="srx-price">{r.service.active ? t('srx.row.price', { p: fmtMoney(r.service.priceCents), m: fmtNumber(r.service.durationMinutes) }) : t('srx.row.inactive')}</td>
                  <td>{r.technician ? r.technician.name : '—'}</td>
                  <td data-testid="srx-booking">{r.booking.thisService ? t('srx.row.thisBooked') : r.booking.nextAnyDate ? t('srx.row.otherBooked', { d: r.booking.nextAnyDate }) : t('srx.row.none')}
                    {r.booking.associated ? <div className="sub">{t('srx.row.associated')}</div> : null}</td>
                  <td className="sub" data-testid="srx-reason">{reason(r.type, r.evidence)}</td>
                  <td><span className={'chip ' + (REC_TONE[r.state] ?? '')} data-testid="srx-state">{t('srx.state.' + r.state)}</span><div className="sub">{when(r.generatedAt)}</div></td>
                  <td><button className="btn ghost sm" data-testid="srx-view" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{t('srx.view')}</button></td>
                </tr>))}</tbody></table></div>}
          <div className="rvw-pager">
            <Pager info={list && !list.unavailable ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: String(p) }, true)} />
            <label className="rvw-f"><span>{t('srx.rows')}</span>
              <select data-testid="srx-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
                {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
          </div>
          <p className="sub">{t('srx.advisory')}</p>
        </section>
      </>}

      {openId ? <RecommendationOverlay id={openId} onClose={() => setOpenId(null)} onChanged={(msg) => { setNotice(msg); void load(); }} nav={nav} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function RecommendationOverlay({ id, onClose, onChanged, nav }: { id: string; onClose: () => void; onChanged: (msg: string) => void; nav: (to: string) => void }) {
  const can = useCan();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'defer' | 'note'>('view');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const reload = useCallback(() => { setErr(null); api.detail(id).then(setD).catch((e) => setErr(errText(e, 'srx.loadFailed'))); }, [id]);
  useEffect(() => { reload(); }, [reload]);
  const act = async (action: string, extra: { note?: string; dueOn?: string } = {}) => {
    setBusy(true); setActErr(null);
    try { await api.review(id, { action, expectedVersion: d?.review?.version ?? 0, ...extra }); setMode('view'); setNote(''); setDue(''); reload(); onChanged(t('srx.saved.' + action)); }
    catch (e) { setActErr(errText(e, 'srx.saveFailed')); }
    finally { setBusy(false); }
  };
  const go = (to: string) => { onClose(); nav(to); };
  // Open AI Booking Assistant: the server re-checks the suggestion, the catalog, the technician's qualification and the LIVE
  // calendar for this exact service, then POS → Booking opens prefilled. Nothing is booked here.
  const book = async () => {
    setBusy(true); setActErr(null);
    try {
      const p = d?.technicians?.preferred;
      const h = await api.handoff(id, { technicianId: p && p.active && p.qualified ? p.id : undefined });
      storeBookingHandoff({ source: 'recommendation', customerId: h.customerId, customerName: h.customerName, customerPhone: h.customerPhone, serviceId: h.serviceId,
        technicianId: h.technicianId, technicianName: h.technicianName, date: h.date, preparedAt: h.preparedAt });
      go(`/booking?date=${encodeURIComponent(h.date)}&recommendation=1`);
    } catch (e) { setActErr(errText(e, 'srx.saveFailed')); reload(); }
    finally { setBusy(false); }
  };
  const open = d && d.status === 'open' && d.service?.active && (d.state === 'needs_review' || d.state === 'reviewed' || d.state === 'deferred' || d.state === 'not_applicable');
  const reviewable = d && d.status === 'open';
  const manage = can('pos.ai_customer_profile.view');
  const canBook = can('pos.booking.create');
  return (
    <FitDialog wide testId="srx-overlay" busy={busy} title={t('srx.ov.title')} subtitle={d ? `${d.identity.name ?? '—'} · ${d.service.name ?? '—'} · ${t('srx.state.' + d.state)}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {mode !== 'view' ? <>
          <button className="btn ghost" onClick={() => setMode('view')} disabled={busy}>{t('pos.cancel')}</button>
          {mode === 'defer' ? <button className="btn" data-testid="srx-defer-save" disabled={busy} onClick={() => void act('deferred', { note: note.trim() || undefined, dueOn: due || undefined })}>{t('srx.defer')}</button>
            : <button className="btn" data-testid="srx-note-save" disabled={busy || !note.trim()} onClick={() => void act('note', { note: note.trim() })}>{t('srx.addNote')}</button>}
        </> : <>
          {open && canBook ? <button className="btn" data-testid="srx-book" disabled={busy} onClick={() => void book()}>{t('srx.ov.book')}</button> : null}
          {reviewable && manage && !d?.review?.current ? <button className="btn ghost" data-testid="srx-mark-reviewed" onClick={() => void act('reviewed')}>{t('srx.markReviewed')}</button> : null}
          {reviewable && manage && !d?.review?.current ? <button className="btn ghost" data-testid="srx-defer" onClick={() => setMode('defer')}>{t('srx.defer')}</button> : null}
          {reviewable && manage && !d?.review?.current ? <button className="btn ghost" data-testid="srx-na" onClick={() => void act('not_applicable')}>{t('srx.notApplicable')}</button> : null}
          {d?.review && manage ? <button className="btn ghost" data-testid="srx-reopen" onClick={() => void act('reopened')}>{t('srx.reopen')}</button> : null}
          {manage ? <button className="btn ghost" data-testid="srx-note" onClick={() => setMode('note')}>{t('srx.addNote')}</button> : null}
          {d ? <button className="btn ghost" data-testid="ov-profile" onClick={() => go(`/tenant/customers/profiles?customerId=${encodeURIComponent(d.customerId)}`)}>{t('srx.ov.profile')}</button> : null}
          {d ? <button className="btn ghost" data-testid="ov-history" onClick={() => go(`/tenant/ai/customer-profile/timeline?customer=${encodeURIComponent(d.customerId)}&family=visit`)}>{t('srx.ov.serviceHistory')}</button> : null}
          <button className="btn ghost" data-testid="ov-catalog" onClick={() => go('/services')}>{t('srx.ov.catalog')}</button>
          <button className="btn ghost" data-testid="ov-rebooking" onClick={() => go('/tenant/ai/customer-profile/rebooking')}>{t('srx.ov.rebooking')}</button>
          <button className="btn ghost" data-testid="ov-close" onClick={onClose}>{t('srx.close')}</button>
        </>}
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('srx.loading')}</div> : <>
        {actErr ? <p className="err" role="alert" data-testid="srx-act-err">{actErr}</p> : null}
        <p className="warn" data-testid="ov-note">{t('srx.ov.note')}</p>
        <h4>{t('srx.ov.identity')}</h4>
        <p data-testid="ov-identity">{d.identity.name ?? '—'} · {d.identity.phone ?? t('srx.notProvided')}{d.identity.email ? ` · ${d.identity.email}` : ''}</p>
        <h4>{t('srx.ov.recommendation')}</h4>
        <dl className="rvw-dl" data-testid="ov-recommendation">
          <dt>{t('srx.f.type')}</dt><dd>{t('srx.type.' + d.type)} · {t('srx.conf.' + d.confidence)}</dd>
          <dt>{t('srx.col.reason')}</dt><dd data-testid="ov-reason">{reason(d.type, d.evidence)}</dd>
          <dt>{t('srx.ov.generated')}</dt><dd>{when(d.generatedAt, true)}</dd>
          <dt>{t('srx.ov.rule')}</dt><dd className="sub">{t('srx.ov.ruleLine', { v: d.ruleVersion, at: when(d.evaluatedAt, true) })}</dd>
        </dl>
        <h4>{t('srx.ov.service')}</h4>
        <dl className="rvw-dl" data-testid="ov-service">
          <dt>{t('srx.f.service')}</dt><dd>{d.service.name ?? '—'}{d.service.category ? ` · ${d.service.category}` : ''}{d.service.branch ? ` · ${d.service.branch}` : ''}</dd>
          <dt>{t('srx.col.price')}</dt><dd data-testid="ov-price">{d.service.active ? t('srx.row.price', { p: fmtMoney(d.service.priceCents), m: fmtNumber(d.service.durationMinutes) }) : t('srx.row.inactive')}</dd>
          {d.service.description ? <><dt /><dd className="sub">{d.service.description}</dd></> : null}
          <dt>{t('srx.ov.addOns')}</dt><dd data-testid="ov-addons">{d.service.addOns.length ? d.service.addOns.map((a: any) => `${a.name} (+${fmtMoney(a.priceCents)}, +${fmtNumber(a.durationDeltaMinutes)}m)`).join(' · ') : t('srx.ov.noAddOns')}</dd>
        </dl>
        <h4>{t('srx.ov.technicians')}</h4>
        <p data-testid="ov-technicians">{t('srx.ov.qualifiedLine', { n: fmtNumber(d.technicians.qualifiedTotal) })}{d.technicians.qualified.length ? `: ${d.technicians.qualified.map((x: any) => x.name).filter(Boolean).join(', ')}` : ''}</p>
        {d.technicians.preferred ? <p data-testid="ov-preferred">{t('srx.ov.preferred', { name: d.technicians.preferred.name ?? '—' })}</p> : null}
        <p className="sub">{t('srx.ov.availability')}</p>
        {d.caveats?.length ? <ul className="warn" data-testid="ov-caveats">{d.caveats.filter((c: string) => c !== 'availability_not_checked').map((c: string) => <li key={c}>{t('srx.caveat.' + c)}</li>)}</ul> : null}
        {d.outcome?.associatedBooking ? <p className="sub" data-testid="ov-outcome">{t('srx.ov.outcome')}</p> : null}
        <h4>{t('srx.ov.frequency')}</h4>
        {d.history.frequency.length ? <ul data-testid="ov-frequency">{d.history.frequency.map((x: any) => <li key={x.serviceId}>{t('srx.ov.frequencyLine', { s: x.service ?? '—', n: fmtNumber(x.count), d: when(x.lastAt) })}</li>)}</ul> : <p className="sub">{t('srx.ov.noVisits')}</p>}
        <h4>{t('srx.ov.history')}</h4>
        {d.history.visits.length ? <table className="tbl rvw-table" data-testid="ov-visits"><tbody>{d.history.visits.map((v: any) => (
          <tr key={v.ticketId}><td className="nowrap">{when(v.at)}</td><td>{v.lines.map((l: any) => l.service).filter(Boolean).join(', ') || '—'}</td><td>{[...new Set(v.lines.map((l: any) => l.technician).filter(Boolean))].join(', ') || '—'}</td></tr>))}</tbody></table>
          : <p className="sub">{t('srx.ov.noVisits')}</p>}
        <h4>{t('srx.ov.bookings')}</h4>
        {d.bookings.length ? <table className="tbl rvw-table" data-testid="ov-bookings"><tbody>{d.bookings.map((b: any) => (
          <tr key={b.id}><td className="nowrap">{b.date} {b.time ?? ''}</td><td>{b.services.join(', ') || '—'}{b.includesThisService ? ` · ${t('srx.ov.thisService')}` : ''}</td><td>{b.technician ?? '—'}</td>
            <td><span className={'chip ' + (b.upcoming ? 'ok' : '')}>{statusLabel('appointment', b.status)}{b.upcoming ? ` · ${t('srx.ov.upcoming')}` : ''}</span></td></tr>))}</tbody></table>
          : <p className="sub">{t('srx.ov.noBookings')}</p>}
        {d.memberships?.length ? <><h4>{t('srx.ov.memberships')}</h4><p data-testid="ov-memberships">{d.memberships.map((x: any) => `${statusLabel('membership', x.status)} · ${fmtNumber(x.count)}`).join(' · ')}</p></> : null}
        {d.otherRecommendations?.length ? <><h4>{t('srx.ov.others')}</h4><p data-testid="ov-others">{d.otherRecommendations.map((o: any) => `${o.service ?? '—'} (${t('srx.type.' + o.type)})`).join(' · ')}</p></> : null}
        {d.review ? <p data-testid="ov-review">{t('srx.ov.reviewLine', { s: t('srx.state.' + d.review.status), at: when(d.review.at, true) })}{d.review.dueOn ? ` · ${t('srx.ov.until', { d: d.review.dueOn })}` : ''}{!d.review.current ? ` · ${t('srx.ov.reviewExpired')}` : ''}</p> : null}
        {mode !== 'view' ? <div className="dupx-form">
          <label className="rvw-f"><span>{mode === 'note' ? t('srx.noteRequired') : t('srx.noteOptional')}</span><textarea data-testid="srx-note-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {mode === 'defer' ? <label className="rvw-f"><span>{t('srx.deferUntil')}</span><input type="date" data-testid="srx-due" value={due} onChange={(e) => setDue(e.target.value)} /></label> : null}
        </div> : null}
        <h4>{t('srx.ov.activity')}</h4>
        {d.activity.length ? d.activity.map((e: any) => <div key={e.id} className="rvw-ev">{when(e.at, true)} · <b>{t('srx.action.' + e.type)}</b>{e.actor ? ` · ${e.actor}` : ''}{e.note ? ` · ${e.note}` : ''}</div>) : <p className="sub">—</p>}
        <p className="sub">{t('srx.ov.noActions')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="srx-health" title={t('srx.check')} subtitle={data && data !== 'loading' && !data.error ? t('srx.health.overall', { s: t('srx.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('srx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('srx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('srx.health.readOnly')}{data.reused ? ` ${t('srx.health.recent')}` : ''}</p>
        {data.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('srx.health.' + x.state)}</span> <b>{t('srx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('srx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
