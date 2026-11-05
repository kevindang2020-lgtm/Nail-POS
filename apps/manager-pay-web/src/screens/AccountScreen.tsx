import { useEffect, useState, useCallback } from 'react';
import { authApi, type Principal } from '../api/authApi';
import { clearNativeToken } from '../auth/native-auth';
import { signalSignedOut } from '@aipowersalon/mobile-sdk';
import { unregisterPushToken } from '../lib/push';
import { mobileCheckoutApi, type ReadinessReport } from '../api/mobileCheckoutApi';
import { faceIdMode, enrollFaceId, disableFaceId, isFaceIdEnrolled } from '../auth/faceid';
import { titleCase } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';

const APP_VERSION = '0.1.0';

function initials(name?: string | null, fallback?: string): string {
  const src = name || fallback || '';
  const parts = src.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '•';
}

function readinessDisplay(r: ReadinessReport | null): { dot: 'ok' | 'warn' | 'err'; label: string } {
  if (!r) return { dot: 'warn', label: 'Unknown' };
  if (r.canTakePayment) return { dot: 'ok', label: 'Ready' };
  if (r.overall === 'backend_unavailable' || r.overall === 'processor_unavailable') return { dot: 'err', label: titleCase(r.overall) };
  return { dot: 'warn', label: titleCase(r.overall) };
}

export function AccountScreen() {
  const [principal, setPrincipal] = useState<Principal | null | undefined>(undefined); // undefined = loading
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [devices, setDevices] = useState<Array<{ deviceId: string; status: string; platform: string; label?: string | null; tapToPayCapable: boolean }> | null>(null);
  const [devBusy, setDevBusy] = useState<string | null>(null);

  // Biometric state
  const [faceIdSupported, setFaceIdSupported] = useState(false);
  const [isFaceIdEnabled, setIsFaceIdEnabled] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [bioMsg, setBioMsg] = useState<string | null>(null);
  const [bioErr, setBioErr] = useState<string | null>(null);

  const loadDevices = useCallback(() => {
    mobileCheckoutApi.myDevices().then(setDevices).catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    let active = true;
    authApi.me().then((p) => { if (active) setPrincipal(p); });
    mobileCheckoutApi.readiness(DEVICE_ID).then((r) => { if (active) setReadiness(r); }).catch(() => { if (active) setReadiness(null); });
    loadDevices();

    void faceIdMode().then(async (mode) => {
      if (!active) return;
      const supported = mode !== 'none';
      setFaceIdSupported(supported);
      if (supported) {
        const enrolled = await isFaceIdEnrolled().catch(() => false);
        const stored = localStorage.getItem('aps_pay_faceid_enabled');
        setIsFaceIdEnabled(enrolled || stored === 'true');
      }
    }).catch(() => {
      if (active) setFaceIdSupported(false);
    });

    return () => { active = false; };
  }, [loadDevices]);

  const handleFaceIdToggle = async () => {
    if (bioBusy) return;
    setBioErr(null);
    setBioMsg(null);

    if (isFaceIdEnabled) {
      setBioBusy(true);
      try {
        await disableFaceId();
        setIsFaceIdEnabled(false);
        localStorage.setItem('aps_pay_faceid_enabled', 'false');
        setBioMsg('Biometric login disabled.');
      } catch (e: any) {
        setBioErr(e?.message || 'Could not disable biometrics.');
      } finally {
        setBioBusy(false);
      }
      return;
    }

    setBioBusy(true);
    try {
      await enrollFaceId();
      setIsFaceIdEnabled(true);
      localStorage.setItem('aps_pay_faceid_enabled', 'true');
      setBioMsg('Biometric login enabled.');
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (!/cancel/i.test(msg)) {
        setBioErr(msg || 'Could not enable biometrics.');
      }
    } finally {
      setBioBusy(false);
    }
  };

  const onDeviceAction = useCallback(async (deviceId: string, action: 'approve' | 'revoke') => {
    setDevBusy(deviceId);
    try { await (action === 'approve' ? mobileCheckoutApi.approveDevice(deviceId) : mobileCheckoutApi.revokeDevice(deviceId)); loadDevices(); }
    catch { /* surfaced by the unchanged status on reload */ }
    finally { setDevBusy(null); }
  }, [loadDevices]);

  const onSignOut = useCallback(async () => {
    setSigningOut(true);
    await unregisterPushToken();
    try { await authApi.logout(); } catch { /* best-effort */ }
    await clearNativeToken();
    signalSignedOut();   // closes the live checkout stream
    setPrincipal(null);
    window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    setSigningOut(false);
  }, []);

  const rd = readinessDisplay(readiness);

  return (
    <>
      <div className="pay-sechead"><div className="t pay-serif">Account</div></div>

      {principal === undefined && <div className="pay-skel" style={{ height: 88, marginBottom: 14 }} />}

      {principal === null && (
        <div className="pay-state"><div className="big">Not signed in</div><div className="muted">Sign in on this device to take payments.</div></div>
      )}

      {principal && (
        <>
          <div className="pay-acct-profile">
            <span className="av">{initials(principal.fullName, principal.userId)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nm">{principal.fullName || principal.userId}</div>
              <div className="rl">{titleCase(principal.role)}</div>
            </div>
          </div>

          {/* Security & Biometrics */}
          <div className="pay-infocard">
            <div className="pay-toggle-row">
              <div className="pay-toggle-meta">
                <span className="pay-toggle-lbl">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
                    <path d="M9 10v1M15 10v1M12 9v4l-1 1" />
                    <path d="M9 15c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" />
                  </svg>
                  Face ID / Biometric Login
                </span>
                <span className="pay-toggle-sub">
                  Sign in instantly with your face or fingerprint
                </span>
              </div>
              <label className="pay-switch" aria-label="Toggle Biometric Login">
                <input
                  type="checkbox"
                  checked={isFaceIdEnabled}
                  disabled={bioBusy || !faceIdSupported}
                  onChange={handleFaceIdToggle}
                />
                <span className="pay-switch-slider" />
              </label>
            </div>
            {!faceIdSupported && (
              <div className="pay-status-msg muted">
                Biometric authentication is not supported or not set up on this device.
              </div>
            )}
            {bioErr && (
              <div className="pay-status-msg err" role="alert">
                {bioErr}
              </div>
            )}
            {bioMsg && (
              <div className="pay-status-msg ok" role="status">
                {bioMsg}
              </div>
            )}
          </div>

          <div className="pay-infocard">
            <div className="pay-inforow"><span className="k">Payment readiness</span><span className="v"><span className={`pay-dot ${rd.dot}`} />{rd.label}</span></div>
            {readiness?.processor && <div className="pay-inforow"><span className="k">Processor</span><span className="v">{titleCase(readiness.processor)}</span></div>}
            <div className="pay-inforow"><span className="k">Tap to Pay</span><span className="v">{readiness?.tapToPayConfigured ? 'Configured' : 'Not set up'}</span></div>
          </div>

          <div className="pay-infocard">
            <div className="pay-inforow"><span className="k">Device</span><span className="v pay-mono">{DEVICE_ID.slice(0, 8)}</span></div>
            <div className="pay-inforow"><span className="k">Session</span><span className="v pay-mono">{SESSION_ID.slice(0, 8)}</span></div>
            <div className="pay-inforow"><span className="k">App version</span><span className="v">v{APP_VERSION}</span></div>
          </div>

          {devices && devices.length > 0 && (
            <div className="pay-infocard">
              <div className="pay-inforow"><span className="k">Payment devices</span><span className="v">{devices.length}</span></div>
              {devices.map((d) => {
                const owner = principal.role === 'OWNER';
                const dot = d.status === 'active' ? 'ok' : d.status === 'revoked' ? 'err' : 'warn';
                return (
                  <div key={d.deviceId} className="pay-inforow" style={{ alignItems: 'center' }}>
                    <span className="k pay-mono">{d.deviceId.slice(0, 8)}{d.deviceId === DEVICE_ID ? ' · this' : ''}</span>
                    <span className="v" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className={`pay-dot ${dot}`} />{titleCase(d.status)}
                      {owner && d.status !== 'active' && <button className="pay-chip" disabled={devBusy === d.deviceId} onClick={() => onDeviceAction(d.deviceId, 'approve')}>Approve</button>}
                      {owner && d.status === 'active' && <button className="pay-chip" disabled={devBusy === d.deviceId} onClick={() => onDeviceAction(d.deviceId, 'revoke')}>Revoke</button>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 22, marginBottom: 28 }}>
            <button
              className="pay-btn-danger"
              disabled={signingOut}
              onClick={onSignOut}
              aria-label="Sign out"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

