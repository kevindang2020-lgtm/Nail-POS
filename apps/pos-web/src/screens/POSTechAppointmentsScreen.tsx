import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '../realtime/useRealtime';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { posTechAppointmentsApi } from '../api/posTechAppointmentsApi';
import { bookingConflictText } from '../api/posBookingApi';
import { posCheckInApi } from '../api/posCheckInApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel, humanizeCode } from '../i18n/status-label';
import { opsStatusLabel } from './opsStatus';
import { clockOfMinutes } from './opsClock';
import { fmtTime } from '../i18n/format';
import { TechnicianPickerButton } from '../components/TechnicianPickerButton';

// POS Tech Appointments — per-technician day lanes from /pos/tech-appointments/state, now with the full lifecycle
// wired. Quick actions (no-body): Check In, Start Service, No-Show (backend takes no body for tech-appt no-show).
// Per-appointment "Manage" drawer wires the body-carrying actions with their exact shapes (tech-appointments.service):
// Assign Technician ({technicianId}), Reschedule ({startTime, date?, technicianId?}), Cancel ({reason}). Reschedule/
// assign surface the 409 conflict message from the client.
type Svc = { serviceId?: string; serviceName?: string; name?: string };
type Appt = {
  appointmentId: string; technicianId: string; customerName: string; isVip?: boolean; source: string; services: Svc[];
  startTime: string; endTime: string; durationMinutes: number; status: string; depositStatus?: string; conflictStatus?: string;
  /** optimistic-concurrency version — echoed as expectedVersion so a stale device gets VERSION_CONFLICT */
  version?: number;
  /** the appointment's day (YYYY-MM-DD) */
  date?: string;
};
type Tech = { technicianId: string; displayName: string; workingStatus: string; appointmentCount: number; scheduledMinutes: number; availableMinutes: number; serviceSkillGroups: string[] };
type TAState = {
  kpis: { totalAppointmentsToday: number; bookedAppointments: number; checkedInAppointments: number; inServiceAppointments: number; completedAppointments: number; cancelledAppointments: number; noShowAppointments: number; onlineBookings: number; aiBookings: number; googleBookings: number; conflictCount: number };
  date: string; technicians: Tech[]; appointments: Appt[];
  filters: { statuses: string[]; sources: string[]; serviceCategories: string[]; technicians: { technicianId: string; name: string }[]; branches: { branchId: string; name: string }[] };
  /** the lane page (200-technician §2) */
  lanes?: { page: number; pageSize: number; total: number; totalPages: number; totalAll: number };
};
/** 200-technician §2 (Oct 26 2026): the board pages its technician lanes on the server — 12 a page, searchable — and never
 *  asks for the roster (Assign picks through the server-paged picker). At 1,000 technicians it drew 1,000 lanes. */
export const TA_LANE_PAGE_SIZE = 12;

const calMin = (t: string): number | null => {
  if (!t) return null;
  if (!t.includes('T') && !t.includes(' ')) { const m = /^(\d{1,2}):(\d{2})/.exec(t); if (m) return (+m[1]) * 60 + (+m[2]); }
  const d = new Date(t); if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
  const m = /(\d{1,2}):(\d{2})/.exec(t); return m ? (+m[1]) * 60 + (+m[2]) : null;
};
const tm = (iso?: string | null) => {
  if (!iso || iso.toLowerCase().includes('invalid')) return '—';
  try {
    const d = new Date(iso);
    if (!isNaN(d.getTime())) {
      return fmtTime(d);
    }
  } catch {}
  const min = calMin(iso);
  if (min !== null && !isNaN(min)) {
    return clockOfMinutes(min);   // the user's clock (WP-C1)
  }
  return iso || '—';
};
const tone = (s: string) => (/book|checked|in_service|complete|arrived/i.test(s) ? 'ok' : /cancel|no.?show|conflict|delay/i.test(s) ? 'warn' : '');
const statusTone = (s?: string) => {
  if (!s) return '';
  const st = s.toLowerCase();
  if (['confirmed', 'completed'].includes(st)) return 'ok';
  if (['checked_in', 'arrived', 'booked'].includes(st)) return 'info';
  if (['waiting', 'in_service'].includes(st)) return 'warn';
  if (['cancelled', 'no_show'].includes(st)) return 'bad';
  return '';
};
const formatStatusLabel = (s?: string) => {
  if (!s) return '—';
  const st = s.toLowerCase();
  if (st === 'checked_in') return tx('pos.checked_in_2');
  if (st === 'in_service') return tx('pos.in_service_3');
  return opsStatusLabel(st);   // canonical appointment / queue labels (WP-C1)
};
const svcNames = (r: Svc[]) => r.map((x) => x.serviceName || x.name || '').filter(Boolean).join(', ');
const inputStyle: React.CSSProperties = { height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12, color: 'var(--text)', width: '100%' };

export function POSTechAppointmentsScreen() {
  const [s, setS] = useState<TAState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [techSel, setTechSel] = useState('');
  const [whenStr, setWhenStr] = useState('');
  const [reason, setReason] = useState('');
  const [laneSearch, setLaneSearch] = useState('');
  const [laneQ, setLaneQ] = useState('');
  const [lanePage, setLanePage] = useState(1);
  useEffect(() => { const h = setTimeout(() => { setLaneQ(laneSearch.trim()); setLanePage(1); }, 250); return () => clearTimeout(h); }, [laneSearch]);

  // Wave 3 (Oct 13 2026, Smooth Refresh §17/§20): the board refetches in place on appointment events and on the 15 s
  // safety sync; a refresh that fails keeps the rows already on screen (the error is a note, not a replacement).
  const load = useCallback(() => posTechAppointmentsApi.state({ lanePage, lanePageSize: TA_LANE_PAGE_SIZE, laneSearch: laneQ || undefined, roster: 'none' })
    .then((d) => { setS(d as TAState); setError(null); })
    .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_tech_appointments'))), [lanePage, laneQ]);

  useEffect(() => { load(); }, [load]);
  useRealtime(['booking', 'tech-appointments', 'technicians'], load);

  const act = async (aid: string, fn: () => Promise<any>, kind: string, closeDrawer?: boolean) => {
    setNote(null); setBusyId(aid + kind);
    try { await fn(); if (closeDrawer) { setOpenId(null); setReason(''); setWhenStr(''); setTechSel(''); } await load(); }
    catch (e: any) { setNote(bookingConflictText(e, tx('pos.action_failed'))); if (e?.status === 409) await load(); }   // lost race → show the server's truth
    finally { setBusyId(null); }
  };

  const toggleDrawer = (a: Appt) => {
    if (openId === a.appointmentId) { setOpenId(null); return; }
    setOpenId(a.appointmentId); setNote(null); setReason(''); setTechSel('');
    // developer merge (Oct 2026): startTime is HH:MM — build the datetime-local value from the appointment's date + time
    try { const hm = /T(\d{2}:\d{2})/.exec(String(a.startTime))?.[1] ?? String(a.startTime).slice(0, 5); setWhenStr(hm ? `${a.date || s?.date || new Date().toISOString().slice(0, 10)}T${hm}` : ''); } catch { setWhenStr(''); }
  };
  const verOf = (aid: string) => { const v = s?.appointments.find((r) => r.appointmentId === aid)?.version; return v != null ? { expectedVersion: v } : {}; };
  const doAssign = (aid: string) => { if (!techSel) { setNote(tx('pos.pick_a_technician_to_assign')); return; } act(aid, () => posTechAppointmentsApi.assignTechnician(aid, { technicianId: techSel, ...verOf(aid) }), 'assign', true); };
  const doReschedule = (aid: string) => {
    if (!whenStr) { setNote(tx('pos.pick_a_new_date_time')); return; }
    const startTime = whenStr.slice(11, 16); const date = whenStr.slice(0, 10);   // the API takes HH:MM + date, not an ISO instant
    act(aid, () => posTechAppointmentsApi.reschedule(aid, { startTime, date, ...(techSel ? { technicianId: techSel } : {}), ...verOf(aid) }), 'resch', true);
  };
  const doCancel = (aid: string) => { if (!reason.trim()) { setNote(tx('pos.a_reason_is_required_to_cancel')); return; } act(aid, () => posTechAppointmentsApi.cancel(aid, { reason: reason.trim() }), 'cancel', true); };

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_tech_appointments')}</div></div>;

  const k = s.kpis;
  const kpis: { l: string; v: string }[] = [
    { l: tx('pos.today_2'), v: String(k.totalAppointmentsToday) },
    { l: tx('pos.booked'), v: String(k.bookedAppointments) },
    { l: tx('pos.checked_in_2'), v: String(k.checkedInAppointments) },
    { l: tx('pos.in_service_3'), v: String(k.inServiceAppointments) },
    { l: tx('pos.completed_2'), v: String(k.completedAppointments) },
    { l: tx('pos.cancelled'), v: String(k.cancelledAppointments) },
    { l: tx('pos.no_shows_2'), v: String(k.noShowAppointments) },
    { l: tx('pos.online'), v: String(k.onlineBookings) },
    { l: tx('pos.conflicts_2'), v: String(k.conflictCount) },
  ];
  const byTech = (techId: string) => s.appointments.filter((a) => a.technicianId === techId).sort((x, y) => x.startTime.localeCompare(y.startTime));

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.tech_appointments')}</h1>
        <div className="sub">{tx('pos.per_technician_schedule')}{' '}{s.date}</div>
      </div>

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}
      {error ? <div className="err" style={{ marginBottom: 12 }}>{tx('pos.couldn_t_refresh_showing_the_last_14pz')}{' '}{error}</div> : null}

      <div className="kpis">
        {kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v">{c.v}</div></div>))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }} data-testid="ta-lane-pager">
        <ImeSafeInput type="search" aria-label={tx('pos.find_technician')} placeholder={tx('pos.find_technician_placeholder')} value={laneSearch} onValue={setLaneSearch}
          style={{ ...inputStyle, width: 'auto', flex: '1 1 200px', minWidth: 0, height: 36 }} />
        {s.lanes ? <span className="s">{tx('pos.n_technicians', { n: String(s.lanes.total) })}</span> : null}
        {s.lanes && s.lanes.totalPages > 1 ? (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="btn ghost" disabled={s.lanes.page <= 1} onClick={() => setLanePage(Math.max(1, s.lanes!.page - 1))}>{tx('pos.previous')}</button>
            <span>{tx('pos.page_x_of_y', { page: String(s.lanes.page), pages: String(s.lanes.totalPages) })}</span>
            <button type="button" className="btn ghost" disabled={s.lanes.page >= s.lanes.totalPages} onClick={() => setLanePage(Math.min(s.lanes!.totalPages, s.lanes!.page + 1))}>{tx('pos.next')}</button>
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
        {s.technicians.length === 0 ? <div className="muted">{tx('pos.no_technicians_scheduled')}</div> : null}
        {s.technicians.map((tech) => {
          const appts = byTech(tech.technicianId);
          return (
            <div className="panel" key={tech.technicianId} style={{ minWidth: 300, maxWidth: 320, flex: '0 0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <ProfileAvatarWithPreview name={tech.displayName} url={(tech as any).avatarUrl} size={24} type="technician" />
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 15 }}>{tech.displayName}</div>
                <span className={'pill ' + tone(tech.workingStatus)} style={{ marginLeft: 'auto' }}>{opsStatusLabel(tech.workingStatus)}</span>
              </div>
              <div className="s" style={{ marginBottom: 4 }}>{tech.appointmentCount} {tx('pos.appts')}{' '}{tech.scheduledMinutes}{tx('pos.m_booked')}{' '}{tech.availableMinutes}{tx('pos.m_free')}</div>
              {tech.serviceSkillGroups?.length ? <div className="s" style={{ marginBottom: 10 }}>{tech.serviceSkillGroups.join(' · ')}</div> : <div style={{ marginBottom: 10 }} />}
              <div className="list" style={{ maxHeight: 'calc(100vh - 340px)' }}>
                {appts.length === 0 ? <div className="muted">{tx('pos.no_appointments')}</div> : null}
                {appts.map((a) => (
                  <div className="row" key={a.appointmentId} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div className="s">{tm(a.startTime)}–{tm(a.endTime)}</div>
                      <span className={'pill ' + statusTone(a.status)} style={{ marginLeft: 'auto' }}>{formatStatusLabel(a.status)}</span>
                    </div>
                    <div className="t" style={{ display: 'flex', alignItems: 'center', gap: 5 }}><ProfileAvatarWithPreview name={a.customerName} url={(a as any).customerAvatarUrl || (a as any).avatarUrl} size={18} type="customer" />{a.customerName} {a.isVip ? <span className="pill warn" style={{ marginLeft: 2 }}>VIP</span> : null}</div>
                    <div className="s">{svcNames(a.services) || '—'} · {statusLabel('source', a.source)}</div>
                    {(a.depositStatus && a.depositStatus !== 'none') || (a.conflictStatus && a.conflictStatus !== 'none') ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {a.depositStatus === 'pending' ? <span className="pill warn">{tx('pos.deposit_pending')}</span>
                          : a.depositStatus === 'collected' ? <span className="pill ok">{tx('pos.deposit_paid_2')}</span>
                          : a.depositStatus === 'refunded' ? <span className="pill">{tx('pos.deposit_refunded')}</span>
                          : a.depositStatus && !['none', 'not_required'].includes(a.depositStatus) ? <span className="pill">{humanizeCode(a.depositStatus)}</span>
                          : null}
                        {a.conflictStatus && a.conflictStatus !== 'none' ? <span className="pill warn">{tx('pos.conflict')}</span> : null}
                      </div>
                    ) : null}
                    {(() => {
                      const st = (a.status || '').toLowerCase();
                      const isBookedOrConfirmed = st === 'booked' || st === 'confirmed';
                      const isCheckedInOrArrived = st === 'checked_in' || st === 'arrived';
                      const isWaitingOrQueue = st === 'waiting' || st === 'queue' || st === 'in_queue';

                      const showCheckIn = isBookedOrConfirmed;
                      const showNoShow = isBookedOrConfirmed || isCheckedInOrArrived;
                      const showStart = isBookedOrConfirmed || isCheckedInOrArrived || isWaitingOrQueue;

                      return (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {showCheckIn && (
                            <button className="btn ghost" style={{ padding: '6px 9px', fontSize: 11 }} disabled={busyId === a.appointmentId + 'ci'} onClick={() => act(a.appointmentId, () => posCheckInApi.appointmentCheckIn(a.appointmentId), 'ci')}>{tx('pos.check_in')}</button>
                          )}
                          {showNoShow && (
                            <button className="btn ghost" style={{ padding: '6px 9px', fontSize: 11 }} disabled={busyId === a.appointmentId + 'ns'} onClick={() => act(a.appointmentId, () => posTechAppointmentsApi.noShow(a.appointmentId), 'ns')}>{tx('pos.no_show_2')}</button>
                          )}
                          {showStart && (
                            <button className="btn ghost" style={{ padding: '6px 9px', fontSize: 11 }} disabled={busyId === a.appointmentId + 'ss'} onClick={() => act(a.appointmentId, () => posTechAppointmentsApi.startService(a.appointmentId), 'ss')}>{tx('pos.start')}</button>
                          )}
                          <button className="btn" style={{ padding: '6px 9px', fontSize: 11, marginLeft: 'auto' }} onClick={() => toggleDrawer(a)}>{openId === a.appointmentId ? tx('pos.close') : tx('pos.manage')}</button>
                        </div>
                      );
                    })()}

                    {openId === a.appointmentId ? (
                      <div style={{ border: '1px solid var(--line)', borderRadius: 9, padding: 9, background: '#FFFDF8', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                        <TechnicianPickerButton value={techSel} emptyLabel={tx('pos.choose_technician')} ariaLabel={tx('pos.choose_technician')}
                          date={a.date || s.date} serviceIds={a.services.map((x) => x.serviceId || '').filter(Boolean)} onChange={(id) => setTechSel(id)} style={{ maxWidth: '100%' }} />
                        <input type="datetime-local" value={whenStr} onChange={(e) => setWhenStr(e.target.value)} style={inputStyle} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn ghost" style={{ padding: '6px 9px', fontSize: 11 }} disabled={busyId === a.appointmentId + 'assign'} onClick={() => doAssign(a.appointmentId)}>{tx('pos.assign')}</button>
                          <button className="btn" style={{ padding: '6px 9px', fontSize: 11 }} disabled={busyId === a.appointmentId + 'resch'} onClick={() => doReschedule(a.appointmentId)}>{tx('pos.reschedule')}</button>
                        </div>
                        <input placeholder={tx('pos.cancel_reason_3')} value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
                        <button className="btn ghost" style={{ padding: '6px 9px', fontSize: 11, color: 'var(--danger)' }} disabled={busyId === a.appointmentId + 'cancel'} onClick={() => doCancel(a.appointmentId)}>{tx('pos.cancel_appointment')}</button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
