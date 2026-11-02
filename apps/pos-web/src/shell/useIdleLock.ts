// useIdleLock.ts — Functional Decision 35 as a hook (used by POSLayout): lock after the idle minutes, unlock with the quick PIN,
// and — once a lock is older than LONG_INACTIVITY_HOURS — end the session (full sign-in required).
//
// Kevin, Oct 12 2026: "POS auto-lock is on by default at 60 minutes, also locked on the server, with a full sign-in after 8 hours
// locked." The SERVER is the authority now: it locks this session after the salon's minutes with no browser involved, answers
// 423 SESSION_LOCKED until the PIN, and ends the session after 8 hours locked. This hook is the instant-UX half:
//   • a local timer (the device's choice, never longer than the salon's — effectiveIdleLock) locks the screen at once and tells
//     the server (POST /auth/lock);
//   • a person's activity is reported to the server at most once a minute (POST /auth/session-activity) — that is the server's
//     idle clock; reads, polling and streams never move it;
//   • GET /auth/lock-status on open tells it the salon's value and whether the server already has the session locked (with the
//     server's lock time, so the 8 hours here match the server's);
//   • any 423 locks this screen (session-lock-watch.ts), carrying the server's lock time.
import { useEffect, useRef, useState } from 'react';
import { ACTIVITY_REPORT_INTERVAL_MS, type SessionLockStatus } from '@aipowersalon/api-contracts';
import { lockState, markLocked, clearLock, effectiveIdleLock, writeSalonLock } from './idle-lock';
import { SESSION_LOCKED_EVENT } from '../api/session-lock-watch';
import { api } from '../api/client';

// Decision 35: lock the SESSION on the server too, so another tab or a cleared browser cannot skip the PIN.
// Never load-bearing for the screen lock itself (offline, the screen still locks).
const fire = (path: string) => { try { const r: any = api.post(path); r?.catch?.(() => undefined); } catch { /* never load-bearing */ } };
const lockOnServer = () => fire('/auth/lock');
const reportActivity = () => fire('/auth/session-activity');

const ACTIVITY = ['mousemove', 'keydown', 'touchstart', 'click'] as const;

export function useIdleLock(onFullSignIn: () => void): { isLocked: boolean; unlock: () => void; fullSignIn: () => void } {
  const [isLocked, setLocked] = useState(() => lockState(localStorage, Date.now()) !== 'unlocked');
  const [salonRev, setSalonRev] = useState(0);   // re-arms the timer when the server tells us the salon's value
  const onFull = useRef(onFullSignIn);
  onFull.current = onFullSignIn;
  const fullSignIn = () => { clearLock(localStorage); onFull.current(); };
  const lockAt = (ms: number) => { if (lockState(localStorage, Date.now()) === 'unlocked') markLocked(localStorage, ms); setLocked(true); };

  // What the server knows: the salon's value (the maximum for this device) and whether this session is already locked.
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => api.get<SessionLockStatus>('/auth/lock-status')).then((st) => {
      if (!alive || !st || typeof st !== 'object') return;
      if (st.salon) { writeSalonLock(localStorage, st.salon); setSalonRev((n) => n + 1); }
      if (st.locked) lockAt(st.lockedAt ? Date.parse(st.lockedAt) : Date.now());
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  // Arm the idle timer while unlocked; any activity restarts it and is reported to the server (at most once a minute).
  useEffect(() => {
    if (isLocked) return;
    let timer: number | null = null;
    let lastReport = 0; let pending: number | null = null;
    const report = () => {
      const now = Date.now();
      if (now - lastReport >= ACTIVITY_REPORT_INTERVAL_MS) { lastReport = now; reportActivity(); return; }
      if (pending == null) pending = window.setTimeout(() => { pending = null; lastReport = Date.now(); reportActivity(); }, ACTIVITY_REPORT_INTERVAL_MS - (now - lastReport));
    };
    const arm = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
      const { enabled, minutes } = effectiveIdleLock(localStorage);
      if (enabled) timer = window.setTimeout(() => { markLocked(localStorage, Date.now()); setLocked(true); lockOnServer(); }, minutes * 60_000);
    };
    const onActivity = () => { arm(); report(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity));
    arm();
    return () => { ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity)); if (timer) window.clearTimeout(timer); if (pending != null) window.clearTimeout(pending); };
  }, [isLocked, salonRev]);

  // The server says this session is locked (it idle-locked it, or another tab locked it) → lock this screen as well.
  useEffect(() => {
    const onLocked = (e: Event) => {
      const at = Date.parse(String((e as CustomEvent).detail?.lockedAt ?? ''));
      lockAt(Number.isFinite(at) ? at : Date.now());
    };
    window.addEventListener(SESSION_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(SESSION_LOCKED_EVENT, onLocked);
  }, []);

  // While locked: as soon as the lock has outlived quick unlock, end the session (checked on open and every minute). The
  // server ends it too (its next answer is 401 → the app's sign-out).
  useEffect(() => {
    if (!isLocked) return;
    const check = () => { if (lockState(localStorage, Date.now()) === 'full_sign_in') { clearLock(localStorage); onFull.current(); } };
    check();
    const t = window.setInterval(check, 60_000);
    return () => window.clearInterval(t);
  }, [isLocked]);

  return { isLocked, unlock: () => { clearLock(localStorage); setLocked(false); }, fullSignIn };
}
