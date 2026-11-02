// MoveAppointmentModal.tsx — the §14 dedicated Move Appointment workflow (the no-drag alternative).
// Everything shown is real backend data: suggested slots come from /pos/booking/day-grid for the chosen date
// (per-technician continuous open ranges), the move itself goes through the same POST …/reschedule the calendar
// drag uses (server re-validates schedule windows + conflicts), and the reason lands in the append-only audit
// trail. Nothing here fabricates availability.
import { useEffect, useMemo, useState } from 'react';
import { bookingConflictText, posBookingApi } from '../api/posBookingApi';
import { calLabel, calMinutes, calRangeLabel, calHHMM, calFitsIn, type DayGrid } from '../screens/POSBookingScreen';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { TechnicianPickerButton } from './TechnicianPickerButton';

type ServiceLine = { serviceName?: string; name?: string };
export interface MoveApptRow {
  appointmentId: string; customerName: string; technicianId?: string; technicianName?: string;
  services: ServiceLine[]; startTime: string; endTime: string; durationMinutes: number; status: string;
}

const inputStyle: React.CSSProperties = { font: 'inherit', fontSize: 13, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#FFFDF8' };
const isoDate = (t: string): string => { try { const d = new Date(t); if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; } catch { /* fall through */ } return ''; };
const hhmm = (t: string): string => { const m = calMinutes(t); return m == null ? '' : calHHMM(m); };

export function MoveAppointmentModal({ appt, defaultDate, onClose, onMoved }: {
  appt: MoveApptRow;
  /** @deprecated (200-technician mandate §57): the technician is chosen from the server-paged picker; ignored */
  technicians?: { technicianId: string; name: string }[];
  defaultDate?: string;
  onClose: () => void;
  onMoved: () => Promise<void> | void;
}) {
  const dur = appt.durationMinutes || Math.max(15, (calMinutes(appt.endTime) ?? 0) - (calMinutes(appt.startTime) ?? 0)) || 30;
  const [date, setDate] = useState(isoDate(appt.startTime) || defaultDate || '');
  const [techId, setTechId] = useState(appt.technicianId || '');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [overbookAsked, setOverbookAsked] = useState(false);
  const [notify, setNotify] = useState(true);
  const [gridDay, setGridDay] = useState<DayGrid | null>(null);
  const [gridBusy, setGridBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Real availability for the chosen date — the same day-grid the calendar renders from, for the chosen technician only
  // (200-technician mandate: it read every technician's whole day to show one column's open ranges).
  useEffect(() => {
    let alive = true;
    setGridDay(null);
    if (!techId) { setGridBusy(false); return () => { alive = false; }; }
    setGridBusy(true);
    posBookingApi.dayGrid(date || undefined, [techId])
      .then((g) => { if (alive) setGridDay(g && Array.isArray(g.columns) ? (g as DayGrid) : null); })
      .catch(() => { if (alive) setGridDay(null); })
      .finally(() => { if (alive) setGridBusy(false); });
    return () => { alive = false; };
  }, [date, techId]);

  const col = useMemo(() => gridDay?.columns.find((c) => c.technicianId === techId) || null, [gridDay, techId]);
  const suggestions = useMemo(() => (col?.openRanges || []).filter((r) => r.minutes >= dur).slice(0, 8), [col, dur]);
  const svc = appt.services.map((x) => x.serviceName || x.name || '').filter(Boolean).join(', ');
  const oldStart = calMinutes(appt.startTime);

  const submit = async () => {
    if (!time) { setMsg({ text: tx('pos.pick_a_new_start_time_a_srbx') }); return; }
    setBusy(true); setMsg(null);
    try {
      await posBookingApi.reschedule(appt.appointmentId, {
        startTime: time, date: date || undefined,
        ...(techId && techId !== appt.technicianId ? { technicianId: techId } : {}),
        notifyCustomer: notify, ...(reason.trim() ? { reason: reason.trim() } : {}),
        expectedVersion: (appt as { version?: number }).version,   // spec §14–§16: a stale copy gets VERSION_CONFLICT, never overwrites
        // spec §11: after the server asked for confirmation, re-submitting with the reason field filled IS the confirmation
        ...(overbookAsked && reason.trim() ? { overbookConfirmed: true, overbookReason: reason.trim() } : {}),
      });
      setMsg({ ok: true, text: tx('pos.appointment_moved') });
      await onMoved();
      onClose();
    } catch (e: any) {
      if (e?.status === 409 && e.code === 'OVERBOOK_CONFIRMATION_REQUIRED') {
        setOverbookAsked(true);
        setMsg({ text: tx('pos.message_enter_the_reason_below_and_sh9w', { message: String(e.message) }) });
      } else {
        setMsg({ text: bookingConflictText(e, tx('ops.booking.moveFailed')) });
        if (e?.status === 409) void onMoved();   // spec §12: refresh the schedule behind the modal to the server's truth
      }
    } finally { setBusy(false); }
  };

  return (
    <>
      <div aria-hidden onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(40,30,15,0.35)', zIndex: 80 }} />
      <div role="dialog" aria-modal="true" aria-label={tx('pos.move_appointment_for_customername', { customerName: String(appt.customerName) })}
        style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(560px, 94vw)', maxHeight: '88vh', overflow: 'auto', zIndex: 81, background: '#FBF6EC', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 18px 48px rgba(60,45,20,0.25)', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0, flex: 1 }}>{tx('pos.move_appointment')}</h2>
          <button className="btn ghost" onClick={onClose} aria-label={tx('pos.close_move_dialog')}>✕</button>
        </div>

        <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8', marginBottom: 10 }}>
          <div style={{ fontWeight: 700 }}>{appt.customerName}</div>
          <div className="s">{svc || 'appointment'} · {dur} {tx('pos.min')}</div>
          <div className="s" style={{ marginTop: 4 }}>
            {tx('pos.currently')}{' '}{isoDate(appt.startTime) || '—'}{oldStart != null ? ` · ${calLabel(oldStart)}–${calLabel(oldStart + dur)}` : ''}{appt.technicianName ? ` · ${appt.technicianName}` : appt.technicianId ? '' : tx('pos.unassigned_3')}
          </div>
        </div>

        {msg ? <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, fontSize: 12.5, background: msg.ok ? '#E8F5E9' : '#FDECEA', color: msg.ok ? '#1B5E20' : '#B3261E', border: `1px solid ${msg.ok ? '#2E7D3233' : '#C0392B33'}` }}>{msg.text}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="s" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{tx('pos.new_date')}
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} style={inputStyle} />
          </label>
          <label className="s" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{tx('pos.technician')}
            <TechnicianPickerButton value={techId} valueName={techId === appt.technicianId ? appt.technicianName : undefined} ariaLabel={tx('pos.technician')}
              emptyLabel={tx('pos.keep_unassigned')} anyLabel={tx('pos.keep_unassigned')} date={date || undefined}
              onChange={(id) => { setTechId(id); setTime(''); }} style={{ height: 34, width: '100%', maxWidth: 'none' }} />
          </label>
        </div>

        <div className="s" style={{ margin: '10px 0 4px' }}>{tx('pos.suggested_open_ranges')}{' '}{gridBusy ? tx('pos.loading_2') : col ? `· ${col.name}` : techId ? '' : tx('pos.pick_a_technician_to_see_real_1x9f')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 30 }}>
          {!gridBusy && techId && col && suggestions.length === 0 ? <span className="s">{col.openRanges.length ? tx('pos.no_open_range_fits_dur_min_1154', { dur: String(dur) }) : col.windows.length === 0 ? tx('pos.not_scheduled_this_day') : tx('pos.fully_booked_this_day')}</span> : null}
          {suggestions.map((r) => {
            const sel = time === calHHMM(r.start);
            const fit = calFitsIn(r.minutes, dur);
            return (
              <button key={r.start} onClick={() => setTime(calHHMM(r.start))}
                title={tx('pos.v0_minutes_min_open', { v0: String(calRangeLabel(r.start, r.end)), minutes: String(r.minutes) })}
                style={{ font: 'inherit', fontSize: 11.5, padding: '4px 9px', borderRadius: 999, cursor: 'pointer', border: sel ? '2px solid #A96F22' : fit === 'fits' ? '1px solid #2E7D32' : '1px dashed #B9A778', background: sel ? '#FFF4DE' : '#FFFDF8', color: '#7A5E22', fontWeight: sel ? 700 : 400 }}>
                {calRangeLabel(r.start, r.end)} · {r.minutes} {tx('pos.min')}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label className="s" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{tx('pos.new_start_time')}
            <input type="time" value={time} onChange={(e) => setTime(hhmm(e.target.value) || e.target.value)} step={((gridDay?.slotIntervalMinutes || 15) * 60)} style={inputStyle} />
          </label>
          <div className="s" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{tx('pos.new_end_time')}
            <div style={{ ...inputStyle, display: 'flex', alignItems: 'center' }}>{time && calMinutes(time) != null ? calLabel((calMinutes(time) as number) + dur) : '—'}</div>
          </div>
        </div>

        <label className="s" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>{tx('pos.reason_for_move_goes_to_the_15cs')}
          <input placeholder={tx('pos.customer_requested_tech_out_double_booked')} value={reason} onChange={(e) => setReason(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {tx('pos.notify_the_customer_of_the_change')}
        </label>

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={onClose}>{tx('pos.cancel')}</button>
          <button className="btn" disabled={busy || !time} onClick={submit}>{busy ? tx('pos.moving') : tx('pos.move_appointment_2')}</button>
        </div>
        <div className="s" style={{ marginTop: 8 }}>{tx('pos.the_server_re_validates_the_technician_1ayg')}</div>
      </div>
    </>
  );
}
