// useGoCheckIn.ts — the display's guest check-in session (23-inch spec §8, §12, §18 — Unit 7: ONE device identity).
// The display checks guests in with its OWN credential: POST /customer-display/device/check-in/session (x-device-token)
// starts a session for the display's salon and branch — no Go Check-In kiosk has to exist, and nothing in the request
// names a salon or a branch. `deviceToken` is null when the display has no check-in (switched off for the salon, the
// display serviced, offline): the hook is then inactive.
//
// ONE SESSION PER GUEST. When a guest's turn ends the flow calls renew(): the session they used is completed and a fresh
// one is started, so every guest gets the session's own allowances (8 phone lookups, 3 new profiles) — the door used to
// be one session for the whole day, and the ninth lookup of the morning was refused. A session nobody used is kept.
// A heartbeat keeps the waiting session alive; a session the server ended (timed out while the screen slept, completed
// elsewhere) is replaced, and a call it refused is made again ONCE on the fresh session (the refusal happens before
// anything is written). A start the server refuses (check-in switched off, the display serviced or revoked) is tried
// again later, backing off — never a loop against the door's limit.
//
// It holds NO flow/UI state — useCheckInFlow owns that.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as gci from './goCheckInApi';
import type { Session, WalkInInput } from './goCheckInApi';
import type { KioskConfig } from '@aipowersalon/api-contracts/customer';
import { DisplayApiError } from './api';

export type GoCheckInPhase = 'inactive' | 'starting' | 'ready' | 'error';

/** The server no longer knows the session (404), refuses its token (401), or it ended / timed out (410). */
const isGone = (e: unknown) => e instanceof DisplayApiError && (e.status === 401 || e.status === 404 || e.status === 410);
/** After a refused start: 15 s, 30 s, 1 min, then every 2 min (the door allows 30 starts a minute per display). */
export const START_RETRY_MS = [15_000, 30_000, 60_000, 120_000] as const;
/** The waiting session's heartbeat (the server ends a session idle for 10 minutes). */
export const SESSION_HEARTBEAT_MS = 20_000;

export function useGoCheckIn(deviceToken: string | null | undefined) {
  const [phase, setPhase] = useState<GoCheckInPhase>('inactive');
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Promise<Session> | null>(null);   // the session in use, or being started
  const used = useRef(false);                               // the guest did something with it (renew only then)
  const epoch = useRef(0);                                  // bumps on every start / stop: an older start's answer is dropped
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tokenRef = useRef(deviceToken);
  tokenRef.current = deviceToken;

  const start = useCallback((): Promise<Session> => {
    const token = tokenRef.current;
    const my = ++epoch.current;
    clearTimeout(retryTimer.current);
    used.current = false;
    if (!token) { current.current = null; return Promise.reject(new Error('Check-in is not available on this display.')); }
    const p = gci.startDisplaySession(token).then((r) => {
      if (my === epoch.current) { retries.current = 0; setConfig(r.config); setError(null); setPhase('ready'); }
      return { sessionId: r.sessionId, token: r.sessionToken };
    });
    current.current = p;
    p.catch((e) => {
      if (my !== epoch.current) return;
      current.current = null;
      setError(e?.message || 'Check-in is unavailable right now.');
      setPhase('error');
      const wait = START_RETRY_MS[Math.min(retries.current, START_RETRY_MS.length - 1)];
      retries.current += 1;
      retryTimer.current = setTimeout(() => { if (my === epoch.current) void start().catch(() => undefined); }, wait);
    });
    return p;
  }, []);

  /** Stop: an answer still on its way is dropped and a pending retry cancelled; returns the session that was in use. */
  const halt = useCallback((): Promise<Session> | null => {
    epoch.current++; clearTimeout(retryTimer.current);
    const p = current.current; current.current = null;
    return p;
  }, []);

  // Start when the display has check-in; stop (and end the session) when it no longer does.
  useEffect(() => {
    if (!deviceToken) { halt(); setPhase('inactive'); setConfig(null); setError(null); return; }
    retries.current = 0;
    setPhase('starting'); setError(null);
    void start().catch(() => undefined);
    return () => { halt()?.then((s) => gci.completeSession(s)).catch(() => undefined); };
  }, [deviceToken, start, halt]);

  // The heartbeat keeps the waiting session alive; a session the server has ended is replaced.
  useEffect(() => {
    if (phase !== 'ready') return;
    const id = setInterval(() => {
      const p = current.current;
      if (!p) return;
      p.then((s) => gci.heartbeat(s)).catch((e) => { if (isGone(e) && current.current === p) void start().catch(() => undefined); });
    }, SESSION_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [phase, start]);

  /** A guest's turn is over: their session is completed and the next guest's started — only if they used it. */
  const renew = useCallback(() => {
    if (!used.current || !tokenRef.current) return;
    const old = current.current;
    void start().catch(() => undefined);
    old?.then((s) => gci.completeSession(s)).catch(() => undefined);
  }, [start]);

  /** Run a call on the current session (waiting for one being started). `mark`: it counts as the guest using it. */
  const withSession = useCallback(<T,>(fn: (s: Session) => Promise<T>, mark = true): Promise<T> => {
    const p = current.current;
    if (!p) return Promise.reject(new Error('Check-in is getting ready. Please try again in a moment.'));
    if (mark) used.current = true;
    return p.then(fn).catch((e) => {
      if (!isGone(e)) throw e;
      // the server ended this session (it timed out while the screen slept, say): once more, on a fresh session
      const fresh = current.current === p || !current.current ? start() : current.current;
      if (mark) used.current = true;
      return fresh.then(fn);
    });
  }, [start]);

  // ONE stable set of session calls (withSession reads the session from a ref), and a returned object that keeps its
  // identity until phase / config / error change. It used to be a NEW object on every render: the check-in screen's
  // services/technicians effect depended on it, so every answer re-rendered → re-ran the effect → asked again — a tight
  // loop of hundreds of requests a second per display, starving the display's own checkout requests (Chromium refused
  // the overflow with ERR_INSUFFICIENT_RESOURCES). Found Oct 6 2026 by the Unit 4 live browser proof; pinned in
  // useCheckInFlow.test.tsx.
  const calls = useMemo(() => ({
    lookupPhone: (phone: string) => withSession((s) => gci.lookupPhone(s, phone)),
    confirmCustomer: (customerId: string) => withSession((s) => gci.confirmCustomer(s, customerId)),
    createCustomer: (input: { firstName?: string; fullName?: string; phone?: string }) => withSession((s) => gci.createCustomer(s, input)),
    todayAppointments: (customerId: string) => withSession((s) => gci.todayAppointments(s, customerId)),
    checkInAppointment: (appointmentId: string) => withSession((s) => gci.checkInAppointment(s, appointmentId)),
    technicianIdentify: (pin: string) => withSession((s) => gci.technicianIdentify(s, pin)),
    technicianClockIn: (pin: string, idempotencyKey?: string) => withSession((s) => gci.technicianClockIn(s, pin, idempotencyKey)),
    technicianClockOut: (pin: string, idempotencyKey?: string) => withSession((s) => gci.technicianClockOut(s, pin, idempotencyKey)),
    // the menu and the team are the screen's, not the guest's: asking for them does not make the session "used"
    listServices: () => withSession((s) => gci.listServices(s), false),
    listTechnicians: (serviceIds: string[] = []) => withSession((s) => gci.listTechnicians(s, serviceIds), false),
    checkInWalkIn: (input: WalkInInput) => withSession((s) => gci.checkInWalkIn(s, input)),
    placeInLine: (checkInId: string) => withSession((s) => gci.placeInLine(s, checkInId), false),
    renew,
  }), [withSession, renew]);
  return useMemo(() => ({ phase, config, error, ...calls }), [phase, config, error, calls]);
}
