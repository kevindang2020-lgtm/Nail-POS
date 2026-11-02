import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { customerApi } from '../api/customerApi';

// Privacy Policy (in-app, Apple-required). This is readable boilerplate; the canonical, lawyer-reviewed policy should be
// hosted at the Privacy Policy URL you set in App Store Connect (e.g. https://aipowersalon.com/privacy) and kept in sync.
const SECTIONS: { h: string; p: string }[] = [
  { h: 'What we collect', p: 'Account details you provide (name, email, phone), your bookings and visit history, loyalty and wallet activity, and — only if you choose to share it — your device location to find nearby salons. You can use the app and search by city or ZIP without sharing location.' },
  { h: 'How we use it', p: 'To create and manage your appointments, show your loyalty and receipts, send the notifications you opt into, and operate and improve the service. We do not sell your personal information.' },
  { h: 'Location', p: 'Location is requested only when you tap “Use my location.” If you decline, you can search by city or ZIP. You can change this anytime in iOS Settings.' },
  { h: 'Payments', p: 'Card payments are processed by the salon’s payment provider using secure tokenization. We do not store your full card number or security code.' },
  { h: 'Sharing', p: 'Your booking and visit information is shared with the salon you visit so they can serve you. Service providers (e.g. messaging, payment, hosting) process data on our behalf under contract.' },
  { h: 'Retention', p: 'We keep your account data while your account is active. Some records (e.g. completed payments and receipts) are retained as required by financial and tax law even after account deletion.' },
  { h: 'Your choices', p: 'You can edit your information, manage notification preferences, request a copy of your data, and request account deletion — all from your Profile.' },
  { h: 'Contact', p: 'Questions about privacy? Reach us from Profile → Help & Support, or email privacy@aipowersalon.com.' },
];

export function PrivacyPolicyScreen() {
  // `customerApi.privacyExport()` has existed all along — DECLARED, and called by no screen. Which is why the
  // unreached-routes audit never flagged it: the route HAS a caller in the api client. It just has no button.
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const downloadMyData = async () => {
    setBusy(true); setErr(null);
    try {
      const data = await customerApi.privacyExport();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `aipowersalon-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message || 'Couldn’t prepare your export. Please try again.');
    } finally { setBusy(false); }
  };
  const exportBlock = (
    <div style={{ border: '1px solid #E3D8C6', borderRadius: 12, padding: 14, marginTop: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Download your data</div>
      <div style={{ fontSize: 13.5, lineHeight: 1.5, opacity: 0.85, marginBottom: 10 }}>
        A copy of the personal data held against your account, as a JSON file.
      </div>
      {err ? <div style={{ fontSize: 12.5, color: '#B3403C', marginBottom: 8 }}>{err}</div> : null}
      <button onClick={downloadMyData} disabled={busy}
        style={{ padding: '9px 14px', borderRadius: 10, border: '1px solid #A96F22', background: '#A96F22', color: '#fff', fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Preparing…' : 'Download my data'}
      </button>
    </div>
  );
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
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Privacy Policy</h1>
      </div>
      <div className="cust-sub" style={{ fontSize: 13 }}>Last updated: June 2026</div>
      {SECTIONS.map((s) => (
        <div key={s.h} className="cust-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{s.h}</div>
          <div className="cust-sub" style={{ fontSize: 14, lineHeight: 1.5 }}>{s.p}</div>
        </div>
      ))}
      {exportBlock}
    </div>
  );
}
