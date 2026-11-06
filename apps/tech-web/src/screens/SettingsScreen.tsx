// SettingsScreen.tsx — technician settings (build doc §4): the salon's REAL capability set (read-only — these are
// controlled by the salon's POS settings + Super Admin), change password via the existing /auth/change-password,
// and sign out. No invented toggles.
import { useEffect, useState } from 'react';
import { techApi } from '../api/techApi';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useTechNav } from '../shell/nav';
import { enrollFaceId, faceIdMode, disableFaceId, isFaceIdEnrolled } from '../auth/faceid';

const APP_VERSION = '0.1.0';
const CAP_LABELS: [string, string][] = [
  ['liveEditEnabled', 'Live ticket editing'],
  ['allowServiceEditDuringServing', 'Edit services during serving'],
  ['techCanAddService', 'Add services to a live ticket'],
  ['techCanChangeService', 'Change a service'],
  ['techCanRemoveLine', 'Remove a service line'],
  ['requireApprovalForChangeService', 'Manager approval to change'],
  ['requireApprovalForRemoveLine', 'Manager approval to remove'],
];
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
export function SettingsScreen() {
  const { back, openPrivacy, openTerms, openDeleteAccount } = useTechNav();
  const { logout } = useAuth();
  const [caps, setCaps] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [faceIdSupported, setFaceIdSupported] = useState(false);
  const [isFaceIdEnabled, setIsFaceIdEnabled] = useState(false);
  const [isAutoStartupEnabled, setIsAutoStartupEnabled] = useState(() => localStorage.getItem('tech_faceid_enabled') !== 'false');
  const [enrolling, setEnrolling] = useState(false);
  const [bioErr, setBioErr] = useState<string | null>(null);
  const [bioOk, setBioOk] = useState<string | null>(null);
  
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState('');
  const [pwBusy, setPwBusy] = useState(false); const [pwMsg, setPwMsg] = useState<string | null>(null);

  useEffect(() => { 
    techApi.settings().then(setCaps).catch((e: any) => setError(e?.message || 'Could not load settings.')); 
    faceIdMode().then(m => {
      setFaceIdSupported(m !== 'none');
      // Nov 5 2026: the SDK's enrolment state, not the never-set aps_bio_login_success flag (bug 14)
      if (m !== 'none') void isFaceIdEnrolled().then(setIsFaceIdEnabled).catch(() => setIsFaceIdEnabled(false));
    });
  }, []);

  const enableFaceId = async () => {
    if (enrolling) return;
    setBioErr(null); setBioOk(null); setEnrolling(true);
    try {
      await enrollFaceId();
      localStorage.setItem('tech_faceid_enabled', 'true');
      setIsFaceIdEnabled(true);
      setIsAutoStartupEnabled(true);
      setBioOk('Biometric login has been enabled.');
    } catch (e: any) {
      const msg = String(e?.message || '');
      setBioErr(/cancel/i.test(msg) ? null : (msg || 'Could not enable Biometrics. Please try again.'));
    } finally { setEnrolling(false); }
  };

  const changePw = async () => {
    setPwBusy(true); setPwMsg(null);
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: nw, confirmPassword: cf });
      setPwMsg('Password updated.'); setCur(''); setNw(''); setCf('');
    } catch (e: any) { setPwMsg(e?.message || 'Password change failed.'); } finally { setPwBusy(false); }
  };

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="tech-iconbtn" onClick={back} aria-label="Back" style={{ minWidth: 44 }}><Back /></button>
        <h1 className="t-title" style={{ margin: 0, fontSize: 19 }}>Settings</h1>
      </div>
      <div className="tech-main-2">
        {error ? <div className="tech-card" style={{ padding: 12 }}>{error}</div> : null}

      <div className="tech-card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="tech-label" style={{ marginBottom: 8 }}>What this salon allows</div>
        {!caps ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--tech-border)' }}>
                <div className="tech-skel" style={{ width: '60%', height: 16 }} />
                <div className="tech-skel" style={{ width: 40, height: 16 }} />
              </div>
            ))}
          </div>
        ) : CAP_LABELS.map(([k, label]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--tech-border)', fontSize: 13 }}>
            <span>{label}</span>
            <span style={{ fontWeight: 700, color: caps[k] ? '#2E7D32' : '#9A9287' }}>{caps[k] ? 'On' : 'Off'}</span>
          </div>
        ))}
        <div className="tech-muted" style={{ fontSize: 11.5, marginTop: 8 }}>These are set by the salon and AIPowerSalon — ask the front desk to change them.</div>
      </div>

      <div className="tech-card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="tech-label" style={{ marginBottom: 8 }}>Sign In</div>
        
        {faceIdSupported ? (
          <>
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--tech-border)' }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Face ID / Biometric Login</div>
                <div className="tech-muted" style={{ fontSize: 12.5 }}>Quick & secure biometric access</div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: 'pointer' }} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isFaceIdEnabled}
                  disabled={enrolling}
                  onChange={async () => {
                    if (enrolling) return;
                    setBioErr(null); setBioOk(null);
                    if (isFaceIdEnabled) {
                      try {
                        await disableFaceId();
                        localStorage.setItem('tech_faceid_enabled', 'false');
                        setIsFaceIdEnabled(false);
                        setIsAutoStartupEnabled(false);
                        setBioOk('Biometric login has been disabled.');
                      } catch (e: any) { setBioErr(e?.message || 'Could not disable biometric login.'); }
                    } else {
                      // The server decides (it needs a recent password sign-in); its answer is shown if it says no.
                      enableFaceId();
                    }
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{ position: 'absolute', inset: 0, backgroundColor: isFaceIdEnabled ? 'var(--tech-primary, #000)' : 'var(--tech-border)', transition: '.2s', borderRadius: 24 }}>
                  <span style={{ position: 'absolute', height: 18, width: 18, left: isFaceIdEnabled ? 22 : 3, bottom: 3, backgroundColor: 'white', transition: '.2s', borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </span>
              </label>
            </div>

            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--tech-border)', opacity: isFaceIdEnabled ? 1 : 0.6 }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>Auto Biometrics on Startup</div>
                <div className="tech-muted" style={{ fontSize: 12.5 }}>Automatically prompt for Face ID</div>
              </div>
              <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, cursor: isFaceIdEnabled ? 'pointer' : 'default' }} onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isAutoStartupEnabled}
                  disabled={!isFaceIdEnabled}
                  onChange={() => {
                    const next = !isAutoStartupEnabled;
                    setIsAutoStartupEnabled(next);
                    localStorage.setItem('tech_faceid_enabled', String(next));
                  }}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span style={{ position: 'absolute', inset: 0, backgroundColor: isAutoStartupEnabled ? 'var(--tech-primary, #000)' : 'var(--tech-border)', transition: '.2s', borderRadius: 24 }}>
                  <span style={{ position: 'absolute', height: 18, width: 18, left: isAutoStartupEnabled ? 22 : 3, bottom: 3, backgroundColor: 'white', transition: '.2s', borderRadius: '50%', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </span>
              </label>
            </div>
            {bioErr ? <div className="tech-muted" style={{ color: 'var(--tech-danger, #B3261E)', fontSize: 12.5, marginTop: 8 }}>{bioErr}</div> : null}
            {bioOk ? <div className="tech-muted" style={{ color: '#2E7D32', fontSize: 12.5, marginTop: 8 }}>{bioOk}</div> : null}
          </>
        ) : (
          <div className="tech-muted" style={{ fontSize: 12.5, marginTop: 8 }}>Biometric authentication is not supported on this device.</div>
        )}
      </div>

      <div className="tech-card" style={{ padding: 14, marginBottom: 12 }}>
        <div className="tech-label" style={{ marginBottom: 8 }}>Change password</div>
        <div style={{ display: 'grid', gap: 8 }}>
          <input className="tech-input" type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <input className="tech-input" type="password" placeholder="New password" value={nw} onChange={(e) => setNw(e.target.value)} />
          <input className="tech-input" type="password" placeholder="Confirm new password" value={cf} onChange={(e) => setCf(e.target.value)} />
          <button className="tech-btn" disabled={pwBusy || !cur || !nw || nw !== cf} onClick={changePw}>{pwBusy ? '…' : 'Update Password'}</button>
          {pwMsg ? <div className="tech-muted" style={{ fontSize: 12.5 }}>{pwMsg}</div> : null}
        </div>
      </div>

      <div className="tech-card" style={{ padding: '4px 16px', marginBottom: 12 }}>
        <div className="tech-label" style={{ padding: '12px 0 4px' }}>About</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderTop: '1px solid var(--tech-border)', fontSize: 13 }}>
          <span>Version</span><span className="tech-muted">{APP_VERSION}</span>
        </div>
        <button className="tech-menu-row" onClick={() => openPrivacy()}><span>Privacy Policy</span><span style={{ marginLeft: 'auto', opacity: 0.45 }}>›</span></button>
        <button className="tech-menu-row" onClick={() => openTerms()}><span>Terms of Service</span><span style={{ marginLeft: 'auto', opacity: 0.45 }}>›</span></button>
        <button className="tech-menu-row" onClick={() => openDeleteAccount()}><span style={{ color: 'var(--tech-danger, #B3261E)' }}>Account Deactivation</span><span style={{ marginLeft: 'auto', opacity: 0.45 }}>›</span></button>
      </div>

        <button className="tech-btn danger-outline" style={{ width: '100%' }} onClick={() => logout()}>Sign Out</button>
      </div>
    </div>
  );
}
