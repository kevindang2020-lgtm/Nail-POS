import { useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { customerApi, type CustomerAppointmentItem, type CustomerActiveService, type CustomerSalonInfo } from '../api/customerApi';
import { apptWhen, statusText, STEPS, stepIndex, bucketOf } from '../lib/appt';
import { useCustomerStream } from '../api/useCustomerStream';
import { FiAlertTriangle } from 'react-icons/fi';
// Appointment Details + live status. The appointment is passed via router state from My Appointments; if opened
// directly it is refetched from /customer/appointments. Live progress comes from /customer/service-progress (the
// customer's current active service) — never a local timer. Actions without a backend yet (cancel, contact, live
// queue) reuse real data: Call/Message dial the salon's real phone (tel:/sms:); cancel stays disabled (no endpoint).
function LiveHero({ step, label }: { step: number; label: string }) {
  return (
    <div className="cust-hero">
      <div style={{ fontWeight: 800, fontSize: 18 }}>{label}</div>
      <div style={{ opacity: 0.85, fontSize: 12.5, marginTop: 2 }}>This is your live status</div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 16 }}>
        {STEPS.map((s, i) => {
          const done = i <= step;
          return (
            <div key={s} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
              {i > 0 && <div style={{ position: 'absolute', top: 11, right: '50%', width: '100%', height: 2, background: i <= step ? '#fff' : 'rgba(255,255,255,0.3)' }} />}
              <div style={{
                zIndex: 1, width: 24, height: 24, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 12,
                background: done ? '#fff' : 'transparent', color: done ? 'var(--customer-primary)' : '#fff', border: done ? '0' : '2px solid rgba(255,255,255,0.5)'
              }}>{done ? '✓' : ''}</div>
              <div style={{ fontSize: 10.5, marginTop: 5, opacity: i <= step ? 1 : 0.7, textAlign: 'center' }}>{s}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ContactButtons({ phone }: { phone: string | null }) {
  const round: CSSProperties = { width: 38, height: 38, borderRadius: 999, background: 'var(--customer-primary-light)', color: 'var(--customer-primary)', display: 'grid', placeItems: 'center', fontSize: 16, textDecoration: 'none', border: 0 };
  if (!phone) return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button disabled aria-label="Call" style={{ ...round, opacity: 0.4, cursor: 'not-allowed' }}>📞</button>
      <button disabled aria-label="Message" style={{ ...round, opacity: 0.4, cursor: 'not-allowed' }}>💬</button>
    </div>
  );
  const tel = phone.replace(/[^0-9+]/g, '');
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <a href={`tel:${tel}`} aria-label="Call the salon" style={round}>📞</a>
      <a href={`sms:${tel}`} aria-label="Message the salon" style={round}>💬</a>
    </div>
  );
}

export function AppointmentDetailsScreen() {
  const nav = useNavigate();
  const { appointmentId } = useParams();
  const location = useLocation();
  const passed = (location.state as any)?.appt as CustomerAppointmentItem | undefined;
  const [appt, setAppt] = useState<CustomerAppointmentItem | null>(passed || null);
  const [active, setActive] = useState<CustomerActiveService | null>(null);
  const [salon, setSalon] = useState<CustomerSalonInfo | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tech, setTech] = useState<{ avatarUrl?: string | null; averageRating: number | null; reviewCount: number | null; title: string | null; specialties: string[] } | null>(null);

  const mounted = useRef(true);
  const refreshLive = useCallback(() => {
    customerApi.serviceProgress().then((s) => mounted.current && setActive(s)).catch(() => { /* best-effort */ });
    if (appointmentId) customerApi.appointments().then((list) => { if (mounted.current) { const f = list.find((a) => a.appointmentId === appointmentId); if (f) setAppt(f); } }).catch(() => { /* best-effort */ });
  }, [appointmentId]);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    if (!passed) {
      customerApi.appointments().then((list) => { if (live) { const f = list.find((a) => a.appointmentId === appointmentId); if (f) { setAppt(f); } else { setError('Appointment not found.'); } } }).catch((e: any) => live && setError(e?.message || 'Could not load this appointment.'));
    }
    customerApi.serviceProgress().then((s) => live && setActive(s)).catch(() => { /* live status is best-effort */ });
    customerApi.salon().then((s) => live && setSalon(s)).catch(() => { /* salon info is best-effort */ });
    return () => { live = false; mounted.current = false; };
  }, [appointmentId, passed]);
  // Realtime: refresh the live status as soon as the service/queue/ticket changes for this salon.
  useCustomerStream((ev) => { if (['reconcile', 'service_started', 'service_done', 'ticket_ready_checkout', 'ticket_paid', 'queue_updated', 'appointment_updated'].includes(ev)) refreshLive(); });

  // Tech card enrichment: rating + reviews + specialties + avatar photo for the booked technician.
  const loadTech = useCallback(async () => {
    try {
      const sid = appt?.serviceId, tid = appt?.technicianId;
      if (!sid || !tid) return;
      const r = await customerApi.bookingServiceTechnicians(sid);
      const t = r.technicians.find((x) => x.technicianId === tid);
      if (!t) return;
      let specialties: string[] = [];
      let avatarUrl = t.avatarUrl || null;
      if (t.publicSlug) {
        try {
          const p = await customerApi.techProfile(t.publicSlug);
          specialties = p.specialties || [];
          if (!avatarUrl && p.avatarUrl) avatarUrl = p.avatarUrl;
        } catch { /* profile is best-effort */ }
      }
      if (mounted.current) {
        setTech({
          avatarUrl,
          averageRating: t.averageRating,
          reviewCount: t.reviewCount,
          title: t.title,
          specialties,
        });
      }
    } catch { /* enrichment is best-effort */ }
  }, [appt?.serviceId, appt?.technicianId]);
  useEffect(() => { loadTech(); }, [loadTech]);

  const back = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
      <button onClick={() => nav(-1)} aria-label="Back" className="customer-back">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1 className="cust-h1" style={{ fontSize: 20, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{appt?.serviceName || 'Appointment Details'}</h1>
    </div>
  );

  if (error) return <div style={{ padding: 18 }}>{back}<div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div></div>;
  if (!appt) return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}
      <div className="cust-card" style={{ padding: 16 }}><div className="cust-skel" style={{ width: 100, height: 26, borderRadius: 12 }} /></div>
      <div className="cust-card" style={{ padding: 16 }}>
        <div className="cust-skel" style={{ width: 120, height: 14 }} />
        <div className="cust-skel" style={{ width: 180, height: 20, marginTop: 4 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <div className="cust-skel" style={{ width: 40, height: 40, borderRadius: '50%' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="cust-skel" style={{ width: 100, height: 16 }} />
            <div className="cust-skel" style={{ width: 140, height: 14 }} />
          </div>
        </div>
      </div>
    </div>
  );

  // Live status: prefer the active-service status if it is the one in progress; otherwise use the appointment's status.
  const liveStatus = active?.status || appt.status;
  const step = stepIndex(liveStatus);

  const doCancel = async () => {
    setCancelBusy(true);
    try {
      const r = await customerApi.cancelAppointment(appt.appointmentId);
      if (r.ok) setAppt({ ...appt, status: 'cancelled' });
      else setError('This appointment can no longer be cancelled — please contact the salon.');
    } catch (e: any) { setError(e?.message || 'Could not cancel the appointment.'); }
    finally { setCancelBusy(false); setCancelOpen(false); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {back}

      {step >= 0 ? <LiveHero step={step} label={active ? statusText(active.status) : STEPS[step]} />
        : <div className="cust-card" style={{ padding: 16 }}><span className="cust-pill cust-pill-purple">{statusText(appt.status)}</span><div className="cust-sub" style={{ marginTop: 8 }}>Live status will appear here once you’re checked in.</div></div>}

      <div className="cust-card" style={{ padding: 16 }}>
        <div style={{ color: 'var(--customer-primary)', fontWeight: 700, fontSize: 13 }}>{apptWhen(appt.startTime)}</div>
        <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>{appt.serviceName || 'Appointment'}</div>
        {appt.technicianName ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            {tech?.avatarUrl ? (
              <img
                src={tech.avatarUrl}
                alt={appt.technicianName}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '1.5px solid var(--customer-border)',
                }}
              />
            ) : (
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: 'var(--customer-primary-light)',
                  color: 'var(--customer-primary)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  fontSize: 15,
                }}
                aria-hidden
              >
                {appt.technicianName
                  .split(/\s+/)
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase()}
              </span>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{appt.technicianName}</div>
              {tech?.averageRating != null
                ? <div className="cust-sub" style={{ fontSize: 12.5 }}>★ {tech.averageRating.toFixed(1)}{tech.reviewCount != null ? ` (${tech.reviewCount})` : ''}</div>
                : <div className="cust-sub" style={{ fontSize: 12 }}>Technician</div>}
              {tech && (tech.specialties.length > 0 || tech.title) ? <div className="cust-sub" style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Specialty: {tech.specialties.length > 0 ? tech.specialties.slice(0, 3).join(', ') : tech.title}</div> : null}
            </div>
            <ContactButtons phone={salon?.phone || null} />
          </div>
        ) : null}
      </div>

      {/* Salon location — real branch name + address (Call/Message above dial the salon's real number). */}
      {salon && (salon.name || salon.address) ? (
        <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span aria-hidden style={{ fontSize: 18, marginTop: 1 }}>📍</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{salon.name}</div>
            {salon.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(salon.address)}`} target="_blank" rel="noreferrer" className="cust-sub" style={{ fontSize: 13, marginTop: 2, color: 'var(--customer-primary)', textDecoration: 'none', display: 'block' }}>{salon.address}</a> : null}
          </div>
        </div>
      ) : null}

      <button onClick={() => nav('/queue')} className="cust-btn cust-btn-ghost">View Live Queue</button>
      {bucketOf(appt.status) === 'upcoming' && appt.serviceId && appt.technicianId ? <button onClick={() => nav(`/appointments/${appt.appointmentId}/reschedule`, { state: { appt } })} className="cust-btn cust-btn-ghost" style={{ marginTop: 10 }}>Reschedule</button> : null}

      {bucketOf(appt.status) === 'upcoming' && (
        <button onClick={() => setCancelOpen(true)} style={{ width: '100%', height: 48, border: 0, borderRadius: 14, background: 'var(--customer-red-light)', color: 'var(--customer-red)', fontWeight: 700, cursor: 'pointer' }}>Cancel Appointment</button>
      )}

      {cancelOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel appointment"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(28, 20, 14, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCancelOpen(false);
          }}
        >
          <div
            style={{
              width: 'min(420px, 92vw)',
              background: '#FFFFFF',
              borderRadius: 24,
              padding: '24px 22px 20px',
              boxShadow: '0 25px 60px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(212, 175, 55, 0.2)',
              border: '1px solid #DFC37B',
              textAlign: 'center',
            }}
          >
            {/* Cancel Icon */}
            <div
              style={{
                width: 54,
                height: 54,
                margin: '0 auto 12px',
                borderRadius: '50%',
                background: 'rgba(220, 38, 38, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(220, 38, 38, 0.2)',
              }}
            >
              <FiAlertTriangle size={26} color="var(--customer-red)" />
            </div>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#1F2937' }}>Cancel this appointment?</div>
            <div className="cust-sub" style={{ marginTop: 6, marginBottom: 22, fontSize: 13.5, color: '#6B7280' }}>
              {appt.serviceName ? `${appt.serviceName} · ` : ''}{apptWhen(appt.startTime)}. This action cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="cust-btn cust-btn-ghost"
                style={{ height: 46, flex: 1, borderRadius: 12, border: '1px solid #E5E7EB', color: '#4B5563', fontWeight: 700 }}
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={doCancel}
                disabled={cancelBusy}
                className="cust-btn"
                style={{ height: 46, flex: 1.2, borderRadius: 12, background: 'var(--customer-red)', color: '#fff', fontWeight: 800, border: 'none' }}
              >
                {cancelBusy ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
