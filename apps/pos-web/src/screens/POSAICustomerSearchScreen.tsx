// POSAICustomerSearchScreen.tsx — AI Center → Customer Profile → Customer Search (/tenant/ai/customer-profile/search).
// Customer Search Complete Build Guide (Nov 1 2026). Rebuilt IN PLACE: the title, subtitle, the search box (name · phone · email ·
// customer ID) and the Search button stay. Added: the KPI row (each number states its definition), filters (status · booking ·
// technician · service · branch), a date field with presets and a From/To month calendar, sort, numbered pages 10/25/50/100
// (newest-created first without a term; relevance with one), the audited Customer 360° overlay (identity · appointments ·
// services · loyalty & memberships · possible duplicates · the existing AI profile panel), "new customers available" instead of
// moving the page, and the read-only Check Customer Search System. Nothing here books, merges, edits or sends; every action opens
// the module that owns it. The search text never goes into the URL (it can hold a phone or email); filters and page do.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCustomerSearchApi, type CustomerSearchQuery } from '../api/posCustomerSearchApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { AICustomerProfilePanel } from './AICustomerProfilePanel';
import { deviceToday } from '../lib/deviceToday';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const URL_KEYS = ['status', 'booking', 'technician', 'service', 'branch', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const STATE_TONE: Record<string, 'ok' | 'warn' | 'bad' | undefined> = { READY: 'ok', WARNING: 'warn', FAILED: 'bad', UNKNOWN: undefined };
const LIFE_TONE: Record<string, string> = { active: 'ok', inactive: 'warn', never: '', archived: 'bad', unknown: '' };
const STATUSES = ['active', 'inactive', 'new', 'returning', 'never', 'duplicate', 'churn_watch', 'rebooking', 'archived'];   // churn_watch + rebooking: SUNMI §09 (source = Customer Intelligence)
const BOOKING = ['upcoming', 'completed', 'canceled', 'no_show'];
const DATE_FIELDS = ['created', 'updated', 'last_visit', 'first_visit', 'appointment', 'booking_created', 'service_completed'];
const SORTS = ['relevance', 'newest', 'oldest', 'name', 'last_visit', 'visits'];

export function POSAICustomerSearchScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [draft, setDraft] = useState('');        // what is typed
  const [q, setQ] = useState('');                // what was searched (Search button / Enter)
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v) o[k] = v; } return o; }, [sp]);
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const query: CustomerSearchQuery = { ...f, q: q || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };
  const range = { branch: f.branch, preset: f.preset && f.preset !== 'all' ? f.preset : 'month', from: f.from, to: f.to };

  const [sum, setSum] = useState<any>(null);
  const [list, setList] = useState<any>(null);
  const [opts, setOpts] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [newer, setNewer] = useState(0);
  const seq = useRef(0);   // a slow answer for an OLD query never overwrites the latest one

  const load = useCallback(async (silent = false) => {
    const mine = ++seq.current;
    if (!silent) setLoading(true);
    setErr(null);
    try {
      const [s, l] = await Promise.all([posCustomerSearchApi.summary(range), posCustomerSearchApi.customers(query)]);
      if (mine !== seq.current) return;
      setSum(s); setList(l); setLoadedAt(new Date().toISOString()); setNewer(0);
    } catch (e) { if (mine === seq.current) setErr(isForbidden(e) ? t('csx.noAccess') : errorTextOf(e, t('csx.loadFailed'))); }
    finally { if (mine === seq.current && !silent) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query: the objects are rebuilt every render
  }, [JSON.stringify(query), JSON.stringify(range)]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { posCustomerSearchApi.options().then(setOpts).catch(() => setOpts(null)); }, []);
  // new matching customers never move the page under the receptionist: they are announced, and shown on request
  useEffect(() => {
    const h = setInterval(() => {
      if (openId || cal || !list) return;
      posCustomerSearchApi.customers({ ...query, page: 1, pageSize: 10 }).then((x) => { if (x && x.total > list.total) setNewer(x.total - list.total); }).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-armed when the results change, not on every render
  }, [list, openId, cal]);

  const k = sum?.kpis;
  const anyFilter = URL_KEYS.some((x) => f[x] && x !== 'page' && x !== 'pageSize') || !!q;
  const submit = (e?: { preventDefault: () => void }) => { e?.preventDefault(); setQ(draft.trim()); setF({}, false); };
  const sel = (key: string, label: string, options: [string, string][], testId: string, anyLabel = t('csx.any')) => (
    <label className="rvw-f"><span>{label}</span>
      <select data-testid={testId} value={f[key] ?? ''} onChange={(e) => setF({ [key]: e.target.value || null })}>
        <option value="">{anyLabel}</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></label>
  );
  const branches: { branchId: string; name: string }[] = opts?.branches ?? [];

  return (
    <div className="work rvw csx" data-testid="customer-search-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.customer_search')}</h1><div className="sub mb-3">{t('pos.find_a_customer_and_open_their_1vdb')}</div></div>
        <div className="rvw-actions">
          <span className="sub" data-testid="csx-updated">{loadedAt ? t('csx.updated', { time: when(loadedAt, true) }) : ''}</span>
          <button className="btn ghost" data-testid="csx-refresh" onClick={() => load()}>{t('csx.refresh')}</button>
          <button className="btn" data-testid="csx-check" onClick={() => { setHealth('loading'); posCustomerSearchApi.check().then(setHealth).catch((e) => setHealth({ error: errorTextOf(e, t('csx.loadFailed')) })); }}>{t('csx.check')}</button>
        </div>
      </div>

      <form className="panel rvw-filters csx-searchbar" data-testid="csx-searchbar" onSubmit={submit}>
        <input className="rvw-search" data-testid="csx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('pos.search_by_name_phone_email_or_y6t9')} aria-label={t('pos.search_by_name_phone_email_or_y6t9')} />
        <button className="btn" type="submit" data-testid="csx-search-btn">{t('pos.search')}</button>
        {q ? <button className="btn ghost" type="button" data-testid="csx-search-clear" onClick={() => { setDraft(''); setQ(''); setF({}, false); }}>{t('csx.clearSearch')}</button> : null}
      </form>

      {err ? <ErrorRetry message={err} onRetry={() => load()} /> : null}

      <div className="rvw-kpis" data-testid="csx-kpis">
        <KpiCard testId="kpi-customers" label={t('csx.kpi.customers')} loading={loading && !k} value={k ? fmtNumber(k.customers) : '—'} sub={t('csx.kpi.customersSub')} />
        <KpiCard testId="kpi-active" label={t('csx.kpi.active')} loading={loading && !k} tone="gold" value={k ? fmtNumber(k.active) : '—'}
          sub={sum ? t('csx.kpi.activeSub', { d: sum.definitions.activeDays }) : undefined} onClick={() => setF({ status: 'active' })} />
        <KpiCard testId="kpi-never" label={t('csx.kpi.never')} loading={loading && !k} value={k ? fmtNumber(k.neverVisited) : '—'} sub={t('csx.kpi.neverSub')} onClick={() => setF({ status: 'never' })} />
        <KpiCard testId="kpi-upcoming" label={t('csx.kpi.upcoming')} loading={loading && !k} value={k ? fmtNumber(k.withUpcomingAppointment) : '—'} sub={t('csx.kpi.upcomingSub')} onClick={() => setF({ booking: 'upcoming' })} />
        <KpiCard testId="kpi-new" label={t('csx.kpi.created')} loading={loading && !k} value={k?.createdInPeriod == null ? '—' : fmtNumber(k.createdInPeriod)}
          sub={sum?.period ? `${sum.period.from} – ${sum.period.to}` : undefined} />
        <KpiCard testId="kpi-shared" label={t('csx.kpi.shared')} loading={loading && !k} value={k ? fmtNumber(k.sharedContactProfiles) : '—'} tone={k?.sharedContactProfiles ? 'warn' : undefined}
          sub={t('csx.kpi.sharedSub')} onClick={() => setF({ status: 'duplicate' })} />
      </div>

      <section className="panel rvw-filters" data-testid="csx-filters">
        {sel('status', t('csx.f.status'), STATUSES.map((s) => [s, t('csx.status.' + s)] as [string, string]), 'flt-status', t('csx.status.all'))}
        {sel('booking', t('csx.f.booking'), BOOKING.map((s) => [s, t('csx.booking.' + s)] as [string, string]), 'flt-booking')}
        {sel('technician', t('csx.f.technician'), (opts?.technicians ?? []).map((x: any) => [x.id, x.name] as [string, string]), 'flt-technician')}
        {sel('service', t('csx.f.service'), (opts?.services ?? []).map((x: any) => [x.id, x.name] as [string, string]), 'flt-service')}
        {branches.length > 1 ? sel('branch', t('csx.f.branch'), branches.map((b) => [b.branchId, b.name] as [string, string]), 'flt-branch', t('csx.allBranches')) : null}
        <label className="rvw-f"><span>{t('csx.f.sort')}</span>
          <select data-testid="flt-sort" value={f.sort ?? ''} onChange={(e) => setF({ sort: e.target.value || null })}>
            <option value="">{q ? t('csx.sort.relevance') : t('csx.sort.newest')}</option>
            {SORTS.filter((s) => s !== (q ? 'relevance' : 'newest')).map((s) => <option key={s} value={s}>{t('csx.sort.' + s)}</option>)}
          </select></label>
        <div className="rvw-dates" data-testid="csx-dates">
          <label className="rvw-f"><span>{t('csx.f.dateField')}</span>
            <select data-testid="flt-datefield" value={f.dateField ?? 'created'} onChange={(e) => setF({ dateField: e.target.value === 'created' ? null : e.target.value })}>
              {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('csx.date.' + d)}</option>)}
            </select></label>
          <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('csx.preset.all')}</button>
          {(['today', 'week', 'month', 'year'] as const).map((p) => <button key={p} className={'btn ghost' + (f.preset === p ? ' on' : '')} data-testid={`preset-${p}`} onClick={() => setF({ preset: p, from: null, to: null })}>{t('csx.preset.' + p)}</button>)}
          <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('csx.preset.custom')}</button>
        </div>
        {anyFilter ? <button className="btn ghost" data-testid="flt-clear" onClick={() => { setDraft(''); setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>{t('csx.clearAll')}</button> : null}
        {cal ? <div className="rvw-cal" data-testid="csx-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.today ?? deviceToday()}
          onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
      </section>

      <section className="panel rvw-feed" data-testid="csx-results">
        <div className="p-h">{t('csx.results')}
          <span className="sub rvw-scope" data-testid="csx-count">{list ? t('csx.count', { n: fmtNumber(list.total), order: t(list.sort === 'relevance' ? 'csx.order.relevance' : 'csx.sort.' + list.sort) }) : ''}</span>
          {newer > 0 ? <button className="btn ghost sm" data-testid="csx-newer" onClick={() => { setF({ page: null }); load(); }}>{t('csx.newer', { n: newer })}</button> : null}
        </div>
        {loading && !list ? <div className="state">{t('csx.loading')}</div>
          : !list ? null
          : list.items.length === 0 ? <Empty title={q || anyFilter ? t('csx.noMatch') : t('csx.empty')}>{q || anyFilter ? <button className="btn ghost" onClick={() => { setDraft(''); setQ(''); setSp(new URLSearchParams(), { replace: true }); }}>{t('csx.clearAll')}</button> : null}</Empty>
          : (
          <div className="rvw-table-wrap">
            <table className="tbl rvw-table csx-table">
              <thead><tr><th>{t('csx.col.customer')}</th><th>{t('csx.col.contact')}</th><th>{t('csx.col.lastVisit')}</th><th>{t('csx.col.next')}</th><th>{t('csx.col.technician')}</th><th>{t('csx.col.visits')}</th><th>{t('csx.col.status')}</th><th>{t('csx.col.created')}</th><th></th></tr></thead>
              <tbody>{list.items.map((r: any) => (
                <tr key={r.id} data-testid="csx-row" onClick={() => setOpenId(r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(r.id); }}>
                  <td><b>{r.name || '—'}</b>{r.preferredName ? <span className="sub"> ({r.preferredName})</span> : null}
                    {r.matchedBy ? <span className="chip" data-testid="csx-matched">{t('csx.match.' + r.matchedBy)}</span> : null}
                    {r.sharedContactProfiles ? <span className="chip warn" data-testid="csx-shared" title={t('csx.sharedHint')}>{t('csx.sharedChip', { n: r.sharedContactProfiles })}</span> : null}
                    {r.member ? <span className="chip ok">{t('csx.member')}</span> : null}</td>
                  <td className="nowrap">{r.phone ?? '—'}{r.phoneVerified ? <span className="chip ok" title={t('csx.verifiedHint')}>✓</span> : null}<div className="sub">{r.email ?? ''}</div></td>
                  <td className="nowrap">{when(r.lastVisitAt)}</td>
                  <td className="nowrap">{r.nextAppointment ? `${r.nextAppointment.date} ${r.nextAppointment.time ?? ''}` : '—'}</td>
                  <td>{r.lastTechnician?.name ?? '—'}</td>
                  <td className="num">{fmtNumber(r.visits)}</td>
                  <td><span className={'chip ' + (LIFE_TONE[r.lifecycle] ?? '')}>{t('csx.life.' + r.lifecycle)}</span></td>
                  <td className="nowrap">{when(r.createdAt)}<div className="sub">{r.homeBranch?.name ?? ''}</div></td>
                  <td className="nowrap"><button className="btn ghost sm" data-testid="csx-view" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>{t('csx.view')}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="rvw-pager">
          <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.pageCount } : null} onPage={(p) => setF({ page: String(p) }, true)} />
          <label className="rvw-f"><span>{t('csx.rows')}</span>
            <select data-testid="csx-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
              {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select></label>
        </div>
        {list ? <p className="sub csx-foot" data-testid="csx-scope">{list.fullContact ? t('csx.contactFull') : t('csx.contactMasked')} · {list.freshness?.lastCustomerChangeAt ? t('csx.fresh', { at: when(list.freshness.lastCustomerChangeAt, true) }) : ''}</p> : null}
      </section>

      {openId ? <ProfileOverlay id={openId} onClose={() => setOpenId(null)}
        onBook={(cid) => nav(`/booking/new?customerId=${encodeURIComponent(cid)}&from=customer-search`)}
        onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)}
        onBooking={(day) => nav(`/booking?date=${encodeURIComponent(day)}`)}
        onDuplicates={() => nav('/tenant/ai/customer-profile/duplicates')} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function ProfileOverlay({ id, onClose, onBook, onCustomer, onBooking, onDuplicates }: { id: string; onClose: () => void; onBook: (cid: string) => void; onCustomer: (cid: string) => void; onBooking: (day: string) => void; onDuplicates: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState('identity');
  useEffect(() => { setD(null); setErr(null); posCustomerSearchApi.profile(id).then(setD).catch((e) => setErr(errorTextOf(e, t('csx.loadFailed')))); }, [id]);
  const tabs = ['identity', 'appointments', 'services', 'benefits', 'duplicates', 'ai'];
  const p = d?.identity;
  const unavailable = d ? Object.entries(d.sources as Record<string, string>).filter(([, v]) => v === 'unavailable').map(([key]) => t('csx.src.' + key)) : [];
  const appt = (a: any) => (
    <div key={a.id} className="rvw-ev" data-testid="ov-appt"><b>{a.date} {a.time ?? ''}</b> · {t('csx.appt.' + a.status)}
      {a.technician ? ` · ${a.technician.any ? t('csx.anyTech') : a.technician.name ?? '—'}` : ''}{a.branch?.name ? ` · ${a.branch.name}` : ''}
      <button className="btn ghost sm" data-testid="ov-view-booking" onClick={() => onBooking(a.date)}>{t('csx.ov.viewBooking')}</button></div>
  );
  return (
    <FitDialog wide testId="csx-overlay" title={p ? p.name || t('csx.ov.title') : t('csx.ov.title')} subtitle={p ? `${t('csx.life.' + p.lifecycle)} · ${t('csx.ov.since', { d: when(p.createdAt) })}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {p && !p.archivedAt ? <button className="btn" data-testid="ov-book" onClick={() => onBook(p.id)}>{t('csx.ov.book')}</button> : null}
        {p ? <button className="btn ghost" data-testid="ov-customer" onClick={() => onCustomer(p.id)}>{t('csx.ov.openCustomer')}</button> : null}
        {d?.duplicates?.length ? <button className="btn ghost" data-testid="ov-duplicates" onClick={onDuplicates}>{t('csx.ov.reviewDuplicates')}</button> : null}
        <button className="btn ghost" data-testid="ov-close" onClick={onClose}>{t('csx.close')}</button>
      </div>}>
      {err ? <div className="err">{err}</div> : !d ? <div className="state">{t('csx.loading')}</div> : <>
        {unavailable.length ? <p className="warn" data-testid="ov-unavailable">{t('csx.ov.unavailable', { list: unavailable.join(', ') })}</p> : null}
        <div className="rvw-tabs" role="tablist">{tabs.map((x) => <button key={x} role="tab" aria-selected={tab === x} className={'btn ghost' + (tab === x ? ' on' : '')} data-testid={`ov-tab-${x}`} onClick={() => setTab(x)}>{t('csx.ov.tab.' + x)}</button>)}</div>
        <div className="rvw-ov-body" data-testid={`ov-${tab}`}>
          {tab === 'identity' ? <dl className="rvw-dl">
            <dt>{t('csx.ov.id')}</dt><dd className="mono">{p.id}</dd>
            <dt>{t('csx.ov.phone')}</dt><dd>{p.phone ?? '—'} {p.phoneVerified ? <span className="chip ok">{t('csx.ov.verified')}</span> : <span className="chip">{t('csx.ov.unverified')}</span>}</dd>
            <dt>{t('csx.ov.email')}</dt><dd>{p.email ?? '—'}</dd>
            {!p.fullContact ? <><dt /><dd className="sub">{t('csx.contactMasked')}</dd></> : null}
            <dt>{t('csx.ov.visits')}</dt><dd data-testid="ov-visits">{d.visits ? t('csx.ov.visitsLine', { n: fmtNumber(d.visits.completed), first: when(d.visits.firstAt), last: when(d.visits.lastAt) }) : t('csx.unavailable')}</dd>
            <dt>{t('csx.ov.homeBranch')}</dt><dd>{p.homeBranch?.name ?? '—'}{p.preferredBranch ? ` · ${t('csx.ov.prefers', { b: p.preferredBranch.name ?? '—' })}` : ''}</dd>
            <dt>{t('csx.ov.prefTech')}</dt><dd>{d.preferences.technician ? `${d.preferences.technician.name ?? '—'} (${t('csx.ov.recorded')})` : t('csx.ov.noneRecorded')}</dd>
            <dt>{t('csx.ov.updated')}</dt><dd>{when(p.updatedAt, true)}</dd>
            {p.archivedAt ? <><dt>{t('csx.ov.archived')}</dt><dd>{when(p.archivedAt, true)}</dd></> : null}
          </dl> : null}
          {tab === 'appointments' ? (d.sources.booking === 'unavailable' ? <Empty title={t('csx.unavailable')} /> : <>
            <h4>{t('csx.ov.upcoming')}</h4>{d.appointments.upcoming.length ? d.appointments.upcoming.map(appt) : <p className="sub">{t('csx.ov.noUpcoming')}</p>}
            <h4>{t('csx.ov.history')}</h4>{d.appointments.history.length ? d.appointments.history.map(appt) : <p className="sub">{t('csx.ov.noHistory')}</p>}
            <p className="sub">{t('csx.ov.cancelNoShow', { c: d.appointments.canceled, n: d.appointments.noShows })}</p>
          </>) : null}
          {tab === 'services' ? (d.sources.services === 'unavailable' ? <Empty title={t('csx.unavailable')} /> : d.services.length ? d.services.map((s: any) => (
            <div key={s.id} className="rvw-ev" data-testid="ov-service"><b>{s.service ?? '—'}</b>{s.minutes != null ? ` · ${t('csx.ov.minutes', { n: s.minutes })}` : ''} · {s.technician?.name ?? '—'} · {when(s.at)}{s.ticketNumber != null ? ` · #${s.ticketNumber}` : ''}</div>
          )) : <Empty title={t('csx.ov.noServices')} />) : null}
          {tab === 'benefits' ? <>
            <h4>{t('csx.ov.loyalty')}</h4>
            {d.sources.loyalty === 'unavailable' ? <p className="sub">{t('csx.unavailable')}</p> : !d.loyalty?.enrolled ? <p className="sub">{t('csx.ov.notEnrolled')}</p> : <p data-testid="ov-points">
              {t('csx.ov.points', { n: fmtNumber(d.loyalty.points) })}{d.loyalty.tier ? ` · ${d.loyalty.tier}` : ''}
              {d.loyalty.conflict ? <span className="chip warn" data-testid="ov-ledger-conflict">{t('csx.ov.conflict', { p: d.loyalty.conflict.profileBalance, l: d.loyalty.conflict.ledgerBalance })}</span> : null}</p>}
            <h4>{t('csx.ov.memberships')}</h4>
            {d.sources.memberships === 'unavailable' ? <p className="sub">{t('csx.unavailable')}</p> : d.memberships.length ? d.memberships.map((m: any) => <div key={m.id} className="rvw-ev">{m.plan ?? '—'} · {t('csx.mstatus.' + m.status)} · {when(m.startedAt)}</div>) : <p className="sub">{t('csx.ov.noMemberships')}</p>}
            <p className="sub">{t('csx.ov.readOnly')}</p>
          </> : null}
          {tab === 'duplicates' ? (d.duplicates.length ? <>
            <p className="sub">{t('csx.ov.dupRule')}</p>
            {d.duplicates.map((o: any) => <div key={o.id} className="rvw-ev" data-testid="ov-dup">{o.name} · {[o.samePhone ? t('csx.ov.samePhone') : '', o.sameEmail ? t('csx.ov.sameEmail') : ''].filter(Boolean).join(' + ')} · {when(o.createdAt)}{o.decision ? ` · ${t('csx.ov.decision.' + o.decision)}` : ''}</div>)}
          </> : <Empty title={t('csx.ov.noDuplicates')} />) : null}
          {tab === 'ai' ? <AICustomerProfilePanel customerId={p.id} /> : null}
        </div>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="csx-health" title={t('csx.check')} subtitle={data && data !== 'loading' && !data.error ? t('csx.health.overall', { s: t('csx.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('csx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('csx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('csx.health.readOnly')}{data.rateLimited ? ` ${t('csx.health.recent')}` : ''}</p>
        {data.checks.map((c: any) => (
          <div key={c.key} className="rvw-check" data-testid={`chk-${c.key}`}>
            <div><span className={'chip ' + (STATE_TONE[c.state] ?? '')} data-testid={`chk-${c.key}-state`}>{t('csx.health.' + c.state)}</span> <b>{t('csx.health.k.' + c.key)}</b></div>
            {/* localized from the check's numbers — the server's English evidence stays in the API / run log */}
            <div className="sub" data-testid={`chk-${c.key}-detail`}>{c.detail?.failedToRun ? t('csx.health.d.failed')
              : t('csx.health.d.' + c.key + '.' + c.state, { ...(c.detail ?? {}), ...(c.detail?.at ? { at: when(String(c.detail.at), true) } : {}) })}</div>
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
