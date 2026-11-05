import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { useRealtime } from '../realtime/useRealtime';
import { posLiveTechnicianScheduleApi as api, ApiError } from '../api/posLiveTechnicianScheduleApi';
import { TechnicianSchedulePreview, type TechScheduleData } from '../components/TechnicianSchedulePreview';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { techScheduleRequest } from '../components/ipad-modules';
import { useIPadView } from '../components/IPadViewProvider';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { fmtMoney, fmtYmd } from '../i18n/format';
import { clockOfHHMM } from './opsClock';
// POSLiveTechnicianScheduleScreen — real-time technician board from /pos/technicians/live-schedule/state. Aggregates
// the SAME records as Booking / Tech Appointments / Queue / Tech App (no duplicate source). Reads on mount + polls
// every 10s (the realtime gateway can replace polling later). Reuses the cream/gold design tokens + .kpi cards.
// Quick actions (Start/End Break, Block Time) hit the per-technician routes; open slots book via the shared endpoint.
// The 24" iMac fit rule holds: fixed grid (rows auto/auto/1fr); the board and right panel scroll internally only.

type LiveStatus = 'available' | 'assigned' | 'checked_in_waiting' | 'in_service' | 'service_done' | 'on_break' | 'lunch' | 'off_shift' | 'blocked' | 'offline';
type Appt = { appointmentId: string; customerName: string; customerInitials: string; serviceSummary: string; startTime: string; endTime: string; status: string; source: string; ticketId?: string };
type OpenSlot = { slotId: string; startTime: string; endTime: string; durationMinutes: number; reason: string };
type Block = { blockId: string; startTime: string; endTime: string; reason: string; note?: string };
type Col = { technicianId: string; fullName: string; initials: string; roleLabel: string; status: LiveStatus; shift?: { startTime: string; endTime: string; breakStartTime?: string; breakEndTime?: string }; skills: string[]; appointments: Appt[]; openSlots: OpenSlot[]; blocks?: Block[]; activeTicket?: { ticketId: string; serviceSummary: string; customerName: string }; bookedHours: number; utilizationPercent: number };
type Kpis = { workingToday: number; availableNow: number; inService: number; onBreakOrLunch: number; bookedHours: number; utilizationPercent: number };
type Detail = Col & { phone?: string; userId?: string; nextAppointment?: Appt; salesTodayCents: number; tipsTodayCents: number; commissionPreviewCents: number };
type PageState = { kpis: Kpis; schedule: { date: string; timeRange: { startTime: string; endTime: string; slotMinutes: number }; technicians: Col[]; lanes?: { page: number; pageSize: number; total: number; totalPages: number; totalAll: number } }; filters: { statuses: { label: string; value: string }[]; skills: { label: string; value: string }[]; technicians: { label: string; value: string }[] } };

const V = (n: string) => `var(--${n})`;
const STATUS: Record<LiveStatus, { label: string; bg: string; fg: string }> = {
  available: { get label() { return tx('pos.available'); }, bg: V('ok-bg'), fg: V('ok') },
  assigned: { get label() { return tx('pos.assigned'); }, bg: V('warn-bg'), fg: V('warn') },
  checked_in_waiting: { get label() { return tx('pos.waiting_2'); }, bg: V('warn-bg'), fg: V('warn') },
  in_service: { get label() { return tx('pos.in_service_3'); }, bg: '#EEF6FF', fg: V('info') },
  service_done: { get label() { return tx('pos.service_done'); }, bg: V('ok-bg'), fg: V('ok') },
  on_break: { get label() { return tx('pos.on_break_2'); }, bg: '#F4EDFF', fg: '#8E6AD8' },
  lunch: { get label() { return tx('pos.lunch'); }, bg: '#F4EDFF', fg: '#8E6AD8' },
  off_shift: { get label() { return tx('pos.off_shift_2'); }, bg: '#F1ECE4', fg: V('muted') },
  blocked: { get label() { return tx('pos.blocked_2'); }, bg: '#FFF0ED', fg: V('danger') },
  offline: { get label() { return tx('pos.offline_4'); }, bg: '#F1ECE4', fg: V('muted') },
};
/** the branch's "HH:MM" in the user's clock (2:30 PM / 14:30) — WP-C1 */
const to12 = (hhmm: string) => clockOfHHMM(hhmm);
const money = (c?: number) => fmtMoney(c || 0);
// Browser-LOCAL calendar date (the POS runs in the salon's time zone). toISOString() is UTC and put a New Jersey
// evening on tomorrow's board (workforce audit: "live-schedule UTC date"; merge Oct 12).
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
/** "Mon 10/27" / "T2, 27/10" — the weekday + day in the user's language (WP-C1) */
const dayLabel = (iso: string) => fmtYmd(iso, { weekday: 'short', month: 'numeric', day: 'numeric' }, iso);
type LanePage = { page: number; pageSize: number; total: number; totalPages: number; totalAll: number };
type WeekData = { weekStart: string; days: { date: string; board: { technicians: Col[] } }[]; lanes?: LanePage };
/** 200-technician §2: technician columns a page */
export const LS_LANE_PAGE_SIZE = 12;
const nowHHMM = () => { const d = new Date(); return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes(); };

const ctl: React.CSSProperties = { height: 34, border: `1px solid ${V('line')}`, borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: V('text') };
const card: React.CSSProperties = { background: V('card'), border: `1px solid ${V('line')}`, borderRadius: 14, padding: 12 };

function Badge({ status }: { status: LiveStatus }) {
  const s = STATUS[status] || STATUS.offline;
  return <span style={{ background: s.bg, color: s.fg, fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>{s.label}</span>;
}

export function POSLiveTechnicianScheduleScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const nav = useNavigate();
  const [s, setS] = useState<PageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);
  const [date, setDate] = useState(todayIso());
  const [view, setView] = useState<'day' | 'week'>('day');
  const [status, setStatus] = useState('');
  const [skill, setSkill] = useState('');
  const [search, setSearch] = useState('');
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(nowHHMM());
  const blockRef = useRef<{ start: string; end: string; reason: string }>({ start: '13:00', end: '14:00', reason: 'vacation' });
  const [showBlock, setShowBlock] = useState(false);
  const [editShifts, setEditShifts] = useState<{ start: string; end: string }[]>([{ start: '09:00', end: '17:00' }]);
  const [editBreaks, setEditBreaks] = useState<{ start: string; end: string; type: string }[]>([{ start: '13:00', end: '14:00', type: 'lunch' }]);
  const [showEditShift, setShowEditShift] = useState(false);
  const { open: openIPad } = useIPadView();   // Jul 29: wires techScheduleRequest — the one iPad builder that had no production caller
  const [previewId, setPreviewId] = useState<string | null>(null);

  const [week, setWeek] = useState<WeekData | null>(null);
  // 200-technician §2 (Oct 27 2026): the board pages its technician columns (and the week its rows) on the server — 12 a
  // page, searchable by name (accent-insensitive) or "#n" — and never asks for the roster.
  const [laneQ, setLaneQ] = useState('');
  const [lanePage, setLanePage] = useState(1);
  const laneQNow = useRef('');
  useEffect(() => { const h = setTimeout(() => { const v = search.trim(); if (v === laneQNow.current) return; laneQNow.current = v; setLaneQ(v); setLanePage(1); }, 250); return () => clearTimeout(h); }, [search]);
  useEffect(() => { setLanePage(1); }, [status, skill, view]);
  const paging = { lanePage, lanePageSize: LS_LANE_PAGE_SIZE, laneSearch: laneQ || undefined, roster: 'none' as const };
  const load = useCallback(() => Promise.all([
    api.state({ date, view, status, skill, ...paging }).then((d) => { setS(d as PageState); setError(null); }),
    view === 'week' ? api.week({ date, status, skill, ...paging }).then((w) => setWeek(w as WeekData)) : Promise.resolve(setWeek(null)),
  ]).catch((e: ApiError) => setError(e?.message || tx('pos.failed_to_load_the_live_schedule'))), [date, view, status, skill, lanePage, laneQ]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  // Realtime standard (Jul 27, 2026): appointment/tech-status/time-clock events refetch this schedule, with the
  // hook's visible-only 45s fallback underneath. The old 10s poll is gone — §39 prohibits exactly that pattern.
  useRealtime(['booking', 'tech-appointments', 'technicians'], load);
  useEffect(() => { const t = setInterval(() => setNow(nowHHMM()), 60000); return () => clearInterval(t); }, []);

  const openTech = async (id: string) => {
    setSelId(id); setDetail(null); setNote(null);
    try { setDetail(await api.detail(id, date) as Detail); } catch (e: any) { setNote(e?.message || tx('pos.failed_to_load_technician')); }
  };
  const act = async (fn: () => Promise<any>, okMsg: Msg) => {
    setBusy(true); setNote(null);
    try { await fn(); setNote(okMsg); await load(); if (selId) setDetail(await api.detail(selId, date) as Detail); }
    catch (e: any) { setNote(e?.message || tx('pos.action_failed')); }
    finally { setBusy(false); }
  };
  const startBreak = (id: string, override = false) => act(() => api.startBreak(id, { managerOverride: override }), msg('ops.liveSchedule.ok.breakStarted'));
  const endBreak = (id: string) => act(() => api.endBreak(id), msg('ops.liveSchedule.ok.breakEnded'));
  const doBlock = (id: string) => act(() => api.blockTime(id, { date, startTime: blockRef.current.start, endTime: blockRef.current.end, reason: blockRef.current.reason }), msg('ops.liveSchedule.ok.timeBlocked')).then(() => setShowBlock(false));
  const doSaveShift = (id: string) => act(() => api.blockTime(id, { date, startTime: editShifts[0]?.start || '09:00', endTime: editShifts[0]?.end || '17:00', reason: tx('ops.liveSchedule.shiftReason', { shifts: editShifts.map(s => `${s.start}-${s.end}`).join(', '), breaks: editBreaks.map(b => `${b.start}-${b.end} (${b.type})`).join(', ') }) }), msg('ops.liveSchedule.ok.shiftUpdated')).then(() => setShowEditShift(false));
  // Inline slot-booking bar (Jul 27, 2026) — replaces window.prompt. Tapping an open slot opens a one-line
  // name field (default Walk-in) with Book/Cancel; the booking call is unchanged.
  const [bookingSlot, setBookingSlot] = useState<OpenSlot | null>(null);
  const [bookName, setBookName] = useState(() => tx('pos.walk_in_2'));
  const bookSlot = (slot: OpenSlot) => { setBookingSlot(slot); setBookName(tx('pos.walk_in_2')); };
  const confirmBookSlot = () => {
    if (!bookingSlot) return;
    const slot = bookingSlot;
    act(() => api.bookOpenSlot(slot.slotId, { customerName: bookName.trim() || tx('pos.walk_in_2'), serviceSummary: tx('pos.service_3'), durationMinutes: slot.durationMinutes }), msg('ops.liveSchedule.ok.slotBooked'))
      .then(() => { setBookingSlot(null); setBookName(tx('pos.walk_in_2')); });
  };

  const techs = s?.schedule?.technicians || [];
  const lanes = (view === 'week' ? week?.lanes : undefined) ?? s?.schedule?.lanes;
  const kpis = s?.kpis;
  const kpiCards = useMemo(() => kpis ? [
    { get l() { return tx('pos.working_today'); }, v: kpis.workingToday }, { get l() { return tx('pos.available_now_3'); }, v: kpis.availableNow }, { get l() { return tx('pos.in_service_3'); }, v: kpis.inService },
    { get l() { return tx('pos.on_break_lunch'); }, v: kpis.onBreakOrLunch }, { get l() { return tx('pos.booked_hours'); }, v: kpis.bookedHours }, { get l() { return tx('pos.utilization'); }, v: kpis.utilizationPercent + '%' },
  ] : [], [kpis]);

  return (
    <div style={{ height: embedded ? 'clamp(440px, 56vh, 600px)' : '100%', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', gap: 12, padding: embedded ? 0 : '14px 18px 16px' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {embedded
          ? <div style={{ marginRight: 'auto', fontSize: 11.5, color: V('muted'), fontWeight: 700 }}>{tx('pos.live_status_now')}{' '}{to12(now)}</div>
          : (<div style={{ marginRight: 'auto' }}>
              <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 21 }}>{tx('pos.live_technician_schedule')}</h1>
              <div style={{ fontSize: 11.5, color: V('muted'), marginTop: 2 }}>{tx('pos.real_time_status_shifts_appointments_and_pyzl')}{' '}{to12(now)}</div>
            </div>)}
        <ImeSafeInput type="search" aria-label={tx('pos.find_technician')} placeholder={tx('ops.liveSchedule.findPlaceholder')} value={search} onValue={setSearch} style={{ ...ctl, width: 200 }} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={ctl} />
        <button onClick={() => setDate(todayIso())} style={{ ...ctl, cursor: 'pointer', fontWeight: 700, background: '#FFF9EF' }}>{tx('pos.today_2')}</button>
        <div style={{ display: 'flex', border: `1px solid ${V('line')}`, borderRadius: 9, overflow: 'hidden' }}>
          {(['day', 'week'] as const).map((v) => <button key={v} onClick={() => setView(v)} aria-pressed={view === v} style={{ height: 34, padding: '0 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, background: view === v ? V('grad') : 'transparent', color: V('text') }}>{v === 'day' ? tx('pos.day') : tx('pos.week')}</button>)}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={ctl}><option value="">{tx('pos.all_status')}</option>{(s?.filters.statuses || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select value={skill} onChange={(e) => setSkill(e.target.value)} style={ctl}><option value="">{tx('pos.all_skills')}</option>{(s?.filters.skills || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        {lanes ? (
          <span data-testid="live-schedule-pager" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span className="s">{tx('pos.n_technicians', { n: String(lanes.total) })}</span>
            {lanes.totalPages > 1 ? (<>
              <button type="button" className="btn ghost" disabled={lanes.page <= 1} onClick={() => setLanePage(Math.max(1, lanes.page - 1))}>{tx('pos.previous')}</button>
              <span>{tx('pos.page_x_of_y', { page: String(lanes.page), pages: String(lanes.totalPages) })}</span>
              <button type="button" className="btn ghost" disabled={lanes.page >= lanes.totalPages} onClick={() => setLanePage(Math.min(lanes.totalPages, lanes.page + 1))}>{tx('pos.next')}</button>
            </>) : null}
          </span>
        ) : null}
      </div>

      {/* KPI row */}
      <div className="kpis" style={{ margin: 0 }}>
        {kpiCards.map((k) => <div className="kpi" key={k.l}><div className="l">{k.l}</div><div className="v">{k.v}</div></div>)}
        {!kpis && <div className="kpi"><div className="l">{tx('pos.loading')}</div></div>}
      </div>

      {note && <div style={{ gridColumn: '1/-1', fontSize: 12, color: V('info'), marginTop: -6 }}>{renderMsg(note)}</div>}
      {error && <div style={{ gridColumn: '1/-1', fontSize: 12, color: V('danger') }}>{error}</div>}
      {bookingSlot ? (
        <div style={{ gridColumn: '1/-1', display: 'flex', gap: 8, alignItems: 'center', background: '#FFFBF2', border: `1px solid ${V('gline')}`, borderRadius: 10, padding: '8px 10px' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: V('g7') }}>{tx('pos.book_open_slot')}{' '}{bookingSlot.startTime}–{bookingSlot.endTime}</span>
          <input aria-label={tx('pos.customer_name_2')} value={bookName} onChange={(e) => setBookName(e.target.value)} autoFocus
            style={{ flex: 1, minHeight: 38, border: `1px solid ${V('line')}`, borderRadius: 9, padding: '0 10px', fontSize: 12.5, fontFamily: 'inherit' }} />
          <button className="btn" onClick={confirmBookSlot}>{tx('pos.book')}</button>
          <button className="btn ghost" onClick={() => setBookingSlot(null)}>{tx('pos.cancel')}</button>
        </div>
      ) : null}

      {/* board + right panel */}
   <div className="grid min-h-0 grid-cols-1 gap-3.5 overflow-hidden 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div style={{ minHeight: 0, overflow: 'auto', paddingRight: 2 }}>
          {view === 'week' ? (
            week ? <WeekGrid week={week} selectedDate={date} onPickDay={(d) => { setDate(d); setView('day'); }} /> : <div style={{ ...card, textAlign: 'center', padding: '48px 18px', fontSize: 12, color: V('muted') }}>{tx('pos.loading_the_week')}</div>
          ) : techs.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: '48px 18px' }}>
              <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16 }}>{tx('pos.no_technicians_scheduled_today')}</div>
              <div style={{ fontSize: 12, color: V('muted'), margin: '6px 0 14px' }}>{tx('pos.add_a_technician_or_create_a_1n73')}</div>
              <button onClick={() => nav('/technicians')} style={{ ...ctl, display: 'inline-block', lineHeight: '34px', cursor: 'pointer', fontWeight: 700, background: '#FFF9EF' }}>{tx('pos.add_technician_create_shift')}</button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 12, alignItems: 'start' }}>
              {techs.map((t) => (
                <div key={t.technicianId} onClick={() => { openTech(t.technicianId); setPreviewId(t.technicianId); }} style={{ ...card, cursor: 'pointer', outline: selId === t.technicianId ? `2px solid ${V('gline')}` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <ProfileAvatarWithPreview name={t.fullName} url={(t as any).avatarUrl} size={34} type="technician" />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.fullName}</div>
                      <div style={{ fontSize: 10.5, color: V('muted') }}>{t.roleLabel}</div>
                    </div>
                    <Badge status={t.status} />
                  </div>
                  <div style={{ fontSize: 10.5, color: V('soft'), marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t.shift ? `${to12(t.shift.startTime)} – ${to12(t.shift.endTime)}` : tx('pos.off_shift_3')}</span>
                    <span style={{ fontWeight: 700 }}>{t.utilizationPercent}% · {tx('ops.common.hoursShort', { n: t.bookedHours })}</span>
                  </div>
                  {t.shift?.breakStartTime && <div style={{ fontSize: 10, color: '#8E6AD8', marginTop: 3 }}>{tx('pos.lunch')}{' '}{to12(t.shift.breakStartTime)}–{to12(t.shift.breakEndTime || '')}</div>}

                  <div style={{ marginTop: 9, display: 'grid', gap: 6 }}>
                    {t.appointments.length === 0 && t.openSlots.length === 0 && <div style={{ fontSize: 11, color: V('muted') }}>{tx('pos.no_appointments_today')}</div>}
                    {t.appointments.map((a) => (
                      <div key={a.appointmentId} style={{ border: `1px solid ${V('line')}`, borderLeft: `3px solid ${(STATUS as any)[a.status]?.fg || V('gline')}`, borderRadius: 8, padding: '6px 8px', background: '#FFFDF8' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}><b>{to12(a.startTime)}</b><span style={{ color: V('muted'), fontSize: 10 }}>{statusLabel('source', a.source)}</span></div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><ProfileAvatarWithPreview name={a.customerName} url={(a as any).customerAvatarUrl || (a as any).avatarUrl} size={16} type="customer" />{a.customerName}</div>
                        <div style={{ fontSize: 10.5, color: V('soft'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.serviceSummary}</div>
                      </div>
                    ))}
                    {t.openSlots.slice(0, 4).map((sl) => (
                      <button key={sl.slotId} onClick={(e) => { e.stopPropagation(); bookSlot(sl); }} style={{ border: `1.5px dashed ${V('gline')}`, borderRadius: 8, padding: '5px 8px', background: '#FFFBF2', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10.5, color: V('g7'), fontWeight: 700, textAlign: 'left' }}>
                        {tx('pos.open_3')}{' '}{to12(sl.startTime)}–{to12(sl.endTime)} · {sl.durationMinutes}m
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* right panel */}
        <aside style={{ minHeight: 0, overflow: 'auto' }}>
          {!detail ? (
            <div style={{ ...card, color: V('muted'), fontSize: 12.5, textAlign: 'center', padding: '40px 16px' }}>{tx('pos.select_a_technician_to_see_their_1ja8')}</div>
          ) : (
            <div style={{ ...card, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ProfileAvatarWithPreview name={detail.fullName} url={(detail as any).avatarUrl} size={40} type="technician" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 16 }}>{detail.fullName}</div>
                  <div style={{ fontSize: 11, color: V('muted') }}>{detail.roleLabel}{detail.phone ? ' · ' + detail.phone : ''}</div>
                </div>
                <Badge status={detail.status} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[[tx('ops.liveSchedule.todayShift'), detail.shift ? `${to12(detail.shift.startTime)}–${to12(detail.shift.endTime)}` : tx('pos.off')], [tx('pos.lunch'), detail.shift?.breakStartTime ? `${to12(detail.shift.breakStartTime)}–${to12(detail.shift.breakEndTime || '')}` : '—'], [tx('pos.utilization'), detail.utilizationPercent + '%'], [tx('pos.booked'), tx('ops.common.hoursShort', { n: detail.bookedHours })]].map(([l, v]) => (
                  <div key={l} style={{ background: '#FFFDF8', border: `1px solid ${V('line')}`, borderRadius: 9, padding: '7px 9px' }}><div style={{ fontSize: 9.5, color: V('muted'), fontWeight: 700, textTransform: 'uppercase' }}>{l}</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{v}</div></div>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                {[[tx('pos.sales'), money(detail.salesTodayCents)], [tx('pos.tips'), money(detail.tipsTodayCents)], [tx('pos.commission'), money(detail.commissionPreviewCents)]].map(([l, v]) => (
                  <div key={l} style={{ background: V('ok-bg'), border: `1px solid ${V('line')}`, borderRadius: 9, padding: '7px 9px' }}><div style={{ fontSize: 9.5, color: V('muted'), fontWeight: 700, textTransform: 'uppercase' }}>{l}</div><div style={{ fontSize: 12.5, fontWeight: 800, color: V('g8') }}>{v}</div></div>
                ))}
              </div>

              {detail.skills.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>{detail.skills.map((sk) => <span key={sk} style={{ fontSize: 10.5, background: '#FFF6E5', border: `1px solid ${V('gline')}`, color: V('g7'), borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>{sk}</span>)}</div>}

              {detail.activeTicket && <div style={{ background: '#EEF6FF', border: `1px solid ${V('line')}`, borderRadius: 9, padding: '8px 10px' }}><div style={{ fontSize: 9.5, color: V('info'), fontWeight: 800, textTransform: 'uppercase' }}>{tx('pos.current_ticket')}</div><div style={{ fontSize: 12.5, fontWeight: 700 }}>{detail.activeTicket.customerName}</div><div style={{ fontSize: 11, color: V('soft') }}>{detail.activeTicket.serviceSummary}</div></div>}
              {detail.nextAppointment && <div style={{ fontSize: 11.5, color: V('soft') }}><b>{tx('pos.next_2')}</b> {to12(detail.nextAppointment.startTime)} · {detail.nextAppointment.customerName} ({detail.nextAppointment.serviceSummary})</div>}

              {/* quick actions */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                <button disabled={busy} onClick={() => startBreak(detail.technicianId)} style={{ ...ctl, cursor: 'pointer', fontWeight: 700, background: '#F4EDFF', color: '#6E4FB0' }}>{tx('pos.start_break')}</button>
                <button disabled={busy} onClick={() => endBreak(detail.technicianId)} style={{ ...ctl, cursor: 'pointer', fontWeight: 700, background: V('ok-bg'), color: V('ok') }}>{tx('pos.end_break')}</button>
                <button disabled={busy} onClick={() => { setShowBlock((x) => !x); setShowEditShift(false); }} style={{ ...ctl, cursor: 'pointer', fontWeight: 700, background: '#FFF6E5', color: V('warn') }}>{tx('pos.block_time_2')}</button>
                <button disabled={busy} onClick={() => { setShowEditShift((x) => !x); setShowBlock(false); }} style={{ ...ctl, lineHeight: '34px', textAlign: 'center', cursor: 'pointer', fontWeight: 700, background: '#FFF9EF' }}>{tx('pos.edit_shift')}</button>
              </div>
              {detail.status === 'in_service' && <div style={{ fontSize: 10.5, color: V('muted') }}>{tx('pos.in_an_active_service_starting_a_lh5t')}{' '}<button disabled={busy} onClick={() => startBreak(detail.technicianId, true)} style={{ border: 'none', background: 'none', color: V('info'), cursor: 'pointer', fontWeight: 700, padding: 0, fontFamily: 'inherit', fontSize: 10.5 }}>{tx('pos.override')}</button></div>}

              {showBlock && (
                <div style={{ background: '#FFFDF8', border: `1px solid ${V('line')}`, borderRadius: 9, padding: 9, display: 'grid', gap: 7 }}>
                  <div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700, textTransform: 'uppercase' }}>{tx('pos.block_time_on')}{' '}{date}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="time" defaultValue={blockRef.current.start} onChange={(e) => (blockRef.current.start = e.target.value)} style={{ ...ctl, flex: 1 }} />
                    <input type="time" defaultValue={blockRef.current.end} onChange={(e) => (blockRef.current.end = e.target.value)} style={{ ...ctl, flex: 1 }} />
                  </div>
                  <select defaultValue={blockRef.current.reason} onChange={(e) => (blockRef.current.reason = e.target.value)} style={ctl}>
                    <option value="vacation">{tx('pos.vacation')}</option>
                    <option value="sick_leave">{tx('pos.sick_leave')}</option>
                    <option value="temporary_unavailable">{tx('pos.temporary_unavailable')}</option>
                    <option value="other">{tx('pos.other')}</option>
                  </select>
                  {blockRef.current.reason === 'other' && (
                    <input placeholder={tx('pos.reason_training_doctor')} onChange={(e) => (blockRef.current.reason = e.target.value)} style={ctl} />
                  )}
                  <button disabled={busy} onClick={() => doBlock(detail.technicianId)} style={{ ...ctl, cursor: 'pointer', fontWeight: 800, background: V('grad') }}>{tx('pos.save_block_2')}</button>
                </div>
              )}

              {showEditShift && (
                <div style={{ background: '#FFFDF8', border: `1px solid ${V('line')}`, borderRadius: 9, padding: 9, display: 'grid', gap: 7 }}>
                  <div style={{ fontSize: 10.5, color: V('muted'), fontWeight: 700, textTransform: 'uppercase' }}>{tx('pos.edit_today_s_shift')}{detail.fullName})</div>
                  
                  {/* Split Shifts */}
                  <div style={{ fontSize: 11, color: V('muted'), fontWeight: 700, marginTop: 4 }}>{tx('pos.shifts')}</div>
                  {editShifts.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="time" value={s.start} onChange={(e) => { const ns = [...editShifts]; ns[i].start = e.target.value; setEditShifts(ns); }} style={{ ...ctl, flex: 1 }} />
                      <span style={{ fontSize: 11, color: V('muted') }}>{tx('pos.to')}</span>
                      <input type="time" value={s.end} onChange={(e) => { const ns = [...editShifts]; ns[i].end = e.target.value; setEditShifts(ns); }} style={{ ...ctl, flex: 1 }} />
                      <button onClick={() => setEditShifts(editShifts.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: V('danger'), fontSize: 14 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setEditShifts([...editShifts, { start: '12:00', end: '17:00' }])} style={{ ...ctl, background: '#F5F2EC', cursor: 'pointer' }}>{tx('pos.add_shift')}</button>

                  {/* Breaks */}
                  <div style={{ fontSize: 11, color: V('muted'), fontWeight: 700, marginTop: 8 }}>{tx('pos.breaks')}</div>
                  {editBreaks.map((b, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="time" value={b.start} onChange={(e) => { const nb = [...editBreaks]; nb[i].start = e.target.value; setEditBreaks(nb); }} style={{ ...ctl, flex: 1, padding: '0 4px' }} />
                      <span style={{ fontSize: 11, color: V('muted') }}>{tx('pos.to')}</span>
                      <input type="time" value={b.end} onChange={(e) => { const nb = [...editBreaks]; nb[i].end = e.target.value; setEditBreaks(nb); }} style={{ ...ctl, flex: 1, padding: '0 4px' }} />
                      <select value={b.type} onChange={(e) => { const nb = [...editBreaks]; nb[i].type = e.target.value; setEditBreaks(nb); }} style={{ ...ctl, flex: 1.2, padding: '0 4px' }}>
                        <option value="lunch">{tx('pos.lunch')}</option>
                        <option value="paid">{tx('pos.paid_3')}</option>
                        <option value="unpaid">{tx('pos.unpaid')}</option>
                      </select>
                      <button onClick={() => setEditBreaks(editBreaks.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: V('danger'), fontSize: 14 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setEditBreaks([...editBreaks, { start: '12:00', end: '12:30', type: 'lunch' }])} style={{ ...ctl, background: '#F5F2EC', cursor: 'pointer' }}>{tx('pos.add_break')}</button>

                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button disabled={busy} onClick={() => doSaveShift(detail.technicianId)} style={{ ...ctl, flex: 1, cursor: 'pointer', fontWeight: 800, background: V('grad') }}>{tx('pos.save_schedule')}</button>
                    <button onClick={() => setShowEditShift(false)} style={{ ...ctl, cursor: 'pointer', background: '#F5F2EC' }}>{tx('pos.cancel')}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      {previewId && (() => {
        const col = techs.find((t) => t.technicianId === previewId);
        if (!col) return null;
        const enrich = detail && detail.technicianId === previewId
          ? { phone: detail.phone, nextAppointment: detail.nextAppointment, salesTodayCents: detail.salesTodayCents, tipsTodayCents: detail.tipsTodayCents }
          : {};
        const tech = { ...col, ...enrich } as unknown as TechScheduleData;
        return (<div>
          <TechnicianSchedulePreview tech={tech} date={date} onClose={() => setPreviewId(null)} onBookSlot={(slot) => { bookSlot(slot as OpenSlot); setPreviewId(null); }} />
          <button className="btn ghost" style={{ position: 'fixed', bottom: 18, right: 18, zIndex: 60 }} title={tx('pos.open_full_ipad_view')}
            onClick={() => { openIPad(techScheduleRequest(tech, date)); setPreviewId(null); }}>{tx('pos.full_view')}</button>
        </div>);
      })()}
    </div>
  );
}

/** Week view: technicians × 7 salon-local days. Each cell: shift window (or Off), appointments, booked hours. Tapping a
 *  day header or cell opens that day in the Day view. Read-only — every action stays on the Day board. */
function WeekGrid({ week, selectedDate, onPickDay }: { week: WeekData; selectedDate: string; onPickDay: (d: string) => void }) {
  const names = new Map<string, { fullName: string; roleLabel: string; avatarUrl?: string }>();
  for (const d of week.days) for (const t of d.board?.technicians || []) if (!names.has(t.technicianId)) names.set(t.technicianId, { fullName: t.fullName, roleLabel: t.roleLabel, avatarUrl: (t as any).avatarUrl });
  const rows = [...names.entries()].sort((a, b) => a[1].fullName.localeCompare(b[1].fullName));
  if (!rows.length) return <div style={{ ...card, textAlign: 'center', padding: '48px 18px', fontSize: 12, color: V('muted') }}>{tx('pos.no_technicians_scheduled_this_week')}</div>;
  const cell = (c?: Col) => {
    if (!c || !c.shift) return <div style={{ fontSize: 10.5, color: V('muted') }}>{tx('pos.off')}</div>;
    const appts = c.appointments.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').length;
    return (
      <div>
        <div style={{ fontSize: 10.5, fontWeight: 700 }}>{to12(c.shift.startTime)}–{to12(c.shift.endTime)}</div>
        <div style={{ fontSize: 10, color: V('soft') }}>{appts} {tx('pos.appt')}{enPlural(appts === 1 ? '' : 's')} · {tx('ops.common.hoursShort', { n: c.bookedHours })} · {c.utilizationPercent}%</div>
        {c.blocks && c.blocks.length > 0 ? <div style={{ fontSize: 10, color: V('danger') }}>{c.blocks.length} {tx('pos.blocked')}</div> : null}
      </div>
    );
  };
  return (
    <div style={{ ...card, padding: 0, overflow: 'auto' }} aria-label={tx('pos.week_schedule')}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: 11, color: V('muted'), borderBottom: `1px solid ${V('line')}` }}>{tx('pos.technician')}</th>
            {week.days.map((d) => (
              <th key={d.date} onClick={() => onPickDay(d.date)} style={{ cursor: 'pointer', padding: '8px 6px', fontSize: 11, fontWeight: 800, borderBottom: `1px solid ${V('line')}`, background: d.date === selectedDate ? '#FFF9EF' : 'transparent' }}>{dayLabel(d.date)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([tid, n]) => (
            <tr key={tid}>
              <td style={{ padding: '7px 10px', borderBottom: `1px solid ${V('line')}`, whiteSpace: 'nowrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProfileAvatarWithPreview name={n.fullName} url={n.avatarUrl} size={26} type="technician" />
                  <div><div style={{ fontSize: 12, fontWeight: 800 }}>{n.fullName}</div><div style={{ fontSize: 10, color: V('muted') }}>{n.roleLabel}</div></div>
                </div>
              </td>
              {week.days.map((d) => {
                const c = (d.board?.technicians || []).find((t) => t.technicianId === tid);
                return <td key={d.date} onClick={() => onPickDay(d.date)} style={{ cursor: 'pointer', verticalAlign: 'top', padding: '7px 6px', borderBottom: `1px solid ${V('line')}`, borderLeft: `1px solid ${V('line')}`, background: d.date === selectedDate ? '#FFFDF8' : 'transparent' }}>{cell(c)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
