import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { customerApi, type CustomerProfile } from '../api/customerApi';

// Settings — communication preferences backed by the real customer record. Current values load from /customer/profile;
// toggling persists immediately via PATCH /customer/profile (SMS → marketing_sms_opt_in, Email → marketing_email_opt_in).
// Module scope: defined inside the screen it was a new component type every render, so each toggle remounted.
const Toggle = ({ label, desc, on, onChange, busy }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void; busy: boolean }) => (
  <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700 }}>{label}</div>
      <div className="cust-sub" style={{ fontSize: 13 }}>{desc}</div>
    </div>
    <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 28, flex: '0 0 auto' }}>
      <input type="checkbox" aria-label={label} checked={on} disabled={busy} onChange={(e) => onChange(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
      <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 999, transition: '.2s', background: on ? 'var(--customer-primary)' : 'var(--customer-border)' }} />
      <span aria-hidden style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: '.2s' }} />
    </label>
  </div>
);

export function SettingsScreen() {
  const nav = useNavigate();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [sms, setSms] = useState(false);
  const [emailOpt, setEmailOpt] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    let live = true;
    customerApi.getProfile().then((p) => { if (live) { setProfile(p); setSms(!!p?.smsOptIn); setEmailOpt(!!p?.emailOptIn); setMarketing(!!p?.marketingOptIn); } })
      .catch((e: any) => live && setError(e?.message || 'Could not load settings.')).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  const update = async (key: 'sms' | 'email' | 'marketing', value: boolean) => {
    if (key === 'sms') setSms(value); else if (key === 'email') setEmailOpt(value); else setMarketing(value); // optimistic
    setSaving(key); setError(null);
    try { await customerApi.updateProfile(key === 'sms' ? { smsOptIn: value } : key === 'email' ? { emailOptIn: value } : { marketingOptIn: value }); }
    catch (e: any) { setError(e?.message || 'Could not save.'); if (key === 'sms') setSms(!value); else if (key === 'email') setEmailOpt(!value); else setMarketing(!value); }
    finally { setSaving(null); }
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
        <h1 className="cust-h1" style={{ fontSize: 20 }}>Settings</h1>
      </div>
      {error ? <div className="cust-card" style={{ padding: 14, color: 'var(--customer-red)', background: 'var(--customer-red-light)', border: 0 }}>{error}</div> : null}
        <>
          <div className="cust-label">Service notifications</div>
          <Toggle label="Appointment & service texts" desc="Reminders, check-in, and receipt texts about your visits. Up to ~6 msgs/mo. Msg & data rates may apply. Reply STOP to opt out, HELP for help." on={sms} onChange={(v) => update('sms', v)} busy={saving === 'sms' || !loaded} />
          <Toggle label="Email updates" desc="Receipts and account updates by email" on={emailOpt} onChange={(v) => update('email', v)} busy={saving === 'email' || !loaded} />
          <div className="cust-label" style={{ marginTop: 6 }}>Promotions &amp; marketing</div>
          <Toggle label="Marketing messages" desc="Promotions and offers from salons you visit. Up to ~4 msgs/mo. Msg & data rates may apply. Reply STOP to opt out, HELP for help." on={marketing} onChange={(v) => update('marketing', v)} busy={saving === 'marketing' || !loaded} />
          <div className="cust-card" style={{ padding: 16 }}>
            <div className="cust-label">Account</div>
            {!loaded ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                <div className="cust-skel" style={{ height: 16, width: 140 }} />
                <div className="cust-skel" style={{ height: 14, width: 100 }} />
              </div>
            ) : (
              <>
                <div style={{ marginTop: 6, fontWeight: 600 }}>{profile?.email || 'No email on file'}</div>
                <div className="cust-sub" style={{ fontSize: 13 }}>{profile?.phone || 'No phone on file'}</div>
              </>
            )}
            <Link to="/profile/edit" style={{ color: 'var(--customer-primary)', fontWeight: 700, textDecoration: 'none', display: 'inline-block', marginTop: 8 }}>Edit my information</Link>
          </div>

          <div className="cust-label">NailShowcase</div>
          <Link to="/social/edit" style={{ textDecoration: 'none' }}>
            <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--customer-text)' }}>Profile Visibility</div>
                <div className="cust-sub" style={{ fontSize: 13 }}>Control who can see your profile and ranking, and edit your public profile</div>
              </div>
              <span aria-hidden style={{ color: 'var(--customer-primary)', fontWeight: 800, fontSize: 18 }}>›</span>
            </div>
          </Link>
        </>
    </div>
  );
}
