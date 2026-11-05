import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { customerApi, type CustomerAppointmentItem, type AvailabilitySlot } from '../api/customerApi';

// Reschedule — moves an existing upcoming appointment to a new date/time. Slots come from the SAME conflict-aware
// availability endpoint booking uses (scoped to this appointment's technician), and the backend re-checks on submit,
// so a double-book is impossible. The appointment (with serviceId/technicianId) arrives via router state from details.
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmt12 = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const h12 = h % 12 || 12; return `${h12}:${String(m).padStart(2, '0')} ${ap}`; };

export function RescheduleScreen() {
  const nav = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  const passed = (location.state as any)?.appt as CustomerAppointmentItem | undefined;
  const [appt, setAppt] = useState<CustomerAppointmentItem | null>(passed || null);
  const [error, setError] = useState<string | null>(null);

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + i); return d; }), [today]);
  const [date, setDate] = useState(ymd(today));
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // if opened directly (no router state), recover the appointment from the list
  useEffect(() => { if (appt || !id) return; let live = true; customerApi.appointments().then((list) => { if (live) setAppt(list.find((a) => a.appointmentId === id) || null); }).catch((e: any) => live && setError(e?.message || 'Could not load the appointment.')); return () => { live = false; }; }, [appt, id]);

  const serviceId = appt?.serviceId;
  const technicianId = appt?.technicianId;

  useEffect(() => {
    if (!serviceId) return; let live = true; setLoading(true); setSlot(null);
    customerApi.availability(serviceId, date, technicianId)
      .then((r) => { if (live) setSlots(r.slots.filter((s) => s.available)); })
      .catch((e: any) => live && setError(e?.message || 'Could not load times.'))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [serviceId, technicianId, date]);

  const confirm = async () => {
    if (!appt || !slot) return;
    setBusy(true); setMsg(null);
    try { await customerApi.reschedule(appt.appointmentId, date, slot.startTime); nav('/appointments'); }
    catch (e: any) { setMsg(e?.message || 'That time is no longer available. Please pick another.'); setSlot(null); customerApi.availability(serviceId!, date, technicianId).then((r) => setSlots(r.slots.filter((s) => s.available))).catch(() => {}); }
    finally { setBusy(false); }
  };

  const back = <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>;

  if (error) return <div style={{ padding: 18 }}>{back}<div className="cust-card" style={{ padding: 14, marginTop: 12, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div></div>;
  if (appt && !serviceId) return <div style={{ padding: 18 }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{back}<h1 className="cust-h1" style={{ fontSize: 20 }}>Reschedule</h1></div><div className="cust-card" style={{ padding: 20, marginTop: 12, textAlign: 'center' }}><div className="cust-sub">This appointment can’t be rescheduled in the app. Please contact the salon.</div></div></div>;

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{back}<h1 className="cust-h1" style={{ fontSize: 20 }}>Reschedule</h1></div>
      {appt ? <div className="cust-sub">{appt.serviceName}{appt.technicianName ? ` · ${appt.technicianName}` : ''}</div> : <div className="cust-skel" style={{ height: 18, width: 160 }} />}

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {days.map((d) => { const v = ymd(d); const sel = v === date; return (
          <button key={v} onClick={() => setDate(v)} aria-pressed={sel} aria-label={d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            style={{ flex: '0 0 auto', width: 52, height: 64, borderRadius: 14, cursor: 'pointer', border: sel ? 0 : '1px solid var(--customer-border)', background: sel ? 'var(--customer-primary)' : '#fff', color: sel ? '#fff' : 'var(--customer-text)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <span style={{ fontSize: 11, opacity: 0.8 }}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <span style={{ fontWeight: 800, fontSize: 16 }}>{d.getDate()}</span>
          </button>
        ); })}
      </div>
      <div style={{ fontWeight: 700, textAlign: 'center' }}>{new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => <div key={i} className="cust-skel" style={{ height: 50, borderRadius: 14 }} />)}
        </div>
      ) : !slots || slots.length === 0 ? <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}><div className="cust-sub">No available times for this date.</div></div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {slots.map((s) => { const sel = slot?.startTime === s.startTime; return (
              <button key={s.startTime} onClick={() => setSlot(s)} aria-pressed={sel}
                style={{ height: 50, borderRadius: 14, cursor: 'pointer', border: sel ? 0 : '1px solid var(--customer-border)', background: sel ? 'var(--customer-primary)' : '#fff', color: sel ? '#fff' : 'var(--customer-text)', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px' }}>
                <span>{fmt12(s.startTime)}</span>{sel ? <span aria-hidden>✓</span> : null}
              </button>
            ); })}
          </div>
        )}

      {msg ? <div className="cust-sub" style={{ color: 'var(--customer-red)' }}>{msg}</div> : null}
      <button onClick={confirm} disabled={!slot || busy} className="cust-btn" style={{ height: 52, opacity: !slot || busy ? 0.6 : 1 }}>{busy ? 'Rescheduling…' : 'Confirm new time'}</button>
    </div>
  );
}
