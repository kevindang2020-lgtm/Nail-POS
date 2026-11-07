import { useEffect, useState, useCallback } from 'react';
import { authApi, type Principal, type BranchOption } from '../api/authApi';
import { saveNativeSession, clearNativeToken, clearFaceId, faceIdMode, isFaceIdEnrolled, enrollFaceId, disableFaceId } from '@aipowersalon/mobile-sdk';
import { mobile } from '../lib/mobile';   // Phase 13 D: the ONE push client
import { mobileCheckoutApi, type ReadinessReport, type MobilePayDeviceView, type TapToPayCapabilityView } from '../api/mobileCheckoutApi';
import { titleCase } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';
import { useT, fmtTime } from '@aipowersalon/mobile-sdk';
import { useInlineAsk, useInlineConfirm } from '@aipowersalon/ui';
import { readActiveAttempt } from '../util/activeAttempt';
import { useStepUp, isStepUpCancelled } from '../lib/stepUp';
import { PairDeviceCard } from './DeviceScreens';
import { useDeviceStanding } from '../device/deviceState';

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
  const tr = useT();
  const { ask, askUi } = useInlineAsk();
  const [principal, setPrincipal] = useState<Principal | null | undefined>(undefined); // undefined = loading
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [capability, setCapability] = useState<TapToPayCapabilityView | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [devices, setDevices] = useState<MobilePayDeviceView[] | null>(null);
  const [devBusy, setDevBusy] = useState<string | null>(null);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  const stepUp = useStepUp();   // Secure Tap to Pay §13: approve / revoke / disable are step-up routes
  const standing = useDeviceStanding();

  const loadDevices = useCallback(() => {
    mobileCheckoutApi.myDevices().then(setDevices).catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    let active = true;
    authApi.me().then((p) => { if (active) setPrincipal(p); });
    mobileCheckoutApi.readiness(DEVICE_ID).then((r) => { if (active) setReadiness(r); }).catch(() => { if (active) setReadiness(null); });
    mobileCheckoutApi.capability?.(DEVICE_ID)?.then((c) => { if (active) setCapability(c); }).catch(() => { if (active) setCapability(null); });
    loadDevices();
    return () => { active = false; };
  }, [loadDevices]);

  // §138–§139: revoke / disable carry a reason (audited); approve is the owner's trust decision
  const onDeviceAction = useCallback((deviceId: string, action: 'approve' | 'revoke' | 'disable') => {
    const run = async (reason?: string) => {
      setDevBusy(deviceId);
      setDevMsg(null);
      try { await stepUp.run(() => (action === 'approve' ? mobileCheckoutApi.approveDevice(deviceId) : action === 'revoke' ? mobileCheckoutApi.revokeDevice(deviceId, reason) : mobileCheckoutApi.disableDevice(deviceId, reason))); loadDevices(); }
      catch (e: any) { if (!isStepUpCancelled(e)) setDevMsg(tr('pay.account.actionFailed', { reason: String(e?.message || '') })); }
      finally { setDevBusy(null); }
    };
    if (action === 'approve') void run();
    else ask(action === 'revoke' ? 'Reason for revoking this phone (e.g. lost phone)?' : 'Reason for disabling this phone?', (reason) => { void run(reason.trim()); }, { minLength: 2 });
  }, [loadDevices, ask, stepUp, tr]);

  const onSignOut = useCallback(async () => {
    setSigningOut(true);
    // Hand the PUSH token back FIRST — /push/unregister is authenticated, so it must run while the session still
    // exists; logging out first would leave this device registered (and receiving payment pushes) forever.
    await mobile.push.unregister();
    // Manager Pay keeps the strict rule (Nov 5 2026): a Tap to Pay phone is often shared at the front desk, so signing out
    // ends Face ID on it. The server no longer does that on logout (migration 841) — revoke it here while the session lives.
    try { await disableFaceId(); } catch { /* clearFaceId below still wipes it locally */ }
    try { await authApi.logout(); } catch { /* best-effort */ }
    // Wipe the Keychain bearer token immediately — a token left behind outlives the sign-out and is resent on every
    // later request (exactly what someone with the device would look for); don't wait for a future 401 to clear it.
    await clearNativeToken();
    await clearFaceId();   // Phase 13 D: the server revoked the device credential at /auth/logout; the Keychain item goes too
    // Return the WHOLE app to the login screen. `setPrincipal` here is AccountScreen's local copy — it does NOT drive
    // App's auth gate — so announce the unauthorized event that App.tsx listens for, which drops the app-level principal.
    setPrincipal(null);
    window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    setSigningOut(false);
  }, []);

  const rd = readinessDisplay(readiness);

  return (
    <>
      <div className="pay-sechead"><div className="t pay-serif">{tr('pay.account.title')}</div></div>
      {capability?.environment === 'sandbox' && <div className="pay-sandbox" role="status">{tr('pay.cap.sandbox')}</div>}

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

          <FaceIdRow userId={(principal as any)?.userId ?? null} />

          <div className="pay-infocard">
            <div className="pay-inforow"><span className="k">{tr('pay.account.paymentStatus')}</span><span className="v"><span className={`pay-dot ${rd.dot}`} />{rd.label}</span></div>
            {capability && <div className="pay-inforow"><span className="k">Tap to Pay</span><span className="v">{capability.state === 'ready' ? tr('pay.cap.ready') : capability.state === 'disabled' ? tr('pay.cap.disabled') : capability.state === 'unavailable' ? tr('pay.cap.unavailable') : tr('pay.cap.setup')}</span></div>}
            {capability?.reason && capability.state !== 'ready' && <div className="pay-inforow"><span className="k muted">{capability.reason}</span></div>}
            {/* The report has no processor/tapToPayConfigured fields — those states live in its checks (keys 'processor', 'tap_to_pay'). */}
            {(() => { const p = readiness?.checks?.find((x) => x.key === 'processor'); return p?.detail ? <div className="pay-inforow"><span className="k">Processor</span><span className="v">{titleCase(p.detail)}</span></div> : null; })()}
          </div>

          <BranchCard currentBranchId={principal.branchId} onSwitched={(p) => setPrincipal((prev) => (prev ? { ...prev, ...p } : prev))} />

          <div className="pay-infocard">
            <div className="pay-inforow"><span className="k">{tr('pay.device.thisPhone')}</span><span className="v pay-mono">{DEVICE_ID.slice(0, 8)}{standing !== 'unknown' ? ` · ${titleCase(standing)}` : ''}</span></div>
            <div className="pay-inforow"><span className="k">Session</span><span className="v pay-mono">{SESSION_ID.slice(0, 8)}</span></div>
            <div className="pay-inforow"><span className="k">App version</span><span className="v">v{APP_VERSION}</span></div>
          </div>

          <PairDeviceCard />
          {devMsg ? <div className="pay-note" role="alert">{devMsg}</div> : null}
          {stepUp.prompt}
          {devices && devices.length > 0 && (
            <div className="pay-infocard">
              <div className="pay-inforow"><span className="k">{tr('pay.account.devices')}</span><span className="v">{devices.length}</span></div>
              {devices.map((d) => {
                // the approval controls follow the PERMISSION the server derived (pos.devices.manage), not the role name
                const owner = principal.permissions?.includes('pos.devices.manage') || principal.role === 'OWNER';
                const dot = d.status === 'active' ? (d.online ? 'ok' : 'warn') : d.status === 'revoked' || d.status === 'compromised' ? 'err' : 'warn';
                const canReactivate = d.status === 'pending' || d.status === 'disabled' || d.status === 'revoked';
                return (
                  <div key={d.deviceId} className="pay-inforow pay-devicerow" style={{ alignItems: 'center' }}>
                    <span className="k">
                      <span className="pay-mono">{d.label || d.deviceId.slice(0, 8)}{d.deviceId === DEVICE_ID ? ' · this' : ''}</span>
                      <span className="sub">{d.boundUserName || ''}{d.appVersion ? ` · v${d.appVersion}` : ''}{d.status === 'active' ? ` · ${d.online ? tr('pay.account.online') : tr('pay.account.offline')}` : ''}{d.lastPaymentAt ? ` · ${tr('pay.account.lastPayment')} ${fmtTime(new Date(d.lastPaymentAt))}` : ''}</span>
                    </span>
                    <span className="v" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className={`pay-dot ${dot}`} />{titleCase(d.status)}
                      {owner && canReactivate && <button className="pay-chip" disabled={devBusy === d.deviceId} onClick={() => onDeviceAction(d.deviceId, 'approve')}>{tr('pay.account.approve')}</button>}
                      {owner && d.status === 'active' && <button className="pay-chip" disabled={devBusy === d.deviceId} onClick={() => onDeviceAction(d.deviceId, 'disable')}>{tr('pay.account.disable')}</button>}
                      {owner && (d.status === 'active' || d.status === 'disabled' || d.status === 'pending') && <button className="pay-chip" disabled={devBusy === d.deviceId} onClick={() => onDeviceAction(d.deviceId, 'revoke')}>{tr('pay.account.revoke')}</button>}
                    </span>
                  </div>
                );
              })}
              {askUi}
            </div>
          )}

          {/* §119: Support — never exposes merchant secrets / gateway settings (those live in Super Admin only, §122) */}
          <div className="pay-infocard">
            <div className="pay-inforow"><span className="k">{tr('pay.account.support')}</span></div>
            <div className="pay-inforow"><span className="k muted">{tr('pay.account.supportHint')}</span></div>
          </div>
          <div className="pay-stickyfoot">
            <button className="pay-btn-danger" disabled={signingOut} onClick={onSignOut}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {signingOut ? 'Signing out…' : tr('pay.account.signOut')}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * §119 Branch, §120 switching, §121 restrictions. The list is the platform's branch picker (GET /auth/branches): the server
 * returns only the locations this person may enter, so a manager authorised for one location sees just it and nothing to
 * switch. Switching is the ONE platform switch (POST /auth/select-branch) — confirmed inline, refused while a payment on this
 * phone is in flight (the intent this install remembers, checked here; the server re-checks claims + attempts and answers
 * 409 PAYMENT_IN_PROGRESS). On success the re-signed session is stored and the app is told (aps:branch-switched), which
 * re-keys every screen's data to the new location.
 */
function BranchCard({ currentBranchId, onSwitched }: { currentBranchId: string | null; onSwitched: (p: Principal) => void }) {
  const tr = useT();
  const { confirm, confirmUi } = useInlineConfirm();
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [current, setCurrent] = useState<string | null>(currentBranchId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setCurrent(currentBranchId); }, [currentBranchId]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(authApi.branches?.()).then((b) => { if (alive) setBranches(Array.isArray(b) ? b : []); }).catch(() => { if (alive) setBranches([]); });
    return () => { alive = false; };
  }, []);
  const label = (b?: BranchOption | null) => (b ? b.name || b.city || b.id.slice(0, 8) : '');
  const here = branches?.find((b) => b.id === current) ?? null;
  const others = (branches ?? []).filter((b) => b.id !== current);

  const doSwitch = async (b: BranchOption) => {
    setBusy(true); setMsg(null);
    try {
      const r = await authApi.selectBranch(b.id, DEVICE_ID);
      await saveNativeSession(r);   // native: the re-signed token for the new location (web: the cookie was re-set)
      if (r?.principal) { onSwitched(r.principal); window.dispatchEvent(new CustomEvent('aps:branch-switched', { detail: r.principal })); }
      setCurrent(b.id);
      setMsg(tr('pay.branch.switched', { name: label(b) }));
    } catch (e: any) {
      setMsg(e?.code === 'PAYMENT_IN_PROGRESS' ? String(e?.message || tr('pay.branch.finishFirst')) : String(e?.message || tr('pay.branch.failed')));
    } finally { setBusy(false); }
  };
  const ask = (b: BranchOption) => {
    // §120: the in-flight intent this install remembers (relaunch recovery) — finish or cancel it first
    if (readActiveAttempt()) { setMsg(tr('pay.branch.finishFirst')); return; }
    confirm(tr('pay.branch.confirmQ', { name: label(b) }), () => { void doSwitch(b); }, { title: tr('pay.account.branch'), confirmLabel: tr('pay.branch.confirm') });
  };

  if (!current && !(branches && branches.length)) return null;
  return (
    <div className="pay-infocard">
      <div className="pay-inforow"><span className="k">{tr('pay.account.branch')}</span><span className="v">{branches === null ? '…' : (label(here) || (current ? current.slice(0, 8) : ''))}</span></div>
      {others.map((b) => (
        <div key={b.id} className="pay-inforow" style={{ alignItems: 'center' }}>
          <span className="k">{b.isActive ? label(b) : `${label(b)} · ${tr('pay.branch.inactive')}`}</span>
          <span className="v">{b.isActive && <button className="pay-chip" disabled={busy} aria-label={tr('pay.branch.switchTo', { name: label(b) })} onClick={() => ask(b)}>{tr('pay.branch.switch')}</button>}</span>
        </div>
      ))}
      {msg ? <div className="pay-inforow"><span className="k" role="status">{msg}</span></div> : null}
      {confirmUi}
    </div>
  );
}

/** Face ID for this app (BUILD_PLAN Phase 13 D, Constitution 6 §37–39): shown only where the server has it on and the
 *  device supports it. Turning it on needs a recent password sign-in (the server answers otherwise); turning it off revokes
 *  the device credential server-side and deletes the Keychain item. */
function FaceIdRow({ userId }: { userId: string | null }) {
  const tr = useT();
  const [shown, setShown] = useState(false);
  const [msgErr, setMsgErr] = useState(false);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void faceIdMode().then(async (m) => { if (!alive || m !== 'native') return; setShown(true); setOn(await isFaceIdEnrolled()); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!shown) return null;
  const toggle = async () => {
    setBusy(true); setMsg(null); setMsgErr(false);
    try {
      if (on) { await disableFaceId(); setOn(false); setMsg('Face ID sign-in is off.'); }
      else { await enrollFaceId(userId); setOn(true); setMsg('Face ID sign-in is on.'); }
    } catch (e: any) { if (e?.reason !== 'cancelled') { setMsgErr(true); setMsg(String(e?.message || 'Face ID could not be changed.')); } }
    finally { setBusy(false); }
  };
  return (
    <div className="pay-infocard">
      <div className="pay-toggle-row">
        <div className="pay-toggle-meta">
          <span className="pay-toggle-lbl">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9 10v1M15 10v1M12 9v4l-1 1" /><path d="M9 15c.9.8 1.9 1.2 3 1.2s2.1-.4 3-1.2" />
            </svg>
            {tr('pay.account.faceId')}
          </span>
          <span className="pay-toggle-sub">{tr('pay.account.faceIdHint')}</span>
        </div>
        <label className="pay-switch">
          <input type="checkbox" role="switch" aria-label={tr('pay.account.faceId')} checked={on} disabled={busy} onChange={() => { void toggle(); }} />
          <span className="pay-switch-slider" />
        </label>
      </div>
      {msg ? <div className={`pay-status-msg ${msgErr ? 'err' : 'ok'}`} role={msgErr ? 'alert' : 'status'}>{msg}</div> : null}
    </div>
  );
}
