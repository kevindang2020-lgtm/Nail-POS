// POSTechAppointmentsScreen.tsx — Team → Technician Appointments (/tech-appointments). Rebuild (Oct 30 2026), one vertical
// scroll, every original module kept:
//   A header (Refresh · View Booking Board · New Appointment) and the selected salon day (‹ Today ›)
//   B one search (customer · phone any format · technician · service · appointment id) · Today / Week / Month / Year /
//     Custom with its date field (scheduled / created) · status · source · technician
//   C the nine KPIs for the selected day, each a filter
//   D technician cards (12 a page from the server, searchable): status, skills, appointments, booked / free minutes,
//     next appointment and View Full Day
//   E the Day / Week board: Day = the live-schedule columns on a 15-minute time axis (shift, true-length bars, breaks,
//     blocked time, open slots); Week = per-day counts per technician, a cell opens that day
//   F All Technician Appointments — server-paged, start-time order (or newest created), with the original actions
//   G Appointment details (Check In · No-Show · Start · Assign · Reschedule · Cancel, as before) · Find Next Available
//     Technician (the booking engine's openings) · Schedule Conflict Warning (every cause + alternatives)
//   H Recent booking changes (the appointment change log, newest first) with its own period and pages.
// Reads only the ONE appointment ledger; every change goes through the existing appointment / booking endpoints.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtime } from '../realtime/useRealtime';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posTechAppointmentsApi } from '../api/posTechAppointmentsApi';
import { codeLabel } from '../components/codeLabel';
import { posTechAppointmentsScreenApi } from '../api/posTeamScreensApi';
import { posLiveTechnicianScheduleApi } from '../api/posLiveTechnicianScheduleApi';
import { bookingConflictText } from '../api/posBookingApi';
import { posCheckInApi } from '../api/posCheckInApi';
import { useCan } from '../components/usePermissions';
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, useFreshAt, FreshnessLine, type PeriodState } from '../components/FinanceKit';
import { TechTimeline, FullDayOverlay, ConflictPanel, nf, hm12, addDay, apptStatus, liveStatus, liveTone } from './teamShared';
import { QualifiedFinder, pageOf, whenTime } from './technicianScreenParts';

/** 200-technician §2: the technician cards page on the server, 12 a page */
export const TA_LANE_PAGE_SIZE = 12;
const STATUSES = ['all', 'booked', 'checked_in', 'in_service', 'completed', 'cancelled', 'no_show', 'conflict'];
const TONE: Record<string, string> = { confirmed: 'ok', booked: 'ok', completed: 'ok', arrived: 'info', checked_in: 'info', waiting: 'warn', in_service: 'warn', cancelled: 'bad', no_show: 'bad' };

/** TECH APPOINTMENTS extras #06 — the exact scheduled start and end on hover (the list shows only the start). The list row
 *  carries no buffer minutes, so none are claimed here; an unknown end shows "—", never a guess. */
export const exactTime = (a: { date?: string | null; start?: string | null; end?: string | null; minutes?: number | null }) =>
  tx('tm.exactTime', { d: a.date ?? '—', s: a.start ? hm12(a.start) : '—', e: a.end ? hm12(a.end) : '—', n: a.minutes != null ? nf(a.minutes) : '—' });

export function POSTechAppointmentsScreen() {
  const nav = useNavigate(); const can = useCan();
  const [date, setDate] = useState<string | null>(null);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [period, setPeriod] = useState<PeriodState>({ preset: 'today' }); const [dateField, setDateField] = useState('scheduled');
  const [status, setStatus] = useState('all'); const [source, setSource] = useState('all'); const [techFilter, setTechFilter] = useState(''); const [sort, setSort] = useState('start');
  const [page, setPage] = useState(1); const [hp, setHp] = useState(1); const [hPeriod, setHPeriod] = useState<PeriodState>({ preset: 'week' }); const [wp, setWp] = useState(1);
  const [laneSearch, setLaneSearch] = useState(''); const laneQ = useDebounced(laneSearch.trim(), 250); const [lanePage, setLanePage] = useState(1);
  const [tick, setTick] = useState(0); const reload = useCallback(() => setTick((n) => n + 1), []);
  const [note, setNote] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null); const [fullDay, setFullDay] = useState<string | null>(null); const [finder, setFinder] = useState(false);
  useEffect(() => setLanePage(1), [laneQ]);
  useRealtime(['booking', 'tech-appointments', 'technicians'], reload);

  const kp = useLoad(() => posTechAppointmentsScreenApi.kpis({ date: date ?? undefined }), [date, tick]);
  const freshAt = useFreshAt(kp.data);   // data freshness: only after a successful read
  const day = date ?? kp.data?.date ?? null; const today = kp.data?.today ?? day ?? '';
  const lanes = useLoad(() => posTechAppointmentsApi.state({ date: day ?? undefined, lanePage, lanePageSize: TA_LANE_PAGE_SIZE, laneSearch: laneQ || undefined, roster: 'none' }), [day, lanePage, laneQ, tick]);
  const board = useLoad(() => (view === 'day' && day ? posLiveTechnicianScheduleApi.board({ date: day, lanePage, lanePageSize: TA_LANE_PAGE_SIZE, search: laneQ || undefined }) : Promise.resolve(null)), [view, day, lanePage, laneQ, tick]);
  const week = useLoad(() => (view === 'week' && day ? posTechAppointmentsScreenApi.week({ start: day, page: wp, pageSize: 12 }) : Promise.resolve(null)), [view, day, wp, tick]);
  const scope = { q: q || undefined, status, source, technicianId: techFilter || undefined, dateField, sort, ...periodQuery(period) };
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key]);
  const list = useLoad(() => posTechAppointmentsScreenApi.appointments({ ...scope, page, pageSize: 10 }), [key, page, tick]);
  const hist = useLoad(() => posTechAppointmentsScreenApi.history({ ...periodQuery(hPeriod), page: hp, pageSize: 8 }), [JSON.stringify(hPeriod), hp, tick]);
  const s: any = lanes.data; const k = kp.data?.kpis;
  // the technician pickers (filter · conflict check) list the active team from the directory, not just this card page
  const [techFilterName, setTechFilterName] = useState<string | undefined>(undefined);   // technicians are chosen from the server-paged picker (never a whole-roster list)
  const showDay = (st: string) => { setStatus(st); setDateField('scheduled'); setPeriod(day ? { preset: 'custom', from: day, to: day } : { preset: 'today' }); document.querySelector('[data-testid="appointments-list"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const filtered = !!(q || status !== 'all' || source !== 'all' || techFilter || sort !== 'start' || period.preset !== 'today' || dateField !== 'scheduled');
  const clearAll = () => { setSearch(''); setStatus('all'); setSource('all'); setTechFilter(''); setSort('start'); setPeriod({ preset: 'today' }); setDateField('scheduled'); };
  // the appointment record; when its detail route is unavailable the list row (the same ledger row) is shown instead
  const openAppt = async (aid: string) => {
    setNote(null);
    try { setDetail(await posTechAppointmentsApi.appointment(aid)); }
    catch (e) {
      const r = (list.data?.items ?? []).find((x: any) => x.appointmentId === aid);
      if (r) setDetail({ appointmentId: r.appointmentId, customerName: r.customer, startTime: r.start, endTime: r.end, date: r.date, durationMinutes: r.minutes, status: r.status, technicianId: r.technicianId, technicianName: r.technician, source: r.source, version: r.version, services: r.services.map((n: string) => ({ name: n })) });
      else setNote(bookingConflictText(e, tx('pos.action_failed')));
    }
  };
  const rowsFromBoard = (b: any) => (b?.technicians ?? b?.schedule?.technicians ?? []).map((c: any) => ({ technicianId: c.technicianId, name: c.fullName, status: c.status, shift: c.shift ?? null, appointments: c.appointments ?? [], blocks: c.blocks ?? [], openSlots: c.openSlots ?? [] }));

  if (isForbidden(kp.error)) return <div className="work mos tas" data-testid="tech-appointments-screen"><h1>{tx('pos.tech_appointments')}</h1><StateBlock error={kp.error} onRetry={kp.reload} /></div>;
  return (
    <div className="work mos tas" data-testid="tech-appointments-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.tech_appointments')}</h1><div className="sub">{tx('tm.sub')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setFinder(true)} data-testid="open-finder">{tx('tm.findNext')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/booking')} data-testid="booking-board">{tx('tm.bookingBoard')}</button>
          {can('booking.manage') ? <button type="button" className="fk-btn primary" onClick={() => nav(`/booking/new${day ? '?date=' + day : ''}`)} data-testid="new-appointment">{tx('tm.newAppointment')}</button> : null}
        </div>
      </header>
      {note ? <div className="fk-note bad" role="alert" data-testid="note"><span>{note}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="tm-dayrow" data-testid="day-picker">
        <button type="button" className="fk-btn ghost" onClick={() => day && setDate(addDay(day, -1))} aria-label={tx('tm.prevDay')} data-testid="prev-day">‹</button>
        <input type="date" className="fk-select" value={day ?? ''} onChange={(e) => setDate(e.target.value || null)} aria-label={tx('tm.date')} data-testid="day" />
        <button type="button" className="fk-btn ghost" onClick={() => day && setDate(addDay(day, 1))} aria-label={tx('tm.nextDay')} data-testid="next-day">›</button>
        <button type="button" className="fk-btn ghost" onClick={() => setDate(null)} disabled={!date || date === today} data-testid="to-today">{tx('tm.today')}</button>
        <span className="fk-hint">{tx('tm.dayRule', { d: day ?? '' })}</span>
      </div>

      <FreshnessLine at={freshAt} error={kp.error} testId="ta-fresh" />

      <div className="fk-kpis nine cg-kpis" data-testid="kpis">
        {kp.error ? <StateBlock error={kp.error} onRetry={kp.reload} /> : ([['today', 'all', 'pos.today_2'], ['booked', 'booked', 'pos.booked'], ['checkedIn', 'checked_in', 'pos.checked_in_2'], ['inService', 'in_service', 'pos.in_service_3'], ['completed', 'completed', 'pos.completed_2'],
          ['cancelled', 'cancelled', 'pos.cancelled'], ['noShows', 'no_show', 'pos.no_shows_2'], ['online', 'all', 'pos.online'], ['conflicts', 'conflict', 'pos.conflicts_2']] as const).map(([kk, st, label]) =>
          <KpiCard key={kk} testId={'kpi-' + kk} tone={kk === 'conflicts' && k && k.conflicts ? 'bad' : kk === 'noShows' && k && k.noShows ? 'warn' : undefined} label={tx(label)} loading={!k} value={k ? nf(k[kk]) : ''} sub={tx('tm.kpi.' + kk)}
            onClick={() => { if (kk === 'online') setSource('online'); showDay(st); }} />)}
      </div>

      {/* TECH APPOINTMENTS 08 — online bookings still waiting on the customer's SMS code: NOT appointments yet, never in the KPIs */}
      {kp.data?.pendingVerification?.count ? <div className="fk-note" data-testid="pending-verification" role="status">
        <b>{tx('tm.pv.title', { n: nf(kp.data.pendingVerification.count) })}</b> <span className="fk-hint">{tx('tm.pv.rule')}</span>
        <ul className="tm-pv-list" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{kp.data.pendingVerification.items.map((h: any) => <li key={h.holdId} data-testid="pv-item">
          {hm12(h.start)}–{hm12(h.end)} · {h.technician ?? tx('tm.anyTech')}{h.phone ? ` · ${h.phone}` : ''} <span className={'fk-chip ' + (h.verification === 'locked' || h.verification === 'failed' ? 'bad' : 'warn')}>{codeLabel('tm.pv.state', h.verification)}</span></li>)}</ul>
      </div> : null}

      <FitPanel testId="tech-cards" title={<>{tx('tm.techCards')}{s?.lanes ? <span className="fk-muted"> · {tx('pos.n_technicians', { n: String(s.lanes.total) })}</span> : null}</>}>
        <div className="mos-tools" data-testid="ta-lane-pager">
          <div className="fn-search mos-search"><input className="fk-search" type="search" value={laneSearch} onChange={(e) => setLaneSearch(e.target.value)} placeholder={tx('pos.find_technician_placeholder')} aria-label={tx('pos.find_technician')} /></div>
          {s?.lanes && s.lanes.totalPages > 1 ? <span className="tm-lanepager">
            <button type="button" className="fk-btn ghost sm" disabled={s.lanes.page <= 1} onClick={() => setLanePage(Math.max(1, s.lanes.page - 1))}>{tx('pos.previous')}</button>
            <span>{tx('pos.page_x_of_y', { page: String(s.lanes.page), pages: String(s.lanes.totalPages) })}</span>
            <button type="button" className="fk-btn ghost sm" disabled={s.lanes.page >= s.lanes.totalPages} onClick={() => setLanePage(Math.min(s.lanes.totalPages, s.lanes.page + 1))}>{tx('pos.next')}</button></span> : null}
        </div>
        {lanes.error ? <StateBlock error={lanes.error} onRetry={lanes.reload} /> : !s ? <div className="fk-loading">{tx('pos.loading_tech_appointments')}</div> : s.technicians.length === 0 ? <Empty title={tx('pos.no_technicians_scheduled')} />
          : <div className="tm-cards" data-testid="tech-card-grid">{s.technicians.map((t: any) => { const mine = (s.appointments ?? []).filter((a: any) => a.technicianId === t.technicianId && !['cancelled', 'no_show', 'completed'].includes(a.status)).sort((a: any, b: any) => String(a.startTime).localeCompare(String(b.startTime)));
            return <div key={t.technicianId} className="tm-card" data-testid="tech-card">
              <div className="tm-card-h"><ProfileAvatarWithPreview name={t.displayName} url={t.avatarUrl} size={40} type="technician" /><span><b>{t.displayName}</b><span className={'fk-chip ' + liveTone(t.workingStatus)}>{liveStatus(t.workingStatus)}</span></span></div>
              <div className="fk-li-s">{t.serviceSkillGroups?.length ? t.serviceSkillGroups.join(' · ') : tx('tm.noSkills')}</div>
              <div className="tm-card-n">{tx('tm.cardLine', { n: nf(t.appointmentCount), b: nf(t.scheduledMinutes), f: nf(t.availableMinutes) })}</div>
              <div className="fk-li-s">{mine[0] ? tx('tm.nextAt', { t: hm12(mine[0].startTime), c: mine[0].customerName ?? '' }) : tx('tm.noNext')}</div>
              <button type="button" className="fk-btn sm" onClick={() => setFullDay(t.technicianId)} data-testid="view-full-day">{tx('tm.viewFullDay')}</button>
            </div>; })}</div>}
        <div className="fk-hint">{tx('tm.freeRule')}</div>
      </FitPanel>

      <FitPanel testId="board" title={tx('tm.board')} actions={<div className="fk-seg" role="tablist" aria-label={tx('tm.board')}>{(['day', 'week'] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={'view-' + v}>{tx('tm.view.' + v)}</button>)}</div>}>
        {view === 'day' ? (board.error ? <StateBlock error={board.error} onRetry={board.reload} /> : !board.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : <TechTimeline rows={rowsFromBoard(board.data)} onTech={setFullDay} onAppt={openAppt} nowMinute={day === today ? kp.data?.nowMinute ?? null : null} />)
          : week.error ? <StateBlock error={week.error} onRetry={week.reload} /> : !week.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : <><table className="fk-table fn-table cg-table tm-week" data-testid="week-table"><thead><tr><th>{tx('tm.col.technician')}</th>{week.data.days.map((d: string) => <th key={d} className={'num' + (d === today ? ' tm-today' : '')}>{d.slice(5)}</th>)}</tr></thead>
            <tbody>{week.data.technicians.map((t: any) => <tr key={t.technicianId}><td>{t.name}</td>{t.days.map((c: any) => <td key={c.date} className="num"><button type="button" className={'tm-cell' + (c.appointments ? ' on' : '')} onClick={() => { setDate(c.date); setView('day'); }} title={tx('tm.cellTitle', { n: nf(c.appointments), m: nf(c.bookedMinutes) })}>{c.appointments ? `${nf(c.appointments)} · ${Math.round(c.bookedMinutes / 6) / 10}h` : '—'}</button></td>)}</tr>)}</tbody></table>
            <Pager info={pageOf(week.data)} onPage={setWp} compact /></>}
        <div className="fk-hint">{tx('tm.boardRule')}</div>
      </FitPanel>

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('tm.searchPh')} aria-label={tx('tm.searchPh')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{STATUSES.map((x) => <option key={x} value={x}>{tx('tm.statusF.' + x)}</option>)}</select>
        <select className="fk-select" value={source} onChange={(e) => setSource(e.target.value)} aria-label={tx('tm.source')} data-testid="source">{['all', 'online', 'in_salon'].map((x) => <option key={x} value={x}>{tx('tm.sourceF.' + x)}</option>)}</select>
        <span data-testid="tech-filter"><TechnicianPickerButton value={techFilter} valueName={techFilterName} emptyLabel={tx('tm.allTechs')} anyLabel={tx('tm.allTechs')} ariaLabel={tx('tm.col.technician')} onChange={(id, t) => { setTechFilter(id); setTechFilterName(t?.name); }} /></span>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{['start', 'newest', 'oldest'].map((x) => <option key={x} value={x}>{tx('tm.sort.' + x)}</option>)}</select>
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact basis={dateField} basisOptions={['scheduled', 'created'].map((f) => ({ value: f, label: tx('tm.df.' + f) }))} onBasis={setDateField} />
        {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
      </div>
      <FitPanel testId="appointments-list" title={<>{tx('tm.allAppointments')}{list.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(list.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(list.data)} onPage={setPage} label={tx('tm.allAppointments')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : list.data.items.length === 0 ? (filtered ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty> : <Empty title={tx('tm.noAppointments')} />)
          : <table className="fk-table fn-table cg-table" data-testid="appointments-table">
            <thead><tr><th>{tx('tm.col.customer')}</th><th>{tx('tm.col.service')}</th><th>{tx('tm.col.technician')}</th><th>{tx('tm.col.when')}</th><th>{tx('pos.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{list.data.items.map((a: any) => <tr key={a.appointmentId} data-testid="appt-row" className="inv2-click" onClick={() => openAppt(a.appointmentId)}>
              <td><span className="fk-li-t">{a.customer ?? '—'}{a.vip ? ' · ' + tx('tm.vip') : ''}</span><span className="fk-li-s">{a.phone ?? ''}{a.matchedVia ? ` · ${tx('tm.via.' + a.matchedVia)}` : ''}</span></td>
              <td>{a.services.join(', ') || '—'}<span className="fk-li-s">{a.online ? tx('tm.onlineBooked') : tx('tm.inSalonBooked')}</span></td>
              <td>{a.technician ?? (a.anyTechnician ? tx('tm.anyTech') : '—')}</td>
              <td title={exactTime(a)} data-testid="appt-when">{a.date} · {hm12(a.start)}<span className="fk-li-s">{tx('cg.min', { n: nf(a.minutes) })}</span></td>
              <td><span className={'fk-chip ' + (TONE[a.status] ?? 'mut')}>{apptStatus(a.status)}</span>{a.conflict ? <span className="fk-chip bad" data-testid="conflict-chip">{tx('pos.conflict')}</span> : null}{a.phoneVerification ? <span className="fk-li-s" data-testid="appt-phone-proof">{codeLabel('tm.pv.proof', a.phoneVerification)}</span> : null}</td>
              <td className="fn-acts" onClick={(e) => e.stopPropagation()}><button type="button" className="fk-btn ghost sm" onClick={() => openAppt(a.appointmentId)} data-testid="appt-details">{tx('pos.details')}</button></td>
            </tr>)}</tbody></table>}
        <div className="fk-hint">{sort === 'start' ? tx('tm.orderStart') : tx('tm.orderNewest')}</div>
      </FitPanel>

      <div className="mos-row two cg-row">
        <FitPanel testId="conflict-warning" title={tx('tm.conflictTitle')}><ConflictPanel today={today} /></FitPanel>
        <FitPanel testId="next-available" title={tx('tm.findNext')}><p className="fk-hint">{tx('tm.findNextSub')}</p><button type="button" className="fk-btn primary" onClick={() => setFinder(true)} data-testid="cta-finder">{tx('tm.findNext')}</button></FitPanel>
      </div>

      <FitPanel testId="history" title={<>{tx('tm.history')}{hist.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(hist.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(hist.data)} onPage={setHp} label={tx('tm.history')} />}>
        <PeriodBar value={hPeriod} onChange={(p) => { setHPeriod(p); setHp(1); }} server={hist.data?.period} allowAll compact />
        {hist.error ? <StateBlock error={hist.error} onRetry={hist.reload} /> : !hist.data ? <div className="fk-loading">{tx('pos.loading')}</div> : hist.data.items.length === 0 ? <Empty title={tx('tm.noChanges')} />
          : <table className="fk-table fn-table cg-table" data-testid="history-table"><thead><tr><th>{tx('tm.col.when')}</th><th>{tx('tm.col.change')}</th><th>{tx('tm.col.appointment')}</th><th className="t-opt">{tx('tm.col.by')}</th></tr></thead>
            <tbody>{hist.data.items.map((h: any) => <tr key={h.id} data-testid="history-row"><td>{whenTime(h.at)}</td><td>{apptStatus(h.changeType)}{h.field ? <span className="fk-li-s">{h.field}: {h.oldValue ?? '—'} → {h.newValue ?? '—'}</span> : null}</td>
              <td>{h.customer ?? '—'}<span className="fk-li-s">{h.technician ?? ''}{h.apptDate ? ` · ${h.apptDate} ${hm12(h.apptStart)}` : ''}</span></td><td className="t-opt">{h.actor ?? '—'}</td></tr>)}</tbody></table>}
      </FitPanel>

      {detail ? <AppointmentDialog a={detail} today={today} onClose={() => setDetail(null)} onDone={() => { setDetail(null); reload(); }} /> : null}
      {fullDay ? <FullDayOverlay technicianId={fullDay} date={day ?? today} today={today} canPay={can('technicians.view_pay')} onClose={() => setFullDay(null)} onAppt={(id) => { setFullDay(null); void openAppt(id); }} /> : null}
      {finder ? <QualifiedFinder today={today} onClose={() => setFinder(false)} /> : null}
    </div>
  );
}

/** Appointment / technician assignment details with the original actions (Check In · No-Show · Start · Assign ·
 *  Reschedule · Cancel). A reschedule is checked for conflicts first and explained; the server re-validates on save. */
function AppointmentDialog({ a, today, onClose, onDone }: { a: any; today: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [techSel, setTechSel] = useState(''); const [when, setWhen] = useState(`${a.date ?? today}T${String(a.startTime ?? '').slice(0, 5)}`); const [reason, setReason] = useState('');
  const [check, setCheck] = useState(false);
  const st = String(a.status || '').toLowerCase(); const booked = st === 'booked' || st === 'confirmed'; const arrived = st === 'checked_in' || st === 'arrived'; const waiting = st === 'waiting';
  const ver = a.version != null ? { expectedVersion: a.version } : {};
  const sids = (a.services ?? []).map((x: any) => x.serviceId).filter(Boolean);
  const act = async (kind: string, fn: () => Promise<unknown>) => { setBusy(kind); setErr(null); try { await fn(); onDone(); } catch (e) { setErr(bookingConflictText(e, tx('pos.action_failed'))); } finally { setBusy(null); } };
  return (
    <FitDialog wide title={`${a.customerName ?? '—'} · ${hm12(a.startTime)}`} subtitle={<><span className={'fk-chip ' + (TONE[st] ?? 'mut')}>{apptStatus(st)}</span> {(a.services ?? []).map((x: any) => x.serviceName || x.name).filter(Boolean).join(', ')} · {a.date}</>} onClose={onClose} busy={!!busy} testId="dlg-appointment"
      footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      <dl className="fk-dl mo-dl" data-testid="appt-overview">
        <dt>{tx('tm.col.when')}</dt><dd>{a.date} · {hm12(a.startTime)} – {hm12(a.endTime)} · {tx('cg.min', { n: nf(a.durationMinutes) })}</dd>
        <dt>{tx('tm.col.technician')}</dt><dd>{a.technicianName ?? '—'}</dd>
        <dt>{tx('tm.source')}</dt><dd>{codeLabel2(a.source)}</dd>
        {a.depositStatus && !['none', 'not_required'].includes(a.depositStatus) ? <><dt>{tx('tm.deposit')}</dt><dd>{codeLabel2(a.depositStatus)}</dd></> : null}
      </dl>
      <div className="cg-acts tm-acts">
        {booked ? <button type="button" className="fk-btn" disabled={!!busy} onClick={() => act('ci', () => posCheckInApi.appointmentCheckIn(a.appointmentId))} data-testid="act-check-in">{tx('pos.check_in')}</button> : null}
        {booked || arrived ? <button type="button" className="fk-btn ghost" disabled={!!busy} onClick={() => act('ns', () => posTechAppointmentsApi.noShow(a.appointmentId))} data-testid="act-no-show">{tx('pos.no_show_2')}</button> : null}
        {booked || arrived || waiting ? <button type="button" className="fk-btn ghost" disabled={!!busy} onClick={() => act('ss', () => posTechAppointmentsApi.startService(a.appointmentId))} data-testid="act-start">{tx('pos.start')}</button> : null}
      </div>
      {booked || arrived || waiting ? <>
        <h3 className="fk-h3">{tx('tm.change')}</h3>
        <div className="cg-form">
          <label className="fk-field">{tx('pos.choose_technician')}<TechnicianPickerButton value={techSel} emptyLabel={tx('pos.choose_technician')} ariaLabel={tx('pos.choose_technician')} date={a.date || today} serviceIds={sids} onChange={(id) => setTechSel(id)} style={{ maxWidth: '100%' }} /></label>
          <label className="fk-field">{tx('tm.newTime')}<input type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setCheck(false); }} data-testid="resched-when" /></label>
        </div>
        <div className="cg-acts">
          <button type="button" className="fk-btn ghost" disabled={!!busy} onClick={() => { if (!techSel) { setErr(tx('pos.pick_a_technician_to_assign')); return; } void act('assign', () => posTechAppointmentsApi.assignTechnician(a.appointmentId, { technicianId: techSel, ...ver })); }} data-testid="act-assign">{tx('pos.assign')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setCheck(true)} data-testid="act-check-conflict">{tx('tm.checkFirst')}</button>
          <button type="button" className="fk-btn" disabled={!!busy || !when} onClick={() => act('resch', () => posTechAppointmentsApi.reschedule(a.appointmentId, { startTime: when.slice(11, 16), date: when.slice(0, 10), ...(techSel ? { technicianId: techSel } : {}), ...ver }))} data-testid="act-reschedule">{tx('pos.reschedule')}</button>
        </div>
        {check ? <ConflictPanel key={when + techSel} initialName={techSel ? undefined : a.technicianName} today={today} testId="dlg-conflict" initial={{ technicianId: techSel || a.technicianId, date: when.slice(0, 10), start: when.slice(11, 16), minutes: a.durationMinutes, appointmentId: a.appointmentId, serviceIds: sids }} /> : null}
        <label className="fk-field wide">{tx('pos.cancel_reason_3')}<input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cancel-reason" /></label>
        <div className="cg-acts"><button type="button" className="fk-btn danger" disabled={!!busy} onClick={() => { if (!reason.trim()) { setErr(tx('pos.a_reason_is_required_to_cancel')); return; } void act('cancel', () => posTechAppointmentsApi.cancel(a.appointmentId, { reason: reason.trim() })); }} data-testid="act-cancel">{tx('pos.cancel_appointment')}</button></div>
      </> : null}
      {err ? <div className="fk-note bad" role="alert" data-testid="appt-error"><span>{err}</span></div> : null}
    </FitDialog>
  );
}
const codeLabel2 = (c?: string | null) => (c ? apptStatus(c) : '—');
