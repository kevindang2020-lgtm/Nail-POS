// teamShared.tsx — pieces shared by Tech Appointments and the Live Technician Schedule (Oct 30 2026):
//   TechTimeline     technician rows on a time axis with 15-minute grid marks; bars are the TRUE duration of each
//                    appointment, the shift window, the planned break, blocked time and open slots (never rounded)
//   FullDayOverlay   one technician's whole day (shift · every appointment · breaks · blocked time · gaps · the next
//                    continuous free opening), adjacent days, Close / Esc — read from the live-schedule detail
//   ConflictPanel    "can she take it?" — every reason from /pos/tech-appointments-screen/conflicts, and alternatives
//                    from the booking engine's openings; it never books or moves anything itself
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posLiveTechnicianScheduleApi } from '../api/posLiveTechnicianScheduleApi';
import { posBookingApi } from '../api/posBookingApi';
import { posTechAppointmentsScreenApi } from '../api/posTeamScreensApi';
import { codeLabel } from '../components/peopleLabels';
import { fmtNumber, fmtMoney } from '../i18n/format';
import { clockOfHHMM } from './opsClock';
import { FitDialog, Empty } from '../components/FitKit';
import { useLoad, StateBlock } from '../components/FinanceKit';

export const nf = (n: number | null | undefined) => fmtNumber(n || 0);
export const minOf = (t?: string | null) => { const m = /(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** "HH:MM" in the user's clock — 2:30 PM in English, 14:30 in Vietnamese (WP-C1) */
export const hm12 = (t?: string | null) => { const m = minOf(t); if (m == null) return '—'; return clockOfHHMM(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); };
export const addDay = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const apptStatus = (s: string) => codeLabel('tm.appt.' + String(s || '').toLowerCase(), s);
export const liveStatus = (s: string) => codeLabel('tm.live.' + String(s || '').toLowerCase(), s);
const LIVE_TONE: Record<string, string> = { available: 'ok', in_service: 'info', assigned: 'info', checked_in_waiting: 'info', on_break: 'warn', lunch: 'warn', off_shift: 'mut', blocked: 'bad', offline: 'mut', service_done: 'ok' };
export const liveTone = (s: string) => LIVE_TONE[String(s || '').toLowerCase()] ?? 'mut';

export type TeamTimelineRow = { technicianId: string; name: string; status?: string; shift?: { startTime: string; endTime: string; breakStartTime?: string; breakEndTime?: string } | null;
  appointments: { appointmentId: string; startTime: string; endTime: string; serviceSummary?: string; customerName?: string; status: string }[];
  blocks?: { blockId: string; startTime: string; endTime: string; reason?: string }[]; openSlots?: { slotId: string; startTime: string; endTime: string; durationMinutes?: number }[] };

/** technician rows on one day's time axis; `from`/`to` in minutes (defaults 8 AM – 8 PM, widened to fit the data) */
export function TechTimeline({ rows, onTech, onAppt, testId = 'timeline', nowMinute, fitMinutes }: { rows: TeamTimelineRow[]; onTech?: (id: string) => void; onAppt?: (id: string) => void; testId?: string; nowMinute?: number | null;
  /** TECH APPOINTMENTS 04: a service length — open gaps at least this long are highlighted, shorter ones dimmed (the gap lengths are the server's) */
  fitMinutes?: number | null }) {
  let lo = 8 * 60, hi = 20 * 60;
  for (const r of rows) for (const t of [r.shift?.startTime, r.shift?.endTime, ...r.appointments.flatMap((a) => [a.startTime, a.endTime])]) { const m = minOf(t); if (m != null) { lo = Math.min(lo, Math.floor(m / 60) * 60); hi = Math.max(hi, Math.ceil(m / 60) * 60); } }
  const span = Math.max(60, hi - lo); const pct = (m: number) => `${((m - lo) / span) * 100}%`; const w = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`;
  const hours = Array.from({ length: Math.floor(span / 60) + 1 }, (_, i) => lo + i * 60);
  if (!rows.length) return <Empty title={tx('tm.noTechs')} />;
  const bar = (key: string, a: number | null, b: number | null, cls: string, label: ReactNode, title: string, onClick?: () => void, tid?: string) => a == null || b == null || b <= a ? null
    : <button key={key} type="button" className={'tt-bar ' + cls} style={{ left: pct(a), width: w(a, b) }} title={title} onClick={onClick} data-testid={tid} tabIndex={onClick ? 0 : -1}>{label}</button>;
  return (
    <div className="tt" data-testid={testId} role="grid" aria-label={tx('tm.board')}>
      <div className="tt-head" aria-hidden="true"><div className="tt-name" />{hours.map((h) => <span key={h} className="tt-hour" style={{ left: pct(h) }}>{hm12(`${Math.floor(h / 60)}:00`).replace(':00 ', ' ')}</span>)}</div>
      {rows.map((r) => {
        const ss = minOf(r.shift?.startTime), se = minOf(r.shift?.endTime), bs = minOf(r.shift?.breakStartTime), be = minOf(r.shift?.breakEndTime);
        return (
          <div key={r.technicianId} className="tt-row" role="row" data-testid={testId + '-row'}>
            <button type="button" className="tt-name" onClick={() => onTech?.(r.technicianId)} title={tx('tm.viewDay')}><b>{r.name}</b>{r.status ? <span className={'fk-chip ' + liveTone(r.status)}>{liveStatus(r.status)}</span> : null}</button>
            <div className="tt-track">
              {Array.from({ length: Math.floor(span / 15) }, (_, i) => <i key={i} className={'tt-tick' + (i % 4 === 0 ? ' h' : '')} style={{ left: pct(lo + i * 15) }} />)}
              {ss != null && se != null ? <span className="tt-shift" style={{ left: pct(ss), width: w(ss, se) }} title={tx('tm.shift') + ` ${hm12(r.shift?.startTime)} – ${hm12(r.shift?.endTime)}`} /> : null}
              {(r.openSlots ?? []).map((o) => { const fit = fitMinutes ? (o.durationMinutes ?? 0) >= fitMinutes : null;
                return bar('o' + o.slotId, minOf(o.startTime), minOf(o.endTime), 'open' + (fit === true ? ' fit' : fit === false ? ' short' : ''), tx('tm.open'), `${tx('tm.open')} ${hm12(o.startTime)} – ${hm12(o.endTime)}`, undefined, fit === true ? 'gap-fit' : fit === false ? 'gap-short' : undefined); })}
              {bar('brk', bs, be, 'break', tx('tm.break'), `${tx('tm.break')} ${hm12(r.shift?.breakStartTime)} – ${hm12(r.shift?.breakEndTime)}`)}
              {(r.blocks ?? []).map((b) => bar('b' + b.blockId, minOf(b.startTime), minOf(b.endTime), 'block', b.reason || tx('tm.blocked'), `${tx('tm.blocked')} ${hm12(b.startTime)} – ${hm12(b.endTime)}`))}
              {r.appointments.map((a) => bar('a' + a.appointmentId, minOf(a.startTime), minOf(a.endTime), 'appt s-' + String(a.status).toLowerCase(), a.serviceSummary || a.customerName || apptStatus(a.status),
                `${hm12(a.startTime)} – ${hm12(a.endTime)} · ${a.serviceSummary ?? ''} · ${apptStatus(a.status)}`, onAppt ? () => onAppt(a.appointmentId) : undefined, testId + '-appt'))}
              {nowMinute != null && nowMinute >= lo && nowMinute <= hi ? <span className="tt-now" style={{ left: pct(nowMinute) }} /> : null}
            </div>
          </div>
        );
      })}
      <div className="tt-legend"><span className="tt-key appt" />{tx('tm.booked')}<span className="tt-key open" />{tx('tm.open')}<span className="tt-key break" />{tx('tm.break')}<span className="tt-key block" />{tx('tm.blocked')}<span className="tt-key shift" />{tx('tm.shift')}</div>
    </div>
  );
}

/** one technician's whole day, from the live-schedule detail (the same data the Live Technician Schedule shows) */
export function FullDayOverlay({ technicianId, date: date0, today, canPay, onClose, onAppt, children }: { technicianId: string; date: string; today: string; canPay?: boolean; onClose: () => void; onAppt?: (id: string) => void;
  /** extra sections (the Live Schedule's actions and history) — given the detail, the shown date and a reload */
  children?: (x: any, date: string, reload: () => void) => ReactNode }) {
  const nav = useNavigate(); const [date, setDate] = useState(date0);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const d = useLoad(() => posLiveTechnicianScheduleApi.detail(technicianId, date), [technicianId, date]);
  const x: any = d.data;
  const items = x ? [...(x.appointments ?? []).map((a: any) => ({ k: 'a' + a.appointmentId, s: a.startTime, e: a.endTime, kind: 'appt', t: a.serviceSummary, sub: `${a.customerName ?? ''} · ${apptStatus(a.status)}`, id: a.appointmentId })),
    ...(x.blocks ?? []).map((b: any) => ({ k: 'b' + b.blockId, s: b.startTime, e: b.endTime, kind: 'block', t: tx('tm.blocked'), sub: b.reason ?? '' })),
    ...(x.shift?.breakStartTime ? [{ k: 'brk', s: x.shift.breakStartTime, e: x.shift.breakEndTime, kind: 'break', t: tx('tm.break'), sub: '' }] : [])].sort((a, b) => (minOf(a.s) ?? 0) - (minOf(b.s) ?? 0)) : [];
  // the gaps between what is booked inside the shift (minutes), so "free" is a fact, not a guess
  const gaps: { s: number; e: number }[] = [];
  if (x?.shift) { let cur = minOf(x.shift.startTime) ?? 0; const end = minOf(x.shift.endTime) ?? 0;
    for (const i of items) { const s = minOf(i.s) ?? 0, e = minOf(i.e) ?? s; if (s > cur) gaps.push({ s: cur, e: s }); cur = Math.max(cur, e); }
    if (end > cur) gaps.push({ s: cur, e: end }); }
  const h = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const nextOpen = (x?.openSlots ?? [])[0];
  return (
    <FitDialog wide title={x?.fullName ?? tx('tm.fullDay')} subtitle={x ? <><span className={'fk-chip ' + liveTone(x.status)}>{liveStatus(x.status)}</span> {date}{x.shift ? ` · ${hm12(x.shift.startTime)} – ${hm12(x.shift.endTime)}` : ` · ${tx('tm.noShift')}`}</> : undefined} onClose={onClose} testId="dlg-full-day"
      footer={<><button type="button" className="fk-btn ghost" onClick={() => setDate(addDay(date, -1))} data-testid="day-prev">‹ {tx('tm.prevDay')}</button><button type="button" className="fk-btn ghost" onClick={() => setDate(today)}>{tx('tm.today')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => setDate(addDay(date, 1))} data-testid="day-next">{tx('tm.nextDay')} ›</button>
        <button type="button" className="fk-btn" onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(technicianId)}&date=${date}`)}>{tx('tm.newBooking')}</button>
        <button type="button" className="fk-btn primary" onClick={onClose} data-testid="full-day-close">{tx('pos.close')}</button></>}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !x ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl mo-dl" data-testid="full-day-summary">
          <dt>{tx('tm.shift')}</dt><dd>{x.shift ? `${hm12(x.shift.startTime)} – ${hm12(x.shift.endTime)}` : tx('tm.noShift')}</dd>
          <dt>{tx('tm.bookedTime')}</dt><dd>{tx('tm.bookedV', { h: String(x.bookedHours ?? 0), p: nf(x.utilizationPercent) })}</dd>
          <dt>{tx('tm.now')}</dt><dd>{x.activeTicket ? `${x.activeTicket.serviceSummary} · ${x.activeTicket.customerName ?? ''}` : liveStatus(x.status)}</dd>
          <dt>{tx('tm.next')}</dt><dd>{x.nextAppointment ? `${hm12(x.nextAppointment.startTime)} · ${x.nextAppointment.serviceSummary}` : tx('tm.none')}</dd>
          <dt>{tx('tm.nextOpen')}</dt><dd>{nextOpen ? `${hm12(nextOpen.startTime)} – ${hm12(nextOpen.endTime)} (${tx('cg.min', { n: nf(nextOpen.durationMinutes) })})` : tx('tm.none')}</dd>
          {canPay && x.salesTodayCents != null ? <><dt>{tx('tm.salesToday')}</dt><dd data-testid="full-day-money">{fmtMoney(x.salesTodayCents)} · {tx('tm.tipsV', { v: fmtMoney(x.tipsTodayCents ?? 0) })} · {tx('tm.commissionV', { v: fmtMoney(x.commissionPreviewCents ?? 0) })}</dd></> : null}
        </dl>
        {items.length === 0 ? <Empty title={tx('tm.nothingBooked')} /> : <ul className="fk-list dense tt-day" data-testid="full-day-list">{items.map((i) => <li key={i.k} className={'fk-li k-' + i.kind}>
          <span className="tt-time">{hm12(i.s)} – {hm12(i.e)}</span><span className="fk-li-t">{i.t}<span className="fk-li-s">{i.sub}</span></span>
          {i.kind === 'appt' && onAppt ? <button type="button" className="fk-btn ghost sm" onClick={() => onAppt(i.id)}>{tx('pos.details')}</button> : null}</li>)}</ul>}
        {gaps.length ? <><h3 className="fk-h3">{tx('tm.gaps')}</h3><div className="cg-chips" data-testid="full-day-gaps">{gaps.map((g) => <span key={g.s} className="fk-chip info">{hm12(h(g.s))} – {hm12(h(g.e))} · {tx('cg.min', { n: nf(g.e - g.s) })}</span>)}</div></>
          : x.shift ? <p className="fk-hint" data-testid="full-day-full">{tx('tm.noGap')}</p> : null}
        {/* extras LIVE TECHNICIAN SCHEDULE 12 — Technician Day Notes: the notes already on this day's records, from the server
            (appointment notes only for a role with customer access — the server leaves them out otherwise and counts them) */}
        {Array.isArray(x.dayNotes) ? <><h3 className="fk-h3">{tx('tm.dayNotes')}</h3>
          {x.dayNotes.length === 0 && !x.dayNotesHidden ? <p className="fk-hint" data-testid="day-notes-none">{tx('tm.dayNotesNone')}</p>
            : <ul className="fk-list dense" data-testid="day-notes">{x.dayNotes.map((n: any) => <li key={n.kind + n.sourceId} className="fk-li" data-testid={`day-note-${n.kind}`}>
              <span className="tt-time">{hm12(n.startTime)} – {hm12(n.endTime)}</span>
              <span className="fk-li-t">{n.text}<span className="fk-li-s">{n.kind === 'appointment' ? `${tx('tm.dn.appointment')}${n.customerName ? ` · ${n.customerName}` : ''}` : `${tx('tm.dn.blocked_time')}${n.reason ? ` · ${codeLabel(`status.scheduleBlock.${n.reason}`, n.reason)}` : ''}`}</span></span></li>)}</ul>}
          {x.dayNotesHidden ? <p className="fk-hint" data-testid="day-notes-hidden">{tx('tm.dayNotesHidden', { n: nf(x.dayNotesHidden) })}</p> : null}</> : null}
        {children ? children(x, date, d.reload) : null}
      </>}
    </FitDialog>
  );
}

/** Schedule conflict warning: explain every cause for a technician + time, and offer valid alternatives (read only) */
export function ConflictPanel({ today, initial, initialName, testId = 'conflict-panel' }: { today: string; initialName?: string; initial?: { technicianId?: string; date?: string; start?: string; minutes?: number; appointmentId?: string; serviceIds?: string[] }; testId?: string }) {
  const nav = useNavigate();
  const [tid, setTid] = useState(initial?.technicianId ?? ''); const [date, setDate] = useState(initial?.date ?? today); const [start, setStart] = useState(initial?.start ?? '10:00'); const [mins, setMins] = useState(String(initial?.minutes ?? 45));
  const [run, setRun] = useState(0);
  useEffect(() => { if (initial?.technicianId) setRun(1); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const sids = initial?.serviceIds ?? [];
  const res = useLoad(() => (run && tid ? posTechAppointmentsScreenApi.conflicts({ technicianId: tid, date, start, minutes: Number(mins), serviceIds: sids.join(',') || undefined, appointmentId: initial?.appointmentId }) : Promise.resolve(null)), [run]);
  const alt = useLoad(() => (res.data && !res.data.ok && sids.length ? posBookingApi.openings({ date, serviceIds: sids, limit: 5 }) : Promise.resolve(null)), [res.data]);
  const altOpen: Array<{ technicianId: string; name: string; time: string }> = ((alt.data as { openings?: Array<{ technicianId: string; name: string; time: string }> } | null)?.openings) ?? [];
  const r: any = res.data;
  return (
    <div className="tm-conflict" data-testid={testId}>
      <div className="cg-form four">
        <label className="fk-field">{tx('tm.col.technician')}<span data-testid="cf-tech"><TechnicianPickerButton value={tid} valueName={tid === initial?.technicianId ? initialName : undefined} emptyLabel={tx('tm.chooseTech')} ariaLabel={tx('tm.col.technician')} date={date} onChange={(id) => setTid(id)} style={{ maxWidth: '100%' }} /></span></label>
        <label className="fk-field">{tx('tm.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value || today)} data-testid="cf-date" /></label>
        <label className="fk-field">{tx('tm.start')}<input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} data-testid="cf-start" /></label>
        <label className="fk-field">{tx('tm.minutes')}<input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, ''))} data-testid="cf-minutes" /></label>
      </div>
      <div className="cg-acts"><button type="button" className="fk-btn primary" disabled={!tid || !Number(mins)} onClick={() => setRun((n) => n + 1)} data-testid="cf-check">{tx('tm.check')}</button></div>
      {res.error ? <StateBlock error={res.error} onRetry={res.reload} /> : !r ? null : r.ok
        ? <div className="fk-note ok" data-testid="cf-ok"><span>{tx('tm.cfOk', { t: r.technician ?? '', s: hm12(r.start), e: hm12(r.end) })}</span></div>
        : <div className="fk-note warn" data-testid="cf-warn"><span><b>{tx('tm.cfWarn', { t: r.technician ?? '', s: hm12(r.start), e: hm12(r.end) })}</b>
          <ul className="tm-reasons">{r.reasons.map((x: any, i: number) => <li key={i} data-testid={'cf-reason-' + x.kind}>{tx('tm.why.' + x.kind, { f: hm12(x.from), t: hm12(x.to), d: x.detail ?? '' })}</li>)}</ul>
          {altOpen.length ? <>{tx('tm.alternatives')} {altOpen.map((o) => <button key={o.technicianId} type="button" className="fk-btn sm ghost" onClick={() => nav(`/booking/new?technicianId=${encodeURIComponent(o.technicianId)}&date=${date}&time=${encodeURIComponent(o.time)}&serviceId=${encodeURIComponent(sids[0])}`)}>{o.name} · {hm12(o.time)}</button>)}</> : null}
          <span className="fk-li-s">{tx('tm.cfRule')}</span></span></div>}
    </div>
  );
}
