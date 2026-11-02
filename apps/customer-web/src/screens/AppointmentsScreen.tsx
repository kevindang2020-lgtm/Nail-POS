import { useEffect, useMemo, useState } from 'react';
import { useScopedQuery, OfflineStatus } from '@aipowersalon/mobile-sdk';
import { useNavigate, Link } from 'react-router-dom';
import { customerScheduleProposalsApi, isPendingProposal } from '../api/customerScheduleProposalsApi';
import { customerApi, type CustomerAppointmentItem } from '../api/customerApi';
import { apptWhen, bucketOf, statusText, type Bucket } from '../lib/appt';
import { isGuest, exitGuestMode } from '../auth/guest';

const TABS: { key: Bucket; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];
const EMPTY: Record<Bucket, string> = {
  upcoming: 'No upcoming appointments.',
  past: 'No past appointments yet.',
  cancelled: 'No cancelled appointments.',
};

export function AppointmentsScreen() {
  const nav = useNavigate();
  // A guest has no appointments: nothing is fetched; the screen invites them to sign in or explore salons.
  const guest = isGuest();
  // BUILD_PLAN Phase 13: appointments through the query layer (scoped to this customer, offline read cache — §18 "recent
  // appointments"). Availability is NEVER read from here for a booking (§20): BookScreen always asks the server.
  const aq = useScopedQuery<CustomerAppointmentItem[]>({ key: ['customer', 'appointments'], fn: () => customerApi.appointments(), persist: true, enabled: !guest });
  const items = aq.data ?? null;
  const error = !guest && !items && aq.isError ? ((aq.error as any)?.message || 'Could not load appointments.') : null;
  const [tab, setTab] = useState<Bucket>('upcoming');
  // BUILD_PLAN Phase 7: how many salon proposals (a new time / technician) wait for this customer's answer
  const [pendingProposals, setPendingProposals] = useState(0);
  useEffect(() => {
    if (guest) return;
    let live = true;
    customerScheduleProposalsApi.list().then((ps) => live && setPendingProposals(ps.filter(isPendingProposal).length)).catch(() => live && setPendingProposals(0));
    return () => { live = false; };
  }, [guest]);


  const filtered = useMemo(() => (items || []).filter((a) => bucketOf(a.status, a.startTime) === tab), [items, tab]);

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 'calc(100vh - 120px)', flex: 1, width: '100%', boxSizing: 'border-box' }}>
      <h1 className="cust-h1">My Appointments</h1>
      <OfflineStatus updatedAt={aq.dataUpdatedAt || undefined} failed={aq.isError} />
      {pendingProposals > 0 ? (
        <Link to="/appointments/proposals" data-testid="proposal-banner" className="cust-card"
          style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit', background: 'var(--customer-purple-100)', border: 0 }}>
          <span aria-hidden style={{ fontSize: 20 }}>🕑</span>
          <span style={{ flex: 1 }}><strong>Your salon suggested a new time for {pendingProposals} appointment{pendingProposals === 1 ? '' : 's'}</strong>
            <span className="cust-sub" style={{ display: 'block' }}>Your original time stays booked until you approve.</span></span>
          <span aria-hidden>›</span>
        </Link>
      ) : null}

      <div role="tablist" style={{ display: 'flex', gap: 8, background: 'var(--customer-purple-100)', padding: 4, borderRadius: 999 }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button key={t.key} role="tab" aria-selected={active} onClick={() => setTab(t.key)}
              style={{ flex: 1, border: 0, cursor: 'pointer', borderRadius: 999, padding: '9px 6px', fontWeight: 700, fontSize: 13.5,
                background: active ? 'var(--customer-primary)' : 'transparent', color: active ? '#fff' : 'var(--customer-text-secondary)' }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {guest ? (
        <div className="cust-card" style={{ padding: '36px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, flex: 1, minHeight: 300 }}>
          <div style={{ width: 70, height: 70, borderRadius: '50%', background: 'linear-gradient(135deg, #FBF3E4 0%, #EFE1C9 100%)', display: 'grid', placeItems: 'center', fontSize: 32, border: '1px solid #DBCAB0', boxShadow: '0 4px 14px rgba(169,111,34,.12)' }} aria-hidden>
            🗓️
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#2A2118', fontFamily: 'Georgia, serif' }}>
              Your Appointments
            </div>
            <div className="cust-sub" style={{ marginTop: 6, maxWidth: 320, fontSize: 13.5, lineHeight: 1.5 }}>
              Sign in with your phone or email to view your scheduled visits, reschedule appointments, and see live service status.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 260, marginTop: 6 }}>
            <button
              onClick={() => exitGuestMode()}
              className="cust-btn"
              style={{
                width: '100%',
                height: 48,
                fontSize: 15,
                background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
                color: '#fff',
                fontWeight: 700,
                boxShadow: '0 4px 14px rgba(169,111,34,.3)',
              }}
            >
              Sign In or Register
            </button>
            <button
              onClick={() => nav('/find-salons')}
              style={{
                width: '100%',
                height: 44,
                borderRadius: 12,
                border: '1px solid #E7DCC9',
                background: '#FFFFFF',
                color: '#655543',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Explore Nearby Salons
            </button>
          </div>
        </div>
      ) : error ? <div className="cust-card" style={{ padding: 16, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div>
        : !items ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="cust-card" style={{ width: '100%', padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="cust-skel" style={{ width: 52, height: 52, borderRadius: 12 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="cust-skel" style={{ width: 120, height: 14 }} />
                  <div className="cust-skel" style={{ width: 180, height: 16 }} />
                  <div className="cust-skel" style={{ width: 80, height: 22, borderRadius: 12 }} />
                </div>
              </div>
            ))}
          </div>
        )
        : filtered.length === 0 ? (
          <div className="cust-card" style={{ padding: '40px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, flex: 1, minHeight: 280 }}>
            <span style={{ width: 68, height: 68, borderRadius: '50%', background: 'var(--customer-purple-100)', display: 'grid', placeItems: 'center', fontSize: 32 }} aria-hidden>🗓️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--customer-text)' }}>{EMPTY[tab]}</div>
              <div className="cust-sub" style={{ marginTop: 4, maxWidth: 300, fontSize: 13, lineHeight: 1.4 }}>
                {tab === 'upcoming'
                  ? 'Book your next luxury nail, lash, or spa treatment with verified technicians.'
                  : tab === 'past'
                    ? 'Your completed appointments and treatment history will be listed here.'
                    : 'Appointments that were cancelled will appear here.'}
              </div>
            </div>
            {tab === 'upcoming' && (
              <button onClick={() => nav('/book')} className="cust-btn" style={{ maxWidth: 220, height: 46, fontSize: 15, marginTop: 4 }}>
                Book an Appointment
              </button>
            )}
          </div>
        )
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filtered.map((a) => (
              <button key={a.appointmentId} onClick={() => nav(`/appointments/${a.appointmentId}`, { state: { appt: a } })}
                className="cust-card" style={{ width: '100%', textAlign: 'left', padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                aria-label={`${a.serviceName || 'Appointment'} ${apptWhen(a.startTime)}, ${statusText(a.status)}`}>
                <span style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--customer-purple-100)', display: 'grid', placeItems: 'center', fontSize: 22, flex: '0 0 auto' }} aria-hidden>💅</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', color: 'var(--customer-primary)', fontWeight: 700, fontSize: 13 }}>{apptWhen(a.startTime)}</span>
                  <span style={{ display: 'block', fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.serviceName || 'Appointment'}</span>
                  {(a.technicianName || a.branchName) ? <span className="cust-sub" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[a.technicianName, a.branchName].filter(Boolean).join(' · ')}</span> : null}
                  <span className={`cust-pill ${tab === 'cancelled' ? '' : 'cust-pill-green'}`} style={{ marginTop: 6, ...(tab === 'cancelled' ? { background: 'var(--customer-red-light)', color: 'var(--customer-red)' } : {}) }}>{statusText(a.status)}</span>
                </span>
                <span aria-hidden style={{ color: 'var(--customer-text-secondary)' }}>›</span>
              </button>
            ))}
          </div>
        )}

      <button onClick={() => nav('/book')} className="cust-btn cust-btn-ghost" style={{ marginTop: filtered.length > 0 ? 12 : 'auto', width: '100%', height: 48 }}>+ Book New Appointment</button>
    </div>
  );
}
