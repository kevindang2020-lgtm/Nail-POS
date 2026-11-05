// useDisplay.ts — owns the display's live state (23-inch dual-screen spec §29, §36–§37, §43–§46, §96, §100–§107).
//
// How the display FOLLOWS the checkout:
//   • realtime first: the device stream always carries the display's OWN channel (an idle display used to listen on
//     nothing, so it never heard a checkout start), plus — while a checkout is attached — its session and ticket rooms.
//     The stream is re-opened whenever the session changes so the server re-derives the rooms; the device never picks one.
//   • a silent 15-second safety sync (the platform's one sync policy) while visible, and 5-second polling only while the
//     stream is down. Neither ever blanks the screen: a failed refetch keeps the last good state.
//   • every response carries its session and version; an older response for the same session is dropped (§101).
//
// How the display FORGETS the customer (§43–§46, §107): only when the server says the checkout is unequivocally complete
// (payment_success, the receipt question answered) does a fixed 3000 ms timer start. When it fires, the customer state is
// DESTROYED — replaced by an idle state built from scratch, not covered over — and a device display releases the session
// so the server ends it. A released session is never rendered again, even if a slow fetch still returns it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRealtimeClient, FallbackPoller, startVisibleSafetySync, SYNC_POLICY } from '@aipowersalon/realtime-client';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { fetchState, submitTip, submitMethod, requestPayment, submitRating, submitReceipt, releaseCompleted, streamUrl, streamSource, readCreds, DisplayApiError, type Creds } from './api';
import type { CustomerDisplayState, DisplayHeartbeatAck, DisplayReceiptSubmission, TipSubmission } from '@aipowersalon/api-contracts/customer';
import { rememberSalon } from './salonMemory';

export type Phase = 'connecting' | 'no-creds' | 'forbidden' | 'error' | 'ready';

/** Spec §43 (hard requirement): the completed-checkout summary stays exactly this long, then the customer is cleared. */
export const COMPLETED_HOLD_MS = 3000;

const ZERO_TOTALS: CustomerDisplayState['totals'] = { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 };

/** An idle state built from NOTHING customer-related — only the salon's own fields survive (§45: no name, ticket, tip,
 *  totals, payment method or session id). Never a spread of the previous state. The salon's branding (§13: its name,
 *  logo, tagline, branch, idle line — no customer field exists in it) is copied field by field, so the header does not
 *  flash from the logo to a monogram while the release is answered. */
export function idleShell(from: Pick<CustomerDisplayState, 'salonName' | 'payButtonEnabled' | 'branding'> | null, keep: { goCheckInSlug?: string; checkIn?: boolean } = {}): CustomerDisplayState {
  const b = from?.branding;
  return {
    state: 'idle', salonName: from?.salonName ?? '', tipOptions: [], selectedTipCents: 0, totals: { ...ZERO_TOTALS },
    payButtonEnabled: from?.payButtonEnabled ?? false, ...(keep.goCheckInSlug ? { goCheckInSlug: keep.goCheckInSlug } : {}),
    // the display's own check-in (Unit 7) stays on through the cleared screen — the guest at the keypad is not cut off
    ...(keep.checkIn ? { checkIn: true } : {}),
    ...(b ? { branding: { salonName: b.salonName, logoUrl: b.logoUrl, tagline: b.tagline, branchName: b.branchName, idleMessage: b.idleMessage } } : {}),
  };
}

/** The completed checkout the 3-second timer may start on, or null: server-confirmed success, and
 *  no receipt still being chosen (§97: the screen never leaves while the customer is choosing a receipt). */
export function completedKey(s: CustomerDisplayState | null): string | null {
  if (!s || s.state !== 'payment_success' || s.receipt?.status === 'choose') return null;
  return s.sessionId ?? (s.ticket?.ticketNumber ? `ticket:${s.ticket.ticketNumber}` : null);
}

/** §97: the receipt question on screen right now (its checkout), or null. */
export function receiptKey(s: CustomerDisplayState | null): string | null {
  return s?.state === 'payment_success' && s.receipt?.status === 'choose' ? (s.sessionId ?? 'receipt') : null;
}

/**
 * `credsIn`: the credential this display runs with (useCredentials). Left out, the address is read (tests, and a one-off
 * session link). `onRevoked`: the server refused a DEVICE credential — the owner revoked this display; it goes back to
 * its pairing screen.
 */
export function useDisplay(credsIn?: Creds | null, opts: { onRevoked?: () => void } = {}) {
  const [creds] = useState<Creds | null>(() => (credsIn !== undefined ? credsIn : readCreds()));
  const onRevokedRef = useRef(opts.onRevoked);
  onRevokedRef.current = opts.onRevoked;
  const [data, setData] = useState<CustomerDisplayState | null>(null);
  const [phase, setPhase] = useState<Phase>(creds ? 'connecting' : 'no-creds');
  // Mandate §78–§81: does the server answer right now? (false after a failed fetch — the 5-second fallback poll and the
  // 15-second safety sync keep asking — true again on the next answer). A checkout on screen stays either way (§79).
  const [online, setOnline] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rated, setRated] = useState<number | null>(null);
  // 23-inch spec §73–§74, §102: bumps when the salon's advertising changed (customer_display_ads_updated on this device's
  // channel) or the stream reconnected — the advertising panel refetches its playlist; the checkout state is untouched.
  const [adsNudge, setAdsNudge] = useState(0);
  const mounted = useRef(true);
  const haveData = useRef(false);
  const onScreen = useRef<CustomerDisplayState | null>(null);   // what is rendered (the version guard compares against it)
  const released = useRef<string | null>(null);                  // a finished checkout this display must never show again
  const lastSlug = useRef<string | undefined>(undefined);        // the branch's Go Check-In slug, kept across checkouts
  const lastCheckIn = useRef(false);                             // the server's latest word on this display's check-in
  const inflight = useRef(false);
  const again = useRef(false);

  const show = useCallback((s: CustomerDisplayState) => {
    onScreen.current = s; haveData.current = true;
    setData(s); setPhase('ready');
    // §72: a paired display remembers its SALON (name + branding, nothing of a customer) for a restart without network
    if (creds?.mode === 'device') rememberSalon(s);
  }, [creds]);

  // Every server state passes through here (fetches AND action responses).
  const accept = useCallback((s: CustomerDisplayState | null) => {
    if (!s || !mounted.current) return;
    if (s.goCheckInSlug) lastSlug.current = s.goCheckInSlug;
    lastCheckIn.current = !!s.checkIn;
    if (released.current) {
      if (s.sessionId === released.current) {
        // The server has not ended it yet (the release is in flight or failed): keep the customer OFF the screen and
        // ask again. Built from scratch — nothing of the returned customer state is kept.
        show(idleShell(s, { goCheckInSlug: lastSlug.current, checkIn: lastCheckIn.current }));
        if (creds) void releaseCompleted(creds, released.current).catch(() => undefined);
        return;
      }
      released.current = null;                                   // the server moved on (idle, or the next customer)
    }
    const cur = onScreen.current;
    if (cur?.sessionId && s.sessionId === cur.sessionId && (s.version ?? 0) < (cur.version ?? 0)) return;   // stale (§101)
    show(s);
  }, [creds, show]);

  const load = useCallback(async () => {
    if (!creds) return;
    if (inflight.current) { again.current = true; return; }      // single-flight; one trailing refetch catches what arrived meanwhile
    inflight.current = true;
    try {
      const s = await fetchState(creds);
      if (mounted.current) setOnline(true);
      accept(s);
    } catch (e) {
      if (!mounted.current) return;
      if (!(e instanceof DisplayApiError) || e.status >= 500) setOnline(false);   // unreachable / failing — not a refusal
      if (e instanceof DisplayApiError && (e.status === 403 || e.status === 404)) {
        setPhase('forbidden');
        // §85 REVOKED: a paired display whose credential is refused forgets it and shows its pairing screen
        if (creds.mode === 'device' && e.status === 403) onRevokedRef.current?.();
      } else if (!haveData.current) setPhase('error');             // keep the last good screen on transient errors
    } finally {
      inflight.current = false;
      if (again.current && mounted.current) { again.current = false; void load(); }
    }
  }, [creds, accept]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  // Realtime, re-opened when the checkout on the display changes so the server re-derives this device's rooms (§100), and
  // when the front desk asks for a refresh (§82). A paired display's stream carries its credential in a header (§12).
  const sessionKey = data?.sessionId ?? 'idle';
  const [streamEpoch, setStreamEpoch] = useState(0);
  useEffect(() => {
    if (!creds) return;
    const client = createRealtimeClient({ streamPath: streamUrl(creds), eventSourceFactory: streamSource(creds) });
    const offEvent = client.onEvent((d) => {
      if (d.event === EVENTS.customerDisplayAdsUpdated) setAdsNudge((n) => n + 1);   // advertising only: no state refetch
      else if (d.event === EVENTS.customerDisplayRefreshRequested) {
        // §82 "Refresh Display": everything again — the state, the advertising, and a fresh stream
        void load(); setAdsNudge((n) => n + 1); setStreamEpoch((n) => n + 1);
      } else void load();                                          // incl. customer_display_device_updated (maintenance, revoked)
    });
    const offReconcile = client.onReconcile(() => { void load(); setAdsNudge((n) => n + 1); });   // §102: state + playlist
    const poller = new FallbackPoller(() => { if (!document.hidden) void load(); }, { intervalMs: 5_000, graceMs: 10_000 });
    poller.onStatus(client.status());
    const offStatus = client.onStatus((st) => poller.onStatus(st));
    client.connect();
    return () => { offEvent(); offReconcile(); offStatus(); poller.stop(); client.disconnect(); };
  }, [creds, load, sessionKey, streamEpoch]);

  // §37: the silent 15-second safety sync (the platform's one policy), visible-only cadence, never a blank screen.
  useEffect(() => {
    if (!creds) return;
    return startVisibleSafetySync(() => load(), { intervalMs: SYNC_POLICY.operationalMs });
  }, [creds, load]);

  // A new checkout starts clean: no rating or error from the previous customer carries over.
  useEffect(() => { setRated(null); setActionError(null); }, [sessionKey]);

  // §43–§46, §96: the 3-second completed screen, then the customer is destroyed and the session released.
  const doneKey = completedKey(data);
  useEffect(() => {
    if (!doneKey) return;
    const t = setTimeout(() => {
      if (!mounted.current) return;
      released.current = doneKey;
      show(idleShell(onScreen.current, { goCheckInSlug: lastSlug.current, checkIn: lastCheckIn.current }));
      setRated(null); setActionError(null);
      if (creds && !doneKey.startsWith('ticket:')) {
        releaseCompleted(creds, doneKey).then((s) => accept(s)).catch(() => { /* the guard keeps the customer off-screen; the next sync retries */ });
      }
    }, COMPLETED_HOLD_MS);
    return () => clearTimeout(t);
  }, [doneKey, creds, show, accept]);

  const act = useCallback(async (fn: (c: Creds) => Promise<CustomerDisplayState>, fallback: string, after?: () => void) => {
    if (!creds) return;
    setSubmitting(true); setActionError(null);
    try {
      accept(await fn(creds));
      after?.();
    } catch (e) {
      // §104: the POS already ended this checkout — not the customer's error; reloading takes it off the screen
      if (e instanceof DisplayApiError && (e.code === 'DISPLAY_SESSION_NOT_FOUND' || e.code === 'DISPLAY_SESSION_EXPIRED')) { void load(); return; }
      if (mounted.current) setActionError(e instanceof Error ? e.message : fallback);
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }, [creds, accept, load]);

  // §97: the receipt choice. If the customer walks away, the salon's automatic choice applies when the time is up.
  const chooseReceipt = useCallback((choice: DisplayReceiptSubmission['choice']) => act((c) => submitReceipt(c, choice), 'Could not send your receipt.'), [act]);
  const askKey = receiptKey(data);
  const decideMs = (data?.receipt?.status === 'choose' ? data.receipt.decideWithinSeconds : 0) * 1000;
  useEffect(() => {
    if (!askKey || !decideMs) return;
    const t = setTimeout(() => { if (mounted.current) void chooseReceipt('auto'); }, decideMs);
    return () => clearTimeout(t);
  }, [askKey, decideMs, chooseReceipt]);

  // §85–§86: the heartbeat's answer — the owner switched maintenance on or off: fetch the state that shows it
  const onHeartbeatAck = useCallback((ack: DisplayHeartbeatAck) => {
    if (!!ack.maintenance !== !!onScreen.current?.maintenance && onScreen.current?.state === 'idle') void load();
  }, [load]);

  const chooseTip = useCallback((body: TipSubmission) => act((c) => submitTip(c, body), 'Could not apply that tip.'), [act]);
  const chooseMethod = useCallback((method: 'card' | 'cash') => act((c) => submitMethod(c, method), 'Could not select that payment method.'), [act]);
  const pay = useCallback(() => act((c) => requestPayment(c), 'Could not start payment.'), [act]);
  const rate = useCallback((rating: number) => act((c) => submitRating(c, rating), 'Could not submit your rating.', () => setRated(rating)), [act]);

  return { creds, data, phase, online, submitting, actionError, rated, adsNudge, chooseTip, chooseMethod, pay, rate, chooseReceipt, onHeartbeatAck, clearActionError: () => setActionError(null) };
}
