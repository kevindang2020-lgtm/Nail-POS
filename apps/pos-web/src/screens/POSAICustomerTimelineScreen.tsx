// POSAICustomerTimelineScreen.tsx — AI Center → Customer Profile → Customer Timeline (/tenant/ai/customer-profile/timeline).
// Customer Timeline guide (Nov 1 2026). Rebuilt IN PLACE: the title, the subtitle, the search box (name · phone · email) and the
// Search button stay. Search-first: nothing is shown until a customer is chosen from real, paged search results (Customer
// Search's directory — similar names and shared phones stay separate rows). Then: the Customer 360° summary (Customer Search's
// audited profile), and the source-linked timeline — every event read from the system that owns it, grouped by visit, newest
// occurrence first — with category, date field + presets + From/To month calendar, search inside the history, sort, numbered
// pages 10/25/50/100, "new activity available" instead of moving the page, a read-only detail overlay that opens the owning
// module, and the read-only Check Customer Timeline System. Nothing here books, charges, refunds, awards points or sends.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCustomerSearchApi } from '../api/posCustomerSearchApi';
import { posCustomerTimelineApi, type TimelineQuery } from '../api/posCustomerTimelineApi';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInZone, fmtMoney } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar, isForbidden } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { statusLabel } from '../i18n/status-label';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const when = (iso?: string | null, withTime = false) => (iso ? fmtInZone(iso, withTime ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const URL_KEYS = ['customer', 'family', 'dateField', 'preset', 'from', 'to', 'sort', 'page', 'pageSize'] as const;
const FAMILIES = ['appointment', 'visit', 'money', 'benefit', 'communication', 'profile'];
const PRESETS = ['today', 'yesterday', 'week', 'last_7', 'month', 'last_month', 'last_30', 'last_90', 'year'] as const;
const DATE_FIELDS = ['occurred', 'recorded', 'appointment'];
const SORTS = ['newest', 'oldest', 'recently_added'];
const STATE_TONE: Record<string, string> = { PASSED: 'ok', WARNING: 'warn', FAILED: 'bad', INSUFFICIENT_DATA: '', UNAVAILABLE: 'bad' };
const FAMILY_TONE: Record<string, string> = { appointment: '', visit: 'ok', money: 'gold', benefit: '', communication: '', profile: '' };
const KNOWN_ERRORS = ['CUSTOMER_NOT_FOUND', 'TIMELINE_EVENT_NOT_FOUND', 'TIMELINE_INVALID_PERIOD', 'TIMELINE_SEARCH_TOO_SHORT', 'PERMISSION_DENIED'];
function errText(e: any, fallbackKey: string) {
  const code = e?.body?.code ?? e?.code;
  if (typeof code === 'string' && KNOWN_ERRORS.includes(code)) return t('tlx.err.' + code);
  if (isForbidden(e)) return t('tlx.err.PERMISSION_DENIED');
  return errorTextOf(e, t(fallbackKey));
}
/** a known event type has its own label; an unfamiliar source status falls back to its family, never a raw code alone */
export function eventLabel(type: string, family: string): string {
  const k = 'tlx.type.' + type;
  const v = t(k);
  return v && v !== k ? v : t('tlx.fallback.' + family);
}

export function POSAICustomerTimelineScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => { const o: Record<string, string> = {}; for (const k of URL_KEYS) { const v = sp.get(k); if (v) o[k] = v; } return o; }, [sp]);
  const setF = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!keepPage) next.delete('page');
    setSp(next, { replace: true });
  };
  const customerId = f.customer ?? null;
  // ── customer search (Customer Search's directory; the term never goes into the URL) ──
  const [draft, setDraft] = useState('');
  const [found, setFound] = useState<any>(null);
  const [findPage, setFindPage] = useState(1);
  const [findErr, setFindErr] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const term = useRef('');
  const find = useCallback(async (q: string, page = 1) => {
    term.current = q; setFinding(true); setFindErr(null); setFindPage(page);
    try { setFound(await posCustomerSearchApi.customers({ q, page, pageSize: 10 })); }
    catch (e) { setFindErr(errText(e, 'tlx.searchFailed')); }
    finally { setFinding(false); }
  }, []);
  const submit = (e?: { preventDefault: () => void }) => { e?.preventDefault(); const q = draft.trim(); if (q.length >= 2) void find(q, 1); else setFindErr(t('tlx.err.TIMELINE_SEARCH_TOO_SHORT')); };

  // ── the selected customer ──
  const [profile, setProfile] = useState<any>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [list, setList] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [inner, setInner] = useState('');      // search inside this customer's history
  const [innerQ, setInnerQ] = useState('');
  const [cal, setCal] = useState(false);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [health, setHealth] = useState<any | 'loading' | null>(null);
  const [newer, setNewer] = useState(false);
  const seq = useRef(0);
  const query: TimelineQuery = { family: f.family, dateField: f.dateField, preset: f.preset, from: f.from, to: f.to, sort: f.sort, q: innerQ || undefined, page: Number(f.page ?? 1), pageSize: Number(f.pageSize ?? 25) };

  useEffect(() => {
    setProfile(null); setProfileErr(null); setInner(''); setInnerQ('');
    if (!customerId) return;
    posCustomerSearchApi.profile(customerId).then(setProfile).catch((e) => setProfileErr(errText(e, 'tlx.loadFailed')));
  }, [customerId]);
  const load = useCallback(async () => {
    if (!customerId) { setList(null); return; }
    const mine = ++seq.current;
    setLoading(true); setErr(null);
    try { const r = await posCustomerTimelineApi.events(customerId, query); if (mine === seq.current) { setList(r); setNewer(false); } }
    catch (e) { if (mine === seq.current) setErr(errText(e, 'tlx.loadFailed')); }
    finally { if (mine === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialized query: the object is rebuilt every render
  }, [customerId, JSON.stringify(query)]);
  useEffect(() => { void load(); }, [load]);
  // new activity never moves the receptionist: it is announced, and shown on request
  useEffect(() => {
    if (!customerId || !list) return;
    const h = setInterval(() => {
      if (openEvent || cal) return;
      posCustomerTimelineApi.events(customerId, { pageSize: 10 }).then((r) => {
        const a = r?.freshness, b = list.freshness;
        if (a && b && (a.newestActivityAt !== b.newestActivityAt || a.lastRecordedAt !== b.lastRecordedAt)) setNewer(true);
      }).catch(() => undefined);
    }, 60_000);
    return () => clearInterval(h);
  }, [customerId, list, openEvent, cal]);

  // events of one visit / appointment stay together on the page (the page order is the server's: newest occurrence first)
  const groups = useMemo(() => {
    const out: { ref: string; events: any[] }[] = [];
    const at = new Map<string, number>();
    for (const e of list?.items ?? []) {
      const i = at.get(e.groupRef);
      if (i == null) { at.set(e.groupRef, out.length); out.push({ ref: e.groupRef, events: [e] }); } else out[i].events.push(e);
    }
    return out;
  }, [list]);
  const groupTitle = (g: { ref: string; events: any[] }) => {
    const ticketNo = g.events.map((e) => e.meta?.ticketNumber).find((n) => n != null);
    if (g.ref.startsWith('ticket:')) return ticketNo != null ? t('tlx.group.visitNo', { n: String(ticketNo) }) : t('tlx.group.visit');
    if (g.ref.startsWith('appt:')) return t('tlx.group.appointment');
    return null;
  };
  const p = profile?.identity;
  const matchesPanel = found ? (
        <section className="panel rvw-feed" data-testid="tlx-matches">
          <div className="p-h">{t('tlx.matches')}<span className="sub rvw-scope">{t('tlx.matchCount', { n: fmtNumber(found.total) })}</span></div>
          {found.items.length === 0 ? <Empty title={t('tlx.noMatches')} /> : (
            <div className="rvw-table-wrap"><table className="tbl rvw-table">
              <thead><tr><th>{t('tlx.col.customer')}</th><th>{t('tlx.col.contact')}</th><th>{t('tlx.col.lastVisit')}</th><th>{t('tlx.col.visits')}</th><th>{t('tlx.col.created')}</th><th /></tr></thead>
              <tbody>{found.items.map((c: any) => (
                <tr key={c.id} data-testid="tlx-match" tabIndex={0} aria-selected={c.id === customerId} className={c.id === customerId ? 'on' : undefined} onClick={() => setF({ customer: c.id })} onKeyDown={(e) => { if (e.key === 'Enter') setF({ customer: c.id }); }}>
                  <td><b>{c.name || '—'}</b>{c.sharedContactProfiles ? <span className="chip warn" title={t('tlx.sharedHint')}>{t('tlx.shared', { n: c.sharedContactProfiles })}</span> : null}</td>
                  <td className="nowrap">{c.phone ?? t('tlx.notProvided')}<div className="sub">{c.email ?? ''}</div></td>
                  <td className="nowrap">{when(c.lastVisitAt)}</td><td className="num">{fmtNumber(c.visits)}</td>
                  <td className="nowrap">{when(c.createdAt)}<div className="sub mono">{String(c.id).slice(0, 8)}</div></td>
                  <td><button className="btn ghost sm" data-testid="tlx-select" onClick={(e) => { e.stopPropagation(); setF({ customer: c.id }); }}>{t('tlx.viewTimeline')}</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="rvw-pager"><Pager info={{ page: findPage, pageSize: 10, totalItems: found.total, totalPages: found.pageCount ?? Math.max(1, Math.ceil(found.total / 10)) }} onPage={(pg) => void find(term.current, pg)} /></div>
        </section>
  ) : null;
  const anyFilter = ['family', 'dateField', 'preset', 'sort'].some((k) => f[k]) || !!innerQ;

  return (
    <div className="work rvw tlx" data-testid="customer-timeline-screen">
      <div className="vh rvw-head">
        <div><h1>{t('pos.customer_timeline')}</h1><div className="sub mb-3">{t('pos.unified_visit_and_appointment_history_newest_9dy5')}</div></div>
        <div className="rvw-actions">
          <button className="btn" data-testid="tlx-check" onClick={() => { setHealth('loading'); posCustomerTimelineApi.check().then(setHealth).catch((e) => setHealth({ error: errText(e, 'tlx.loadFailed') })); }}>{t('tlx.check')}</button>
        </div>
      </div>

      <form className="panel rvw-filters" data-testid="tlx-searchbar" onSubmit={submit}>
        <input className="rvw-search" data-testid="tlx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('tlx.searchPh')} aria-label={t('tlx.searchPh')} />
        <button className="btn" type="submit" data-testid="tlx-search-btn" disabled={finding}>{t('pos.search')}</button>
        {customerId ? <button className="btn ghost" type="button" data-testid="tlx-change" onClick={() => setF({ customer: null, family: null, dateField: null, preset: null, from: null, to: null, sort: null, pageSize: null })}>{t('tlx.changeCustomer')}</button> : null}
      </form>
      {findErr ? <p className="err" role="alert" data-testid="tlx-find-err">{findErr}</p> : null}

      {found && !customerId ? matchesPanel : null}

      {!customerId && !found ? <section className="panel tlx-howto" data-testid="tlx-howto">
        <Empty title={t('tlx.searchFirst')} />
        <ol className="tlx-steps"><li>{t('tlx.howto.1')}</li><li>{t('tlx.howto.2')}</li><li>{t('tlx.howto.3')}</li></ol>
        <p className="sub">{t('tlx.howto.privacy')}</p>
      </section> : null}

      {customerId ? <>
        {profileErr ? <ErrorRetry message={profileErr} onRetry={() => setF({ customer: customerId })} /> : null}
        <section className="panel tlx-summary" data-testid="tlx-summary">
          {!p ? <div className="state">{t('tlx.loading')}</div> : <>
            <div className="tlx-who"><h2>{p.name || '—'}</h2>
              <span className="sub">{p.phone ?? t('tlx.notProvided')} · {p.email ?? t('tlx.notProvided')} · <span className="mono">{String(p.id).slice(0, 8)}</span></span>
              <span className="tlx-links">
                <button className="btn ghost sm" data-testid="tlx-open-customer" onClick={() => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(p.id)}`)}>{t('tlx.openCustomer')}</button>
                {!p.archivedAt ? <button className="btn ghost sm" data-testid="tlx-book" onClick={() => nav(`/booking/new?customerId=${encodeURIComponent(p.id)}&from=customer-timeline`)}>{t('tlx.newBooking')}</button> : null}
              </span></div>
            {/* Customer Timeline SUNMI guide §05/§07: the Customer 360 summary — four equal cards, every earlier fact kept inside */}
            <div className="rvw-kpis tlx-kpis" data-testid="tlx-kpis">
              <KpiCard testId="tlx-kpi-identity" label={t('tlx.kpi.identity')} value={p.name || '—'}
                sub={<>{t('tlx.kpi.since', { d: when(p.createdAt) })}{p.homeBranch?.name ? ` · ${p.homeBranch.name}` : ''}<span data-testid="tlx-kpi-tech"> · {t('tlx.kpi.prefTech')}: {profile.preferences.technician?.name ?? t('tlx.noneRecorded')}</span></>} />
              <KpiCard testId="tlx-kpi-visits" label={t('tlx.kpi.lastVisit')} value={profile.visits ? (profile.visits.lastAt ? when(profile.visits.lastAt) : t('tlx.none')) : t('tlx.unavailable')}
                sub={profile.visits ? <>{t('tlx.kpi.completedVisits', { n: fmtNumber(profile.visits.completed) })}<span data-testid="tlx-kpi-first"> · {t('tlx.kpi.first')}: {when(profile.visits.firstAt)}</span></> : undefined} />
              <KpiCard testId="tlx-kpi-upcoming" label={t('tlx.kpi.upcoming')} value={fmtNumber(profile.appointments.upcoming.length)}
                sub={profile.appointments.upcoming[0] ? `${profile.appointments.upcoming[0].date} ${profile.appointments.upcoming[0].time ?? ''} · ${statusLabel('appointment', profile.appointments.upcoming[0].status)}${profile.appointments.upcoming[0].source ? ` · ${profile.appointments.upcoming[0].source}` : ''}` : t('tlx.none')} />
              <KpiCard testId="tlx-kpi-benefits" label={t('tlx.kpi.benefits')}
                value={<span data-testid="tlx-kpi-points">{profile.sources.loyalty === 'unavailable' ? t('tlx.unavailable') : !profile.loyalty?.enrolled ? t('tlx.notEnrolled') : t('tlx.points', { n: fmtNumber(profile.loyalty.points) })}</span>}
                sub={<span data-testid="tlx-kpi-member">{profile.loyalty?.tier ? `${profile.loyalty.tier} · ` : ''}{t('tlx.kpi.membership')}: {profile.sources.memberships === 'unavailable' ? t('tlx.unavailable') : profile.memberships.find((m: any) => m.status === 'active')?.plan ?? t('tlx.none')} · {t('tlx.readOnly')}</span>} />
            </div>
            {Object.entries(profile.sources as Record<string, string>).some(([, v]) => v === 'unavailable')
              ? <p className="warn" data-testid="tlx-partial">{t('tlx.partial', { list: Object.entries(profile.sources as Record<string, string>).filter(([, v]) => v === 'unavailable').map(([k]) => t('tlx.src.' + k)).join(', ') })}</p> : null}
          </>}
        </section>

        <div className={'tlx-body' + (matchesPanel ? ' with-matches' : '')} data-testid="tlx-body">
        {matchesPanel ? <div className="tlx-left">{matchesPanel}</div> : null}
        <div className="tlx-right">
        <section className="panel rvw-filters" data-testid="tlx-filters">
          <div className="rvw-tabs" role="tablist">
            <button role="tab" aria-selected={!f.family} className={'btn ghost' + (!f.family ? ' on' : '')} data-testid="fam-all" onClick={() => setF({ family: null })}>{t('tlx.family.all')}</button>
            {FAMILIES.map((x) => <button key={x} role="tab" aria-selected={f.family === x} className={'btn ghost' + (f.family === x ? ' on' : '')} data-testid={`fam-${x}`} onClick={() => setF({ family: x })}>{t('tlx.family.' + x)}</button>)}
          </div>
          <form className="tlx-inner" onSubmit={(e) => { e.preventDefault(); setInnerQ(inner.trim()); setF({}, false); }}>
            <input data-testid="tlx-inner" value={inner} onChange={(e) => setInner(e.target.value)} placeholder={t('tlx.innerPh')} aria-label={t('tlx.innerPh')} />
            <button className="btn ghost" type="submit">{t('pos.search')}</button>
          </form>
          <label className="rvw-f"><span>{t('tlx.f.sort')}</span>
            <select data-testid="flt-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value === 'newest' ? null : e.target.value })}>
              {SORTS.map((s) => <option key={s} value={s}>{t('tlx.sort.' + s)}</option>)}
            </select></label>
          <div className="rvw-dates" data-testid="tlx-dates">
            <label className="rvw-f"><span>{t('tlx.f.dateField')}</span>
              <select data-testid="flt-datefield" value={f.dateField ?? 'occurred'} onChange={(e) => setF({ dateField: e.target.value === 'occurred' ? null : e.target.value })}>
                {DATE_FIELDS.map((d) => <option key={d} value={d}>{t('tlx.date.' + d)}</option>)}
              </select></label>
            <button className={'btn ghost' + (!f.preset ? ' on' : '')} data-testid="preset-all" onClick={() => setF({ preset: null, from: null, to: null })}>{t('tlx.preset.all')}</button>
            {PRESETS.map((x) => <button key={x} className={'btn ghost' + (f.preset === x ? ' on' : '')} data-testid={`preset-${x}`} onClick={() => setF({ preset: x, from: null, to: null })}>{t('tlx.preset.' + x)}</button>)}
            <button className={'btn ghost' + (f.preset === 'custom' ? ' on' : '')} data-testid="preset-custom" onClick={() => setCal(true)}>{f.preset === 'custom' ? `${f.from} → ${f.to}` : t('tlx.preset.custom')}</button>
          </div>
          {anyFilter ? <button className="btn ghost" data-testid="flt-clear" onClick={() => { setInner(''); setInnerQ(''); setF({ family: null, dateField: null, preset: null, from: null, to: null, sort: null }); }}>{t('tlx.clearFilters')}</button> : null}
          {cal ? <div className="rvw-cal" data-testid="tlx-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={list?.period?.today ?? deviceToday()}
            onApply={(r) => { setF({ preset: 'custom', from: r.from, to: r.to }); setCal(false); }} onCancel={() => setCal(false)} onClear={() => { setF({ preset: null, from: null, to: null }); setCal(false); }} /></div> : null}
        </section>

        <section className="panel rvw-feed" data-testid="tlx-events">
          <div className="p-h">{t('tlx.activity')}
            <span className="sub rvw-scope" data-testid="tlx-count">{list ? t('tlx.count', { n: fmtNumber(list.total), order: t('tlx.sort.' + (list.applied?.sort ?? 'newest')) }) : ''}</span>
            {newer ? <button className="btn ghost sm" data-testid="tlx-newer" onClick={() => { setF({ page: null }); void load(); }}>{t('tlx.newer')}</button> : null}
          </div>
          {err ? <ErrorRetry message={err} onRetry={() => void load()} />
            : loading && !list ? <div className="state">{t('tlx.loading')}</div>
            : !list ? null
            : list.items.length === 0 ? <Empty title={t('tlx.noActivity')} />
            : groups.map((g) => (
              <div key={g.ref} className={'tlx-group' + (groupTitle(g) ? ' grouped' : '')} data-testid="tlx-group">
                {groupTitle(g) ? <div className="tlx-group-h">{groupTitle(g)}</div> : null}
                {g.events.map((e: any) => (
                  <button key={e.id} type="button" className="tlx-ev" data-testid="tlx-event" onClick={() => setOpenEvent(e.id)}>
                    <span className="tlx-when">{when(e.occurredAt, true)}</span>
                    <span className={'chip ' + (FAMILY_TONE[e.family] ?? '')}>{t('tlx.family.' + e.family)}</span>
                    <b>{eventLabel(e.type, e.family)}</b>
                    {e.technician?.name ? <span className="sub">· {e.technician.name}</span> : null}
                    {e.branch?.name ? <span className="sub">· {e.branch.name}</span> : null}
                    {e.amountCents != null ? <span className="tlx-amt">{fmtMoney(e.amountCents)}</span> : e.amountHidden ? <span className="sub tlx-amt" title={t('tlx.amountHiddenHint')}>{t('tlx.amountHidden')}</span> : null}
                    {e.family === 'benefit' && e.meta?.points != null ? <span className="tlx-amt">{t('tlx.points', { n: fmtNumber(Number(e.meta.points)) })}</span> : null}
                  </button>
                ))}
              </div>
            ))}
          <div className="rvw-pager">
            <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(pg) => setF({ page: String(pg) }, true)} />
            <label className="rvw-f"><span>{t('tlx.rows')}</span>
              <select data-testid="tlx-pagesize" value={String(query.pageSize)} onChange={(e) => setF({ pageSize: e.target.value === '25' ? null : e.target.value })}>
                {['10', '25', '50', '100'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
          </div>
          {list ? <p className="sub" data-testid="tlx-foot">{t('tlx.liveSources', { at: when(list.freshness?.readAt, true) })}{!list.visibility?.money ? ` · ${t('tlx.moneyHidden')}` : ''}</p> : null}
        </section>
        </div>
        </div>
      </> : null}

      {openEvent && customerId ? <EventOverlay customerId={customerId} eventId={openEvent} onClose={() => setOpenEvent(null)} nav={nav} /> : null}
      {health ? <HealthDialog data={health} onClose={() => setHealth(null)} /> : null}
    </div>
  );
}

function EventOverlay({ customerId, eventId, onClose, nav }: { customerId: string; eventId: string; onClose: () => void; nav: (to: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); setErr(null); posCustomerTimelineApi.event(customerId, eventId).then(setD).catch((e) => setErr(errText(e, 'tlx.loadFailed'))); }, [customerId, eventId]);
  const e = d?.event; const v = d?.visit;
  const go = (to: string) => { onClose(); nav(to); };
  return (
    <FitDialog wide testId="tlx-overlay" title={e ? eventLabel(e.type, e.family) : t('tlx.loading')} subtitle={e ? `${t('tlx.family.' + e.family)} · ${when(e.occurredAt, true)}` : undefined} onClose={onClose}
      footer={<div className="rvw-ov-foot">
        {e?.appointmentDate ? <button className="btn ghost" data-testid="ov-booking" onClick={() => go(`/booking?date=${encodeURIComponent(e.appointmentDate)}`)}>{t('tlx.ov.viewBooking')}</button> : null}
        {v ? <button className="btn ghost" data-testid="ov-checkout" onClick={() => go(`/tenant/payments/transactions?ticket=${encodeURIComponent(v.ticketId)}`)}>{t('tlx.ov.viewCheckout')}</button> : null}
        {e?.type?.startsWith('refund_') ? <button className="btn ghost" data-testid="ov-refunds" onClick={() => go('/tenant/payments/refunds-voids')}>{t('tlx.ov.viewRefunds')}</button> : null}
        {e?.type?.startsWith('loyalty_') ? <button className="btn ghost" data-testid="ov-loyalty" onClick={() => go(`/tenant/customers/loyalty?customerId=${encodeURIComponent(customerId)}`)}>{t('tlx.ov.viewLoyalty')}</button> : null}
        {e?.type?.startsWith('membership_') ? <button className="btn ghost" onClick={() => go(`/tenant/customers/memberships?customerId=${encodeURIComponent(customerId)}`)}>{t('tlx.ov.viewMembership')}</button> : null}
        {e?.type?.startsWith('gift_card_') ? <button className="btn ghost" onClick={() => go(`/tenant/customers/gift-cards?customerId=${encodeURIComponent(customerId)}`)}>{t('tlx.ov.viewGiftCards')}</button> : null}
        <button className="btn ghost" data-testid="ov-customer" onClick={() => go(`/tenant/customers/profiles?customerId=${encodeURIComponent(customerId)}`)}>{t('tlx.openCustomer')}</button>
        <button className="btn ghost" data-testid="ov-close" onClick={onClose}>{t('tlx.close')}</button>
      </div>}>
      {err ? <div className="err">{err}</div> : !e ? <div className="state">{t('tlx.loading')}</div> : <>
        <dl className="rvw-dl" data-testid="ov-fields">
          <dt>{t('tlx.ov.occurred')}</dt><dd>{when(e.occurredAt, true)}</dd>
          <dt>{t('tlx.ov.recorded')}</dt><dd>{when(e.recordedAt, true)}</dd>
          <dt>{t('tlx.ov.source')}</dt><dd>{t('tlx.source.' + e.source)} · <span className="mono">{e.refId ? String(e.refId).slice(0, 8) : '—'}</span></dd>
          {e.branch ? <><dt>{t('tlx.ov.branch')}</dt><dd>{e.branch.name ?? '—'}</dd></> : null}
          {e.technician ? <><dt>{t('tlx.ov.technician')}</dt><dd>{e.technician.name ?? '—'}</dd></> : null}
          {e.appointmentDate ? <><dt>{t('tlx.ov.apptDate')}</dt><dd>{e.appointmentDate} {e.meta?.time ? String(e.meta.time).slice(0, 5) : ''}</dd></> : null}
          {e.amountCents != null ? <><dt>{t('tlx.ov.amount')}</dt><dd data-testid="ov-amount">{fmtMoney(e.amountCents)}{e.meta?.cardLast4 ? ` · •••• ${e.meta.cardLast4}` : ''}</dd></> : e.amountHidden ? <><dt>{t('tlx.ov.amount')}</dt><dd className="sub">{t('tlx.amountHidden')}</dd></> : null}
          {e.meta?.points != null ? <><dt>{t('tlx.ov.points')}</dt><dd>{fmtNumber(Number(e.meta.points))}{e.meta.balanceAfter != null ? ` → ${fmtNumber(Number(e.meta.balanceAfter))}` : ''}</dd></> : null}
          {e.meta?.plan ? <><dt>{t('tlx.ov.plan')}</dt><dd>{String(e.meta.plan)}</dd></> : null}
          {e.meta?.title ? <><dt>{t('tlx.ov.message')}</dt><dd>{String(e.meta.title)}{e.meta.body ? <div className="sub">{String(e.meta.body)}</div> : null}</dd></> : null}
          {e.meta?.statusTimeIsLastUpdate ? <><dt /><dd className="sub">{t('tlx.ov.statusTimeNote')}</dd></> : null}
        </dl>
        {v ? <div data-testid="ov-visit">
          <h4>{v.ticketNumber != null ? t('tlx.group.visitNo', { n: String(v.ticketNumber) }) : t('tlx.group.visit')}</h4>
          <p className="sub">{t('tlx.ov.visitTimes', { inAt: when(v.checkedInAt, true), start: when(v.startedAt, true), done: when(v.serviceDoneAt, true), paid: when(v.paidAt, true) })}</p>
          {v.services.length ? <table className="tbl"><thead><tr><th>{t('tlx.ov.service')}</th><th>{t('tlx.ov.technician')}</th><th>{t('tlx.ov.minutes')}</th>{v.totals ? <th>{t('tlx.ov.amount')}</th> : null}</tr></thead>
            <tbody>{v.services.map((s: any) => <tr key={s.id} data-testid="ov-service"><td>{s.service ?? '—'}{s.addOn ? <span className="chip">{t('tlx.ov.addOn')}</span> : null}</td><td>{s.technician ?? '—'}</td><td className="num">{s.minutes ?? '—'}</td>{v.totals ? <td className="num">{s.lineTotalCents == null ? '—' : fmtMoney(s.lineTotalCents)}</td> : null}</tr>)}</tbody></table>
            : <p className="sub">{t('tlx.ov.noServices')}</p>}
          {v.totals ? <p data-testid="ov-total">{t('tlx.ov.total', { total: fmtMoney(v.totals.totalCents), tip: fmtMoney(v.totals.tipCents) })}</p> : null}
        </div> : null}
        <p className="sub">{t('tlx.ov.readOnly')}</p>
      </>}
    </FitDialog>
  );
}

function HealthDialog({ data, onClose }: { data: any; onClose: () => void }) {
  return (
    <FitDialog wide testId="tlx-health" title={t('tlx.check')} subtitle={data && data !== 'loading' && !data.error ? t('tlx.health.overall', { s: t('tlx.health.' + data.overall), at: when(data.checkedAt, true) }) : undefined} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{t('tlx.close')}</button>}>
      {data === 'loading' ? <div className="state">{t('tlx.health.running')}</div> : data.error ? <div className="err">{data.error}</div> : <>
        <p className="sub">{t('tlx.health.readOnly')}{data.reused ? ` ${t('tlx.health.recent')}` : ''}</p>
        {data.checks.map((c: any) => (
          <div key={c.key} className="rvw-check" data-testid={`chk-${c.key}`}>
            <div><span className={'chip ' + (STATE_TONE[c.state] ?? '')} data-testid={`chk-${c.key}-state`}>{t('tlx.health.' + c.state)}</span> <b>{t('tlx.health.k.' + c.key)}</b>{c.count ? <span className="sub"> · {fmtNumber(c.count)}</span> : null}</div>
            <div className="sub">{t('tlx.health.d.' + c.key + '.' + c.state)}</div>
            {c.key === 'sources' && c.detail?.unavailable?.length ? <div className="sub">{c.detail.unavailable.map((s: string) => t('tlx.src.' + s)).join(', ')}</div> : null}
          </div>
        ))}
      </>}
    </FitDialog>
  );
}
