// POSAICustomerRebookingScreen.tsx — AI Center → Customer Profile → Rebooking (/tenant/ai/customer-profile/rebooking).
// Rebooking Opportunities guide (Nov 1 2026). Rebuilt IN PLACE: the title, the advisory line ("booking always goes through
// the AI Booking Assistant with confirmation"), the search box (name · phone · email) and the Search button stay. The page
// used to open on a blank area that only filled after picking ONE customer; it now opens on the salon's authorized review
// queue with honest states (Data Unavailable — never a misleading zero — when nothing has been evaluated). Added: the cards,
// Refresh (the shared Customer Intelligence evaluation), Check Rebooking System, Open Booking Calendar, Due for Review /
// Coming Due / Reviewed / Already Booked / Insufficient History / All / History tabs, service and technician filters, a date
// dimension with presets and a From/To month calendar, sort, numbered pages (newest opportunity first), and the 360° overlay:
// identity, recommendation + evidence, completed services, bookings, technician, Hội viên, review state and history, with
// Mark reviewed / Defer / Reopen / note and "Open AI Booking Assistant" — a PREFILL of POS → Booking, which re-checks
// availability, takes the human confirmation and applies the salon's phone verification. Nothing here books or sends.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posRebookingApi, storeBookingHandoff, type RebookingQuery } from '../api/posRebookingApi';
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
const URL_KEYS = ['tab', 'serviceId', 'technicianId', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const TABS = ['due_for_review', 'coming_due', 'reviewed', 'booked', 'insufficient', 'all'];
const DATE_FIELDS = ['opportunity', 'last_visit', 'suggested_return', 'next_appointment', 'created', 'reviewed', 'evaluated'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const SORTS = ['newest', 'most_overdue', 'last_visit', 'name'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const OPP_TONE: Record<string, string> = { due: 'warn', coming_due: 'gold', booked: 'ok', insufficient: '', not_due: '', data_unavailable: 'bad' };
const KNOWN_ERRORS = ['AI_CUSTOMER_PROFILE_DISABLED', 'CUSTOMER_NOT_FOUND', 'REBOOKING_INVALID_PERIOD', 'REBOOKING_SEARCH_TOO_SHORT', 'REBOOKING_INVALID_FILTER', 'REBOOKING_NOT_CURRENT',
  'REBOOKING_ALREADY_BOOKED', 'REBOOKING_SERVICE_INACTIVE', 'REBOOKING_TECHNICIAN_INACTIVE', 'REBOOKING_STALE_VERSION', 'REBOOKING_NOTE_REQUIRED', 'INTELLIGENCE_SCAN_FAILED', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN_ERRORS.includes(code)) return t('rbx.err.' + code, { d: String(e?.body?.details?.nextAppointmentDate ?? '') });
  if (isForbidden(e)) return t('rbx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}

export function POSAICustomerRebookingScreen() {
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
  const tab = f.tab ?? 'due_for_review';
  const query: RebookingQuery = { ...f, tab, q: q || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };
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
  const [services, setServices] = useState<{ serviceId: string; name: string }[] | null>(null);
  const [techName, setTechName] = useState<string | undefined>(undefined);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setErr(null);
    try {
      const [s, l] = await Promise.all([posRebookingApi.summary(), posRebookingApi.customers(query)]);
      if (mine === seq.current) { setSum(s); setList(l); }
    } catch (e) { if (mine === seq.current) setErr(errText(e, 'rbx.loadFailed')); }
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
    if (!showHistory) return;
    posRebookingApi.history({ page: histPage, pageSize: 25 }).then(setHist).catch((e) => setErr(errText(e, 'rbx.loadFailed')));
  }, [showHistory, histPage]);
  const refresh = async () => {
    setBusy(true); setNotice(null);
    try { const r = await posRebookingApi.refresh(); setNotice(r?.reused ? t('rbx.refreshReused') : t('rbx.refreshDone', { n: fmtNumber(r?.scan?.scanned ?? 0) })); }
    catch (e) { setErr(errText(e, 'rbx.err.INTELLIGENCE_SCAN_FAILED')); }
    finally { setBusy(false); await load(); }
  };
  const m = sum?.metrics; const fr = sum?.freshness;
  const anyFilter = ['serviceId', 'technicianId', 'dateField', 'preset', 'sort'].some((k) => f[k]) || !!q;
  const metric = (testId: string, label: string, v: number | undefined, onClick?: () => void, tone?: 'warn' | 'bad' | 'gold') => (
    <KpiCard testId={testId} label={label} loading={loading && !sum} tone={tone} value={sum?.unavailable ? t('rbx.unavailable') : v == null ? '—' : fmtNumber(v)} onClick={onClick} />
  );
  const clearAll = () => { setDraft(''); setQ(''); setTechName(undefined); setF({ serviceId: null, technicianId: null, dateField: null, preset: null, from: null, to: null, sort: null }); };

  return (
    <div className="work rvw rbx" data-testid="rebooking-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.rebooking_opportunities_2')}</h1><div className="sub mb-3">{t('pos.advisory_only_booking_always_goes_through_12t8')}</div></div>
        <div className="rvw-actions">
          <span className={'chip ' + (fr?.state === 'up_to_date' ? 'ok' : fr?.state === 'failed' ? 'bad' : 'warn')} data-testid="rbx-freshness">
            {busy ? t('rbx.fresh.running') : fr ? t('rbx.fresh.' + fr.state, { at: when(fr.lastEvaluatedAt, true) }) : '…'}</span>
          <button className="btn ghost" data-testid="rbx-check" onClick={() => { setHealth('loading'); posRebookingApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'rbx.loadFailed') })); }}>{t('rbx.check')}</button>
          <button className="btn ghost" data-testid="rbx-calendar" onClick={() => nav('/booking')}>{t('rbx.openCalendar')}</button>
          <button className="btn" data-testid="rbx-refresh" disabled={busy} onClick={() => void refresh()}>{busy ? t('pos.refreshing') : t('pos.refresh')}</button>
        </div>
      </div>
      {notice ? <div className="panel" role="status" data-testid="rbx-notice" style={{ padding: 12, marginBottom: 10 }}>{notice}</div> : null}
      {err ? <ErrorRetry message={err} onRetry={() => void load()} /> : null}
      {sum?.unavailable ? <p className="warn" data-testid="rbx-unavailable">{t('rbx.unavailableNote')}</p> : null}

      <div className="rvw-kpis" data-testid="rbx-metrics">
        {metric('kpi-opportunities', t('rbx.kpi.opportunities'), m?.opportunities, () => { setShowHistory(false); setF({ tab: 'all' }); })}
        {metric('kpi-due', t('rbx.kpi.due'), m?.dueForReview, () => { setShowHistory(false); setF({ tab: null }); }, 'warn')}
        {metric('kpi-booked', t('rbx.kpi.booked'), m?.alreadyBooked, () => { setShowHistory(false); setF({ tab: 'booked' }); })}
        {metric('kpi-reviewed', t('rbx.kpi.reviewed'), m?.reviewed, () => { setShowHistory(false); setF({ tab: 'reviewed' }); }, 'gold')}
      </div>

      <form className="panel rvw-filters" data-testid="rbx-searchbar" onSubmit={(e) => { e.preventDefault(); setQ(draft.trim()); setF({}, false); }}>
        <input className="rvw-search" data-testid="rbx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('pos.search_by_name_phone_or_email')} aria-label={t('pos.search_by_name_phone_or_email')} />
        <button className="btn" type="submit" data-testid="rbx-search-btn">{t('pos.search')}</button>
        {anyFilter ? <button className="btn ghost" type="button" data-testid="flt-clear" onClick={clearAll}>{t('rbx.clearAll')}</button> : null}
        <span className="sub">{t('rbx.searchHint')}</span>
      </form>

      <div className="rvw-tabs" role="tablist" data-testid="rbx-tabs">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={!showHistory && tab === x} className={'btn ghost' + (!showHistory && tab === x ? ' on' : '')} data-testid={`tab-${x}`} onClick={() => { setShowHistory(false); setF({ tab: x === 'due_for_review' ? null : x }); }}>{t('rbx.tab.' + x)}</button>)}
        <button role="tab" aria-selected={showHistory} className={'btn ghost' + (showHistory ? ' on' : '')} data-testid="tab-history" onClick={() => setShowHistory(true)}>{t('rbx.tab.history')}</button>
      </div>

      {showHistory ? (
        <section className="panel rvw-feed" data-testid="rbx-history">
          {!hist ? <div className="state">{t('rbx.loading')}</div> : hist.items.length === 0 ? <Empty title={t('rbx.noHistory')} /> : (
            <table className="tbl rvw-table"><thead><tr><th>{t('rbx.hist.when')}</th><th>{t('rbx.col.customer')}</th><th>{t('rbx.hist.action')}</th><th>{t('rbx.hist.note')}</th><th>{t('rbx.hist.by')}</th></tr></thead>
              <tbody>{hist.items.map((e: any) => <tr key={e.id} data-testid="rbx-hist-row"><td className="nowrap">{when(e.at, true)}</td><td>{e.name ?? '—'}</td><td>{t('rbx.action.' + e.type)}</td><td>{e.note ?? ''}</td><td>{e.actor ?? '—'}</td></tr>)}</tbody></table>)}
          {hist ? <Pager info={{ page: hist.page, pageSize: hist.pageSize, totalItems: hist.total, totalPages: hist.totalPages }} onPage={setHistPage} /> : null}
        </section>
      ) : <>
        <section className="panel rvw-filters" data-testid="rbx-filters">
          {services && services.length ? <label className="rvw-f"><span>{t('rbx.f.service')}</span>
            <select data-testid="flt-service" value={f.serviceId ?? ''} onChange={(e) => setF({ serviceId: e.target.value || null })}>
              <option value="">{t('rbx.anyService')}</option>{services.map((s) => <option key={s.serviceId} value={s.serviceId}>{s.name}</option>)}
            </select></label> : null}
          <label className="rvw-f"><span>{t('rbx.f.technician')}</span>
            <TechnicianPickerButton value={f.technicianId ?? ''} valueName={techName} emptyLabel={t('rbx.anyTechnician')} anyLabel={t('rbx.anyTechnician')} ariaLabel={t('rbx.f.technician')}
              onChange={(id, tech) => { setTechName(tech?.name); setF({ technicianId: id || null }); }} /></label>
          <label className="rvw-f"><span>{t('rbx.f.sort')}</span>
            <select data-testid="flt-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value === 'newest' ? null : e.target.value })}>
              {SORTS.map((s) => <option key={s} value={s}>{t('rbx.sort.' + s)}</option>)}
            </select></label>
          <div className="rvw-dates" data-testid="rbx-dates">
            <label className="rvw-f"><span>{t('rbx.f.dateField')}</span>
              <select data-testid="flt-datefield" value={f.dateField ?? 'opportunity'} onChange={(e) => setF({ dateField: e.target.value === 'opportunity' ? null : e.target.value })}>
                {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('rbx.date.' + d)}</option>)}
              </select></label>
            <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('rbx.preset.all')}</button>
            {PRESETS.map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: p, from: null, to: null })}>{t('rbx.preset.' + p)}</button>)}
            <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('rbx.preset.custom')}</button>
          </div>
          {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? new Date().toISOString().slice(0, 10)}
            onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
        </section>
        <section className="panel rvw-feed" data-testid="rbx-results">
          <div className="p-h">{t('rbx.tab.' + tab)}<span className="sub rvw-scope" data-testid="rbx-count">{list && !list.unavailable ? t('rbx.count', { n: fmtNumber(list.total) }) : ''}</span>
            {list?.freshness?.lastEvaluatedAt ? <span className="sub"> · {t('rbx.asOf', { at: when(list.freshness.lastEvaluatedAt, true) })}</span> : null}</div>
          {loading && !list ? <div className="state" data-testid="rbx-loading">{t('rbx.loading')}</div>
            : !list ? null
            : list.unavailable ? <Empty title={t('rbx.unavailableNote')} />
            : list.items.length === 0 ? <Empty title={anyFilter ? t('rbx.noMatch') : t('rbx.empty.' + tab)} />
            : <div className="rvw-table-wrap"><table className="tbl rvw-table">
              <thead><tr><th>{t('rbx.col.customer')}</th><th>{t('rbx.col.lastService')}</th><th>{t('rbx.col.suggested')}</th><th>{t('rbx.col.due')}</th><th>{t('rbx.col.techBooking')}</th><th>{t('rbx.col.status')}</th><th /></tr></thead>
              <tbody>{list.items.map((r: any) => (
                <tr key={r.id} data-testid="rbx-row" tabIndex={0} onClick={() => setOpenId(r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }}>
                  <td><b>{r.name || '—'}</b><div className="sub">{r.phone ?? t('rbx.notProvided')}</div></td>
                  <td>{r.lastService ?? '—'}<div className="sub">{when(r.lastVisitAt)}</div></td>
                  <td>{r.suggestedService ? <>{r.suggestedService.name}<div className="sub">{r.suggestedService.active ? t('rbx.row.price', { p: fmtMoney(r.suggestedService.priceCents), m: fmtNumber(r.suggestedService.durationMinutes) }) : t('rbx.row.inactive')}</div></> : '—'}</td>
                  <td className="nowrap">{r.window ? t('rbx.row.window', { d: r.window.dueOn }) : t('rbx.notEstablished')}<div className="sub">{r.typicalIntervalDays ? t('rbx.days', { n: r.typicalIntervalDays }) : ''}</div></td>
                  <td>{r.lastTechnician ?? '—'}<div className="sub" data-testid="rbx-booking">{r.booking.upcoming ? (r.booking.bookedSinceEvaluation ? t('rbx.row.bookedSince') : t('rbx.row.next', { d: r.booking.nextDate ?? '—' })) : t('rbx.row.noUpcoming')}</div></td>
                  <td><span className={'chip ' + (OPP_TONE[r.state] ?? '')} data-testid="rbx-state">{t('rbx.state.' + r.state)}</span>
                    {r.review ? <div className="sub">{t('rbx.review.' + r.review.status)}{r.review.dueOn ? ` · ${r.review.dueOn}` : ''}</div> : null}</td>
                  <td><button className="btn ghost sm" data-testid="rbx-view" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{t('rbx.view')}</button></td>
                </tr>))}</tbody></table></div>}
          <div className="rvw-pager">
            <Pager info={list && !list.unavailable ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: String(p) }, true)} />
            <label className="rvw-f"><span>{t('rbx.rows')}</span>
              <select data-testid="rbx-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
                {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
          </div>
          <p className="sub">{t('rbx.advisory')}</p>
        </section>
      </>}

      {openId ? <ReviewOverlay id={openId} onClose={() => setOpenId(null)} onChanged={(msg) => { setNotice(msg); void load(); }} nav={nav} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function ReviewOverlay({ id, onClose, onChanged, nav }: { id: string; onClose: () => void; onChanged: (msg: string) => void; nav: (to: string) => void }) {
  const can = useCan();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'defer' | 'note'>('view');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);
  const reload = useCallback(() => { setErr(null); posRebookingApi.customer(id).then(setD).catch((e) => setErr(errText(e, 'rbx.loadFailed'))); }, [id]);
  useEffect(() => { reload(); }, [reload]);
  const act = async (action: string, extra: { note?: string; dueOn?: string } = {}) => {
    setBusy(true); setActErr(null);
    try { await posRebookingApi.review(id, { action, expectedVersion: d?.review?.version ?? 0, ...extra }); setMode('view'); setNote(''); setDue(''); reload(); onChanged(t('rbx.saved.' + action)); }
    catch (e) { setActErr(errText(e, 'rbx.saveFailed')); }
    finally { setBusy(false); }
  };
  const go = (to: string) => { onClose(); nav(to); };
  // Open AI Booking Assistant: the server re-checks the opportunity and the LIVE calendar, then POS → Booking opens prefilled
  const book = async () => {
    setBusy(true); setActErr(null);
    try {
      const h = await posRebookingApi.handoff(id, { serviceId: d?.suggestedService?.active ? d.suggestedService.id : undefined,
        technicianId: d?.technician?.preferred && d.technician.active ? d.technician.id : undefined });
      storeBookingHandoff({ source: 'rebooking', customerId: h.customerId, customerName: h.customerName, customerPhone: h.customerPhone, serviceId: h.serviceId,
        technicianId: h.technicianId, technicianName: h.technicianName, date: h.date, preparedAt: h.preparedAt });
      go(`/booking?date=${encodeURIComponent(h.date)}&rebook=1`);
    } catch (e) { setActErr(errText(e, 'rbx.saveFailed')); reload(); }
    finally { setBusy(false); }
  };
  const r = d?.recommendation; const open = r && (r.state === 'due' || r.state === 'coming_due');
  const manage = can('pos.ai_customer_profile.view');
  const canBook = can('pos.booking.create');
  const upcoming = (d?.bookings ?? []).find((b: any) => b.upcoming);
  return (
    <FitDialog wide testId="rbx-overlay" busy={busy} title={t('rbx.ov.title')} subtitle={d?.identity?.name ? `${d.identity.name}${r ? ' · ' + t('rbx.state.' + r.state) : ''}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {mode !== 'view' ? <>
          <button className="btn ghost" onClick={() => setMode('view')} disabled={busy}>{t('pos.cancel')}</button>
          {mode === 'defer' ? <button className="btn" data-testid="rbx-defer-save" disabled={busy} onClick={() => void act('deferred', { note: note.trim() || undefined, dueOn: due || undefined })}>{t('rbx.defer')}</button>
            : <button className="btn" data-testid="rbx-note-save" disabled={busy || !note.trim()} onClick={() => void act('note', { note: note.trim() })}>{t('rbx.addNote')}</button>}
        </> : <>
          {open && canBook ? <button className="btn" data-testid="rbx-book" disabled={busy} onClick={() => void book()}>{t('rbx.ov.book')}</button> : null}
          {open && manage && !d?.review?.current ? <button className="btn ghost" data-testid="rbx-mark-reviewed" onClick={() => void act('reviewed')}>{t('rbx.markReviewed')}</button> : null}
          {open && manage && !d?.review?.current ? <button className="btn ghost" data-testid="rbx-defer" onClick={() => setMode('defer')}>{t('rbx.defer')}</button> : null}
          {d?.review && manage ? <button className="btn ghost" data-testid="rbx-reopen" onClick={() => void act('reopened')}>{t('rbx.reopen')}</button> : null}
          {manage ? <button className="btn ghost" data-testid="rbx-note" onClick={() => setMode('note')}>{t('rbx.addNote')}</button> : null}
          <button className="btn ghost" data-testid="ov-profile" onClick={() => go(`/tenant/customers/profiles?customerId=${encodeURIComponent(id)}`)}>{t('rbx.ov.profile')}</button>
          <button className="btn ghost" data-testid="ov-history" onClick={() => go(`/tenant/ai/customer-profile/timeline?customer=${encodeURIComponent(id)}&family=visit`)}>{t('rbx.ov.history')}</button>
          {upcoming ? <button className="btn ghost" data-testid="ov-booking" onClick={() => go(`/booking?date=${encodeURIComponent(upcoming.date)}`)}>{t('rbx.ov.viewBooking')}</button> : null}
          <button className="btn ghost" data-testid="ov-close" onClick={onClose}>{t('rbx.close')}</button>
        </>}
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('rbx.loading')}</div> : <>
        {actErr ? <p className="err" role="alert" data-testid="rbx-act-err">{actErr}</p> : null}
        <h4>{t('rbx.ov.identity')}</h4>
        <dl className="rvw-dl" data-testid="ov-identity">
          <dt>{t('rbx.col.customer')}</dt><dd>{d.identity.name ?? '—'} · {d.identity.phone ?? t('rbx.notProvided')}{d.identity.email ? ` · ${d.identity.email}` : ''}</dd>
          {d.identity.branch ? <><dt>{t('pos.branch')}</dt><dd>{d.identity.branch}</dd></> : null}
        </dl>
        <h4>{t('rbx.ov.recommendation')}</h4>
        {!r ? <p className="warn">{t('rbx.caveat.not_evaluated')}</p> : <>
          <p className="warn" data-testid="ov-note">{t('rbx.ov.note')}</p>
          {r.evidence?.length ? <ul data-testid="ov-evidence">{r.evidence.map((x: string, k: number) => <li key={k}>{x}</li>)}</ul> : null}
          <dl className="rvw-dl" data-testid="ov-inputs">
            <dt>{t('rbx.col.lastService')}</dt><dd>{t('rbx.ov.visitsLine', { n: fmtNumber(r.completedVisits), first: when(r.firstVisitAt), last: when(r.lastVisitAt) })}</dd>
            <dt>{t('rbx.ov.interval')}</dt><dd>{r.typicalIntervalDays ? t('rbx.days', { n: r.typicalIntervalDays }) : t('rbx.ov.minHistory', { n: r.minVisitsForCadence })}</dd>
            <dt>{t('rbx.ov.window')}</dt><dd data-testid="ov-window">{r.window ? t('rbx.ov.windowLine', { a: r.window.dueOn, b: r.window.endsOn ?? '—' }) : '—'}</dd>
            <dt>{t('rbx.col.suggested')}</dt><dd data-testid="ov-service">{d.suggestedService ? `${d.suggestedService.name}${d.suggestedService.active ? ' · ' + t('rbx.row.price', { p: fmtMoney(d.suggestedService.priceCents), m: fmtNumber(d.suggestedService.durationMinutes) }) : ' · ' + t('rbx.row.inactive')}` : '—'}</dd>
            <dt>{t('rbx.ov.preference')}</dt><dd data-testid="ov-tech">{d.technician ? `${t(d.technician.preferred ? 'rbx.ov.preferred' : 'rbx.ov.lastTech', { name: d.technician.name ?? '—', v: d.technician.visits, of: d.technician.of })}${d.technician.active ? '' : ' · ' + t('rbx.ov.techInactive')}` : '—'}</dd>
            <dt>{t('rbx.ov.since')}</dt><dd>{when(r.opportunitySince, true)}</dd>
            <dt>{t('rbx.ov.rule')}</dt><dd className="sub">{d.rule ? t('rbx.ov.ruleLine', { v: d.rule.version, at: when(d.rule.evaluatedAt, true) }) : '—'}</dd>
          </dl>
        </>}
        {d.caveats?.length ? <ul className="warn" data-testid="ov-caveats">{d.caveats.filter((c: string) => c !== 'not_evaluated').map((c: string) => <li key={c}>{t('rbx.caveat.' + c)}</li>)}</ul> : null}
        {open ? <p className="sub">{t('rbx.ov.handoffNote')}</p> : null}
        <h4>{t('rbx.ov.services')}</h4>
        {d.completedServices.length ? <table className="tbl rvw-table" data-testid="ov-services"><tbody>{d.completedServices.map((v: any) => (
          <tr key={v.ticketId}><td className="nowrap">{when(v.at)}</td><td>{v.lines.map((l: any) => l.service).filter(Boolean).join(', ') || '—'}</td><td>{[...new Set(v.lines.map((l: any) => l.technician).filter(Boolean))].join(', ') || '—'}</td></tr>))}</tbody></table>
          : <p className="sub">{t('rbx.ov.noServices')}</p>}
        <h4>{t('rbx.ov.bookings')}</h4>
        {d.bookings.length ? <table className="tbl rvw-table" data-testid="ov-bookings"><tbody>{d.bookings.map((b: any) => (
          <tr key={b.id}><td className="nowrap">{b.date} {b.time ?? ''}</td><td>{b.services.join(', ') || '—'}</td><td>{b.technician ?? '—'}</td><td><span className={'chip ' + (b.upcoming ? 'ok' : '')}>{statusLabel('appointment', b.status)}{b.upcoming ? ` · ${t('rbx.ov.upcoming')}` : ''}</span></td></tr>))}</tbody></table>
          : <p className="sub">{t('rbx.ov.noBookings')}</p>}
        {d.memberships?.length ? <><h4>{t('rbx.ov.memberships')}</h4><p data-testid="ov-memberships">{d.memberships.map((x: any) => `${statusLabel('membership', x.status)} · ${fmtNumber(x.count)}`).join(' · ')}</p></> : null}
        {d.review ? <p data-testid="ov-review">{t('rbx.ov.reviewLine', { s: t('rbx.review.' + d.review.status), at: when(d.review.at, true) })}{d.review.dueOn ? ` · ${t('rbx.ov.until', { d: d.review.dueOn })}` : ''}{!d.review.current ? ` · ${t('rbx.ov.reviewExpired')}` : ''}</p> : null}
        {mode !== 'view' ? <div className="dupx-form">
          <label className="rvw-f"><span>{mode === 'note' ? t('rbx.noteRequired') : t('rbx.noteOptional')}</span><textarea data-testid="rbx-note-input" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {mode === 'defer' ? <label className="rvw-f"><span>{t('rbx.deferUntil')}</span><input type="date" data-testid="rbx-due" value={due} onChange={(e) => setDue(e.target.value)} /></label> : null}
        </div> : null}
        <h4>{t('rbx.ov.activity')}</h4>
        {d.history.length ? d.history.map((e: any) => <div key={e.id} className="rvw-ev">{when(e.at, true)} · <b>{t('rbx.action.' + e.type)}</b>{e.actor ? ` · ${e.actor}` : ''}{e.note ? ` · ${e.note}` : ''}</div>) : <p className="sub">—</p>}
        <p className="sub">{t('rbx.ov.noActions')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="rbx-health" title={t('rbx.check')} subtitle={data && data !== 'loading' && !data.error ? t('rbx.health.overall', { s: t('rbx.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('rbx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('rbx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('rbx.health.readOnly')}{data.reused ? ` ${t('rbx.health.recent')}` : ''}</p>
        {data.checks.map((x: any) => (
          <div key={x.key} className="rvw-check" data-testid={`chk-${x.key}`}>
            <div><span className={'chip ' + (STATE_TONE[x.state] ?? '')} data-testid={`chk-${x.key}-state`}>{t('rbx.health.' + x.state)}</span> <b>{t('rbx.health.k.' + x.key)}</b>{x.count ? <span className="sub"> · {fmtNumber(x.count)}</span> : null}</div>
            <div className="sub">{t('rbx.health.d.' + x.key + '.' + x.state)}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
