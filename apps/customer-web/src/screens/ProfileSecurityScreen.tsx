import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { enrollFaceId, faceIdMode, canEnrollFaceId, disableFaceId, isFaceIdEnrolled } from '@aipowersalon/mobile-sdk';
import { useAuth } from '../auth/AuthContext';

// ProfileSecurityScreen — Profile → Security for the Customer App.
//
// A customer who activated with an SMS one-time code has NO password. That is fine — the OTP granted a session —
// but they should be able to add one so future sign-ins are easier. This screen offers Create Password when none
// is set, Change Password when one is, and shows active sessions with a way to sign out other devices.

const GOLD = 'var(--customer-primary, #A96F22)';
const GOLD_DEEP = '#84561A';
const GOLD_BRONZE = '#C9971B';
const LINE = 'var(--line, #E7DCC9)';
const TEXT = 'var(--text, #2A2118)';
const MUTED = '#8A7A66';
const SERIF = 'Georgia, "Times New Roman", serif';

const input: React.CSSProperties = {
  width: '100%', height: 48, borderRadius: 11, border: `1px solid ${LINE}`, background: '#FFFDF8',
  padding: '0 13px', fontFamily: 'inherit', fontSize: 16, color: TEXT, outline: 'none',   // 16px avoids iOS zoom
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 };
const btn = (busy: boolean): React.CSSProperties => ({
  width: '100%', height: 50, borderRadius: 12, border: 'none', marginTop: 6,
  cursor: busy ? 'default' : 'pointer', color: '#FFFDF8', fontSize: 16, fontFamily: SERIF,
  background: busy ? '#D6C097' : `linear-gradient(180deg, ${GOLD_BRONZE} 0%, ${GOLD} 55%, ${GOLD_DEEP} 100%)`,
});
const panel: React.CSSProperties = {
  background: '#FFFDF8', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 16px', marginBottom: 14,
};

interface SessionRow { id: string; current: boolean; device: string | null; createdAt: string }

export function ProfileSecurityScreen() {
  const { principal } = useAuth();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [faceIdSupported, setFaceIdSupported] = useState(false);
  const [, setFaceIdDebug] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [canEnroll, setCanEnroll] = useState(false);   // a signed-in session can enrol (token design, Sep 2026 merge)
  useEffect(() => { canEnrollFaceId().then(setCanEnroll).catch(() => setCanEnroll(false)); }, []);
  const [bioAlreadyEnrolled, setBioAlreadyEnrolled] = useState(false);

  const load = async () => {
    try {
      const s = await api.get<{ hasPassword: boolean }>('/customer/me/security/status');
      setHasPassword(!!s.hasPassword);
    } catch { setHasPassword(null); }
    try {
      const r = await api.get<{ sessions: SessionRow[] }>('/customer/me/security/sessions');
      setSessions(r.sessions || []);
    } catch { setSessions([]); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { 
    faceIdMode().then(m => {
      setFaceIdSupported(m !== 'none');
      import('@aipowersalon/mobile-sdk').then(mod => mod.faceIdState()).then(s => {
        setFaceIdDebug(`mode=${m}, state=${JSON.stringify(s)}`);
      });
      // Phase 13 D (bug 14): the device's record of an enrolled credential — not flags nothing ever set or kept honest
      void isFaceIdEnrolled().then(setBioAlreadyEnrolled).catch(() => setBioAlreadyEnrolled(false));
    });
  }, []);

  const enableFaceId = async () => {
    if (enrolling) return;
    setErr(null); setOk(null); setEnrolling(true);
    try {
      await enrollFaceId((principal as any)?.userId);   // Phase 13 D: a device credential from the server (recent password required)
      localStorage.setItem('customer_faceid_enabled', 'true');
      setBioAlreadyEnrolled(true);
      setOk('Face ID is enabled. You can use it to sign in next time.');
    } catch (e: any) {
      // A cancelled prompt is not a failure worth alarming anyone about.
      const msg = String(e?.message || '');
      setErr(/cancel/i.test(msg) ? null : (msg || 'Could not enable Face ID. Please try again.'));
    } finally { setEnrolling(false); }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(null); setOk(null);
    if (!next || next !== confirm) { setErr('The passwords do not match.'); return; }
    setBusy(true);
    try {
      if (hasPassword) {
        await api.post('/customer/me/security/password/change', { currentPassword: current, newPassword: next, confirmPassword: confirm });
        setOk('Password changed. You have been signed out on other devices.');
      } else {
        await api.post('/customer/me/security/password/create', { newPassword: next, confirmPassword: confirm });
        setOk('Password created. You can now sign in with your phone and password.');
      }
      setCurrent(''); setNext(''); setConfirm('');
      await load();
    } catch (e: any) {
      setErr(e?.message || 'We could not update your password. Please try again.');
    } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setErr(null); setOk(null);
    try { await api.post(`/customer/me/security/sessions/${id}/revoke`, {}); await load(); setOk('That device has been signed out.'); }
    catch (e: any) { setErr(e?.message || 'Could not sign out that device.'); }
  };

  const revokeOthers = async () => {
    setErr(null); setOk(null);
    try { await api.post('/customer/me/security/sessions/revoke-others', {}); await load(); setOk('Signed out of all other devices.'); }
    catch (e: any) { setErr(e?.message || 'Could not sign out other devices.'); }
  };

  return (
    <div style={{ padding: '18px 16px max(24px, env(safe-area-inset-bottom))', maxWidth: 480, margin: '0 auto' }}>
      <h1 style={{ fontFamily: SERIF, fontSize: 24, color: TEXT, margin: '0 0 16px' }}>Security</h1>

      {err ? <div role="alert" style={{ ...panel, background: '#FBEDE9', borderColor: '#F0D2C9', color: '#8F3226', fontSize: 13.5, padding: '11px 13px' }}>{err}</div> : null}
      {ok ? <div role="status" style={{ ...panel, background: '#EAF1E7', borderColor: '#CFE0C9', color: '#3F6B46', fontSize: 13.5, padding: '11px 13px' }}>{ok}</div> : null}

      {hasPassword === false ? (
        <div style={{ ...panel, background: '#FBF3DE', borderColor: '#ECDCAE', color: '#7A5A12', fontSize: 13.5, padding: '11px 13px' }}>
          Create a password to make future sign-ins easier.
        </div>
      ) : null}

      <form onSubmit={submitPassword} style={panel} noValidate>
        <h2 style={{ fontFamily: SERIF, fontSize: 18, color: TEXT, margin: '0 0 12px' }}>
          {hasPassword ? 'Change Password' : 'Create Password'}
        </h2>

        {hasPassword ? (
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="sec-current" style={label}>Current Password</label>
            <input id="sec-current" style={input} type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
        ) : null}

        <div style={{ marginBottom: 12 }}>
          <label htmlFor="sec-new" style={label}>New Password</label>
          <input id="sec-new" style={input} type="password" autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <label htmlFor="sec-confirm" style={label}>Confirm New Password</label>
          <input id="sec-confirm" style={input} type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>

        <button type="submit" disabled={busy} style={btn(busy)}>
          {busy ? 'Saving…' : hasPassword ? 'Change Password' : 'Create Password'}
        </button>
      </form>

      <div style={panel}>
        <button
          type="button"
          onClick={() => setSessionsOpen((v) => !v)}
          aria-expanded={sessionsOpen}
          aria-label="Active Sessions dropdown"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'inherit',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 style={{ fontFamily: SERIF, fontSize: 18, color: TEXT, margin: 0 }}>Active Sessions</h2>
              {sessions.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, background: '#F5EEE2', color: GOLD_DEEP, padding: '2px 8px', borderRadius: 12 }}>
                  {sessions.length}
                </span>
              )}
            </div>
            <p style={{ color: MUTED, fontSize: 12.5, margin: '4px 0 0' }}>
              Devices signed in to your account. Signing a device out takes effect immediately.
            </p>
          </div>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={MUTED}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: sessionsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
              marginLeft: 12,
            }}
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {sessionsOpen ? (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${LINE}` }}>
            {sessions.length === 0 ? (
              <p style={{ color: MUTED, fontSize: 13.5, margin: 0 }}>No other active sessions.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sessions.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 11, minHeight: 48 }}>
                    <span style={{ fontSize: 13.5, color: TEXT }}>
                      {s.device || 'Unknown device'}
                      {s.current ? <span style={{ color: GOLD, fontSize: 12, fontWeight: 600 }}> · This device</span> : null}
                    </span>
                    {!s.current ? (
                      <button type="button" onClick={() => revoke(s.id)}
                        style={{ background: 'none', border: 0, color: GOLD, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 6 }}>
                        Sign out
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {sessions.some((s) => !s.current) ? (
              <button type="button" onClick={revokeOthers}
                style={{ width: '100%', marginTop: 12, height: 46, borderRadius: 11, border: `1px solid ${GOLD}`, background: '#fff', color: GOLD_DEEP, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                Sign out of all other devices
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={panel}>
        <h2 style={{ fontFamily: SERIF, fontSize: 18, color: TEXT, margin: '0 0 4px' }}>Face ID</h2>
        {faceIdSupported ? (
          <>
            <p style={{ color: MUTED, fontSize: 12.5, margin: '0 0 12px' }}>
              Use Face ID to sign in without typing your password. Your biometric never leaves this device.
            </p>
            {bioAlreadyEnrolled ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px', borderRadius: 11, background: '#EAF1E7', border: '1px solid #CFE0C9', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3F6B46" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#3F6B46' }}>Face ID is enabled</span>
                </div>
                <button type="button" onClick={async () => {
                  try { await disableFaceId(); } catch { /* ignore */ }
                  localStorage.setItem('customer_faceid_enabled', 'false');
                  setBioAlreadyEnrolled(false);
                }} style={{ background: 'none', border: 'none', color: '#8F3226', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: 4 }}>
                  Remove
                </button>
              </div>
            ) : canEnroll ? (
              <button type="button" onClick={enableFaceId} disabled={enrolling}
                style={{ width: '100%', height: 46, borderRadius: 11, border: `1px solid ${GOLD}`, background: '#fff', color: GOLD_DEEP, fontSize: 14, fontWeight: 500, cursor: enrolling ? 'default' : 'pointer', marginBottom: 12 }}>
                {enrolling ? 'Setting up…' : 'Enable Face ID'}
              </button>
            ) : (
              <p style={{ color: MUTED, fontSize: 12.5, fontStyle: 'italic', margin: '0 0 12px' }}>
                * To set up Face ID, please sign out and sign back in with your password first.
              </p>
            )}
            <FaceIdToggle />
          </>
        ) : (
          <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>
            Face ID isn&rsquo;t available on this device or browser.
          </p>
        )}
      </div>
    </div>
  );
}

function FaceIdToggle() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('customer_faceid_enabled') !== 'false');
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem('customer_faceid_enabled', String(next));
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${LINE}` }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, color: TEXT, fontWeight: 500 }}>Auto Face ID on startup</div>
      </div>
      <label style={{ position: 'relative', display: 'inline-block', width: 46, height: 28, flex: '0 0 auto', cursor: 'pointer' }}>
        <input type="checkbox" aria-label="Auto Face ID on startup" checked={enabled} onChange={toggle} style={{ opacity: 0, width: 0, height: 0 }} />
        <span aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 999, transition: '.2s', background: enabled ? GOLD : '#E9DAC4' }} />
        <span aria-hidden style={{ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 22, height: 22, borderRadius: 999, background: '#fff', transition: '.2s' }} />
      </label>
    </div>
  );
}
