// POSLiveTechnicianScheduleScreen.tsx — Team → Live Technician Schedule (/technicians/schedule). Rebuild (Oct 30 2026), one
// vertical scroll, every module of the photographed screen kept (search · date · Today · Day / Week · All Status · All Skills ·
// the six KPIs · every technician with avatar, status, shift and openings · the selected-technician panel):
//   A header — last updated + Refresh, Find Next Available, Open Booking, Tech Queue
//   B toolbar — ONE search (technician name / phone / skill and customer name / phone / appointment id, from the server),
//     date ‹ › Today, Day / Week, status, skills, 12 technicians a page
//   C the six KPIs for the chosen salon day, each with its definition; live counts only for today (a past day never says
//     "Available Now"); utilization N/A when nothing is scheduled
//   D the board — Day: technician rows on a 15-minute time axis, true-length bars (shift, appointments, break, blocked,
//     open slots, now marker on today); Week: seven days per technician, a cell opens that day
//   E selected technician + Find Next Available Technician (the booking engine's openings for a real service)
//   F Schedule Conflict Warning (every cause, alternatives) — never books or moves anything itself
//   G Schedule activity — booking changes, status, breaks, time off, blocked time, weekly hours — newest first, own period
//   H the full-day overlay (Close / Esc): shift, every appointment, breaks, blocked time, gaps, next opening, pay only with
//     pay access (redacted by the server too), and the authorized actions: Start / End Break, Block Time, Weekly Hours
//     (impact on booked appointments shown BEFORE saving; nothing is moved), Profile, Appointments, iPad view, History.
//   I F4 (Finish the Five, Oct 30 2026): Edit Shift for Selected Date (dateShiftEditor.tsx) — a one-date override with a month
//     calendar, baseline vs effective side by side and a server conflict check; the weekly template is never changed.
// The board is the canonical /pos/technicians/live-schedule/* (the same ledger as Booking, Tech Appointments and the Queue).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtime } from '../realtime/useRealtime';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posLiveTechnicianScheduleApi as api } from '../api/posLiveTechnicianScheduleApi';
import { posLiveScheduleScreenApi, posTechniciansScreenApi } from '../api/posTeamScreensApi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { useCan } from '../components/usePermissions';
import { useIPadView } from '../components/IPadViewProvider';
import { techScheduleRequest } from '../components/ipad-modules';
import type { TechScheduleData } from '../components/TechnicianSchedulePreview';
import { FitPanel, KpiCard, Pager, Empty, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { codeLabel } from '../components/peopleLabels';
import { TechTimeline, FullDayOverlay, ConflictPanel, nf, hm12, addDay, apptStatus, liveStatus, liveTone } from './teamShared';
import { QualifiedFinder, pageOf, whenTime } from './technicianScreenParts';
import { fmtYmd } from '../i18n/format';
import { DateShiftEditor } from './dateShiftEditor';

/** 200-technician §2: technician rows a page */
export const LS_LANE_PAGE_SIZE = 12;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const dowOf = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay();
const dayLabel = (ymd: string) => fmtYmd(ymd, { weekday: 'short', month: 'numeric', day: 'numeric' }, ymd);
/** the browser's calendar day — only until the server has said which day the salon is on */
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const clockNow = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function POSLiveTechnicianScheduleScreen() {
  const nav = useNavigate(); const can = useCan();
  const [date, setDate] = useState<string | null>(null);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [status, setStatus] = useState(''); const [skill, setSkill] = useState('');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 250);
  const [lanePage, setLanePage] = useState(1);
  const [tick, setTick] = useState(0); const [updated, setUpdated] = useState(clockNow());
  const reload = useCallback(() => { setTick((n) => n + 1); setUpdated(clockNow()); }, []);
  const [sel, setSel] = useState<string | null>(null); const [fullDay, setFullDay] = useState<{ id: string; date: string } | null>(null); const [finder, setFinder] = useState(false);
  const [aPeriod, setAPeriod] = useState<PeriodState>({ preset: 'week' }); const [aKind, setAKind] = useState('all'); const [aSearch, setASearch] = useState(''); const aq = useDebounced(aSearch.trim(), 300); const [ap, setAp] = useState(1);
  useEffect(() => setLanePage(1), [q, status, skill, view]);
  useRealtime(['booking', 'tech-appointments', 'technicians'], reload);   // technician_schedule_updated (weekly hours, time off, F4 date shifts) reaches the 'technicians' channel

  const kp = useLoad(() => posLiveScheduleScreenApi.kpis({ date: date ?? undefined }), [date, tick]);
  const day = date ?? kp.data?.date ?? (kp.data || kp.error ? localToday() : null); const today = kp.data?.today ?? (kp.data || kp.error ? localToday() : day ?? '');
  // "#n" / a name pages the board; the same words also search every record of the salon (technicians and appointments)
  const lane = q.startsWith('#') || q.length >= 2 ? q : '';
  const paging = { lanePage, lanePageSize: LS_LANE_PAGE_SIZE, laneSearch: lane || undefined, roster: 'none' as const };
  const st = useLoad(() => (day ? api.state({ date: day, view: 'day', status, skill, ...paging }) : Promise.resolve(null)), [day, status, skill, lanePage, lane, tick]);
  const wk = useLoad(() => (view === 'week' && day ? api.week({ date: day, status, skill, ...paging }) : Promise.resolve(null)), [view, day, status, skill, lanePage, lane, tick]);
  const found = useLoad(() => (q.length >= 2 && !q.startsWith('#') ? posLiveScheduleScreenApi.search({ q }) : Promise.resolve(null)), [q]);
  const act = useLoad(() => posLiveScheduleScreenApi.activity({ ...periodQuery(aPeriod), kind: aKind, q: aq || undefined, page: ap, pageSize: 8 }), [JSON.stringify(aPeriod), aKind, aq, ap, tick]);
  useEffect(() => setAp(1), [aq, aKind]);
  const roster = useLoad(() => posTechniciansScreenApi.directory({ status: 'active', sort: 'name', pageSize: 100 }), [tick]);
  const techs: { technicianId: string; name: string }[] = (roster.data?.items ?? []).map((t: any) => ({ technicianId: t.technicianId, name: t.name }));

  const s: any = st.data; const cols: any[] = s?.schedule?.technicians ?? [];
  const lanes = (view === 'week' ? wk.data?.lanes : undefined) ?? s?.schedule?.lanes;
  const k = kp.data?.kpis; const live = kp.data?.when === 'today';
  const selCol = cols.find((c) => c.technicianId === sel) ?? null;
  const openDay = (id: string, d?: string) => { setSel(id); setFullDay({ id, date: d ?? day ?? today }); };
  const na = (v: number | null | undefined) => (v == null ? '—' : nf(v));

  if (isForbidden(kp.error)) return <div className="work mos lts" data-testid="live-schedule-screen"><h1>{tx('pos.live_technician_schedule')}</h1><StateBlock error={kp.error} onRetry={kp.reload} /></div>;
  return (
    <div className="work mos lts" data-testid="live-schedule-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.live_technician_schedule')}</h1><div className="sub">{tx('ls.sub')}</div></div>
        <div className="fk-head-actions">
          <span className="fk-hint" data-testid="updated"><span className="ls-live" aria-hidden="true" />{tx('ls.updated', { t: hm12(updated) })}</span>
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setFinder(true)} data-testid="open-finder">{tx('tm.findNext')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/booking')} data-testid="open-booking">{tx('ls.openBooking')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/tech-queue')} data-testid="open-queue">{tx('ls.techQueue')}</button>
        </div>
      </header>

      <div className="mos-tools ls-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('ls.searchPh')} aria-label={tx('pos.find_technician')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
        <button type="button" className="fk-btn ghost" onClick={() => day && setDate(addDay(day, -1))} aria-label={tx('tm.prevDay')} data-testid="prev-day">‹</button>
        <input type="date" className="fk-select" value={day ?? ''} onChange={(e) => setDate(e.target.value || null)} aria-label={tx('tm.date')} data-testid="day" />
        <button type="button" className="fk-btn ghost" onClick={() => day && setDate(addDay(day, 1))} aria-label={tx('tm.nextDay')} data-testid="next-day">›</button>
        <button type="button" className="fk-btn ghost" onClick={() => setDate(null)} disabled={!date || date === today} data-testid="to-today">{tx('pos.today_2')}</button>
        <div className="fk-seg" aria-label={tx('tm.board')}>{(['day', 'week'] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={'view-' + v}>{tx('tm.view.' + v)}</button>)}</div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status"><option value="">{tx('pos.all_status')}</option>{(s?.filters?.statuses ?? []).map((o: any) => <option key={o.value} value={o.value}>{liveStatus(o.value)}</option>)}</select>
        <select className="fk-select" value={skill} onChange={(e) => setSkill(e.target.value)} aria-label={tx('ls.skill')} data-testid="skill"><option value="">{tx('pos.all_skills')}</option>{(s?.filters?.skills ?? []).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        {lanes ? <span className="tm-lanepager" data-testid="live-schedule-pager">
          <span className="fk-muted">{tx('pos.n_technicians', { n: String(lanes.total) })}</span>
          {lanes.totalPages > 1 ? <>
            <button type="button" className="fk-btn ghost sm" disabled={lanes.page <= 1} onClick={() => setLanePage(Math.max(1, lanes.page - 1))}>{tx('pos.previous')}</button>
            <span>{tx('pos.page_x_of_y', { page: String(lanes.page), pages: String(lanes.totalPages) })}</span>
            <button type="button" className="fk-btn ghost sm" disabled={lanes.page >= lanes.totalPages} onClick={() => setLanePage(Math.min(lanes.totalPages, lanes.page + 1))}>{tx('pos.next')}</button></> : null}
        </span> : null}
      </div>

      {found.data ? <FitPanel testId="search-results" title={tx('ls.results', { q: found.data.q })} actions={<button type="button" className="fk-link" onClick={() => setSearch('')}>{tx('finance.clearSearch')}</button>}>
        {found.data.technicians.totalItems + found.data.appointments.totalItems === 0 ? <Empty title={tx('cg.noMatchSearch', { q: found.data.q })} /> : <div className="mos-row two cg-row">
          <div><h3 className="fk-h3">{tx('ls.resTechs', { n: nf(found.data.technicians.totalItems) })}</h3>
            <ul className="fk-list dense">{found.data.technicians.items.map((t: any) => <li key={t.technicianId} className="fk-li"><button type="button" className="ls-hit" onClick={() => openDay(t.technicianId)} data-testid="hit-tech">
              <ProfileAvatarWithPreview name={t.name} url={t.avatarUrl} size={28} type="technician" /><span className="fk-li-t">{t.name}<span className="fk-li-s">{t.shiftToday ?? tx('tm.noShift')}{t.matchedVia ? ` · ${codeLabel('tc.via.' + t.matchedVia, t.matchedVia)}` : ''}</span></span></button></li>)}</ul></div>
          <div><h3 className="fk-h3">{tx('ls.resAppts', { n: nf(found.data.appointments.totalItems) })}</h3>
            <ul className="fk-list dense">{found.data.appointments.items.map((a: any) => <li key={a.appointmentId} className="fk-li"><button type="button" className="ls-hit" disabled={!a.technicianId} onClick={() => a.technicianId && openDay(a.technicianId, a.date ?? undefined)} data-testid="hit-appt">
              <span className="fk-li-t">{a.customer ?? '—'} · {a.date} {hm12(a.start)}<span className="fk-li-s">{(a.services ?? []).join(', ')} · {a.technician ?? tx('tm.anyTech')} · {apptStatus(a.status)}{a.phone ? ` · ${a.phone}` : ''}</span></span></button></li>)}</ul></div>
        </div>}
      </FitPanel> : null}

      <div className="fk-kpis six cg-kpis" data-testid="kpis">
        {kp.error ? <StateBlock error={kp.error} onRetry={kp.reload} /> : <>
          <KpiCard testId="kpi-working" label={tx('pos.working_today')} loading={!k} value={k ? nf(k.workingToday) : ''} sub={k && live ? tx('ls.k.workingLive', { n: nf(k.clockedIn) }) : tx('ls.k.working')} onClick={() => { setStatus(''); document.querySelector('[data-testid="board"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
          <KpiCard testId="kpi-available" tone={k && live && k.availableNow ? 'ok' : undefined} label={tx('pos.available_now_3')} loading={!k} value={k ? na(k.availableNow) : ''} sub={live ? tx('ls.k.available') : tx('ls.k.notLive')} onClick={live ? () => setStatus('available') : undefined} />
          <KpiCard testId="kpi-in-service" label={tx('pos.in_service_3')} loading={!k} value={k ? na(k.inService) : ''} sub={live ? tx('ls.k.inService') : tx('ls.k.notLive')} onClick={live ? () => setStatus('in_service') : undefined} />
          <KpiCard testId="kpi-break" tone={k && live && k.onBreak ? 'warn' : undefined} label={tx('pos.on_break_lunch')} loading={!k} value={k ? na(k.onBreak) : ''} sub={live ? tx('ls.k.break') : tx('ls.k.notLive')} onClick={live ? () => setStatus('on_break') : undefined} />
          <KpiCard testId="kpi-booked" label={tx('pos.booked_hours')} loading={!k} value={k ? tx('ls.hours', { n: String(k.bookedHours) }) : ''} sub={k ? tx('ls.k.booked', { n: nf(k.appointments) }) : ''} />
          <KpiCard testId="kpi-utilization" label={tx('pos.utilization')} loading={!k} value={k ? (k.utilizationPercent == null ? tx('ls.na') : `${k.utilizationPercent}%`) : ''}
            sub={k ? (k.utilizationPercent == null ? tx('ls.k.utilNone') : tx(k.utilizationBasis === 'booked' ? 'ls.k.utilPast' : 'ls.k.utilForecast', { b: nf(k.bookedMinutes), s: nf(k.scheduledMinutes) })) : ''} />
        </>}
      </div>
      {k && !live ? <div className="fk-note info" data-testid="not-live"><span>{tx(kp.data.when === 'past' ? 'ls.pastDay' : 'ls.futureDay', { d: day ?? '' })}</span></div> : null}

      <FitPanel testId="board" title={<>{tx('tm.board')} · {day ? dayLabel(day) : ''}</>}>
        {view === 'day' ? (st.error ? <StateBlock error={st.error} onRetry={st.reload} /> : !s ? <div className="fk-loading">{tx('pos.loading')}</div>
          : cols.length === 0 ? <Empty title={tx('pos.no_technicians_scheduled_today')}><button type="button" className="fk-btn" onClick={() => nav('/technicians')}>{tx('pos.add_technician_create_shift')}</button></Empty>
          : <TechTimeline rows={cols.map((c) => ({ technicianId: c.technicianId, name: c.fullName, status: c.status, shift: c.shift ?? null, appointments: c.appointments ?? [], blocks: c.blocks ?? [], openSlots: c.openSlots ?? [] }))}
              onTech={(id) => openDay(id)} onAppt={(aid) => { const c = cols.find((x) => (x.appointments ?? []).some((a: any) => a.appointmentId === aid)); if (c) openDay(c.technicianId); }} nowMinute={live ? kp.data?.nowMinute ?? null : null} />)
          : wk.error ? <StateBlock error={wk.error} onRetry={wk.reload} /> : !wk.data ? <div className="fk-loading">{tx('pos.loading_the_week')}</div>
          : <WeekGrid week={wk.data} selected={day ?? ''} today={today} onPick={(d) => { setDate(d); setView('day'); }} onTech={(id, d) => openDay(id, d)} />}
        <div className="fk-hint">{tx('ls.boardRule')}</div>
      </FitPanel>

      <div className="mos-row two cg-row">
        <FitPanel testId="selected" title={tx('ls.selected')}>
          {!selCol ? <p className="fk-hint" data-testid="select-prompt">{tx('pos.select_a_technician_to_see_their_1ja8')}</p> : <div data-testid="selected-card">
            <div className="tm-card-h"><ProfileAvatarWithPreview name={selCol.fullName} url={selCol.avatarUrl} size={40} type="technician" /><span><b>{selCol.fullName}</b><span className={'fk-chip ' + liveTone(selCol.status)}>{liveStatus(selCol.status)}</span></span></div>
            <dl className="fk-dl mo-dl">
              <dt>{tx('tm.shift')}</dt><dd>{selCol.shift ? `${hm12(selCol.shift.startTime)} – ${hm12(selCol.shift.endTime)}` : tx('tm.noShift')}</dd>
              <dt>{tx('tm.next')}</dt><dd>{(() => { const n = (selCol.appointments ?? []).find((a: any) => !['cancelled', 'no_show', 'completed'].includes(a.status)); return n ? `${hm12(n.startTime)} · ${n.serviceSummary ?? ''}` : tx('tm.none'); })()}</dd>
              <dt>{tx('tm.nextOpen')}</dt><dd>{selCol.openSlots?.[0] ? `${hm12(selCol.openSlots[0].startTime)} – ${hm12(selCol.openSlots[0].endTime)}` : tx('tm.none')}</dd>
              <dt>{tx('pos.skills')}</dt><dd>{(selCol.skills ?? []).join(' · ') || tx('tm.noSkills')}</dd>
            </dl>
            <div className="cg-acts"><button type="button" className="fk-btn primary" onClick={() => openDay(selCol.technicianId)} data-testid="selected-open">{tx('tm.viewFullDay')}</button></div>
          </div>}
        </FitPanel>
        <FitPanel testId="next-available" title={tx('tm.findNext')}><p className="fk-hint">{tx('tm.findNextSub')}</p><button type="button" className="fk-btn primary" onClick={() => setFinder(true)} data-testid="cta-finder">{tx('tm.findNext')}</button></FitPanel>
      </div>

      <FitPanel testId="conflict-warning" title={tx('tm.conflictTitle')}><ConflictPanel techs={techs} today={today} /></FitPanel>

      <FitPanel testId="activity" title={<>{tx('ls.activity')}{act.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(act.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(act.data)} onPage={setAp} label={tx('ls.activity')} />}>
        <div className="mos-tools">
          <div className="fn-search mos-search"><input className="fk-search" type="search" value={aSearch} onChange={(e) => setASearch(e.target.value)} placeholder={tx('ls.activityPh')} aria-label={tx('ls.activityPh')} data-testid="activity-search" /></div>
          <select className="fk-select" value={aKind} onChange={(e) => setAKind(e.target.value)} aria-label={tx('ls.kind')} data-testid="activity-kind">{['all', 'booking', 'status', 'break', 'time_off', 'blocked', 'schedule'].map((x) => <option key={x} value={x}>{tx('ls.kindF.' + x)}</option>)}</select>
        </div>
        <PeriodBar value={aPeriod} onChange={(p) => { setAPeriod(p); setAp(1); }} server={act.data?.period} allowAll compact />
        <ActivityTable a={act} />
      </FitPanel>

      {fullDay ? <FullDayOverlay key={fullDay.id + fullDay.date} technicianId={fullDay.id} date={fullDay.date} today={today} canPay={can('technicians.view_pay')} onClose={() => setFullDay(null)}>
        {(x, d, again) => <DayActions x={x} date={d} today={today} onChanged={() => { again(); reload(); }} />}
      </FullDayOverlay> : null}
      {finder ? <QualifiedFinder today={today} onClose={() => setFinder(false)} /> : null}
    </div>
  );
}

function ActivityTable({ a }: { a: { data: any; error: unknown; reload: () => void } }) {
  if (a.error) return <StateBlock error={a.error} onRetry={a.reload} />;
  if (!a.data) return <div className="fk-loading">{tx('pos.loading')}</div>;
  if (a.data.items.length === 0) return <Empty title={tx('ls.noActivity')} />;
  return <table className="fk-table fn-table cg-table" data-testid="activity-table"><thead><tr><th>{tx('tm.col.when')}</th><th>{tx('tm.col.technician')}</th><th>{tx('tm.col.change')}</th><th className="t-opt">{tx('tm.col.by')}</th></tr></thead>
    <tbody>{a.data.items.map((h: any) => <tr key={h.kind + h.id} data-testid="activity-row"><td>{whenTime(h.at)}</td><td>{h.technician ?? '—'}</td>
      <td><span className={'fk-chip ls-k-' + h.kind}>{tx('ls.kindF.' + h.kind)}</span> {codeLabel('ls.act.' + h.action, h.action)}<span className="fk-li-s">{activityDetail(h)}</span></td><td className="t-opt">{h.actor ?? '—'}</td></tr>)}</tbody></table>;
}
const activityDetail = (h: any) => {
  if (h.kind === 'booking') return `${h.subject ?? ''}${h.onDate ? ` · ${h.onDate} ${hm12(h.atTime)}` : ''}${h.field ? ` · ${h.oldValue ?? '—'} → ${h.newValue ?? '—'}` : ''}`;
  if (h.kind === 'status') return `${liveStatus(h.oldValue ?? '')} → ${liveStatus(h.newValue ?? '')}${h.subject ? ` · ${h.subject}` : ''}`;
  if (h.kind === 'blocked') return `${h.onDate ?? ''} ${hm12(h.oldValue)} – ${hm12(h.newValue)}${h.subject ? ` · ${h.subject}` : ''}`;
  if (h.kind === 'schedule') return `${tx('ls.dow.' + (DAYS[Number(h.field)] ?? 'sunday'))}${h.action === 'weekly_hours' ? ` · ${hm12(h.oldValue)} – ${hm12(h.newValue)}` : ''}`;
  if (h.kind === 'break' || h.kind === 'time_off') return `${h.oldValue ? whenTime(h.oldValue) : ''}${h.newValue ? ` – ${whenTime(h.newValue)}` : ''}${h.subject ? ` · ${h.subject}` : ''}`;
  return h.subject ?? '';
};

/** Week view: technicians × seven salon-local days (shift or Off, appointments, booked hours); a cell opens that day */
function WeekGrid({ week, selected, today, onPick, onTech }: { week: any; selected: string; today: string; onPick: (d: string) => void; onTech: (id: string, d: string) => void }) {
  const names = new Map<string, { fullName: string; avatarUrl?: string }>();
  for (const d of week.days ?? []) for (const t of d.board?.technicians ?? []) if (!names.has(t.technicianId)) names.set(t.technicianId, { fullName: t.fullName, avatarUrl: t.avatarUrl });
  const rows = [...names.entries()].sort((a, b) => a[1].fullName.localeCompare(b[1].fullName));
  if (!rows.length) return <Empty title={tx('pos.no_technicians_scheduled_this_week')} />;
  return (
    <div className="ls-week" aria-label={tx('pos.week_schedule')} data-testid="week-table">
      <table className="fk-table fn-table cg-table tm-week"><thead><tr><th>{tx('tm.col.technician')}</th>{week.days.map((d: any) => <th key={d.date} className={(d.date === today ? 'tm-today ' : '') + (d.date === selected ? 'ls-sel' : '')}><button type="button" className="fk-link" onClick={() => onPick(d.date)}>{dayLabel(d.date)}</button></th>)}</tr></thead>
        <tbody>{rows.map(([tid, n]) => <tr key={tid}><td><span className="ls-wname">{n.fullName}</span></td>{week.days.map((d: any) => {
          const c = (d.board?.technicians ?? []).find((t: any) => t.technicianId === tid);
          const appts = (c?.appointments ?? []).filter((a: any) => a.status !== 'cancelled' && a.status !== 'no_show').length;
          return <td key={d.date}><button type="button" className={'tm-cell' + (c?.shift ? ' on' : '')} onClick={() => onTech(tid, d.date)} title={tx('ls.openDay')}>
            {c?.shift ? <><b>{hm12(c.shift.startTime)}–{hm12(c.shift.endTime)}</b><span className="fk-li-s">{tx('ls.weekCell', { n: nf(appts), h: String(c.bookedHours ?? 0) })}</span>{c.blocks?.length ? <span className="fk-li-s bad">{tx('ls.blockedN', { n: nf(c.blocks.length) })}</span> : null}</> : <span className="fk-muted">{tx('pos.off')}</span>}
          </button></td>; })}</tr>)}</tbody></table>
    </div>
  );
}

/** the overlay's authorized actions and history for ONE technician on the shown day */
function DayActions({ x, date, today, onChanged }: { x: any; date: string; today: string; onChanged: () => void }) {
  const nav = useNavigate(); const can = useCan(); const { open: openIPad } = useIPadView();
  const [tab, setTab] = useState<'actions' | 'hours' | 'history'>('actions');
  const [busy, setBusy] = useState(false); const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [bs, setBs] = useState('13:00'); const [be, setBe] = useState('14:00'); const [reason, setReason] = useState('temporary_unavailable');
  const [walkIn, setWalkIn] = useState<any | null>(null); const [walkName, setWalkName] = useState(''); const [dateEdit, setDateEdit] = useState(false);
  const edit = can('technicians.edit'); const isToday = date === today;
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setNote(null); try { await fn(); setNote({ ok: true, text: ok }); onChanged(); } catch (e: any) { setNote({ ok: false, text: e?.message || tx('pos.action_failed') }); } finally { setBusy(false); } };
  const hist = useLoad(() => (tab === 'history' ? posLiveScheduleScreenApi.activity({ technicianId: x.technicianId, preset: 'month', pageSize: 6 }) : Promise.resolve(null)), [tab, x.technicianId]);
  const onBreak = x.status === 'on_break' || x.status === 'lunch';
  return (
    <div className="ls-actions" data-testid="day-actions">
      <div className="fk-seg" role="tablist" aria-label={tx('ls.manage')}>{(['actions', 'hours', 'history'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={'tab-' + t}>{tx('ls.tab.' + t)}</button>)}</div>
      {note ? <div className={'fk-note ' + (note.ok ? 'ok' : 'bad')} role="status" data-testid="action-note"><span>{note.text}</span></div> : null}
      {tab === 'actions' ? <>
        <div className="cg-acts">
          {edit && isToday ? (onBreak
            ? <button type="button" className="fk-btn" disabled={busy} onClick={() => run(() => api.endBreak(x.technicianId), tx('ops.liveSchedule.ok.breakEnded'))} data-testid="end-break">{tx('pos.end_break')}</button>
            : <button type="button" className="fk-btn" disabled={busy || x.status === 'off_shift'} onClick={() => run(() => api.startBreak(x.technicianId, { managerOverride: x.status === 'in_service' }), tx('ops.liveSchedule.ok.breakStarted'))} data-testid="start-break">{tx('pos.start_break')}</button>) : null}
          <button type="button" className="fk-btn ghost" onClick={() => nav(`/technicians/${encodeURIComponent(x.technicianId)}`)} data-testid="open-profile">{tx('ls.profile')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/tech-appointments')} data-testid="open-appointments">{tx('ls.appointments')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => openIPad(techScheduleRequest(x as TechScheduleData, date))} data-testid="open-ipad">{tx('pos.full_view')}</button>
          <button type="button" className="fk-btn" onClick={() => setDateEdit(true)} data-testid="edit-date-shift">{tx('so.open')}</button>
        </div>
        {x.status === 'in_service' && edit && isToday ? <p className="fk-hint">{tx('pos.in_an_active_service_starting_a_lh5t')}</p> : null}
        {(x.openSlots ?? []).length ? <><h3 className="fk-h3">{tx('ls.openings')}</h3><ul className="fk-list dense" data-testid="openings">{x.openSlots.slice(0, 6).map((o: any) => <li key={o.slotId} className="fk-li">
          <span className="fk-li-t">{hm12(o.startTime)} – {hm12(o.endTime)}<span className="fk-li-s">{tx('cg.min', { n: nf(o.durationMinutes) })}</span></span>
          <button type="button" className="fk-btn ghost sm" onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(x.technicianId)}&date=${date}&time=${encodeURIComponent(o.startTime)}`)} data-testid="book-opening">{tx('ls.book')}</button>
          {can('booking.manage') && isToday ? <button type="button" className="fk-btn ghost sm" onClick={() => { setWalkIn(o); setWalkName(''); }} data-testid="walk-in-opening">{tx('ls.walkIn')}</button> : null}</li>)}</ul></> : null}
        {walkIn ? <div className="cg-form" data-testid="walk-in-form"><label className="fk-field">{tx('pos.customer_name_2')}<input value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder={tx('pos.walk_in_2')} data-testid="walk-in-name" /></label>
          <div className="cg-acts"><button type="button" className="fk-btn primary" disabled={busy} onClick={() => run(() => api.bookOpenSlot(walkIn.slotId, { customerName: walkName.trim() || tx('pos.walk_in_2'), serviceSummary: tx('pos.service_3'), durationMinutes: walkIn.durationMinutes }), tx('ops.liveSchedule.ok.slotBooked')).then(() => setWalkIn(null))} data-testid="walk-in-save">{tx('pos.book')}</button>
            <button type="button" className="fk-btn ghost" onClick={() => setWalkIn(null)}>{tx('pos.cancel')}</button></div></div> : null}
        {edit ? <><h3 className="fk-h3">{tx('pos.block_time_on')} {date}</h3>
          <div className="cg-form four">
            <label className="fk-field">{tx('tm.start')}<input type="time" step={900} value={bs} onChange={(e) => setBs(e.target.value)} data-testid="block-start" /></label>
            <label className="fk-field">{tx('ls.end')}<input type="time" step={900} value={be} onChange={(e) => setBe(e.target.value)} data-testid="block-end" /></label>
            <label className="fk-field">{tx('ls.reason')}<select value={reason} onChange={(e) => setReason(e.target.value)} data-testid="block-reason">{['temporary_unavailable', 'vacation', 'sick_leave', 'other'].map((r) => <option key={r} value={r}>{tx('ls.reasonF.' + r)}</option>)}</select></label>
          </div>
          <div className="cg-acts"><button type="button" className="fk-btn" disabled={busy || !bs || !be || be <= bs} onClick={() => run(() => api.blockTime(x.technicianId, { date, startTime: bs, endTime: be, reason }), tx('ops.liveSchedule.ok.timeBlocked'))} data-testid="block-save">{tx('pos.save_block_2')}</button></div>
          <p className="fk-hint">{tx('ls.blockRule')}</p></> : null}
      </> : tab === 'hours' ? <WeeklyHours technicianId={x.technicianId} date={date} canEdit={edit} onSaved={onChanged} />
      : hist.error ? <StateBlock error={hist.error} onRetry={hist.reload} /> : <ActivityTable a={hist} />}
      {dateEdit ? <DateShiftEditor technicianId={x.technicianId} technicianName={x.fullName ?? ''} initialDate={date} today={today} canEdit={can('pos.technicians.schedule.edit') || edit} onClose={() => setDateEdit(false)} onSaved={onChanged} /> : null}
    </div>
  );
}

/** Weekly working hours for the weekday of the shown date. Before saving, the booked appointments the new hours would
 *  leave outside the shift or in lunch are listed; saving never moves or cancels them (the salon decides each one). */
function WeeklyHours({ technicianId, date, canEdit, onSaved }: { technicianId: string; date: string; canEdit: boolean; onSaved: () => void }) {
  const dow = dowOf(date); const key = DAYS[dow]!;
  const sch = useLoad(() => posTechniciansApi.schedule(technicianId), [technicianId]);
  const cur = sch.data?.weekly?.[key];
  const [f, setF] = useState<{ working: boolean; start: string; end: string; ls: string; le: string } | null>(null);
  useEffect(() => { if (sch.data) setF({ working: !!cur?.isWorking, start: cur?.startTime?.slice(0, 5) ?? '09:00', end: cur?.endTime?.slice(0, 5) ?? '17:00', ls: cur?.lunchStart?.slice(0, 5) ?? '', le: cur?.lunchEnd?.slice(0, 5) ?? '' }); }, [sch.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [impact, setImpact] = useState<any | null>(null); const [ack, setAck] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const change = (p: Partial<NonNullable<typeof f>>) => { setF((o) => (o ? { ...o, ...p } : o)); setImpact(null); setAck(false); setMsg(null); };
  if (sch.error) return <StateBlock error={sch.error} onRetry={sch.reload} />;
  if (!f) return <div className="fk-loading">{tx('pos.loading')}</div>;
  const valid = !f.working || (f.start < f.end && (!f.ls || !f.le || (f.ls < f.le && f.ls >= f.start && f.le <= f.end)));
  const check = async () => { setBusy(true); setMsg(null); try { setImpact(await posLiveScheduleScreenApi.shiftImpact({ technicianId, dow, working: f.working, start: f.start, end: f.end, lunchStart: f.ls || undefined, lunchEnd: f.le || undefined })); } catch (e: any) { setMsg({ ok: false, text: e?.message || tx('pos.action_failed') }); } finally { setBusy(false); } };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const weekly = { ...(sch.data?.weekly ?? {}), [key]: { ...(cur ?? {}), isWorking: f.working, startTime: f.start, endTime: f.end, ...(f.ls && f.le ? { lunchStart: f.ls, lunchEnd: f.le } : { lunchStart: undefined, lunchEnd: undefined }) } };
      await posTechniciansApi.setSchedule(technicianId, { weekly, expectedVersion: sch.data?.version ?? 0 });
      setMsg({ ok: true, text: tx('ls.hoursSaved', { d: tx('ls.dow.' + key) }) }); setImpact(null); setAck(false); sch.reload(); onSaved();
    } catch (e: any) { setMsg({ ok: false, text: e?.status === 409 ? tx('ls.hoursRace') : e?.message || tx('pos.action_failed') }); }
    finally { setBusy(false); }
  };
  return (
    <div data-testid="weekly-hours">
      <p className="fk-hint">{tx('ls.hoursRule', { d: tx('ls.dow.' + key) })}</p>
      <div className="cg-form four">
        <label className="fk-field">{tx('ls.working')}<select value={f.working ? '1' : '0'} disabled={!canEdit} onChange={(e) => change({ working: e.target.value === '1' })} data-testid="wh-working"><option value="1">{tx('ls.workingYes')}</option><option value="0">{tx('pos.off')}</option></select></label>
        <label className="fk-field">{tx('tm.start')}<input type="time" step={900} value={f.start} disabled={!canEdit || !f.working} onChange={(e) => change({ start: e.target.value })} data-testid="wh-start" /></label>
        <label className="fk-field">{tx('ls.end')}<input type="time" step={900} value={f.end} disabled={!canEdit || !f.working} onChange={(e) => change({ end: e.target.value })} data-testid="wh-end" /></label>
        <span />
        <label className="fk-field">{tx('ls.lunchStart')}<input type="time" step={900} value={f.ls} disabled={!canEdit || !f.working} onChange={(e) => change({ ls: e.target.value })} data-testid="wh-ls" /></label>
        <label className="fk-field">{tx('ls.lunchEnd')}<input type="time" step={900} value={f.le} disabled={!canEdit || !f.working} onChange={(e) => change({ le: e.target.value })} data-testid="wh-le" /></label>
      </div>
      {!valid ? <div className="fk-note bad" role="alert"><span>{tx('ls.hoursInvalid')}</span></div> : null}
      {canEdit ? <div className="cg-acts">
        <button type="button" className="fk-btn" disabled={busy || !valid} onClick={check} data-testid="wh-check">{tx('ls.checkImpact')}</button>
        <button type="button" className="fk-btn primary" disabled={busy || !valid || !impact || (impact.affected > 0 && !ack)} onClick={save} data-testid="wh-save">{tx('ls.saveHours')}</button>
      </div> : <p className="fk-hint">{tx('ls.noEdit')}</p>}
      {impact ? (impact.affected === 0 ? <div className="fk-note ok" data-testid="wh-impact-none"><span>{tx('ls.noImpact', { n: nf(impact.days) })}</span></div>
        : <div className="fk-note warn" data-testid="wh-impact"><span><b>{tx('ls.impact', { n: nf(impact.affected) })}</b>
          <ul className="tm-reasons">{impact.items.slice(0, 8).map((i: any) => <li key={i.appointmentId}>{i.date} {hm12(i.start)} · {i.customer ?? '—'} · {tx('ls.why.' + i.reason)}</li>)}</ul>
          <label className="ls-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="wh-ack" /> {tx('ls.ack')}</label></span></div>) : null}
      {msg ? <div className={'fk-note ' + (msg.ok ? 'ok' : 'bad')} role="status" data-testid="wh-msg"><span>{msg.text}</span></div> : null}
    </div>
  );
}
