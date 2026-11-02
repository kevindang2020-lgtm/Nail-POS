import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { customerApi, type CustomerProfile, type CustomerLoyaltySummary } from '../api/customerApi';
import { useAuth } from '../auth/AuthContext';
import { MySalonCard } from '../components/MySalonCard';
import { isGuest, exitGuestMode } from '../auth/guest';
import { GuestModal } from '../components/GuestModal';
import {
  FiUser,
  FiMessageSquare,
  FiCreditCard,
  FiGift,
  FiFileText,
  FiStar,
  FiAward,
  FiMapPin,
  FiCamera,
  FiBell,
  FiMessageCircle,
  FiLock,
  FiSettings,
  FiHelpCircle,
  FiShield,
  FiTrash2,
  FiLogOut,
} from 'react-icons/fi';

const initials = (name?: string | null) => (name || '').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '🙂';

const Chevron = () => (
  <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

type Row = { key: string; icon: React.ReactNode; label: string; subtitle: string; to?: string; danger?: boolean; publicOnly?: boolean };

type MenuSection = {
  title: string;
  description: string;
  rows: Row[];
};

const SECTIONS: MenuSection[] = [
  {
    title: 'ACCOUNT & SERVICES',
    description: 'Manage your profile and payment options',
    rows: [
      { key: 'info', icon: <FiUser />, label: 'My Information', subtitle: 'Account and contact details', to: '/profile/edit' },
      { key: 'assistant', icon: <FiMessageSquare />, label: 'AI Receptionist', subtitle: 'AI appointment assistant', to: '/assistant', publicOnly: true },
      { key: 'pay', icon: <FiCreditCard />, label: 'Payment Methods', subtitle: 'Saved cards and payment options', to: '/profile/payment-methods' },
      { key: 'wallet', icon: <FiGift />, label: 'Wallet & Gift Cards', subtitle: 'Passes, balances, and gift cards', to: '/wallet', publicOnly: true },
      { key: 'invoices', icon: <FiFileText />, label: 'Receipts & Invoices', subtitle: 'Past appointment receipts and invoices', to: '/receipts' },
    ],
  },
  {
    title: 'LOYALTY & REWARDS',
    description: 'Track your points, perks and style',
    rows: [
      { key: 'rewards', icon: <FiStar />, label: 'Rewards', subtitle: 'Points and loyalty rewards', to: '/rewards', publicOnly: true },
      { key: 'membership', icon: <FiAward />, label: 'Membership', subtitle: 'Membership tier and benefits', to: '/membership' },
      { key: 'rewards', icon: <FiAward />, label: 'My Rewards', subtitle: 'AI PowerSalon Rewards points', to: '/rewards' },
      { key: 'addr', icon: <FiMapPin />, label: 'My Addresses', subtitle: 'Saved addresses and locations', to: '/profile/addresses' },
      { key: 'photos', icon: <FiCamera />, label: 'My Salon Photos', subtitle: 'Saved lookbook & style photos', to: '/profile/my-photos' },
    ],
  },
  {
    title: 'PREFERENCES & SECURITY',
    description: 'Notifications, security and settings',
    rows: [
      { key: 'notif', icon: <FiBell />, label: 'Notifications', subtitle: 'Appointment alerts and updates', to: '/notifications' },
      { key: 'followups', icon: <FiMessageCircle />, label: 'Service Follow-Ups', subtitle: 'Care instructions and feedback', to: '/follow-ups' },
      { key: 'security', icon: <FiLock />, label: 'Password & Security', subtitle: 'Password and security settings', to: '/profile/security' },
      { key: 'settings', icon: <FiSettings />, label: 'Settings', subtitle: 'App preferences and configuration', to: '/profile/settings' },
    ],
  },
  {
    title: 'SUPPORT & LEGAL',
    description: 'Help, privacy policy and terms',
    rows: [
      { key: 'help', icon: <FiHelpCircle />, label: 'Help & Support', subtitle: 'FAQ and customer support', to: '/profile/help', publicOnly: true },
      { key: 'privacy', icon: <FiShield />, label: 'Privacy Policy', subtitle: 'Privacy policy & data practices', to: '/legal/privacy', publicOnly: true },
      { key: 'terms', icon: <FiFileText />, label: 'Terms of Service', subtitle: 'Terms and conditions of service', to: '/legal/terms', publicOnly: true },
      { key: 'delete', icon: <FiTrash2 />, label: 'Delete Account', subtitle: 'Deactivate or delete your account', to: '/profile/delete-account', danger: true },
    ],
  },
];

export function ProfileScreen() {
  const nav = useNavigate();
  const guest = isGuest();
  const { principal, logout } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [guestModalMsg, setGuestModalMsg] = useState('Please sign in or create an account to access this feature.');

  const name = guest ? 'Guest User' : (principal?.fullName || 'My account');
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    if (guest) return;
    let live = true;
    customerApi.getProfile()
      .then((d) => {
        if (live) {
          setImgErr(false);
          setProfile(d);
        }
      })
      .catch(() => { /* identity contact is best-effort */ });
    return () => { live = false; };
  }, [guest]);

  const [loyalty, setLoyalty] = useState<CustomerLoyaltySummary | null>(null);
  useEffect(() => {
    if (guest) return;
    let live = true;
    (async () => {
      try {
        const d = await customerApi.loyalty();
        if (live) setLoyalty(d);
      } catch { /* loyalty badge is best-effort */ }
    })();
    return () => { live = false; };
  }, [guest]);

  const doLogout = async () => {
    setBusy(true);
    try {
      await logout();
      if (guest) exitGuestMode();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const handleRowClick = (r: Row) => {
    if (guest && !r.publicOnly) {
      setGuestModalMsg(`Please sign in or create an account to access ${r.label}.`);
      setGuestModalOpen(true);
      return;
    }
    if (r.to) nav(r.to);
    else setNote('This section is coming soon.');
  };

  return (
    <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 className="cust-h1">Profile</h1>

      {/* First cust-card: profile identity information (kept unchanged per user instruction) */}
      <div className="cust-card" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
        <label style={{ position: 'relative', cursor: guest ? 'default' : 'pointer', display: 'block' }}>
          {profile?.avatarUrl && !imgErr ? (
            <img
              src={profile.avatarUrl}
              onError={() => setImgErr(true)}
              style={{ width: 56, height: 56, borderRadius: 999, objectFit: 'cover', display: 'block' }}
              alt="Avatar"
            />
          ) : (
            <span style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--customer-primary-light)', color: 'var(--customer-primary)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18 }} aria-hidden>
              {guest ? '👤' : initials(name)}
            </span>
          )}
          {!guest && (
            <>
              <div style={{ position: 'absolute', bottom: -4, right: -4, background: '#fff', borderRadius: '50%', padding: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                <FiCamera size={12} color="var(--customer-primary)" />
              </div>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  try {
                    const res = await customerApi.uploadAvatar(f);
                    setImgErr(false);
                    const cleanUrl = res.url ? `${res.url}${res.url.includes('?') ? '&' : '?'}t=${Date.now()}` : res.url;
                    setProfile(p => p ? { ...p, avatarUrl: cleanUrl } : p);
                  } catch (err: any) {
                    setUploadError(err.message || 'Failed to upload image');
                  }
                }
              }} />
            </>
          )}
        </label>
              {uploadError ? <div className="error" role="alert">{uploadError}</div> : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 18, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
          {guest ? (
            <div className="cust-sub" style={{ fontSize: 13 }}>Browsing Mode (Not Signed In)</div>
          ) : (
            <>
              {profile?.email ? <div className="cust-sub" style={{ fontSize: 13 }}>{profile.email}</div> : null}
              {profile?.phone ? <div className="cust-sub" style={{ fontSize: 13 }}>{profile.phone}</div> : null}
              {!profile?.email && !profile?.phone ? <div className="cust-sub" style={{ fontSize: 13 }}>Add your contact details in My Information</div> : null}
              {loyalty ? <div style={{ marginTop: 6 }}><span className="cust-pill cust-pill-purple">👑 {loyalty.tier} Member · {loyalty.points.toLocaleString('en-US')} pts</span></div> : null}
            </>
          )}
        </div>
        {guest ? (
          <button onClick={() => exitGuestMode()} style={{ border: 0, background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)', color: '#fff', fontWeight: 700, padding: '7px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, boxShadow: '0 2px 8px rgba(169,111,34,.25)' }}>Sign In</button>
        ) : (
          <button onClick={() => nav('/profile/edit')} style={{ border: 0, background: 'none', color: 'var(--customer-primary)', fontWeight: 700, cursor: 'pointer' }}>Edit</button>
        )}
      </div>

      {guest && (
        <div style={{
          background: 'linear-gradient(135deg, #FFFDF8 0%, #F9F1E2 100%)',
          border: '1px solid #E7DCC9',
          borderRadius: 16,
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 4px 14px rgba(42,33,24,0.04)'
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#2A2118' }}>Sign In or Register</div>
            <div style={{ fontSize: 13, color: '#70604E', marginTop: 4, lineHeight: 1.45 }}>
              Link your account to save your favorite stylists, view past invoices, manage payment methods, and earn reward points.
            </div>
          </div>
          <button
            type="button"
            onClick={() => exitGuestMode()}
            style={{
              height: 44,
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(180deg, #C9971B 0%, #A96F22 100%)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(169,111,34,.25)',
              alignSelf: 'flex-start',
              padding: '0 20px',
            }}>
            Sign In or Register
          </button>
        </div>
      )}

      {/* Owner-style Menu cards & rows */}
      <div className="owner-menu">
        {/* Default salon — chosen at sign-up, changeable here (Oct 3 2026). A guest has no salon account yet. */}
        {!guest && <MySalonCard onSignInAgain={async (name) => { try { sessionStorage.setItem('aps_signin_note', `Sign in again to continue at ${name}.`); } catch { /* ignore */ } await logout(); }} />}
        {SECTIONS.map((sec) => (
          <section key={sec.title} className="owner-menu-section">
            <div className="owner-menu-section-head">
              <h6>{sec.title}</h6>
              <p>{sec.description}</p>
            </div>
            <div className="owner-menu-card">
              {sec.rows.map((r) => (
                <button
                  key={r.key}
                  className={`owner-menurow${r.danger ? ' danger' : ''}`}
                  onClick={() => handleRowClick(r)}
                  aria-label={r.label}
                >
                  <span className="owner-menu-icon">{r.icon}</span>
                  <div className="owner-menu-content">
                    <span className="ml">{r.label}</span>
                    <span className="owner-menu-subtitle">{r.subtitle}</span>
                  </div>
                  <Chevron />
                </button>
              ))}
            </div>
          </section>
        ))}

        {/* Log Out Section Card (owner-web MoreScreen style) */}
        <section className="owner-menu-section">
          <div className="owner-menu-card">
            <button
              className="owner-menurow danger"
              onClick={() => setConfirm(true)}
              aria-label={guest ? 'Exit Guest Mode' : 'Log Out'}
            >
              <span className="owner-menu-icon">
                <FiLogOut />
              </span>
              <div className="owner-menu-content">
                <span className="ml">{guest ? 'Exit Guest Mode' : 'Log Out'}</span>
                <span className="owner-menu-subtitle">
                  {guest ? 'Return to sign in screen' : 'Sign out from your account'}
                </span>
              </div>
              <Chevron />
            </button>
          </div>
        </section>
      </div>

      {note && <div className="cust-sub" style={{ textAlign: 'center', marginTop: -6 }}>{note}</div>}

      {/* Logout Popup Modal (owner-web InlineConfirm style) */}
      {confirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(28, 20, 14, 0.65)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            zIndex: 250,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Logout"
            style={{
              width: 'min(420px, 92vw)',
              background: '#FFFFFF',
              border: '1px solid #DFC37B',
              borderRadius: 20,
              boxShadow:
                '0 20px 50px rgba(44, 33, 24, 0.25), 0 0 0 1px rgba(212, 175, 55, 0.15)',
              padding: '24px 22px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            {/* Header Icon Badge */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#F4E3BF',
                color: '#8B5A18',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
                border: '1px solid #DFC37B',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </div>

            {/* Modal Title */}
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: '#2C2118',
                marginBottom: 6,
              }}
            >
              {guest ? 'Exit Guest Mode' : 'Confirm Logout'}
            </div>

            {/* Question Text */}
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.5,
                color: '#6D5F50',
                fontWeight: 400,
                whiteSpace: 'pre-wrap',
                marginBottom: 20,
              }}
            >
              {guest
                ? 'Are you sure you want to exit guest mode? You will return to the sign in screen where you can log in or register.'
                : 'Are you sure you want to log out of your session? You’ll need to sign in again to view your appointments and rewards.'}
            </div>

            {/* Modal Actions */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                width: '100%',
              }}
            >
              <button
                type="button"
                onClick={() => setConfirm(false)}
                style={{
                  height: 46,
                  minHeight: 46,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  border: '1px solid #E9DAC4',
                  background: '#FFFFFF',
                  color: '#2C2118',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doLogout}
                disabled={busy}
                style={{
                  height: 46,
                  minHeight: 46,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  background: '#A96F22',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 14px rgba(169, 111, 34, 0.3)',
                }}
              >
                {busy ? (guest ? 'Exiting…' : 'Logging out…') : (guest ? 'Exit Mode' : 'Log Out')}
              </button>
            </div>
          </div>
        </div>
      )}

      <GuestModal
        open={guestModalOpen}
        onClose={() => setGuestModalOpen(false)}
        message={guestModalMsg}
      />
    </div>
  );
}

