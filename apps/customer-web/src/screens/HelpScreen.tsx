import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerSalonInfo } from '../api/customerApi';

// Help & Support — app usage FAQ (informational) plus a real "contact the salon" card (salon name/address/phone from
// /customer/salon; Call/Message use the salon's real number via tel:/sms:).
const FAQ = [
  { q: 'How do I book an appointment?', a: 'Tap Book on the home screen, choose your services, then pick a date and time.' },
  { q: 'How do I cancel an appointment?', a: 'Open the appointment from My Appointments and tap Cancel Appointment. To reschedule, cancel and book a new time.' },
  { q: 'How do loyalty points work?', a: 'You earn points on visits. See your tier and progress to the next tier on the Rewards screen.' },
  { q: 'What is the wallet balance?', a: 'Your wallet holds store credit. Top-ups, refunds and payments appear under Recent Transactions.' },
];

export function HelpScreen() {
  const nav = useNavigate();
  const [salon, setSalon] = useState<CustomerSalonInfo | null>(null);
  const [open, setOpen] = useState<number | null>(0);
  useEffect(() => { let live = true; customerApi.salon().then((s) => live && setSalon(s)).catch(() => {}); return () => { live = false; }; }, []);
  const tel = (salon?.phone || '').replace(/[^0-9+]/g, '');

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={() => nav(-1)}
          aria-label="Back"
          className='customer-back'
        
        >
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
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Help &amp; Support</h1>
      </div>
      <div className="cust-label">FAQ</div>
      {FAQ.map((f, i) => (
        <div key={i} className="cust-card" style={{ padding: 0 }}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '14px 16px', display: 'flex', gap: 10, cursor: 'pointer', fontWeight: 700, color: 'var(--customer-text)' }}>
            <span style={{ flex: 1 }}>{f.q}</span><span aria-hidden style={{ color: 'var(--customer-primary)', fontSize: 18 }}>{open === i ? '–' : '+'}</span>
          </button>
          {open === i ? <div className="cust-sub" style={{ padding: '0 16px 14px', fontSize: 14 }}>{f.a}</div> : null}
        </div>
      ))}
      <div className="cust-label" style={{ marginTop: 6 }}>Contact</div>
      <div className="cust-card" style={{ padding: 16 }}>
        <div style={{ fontWeight: 700 }}>{salon?.name || 'Contact the salon'}</div>
        {salon?.address ? <div className="cust-sub" style={{ fontSize: 13, marginTop: 2 }}>{salon.address}</div> : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {tel ? <a href={`tel:${tel}`} className="cust-btn" style={{ height: 44, textDecoration: 'none', display: 'grid', placeItems: 'center' }}>Call salon</a>
               : <button disabled className="cust-btn" style={{ height: 44, opacity: 0.5 }}>Call salon</button>}
          {tel ? <a href={`sms:${tel}`} className="cust-btn cust-btn-ghost" style={{ height: 44, textDecoration: 'none', display: 'grid', placeItems: 'center' }}>Message</a>
               : <button disabled className="cust-btn cust-btn-ghost" style={{ height: 44, opacity: 0.5 }}>Message</button>}
        </div>
      </div>
    </div>
  );
}
