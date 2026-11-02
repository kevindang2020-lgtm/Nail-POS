import { useNavigate } from 'react-router-dom';

// Terms of Service (in-app, Apple-required). Readable boilerplate; host the canonical version at the URL you set in
// App Store Connect (e.g. https://aipowersalon.com/terms) and keep it in sync.
const SECTIONS: { h: string; p: string }[] = [
  { h: 'Using AIPowerSalon', p: 'AIPowerSalon helps you discover salons, book appointments, check in, track service, pay, and earn rewards. You agree to use the app lawfully and to provide accurate information.' },
  { h: 'Your account', p: 'You are responsible for activity on your account and for keeping your sign-in secure. You can request account deletion at any time from your Profile.' },
  { h: 'Bookings and payments', p: 'Appointments, prices, and availability are set by the salon you visit. Payments for salon services are processed through the salon’s payment provider. Cancellation and refund terms may vary by salon.' },
  { h: 'Acceptable use', p: 'Do not misuse the service, attempt to access other users’ data, or interfere with the app’s operation.' },
  { h: 'Disclaimers', p: 'The service is provided “as is.” Salon services are provided by the salons, not by AIPowerSalon.' },
  { h: 'Changes', p: 'We may update these terms; continued use after an update means you accept the revised terms.' },
  { h: 'Contact', p: 'Questions? Reach us from Profile → Help & Support, or email support@aipowersalon.com.' },
];

export function TermsScreen() {
  const nav = useNavigate();
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
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Terms of Service</h1>
      </div>
      <div className="cust-sub" style={{ fontSize: 13 }}>Last updated: June 2026</div>
      {SECTIONS.map((s) => (
        <div key={s.h} className="cust-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{s.h}</div>
          <div className="cust-sub" style={{ fontSize: 14, lineHeight: 1.5 }}>{s.p}</div>
        </div>
      ))}
    </div>
  );
}
