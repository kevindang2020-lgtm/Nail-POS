import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerAppointmentItem } from '../api/customerApi';
import { apptWhen } from '../lib/appt';

// Check In (Home → Check In) — lets a customer self-check-in for a TODAY appointment. POST /customer/appointments/:id/
// check-in creates the real pos_queue_items row (the same the POS uses) and flips the appointment to checked_in, then we
// route to the Live Queue. No fabricated state; eligibility comes from the real appointment list.
const isToday = (iso: string) => { const d = new Date(iso); return !isNaN(d.getTime()) && d.toDateString() === new Date().toDateString(); };
const ELIGIBLE = ['booked', 'confirmed', 'arrived'];   // = CHECK_IN_ELIGIBLE_STATUSES (Decision 38); the server re-checks
const ALREADY = ['checked_in', 'waiting', 'assigned', 'in_service', 'serving', 'nearly_finished', 'in_progress'];

export function CheckInScreen() {
  const nav = useNavigate();
  const [items, setItems] = useState<CustomerAppointmentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { let live = true; customerApi.appointments().then((d) => { if (live) setItems(d); }).catch((e: any) => live && setError(e?.message || 'Could not load your appointments.')); return () => { live = false; }; }, []);

  const today = (items || []).filter((a) => isToday(a.startTime));
  const eligible = today.find((a) => ELIGIBLE.includes((a.status || '').toLowerCase()));
  const already = today.find((a) => ALREADY.includes((a.status || '').toLowerCase()));

  const checkIn = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await customerApi.checkIn(id); if (r.ok) nav('/queue'); else setMsg(r.message || 'Could not check in.'); }
    catch (e: any) { setMsg(e?.message || 'Could not check in.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => nav(-1)} aria-label="Back" style={{ border: 0, background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--customer-text)' }}>‹</button>
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Check In</h1>
      </div>

      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? (
          <div className="cust-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div className="cust-skel" style={{ width: 44, height: 44, borderRadius: '50%' }} />
            <div className="cust-skel" style={{ width: 140, height: 20, marginTop: 4 }} />
            <div className="cust-skel" style={{ width: 180, height: 14 }} />
            <div className="cust-skel" style={{ width: 160, height: 16, marginTop: 8 }} />
            <div className="cust-skel" style={{ width: 120, height: 14 }} />
            <div className="cust-skel" style={{ width: '100%', height: 50, borderRadius: 12, marginTop: 10 }} />
          </div>
        )
        : eligible ? (
          <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 36 }}>📍</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>You're here!</h2>
            <div className="cust-sub" style={{ marginTop: 2 }}>Check in for your appointment</div>
            <div style={{ marginTop: 14, fontWeight: 800, fontSize: 16 }}>{eligible.serviceName}</div>
            <div className="cust-sub" style={{ fontSize: 13 }}>{apptWhen(eligible.startTime)}{eligible.technicianName ? ` · ${eligible.technicianName}` : ''}</div>
            <button onClick={() => checkIn(eligible.appointmentId)} disabled={busy} className="cust-btn" style={{ height: 50, marginTop: 16 }}>{busy ? 'Checking in…' : 'Check In'}</button>
            {msg ? <div className="cust-sub" style={{ color: 'var(--customer-red)', marginTop: 10 }}>{msg}</div> : null}
          </div>
        ) : already ? (
          <div className="cust-card" style={{ padding: 20, textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 36 }}>✅</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>You're checked in</h2>
            <div className="cust-sub" style={{ marginTop: 2 }}>{already.serviceName} · {apptWhen(already.startTime)}</div>
            <button onClick={() => nav('/queue')} className="cust-btn" style={{ height: 50, marginTop: 16 }}>View Live Queue</button>
          </div>
        ) : (
          <div className="cust-card" style={{ padding: 24, textAlign: 'center' }}>
            <div aria-hidden style={{ fontSize: 36 }}>🗓️</div>
            <h2 className="cust-h2" style={{ marginTop: 8 }}>No appointment to check into today</h2>
            <div className="cust-sub" style={{ marginTop: 4 }}>You can check in on the day of your appointment.</div>
            <button onClick={() => nav('/book')} className="cust-btn cust-btn-ghost" style={{ height: 48, marginTop: 16 }}>Book an appointment</button>
          </div>
        )}
    </div>
  );
}
