import { useEffect, useState, useCallback, useRef } from 'react';
import { useT } from '@aipowersalon/mobile-sdk';
import { mobileCheckoutApi, type PaymentAttempt } from '../api/mobileCheckoutApi';
import { formatCents } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';
import { isTapToPayAvailable, captureTapToPay } from '../native/tapToPay';
import { usePayNav } from '../shell/nav';
import { clearActiveAttempt, rememberActiveAttempt } from '../util/activeAttempt';
import { ReturnToStaff } from './ReturnToStaff';
import { deviceErrorCode, deviceErrorMessage } from '../device/deviceErrors';

// Tap to Pay screen (mandate §62, §64–§78, §129–§131, §192–§193). Creates the persisted intent (idempotent), runs the
// backend readiness step, mints the device session and — only when the native reader is present — runs ONE native
// capture and posts the processor result to the server bridge. The backend verifies with the provider and records the
// money; only its 'confirmed' answer reaches the Success screen (§71). A timeout / unknown / lost network is VERIFYING
// (§74–§75): the screen asks the backend to verify (which asks the provider) — it never runs a second capture (§77).
// `recovered`: the app relaunched with this intent in flight (§130) — restore and verify, never start a new charge.
// The "attaches on the on-device build" state is honest: without the native plugin no card is read, nothing is invented.
type Phase = 'preparing' | 'ready' | 'capturing' | 'declined' | 'canceled' | 'verifying' | 'blocked' | 'unavailable' | 'error';
const UNRESOLVED = new Set(['authorization_pending', 'authorized', 'confirmation_pending', 'timed_out', 'unknown', 'reconciliation_required', 'reader_initializing', 'awaiting_customer_tap', 'card_detected']);

export function TapToPayScreen({ ticketId, idempotencyKey, amountCents, handoff, recovered }: { ticketId: string; idempotencyKey: string; amountCents: number; handoff?: boolean; recovered?: boolean }) {
  const tr = useT();
  const nav = usePayNav();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [message, setMessage] = useState<string>('');
  const [canceling, setCanceling] = useState(false);
  const [staffAsk, setStaffAsk] = useState(false);
  const started = useRef(false);
  const captured = useRef(false);
  const verifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback((to: string, extra: { paymentId?: string; cardBrand?: string | null; cardLast4?: string | null } = {}) => {
    if (to === 'confirmed') { clearActiveAttempt(); nav.openSuccess(ticketId, amountCents, { handoff, ...extra }); return true; }
    return false;
  }, [nav, ticketId, amountCents, handoff]);

  // §74–§76: verify with the backend (which asks the provider). Polls while the answer is still unknown; never re-captures.
  const verify = useCallback(async () => {
    try {
      const v = await mobileCheckoutApi.verifyAttempt(idempotencyKey);
      if (finish(v.status, { paymentId: v.paymentId })) return;
      if (v.status === 'declined') { clearActiveAttempt(); setPhase('declined'); setMessage(tr('pay.tap.declinedHint')); return; }
      if (v.status === 'canceled' || v.status === 'failed') { clearActiveAttempt(); setPhase('canceled'); setMessage(tr('pay.tap.canceled')); return; }
      setPhase('verifying');
      verifyTimer.current = setTimeout(() => { void verify(); }, 5_000);
    } catch (e: any) {
      setPhase('verifying'); setMessage(e?.message || '');
      verifyTimer.current = setTimeout(() => { void verify(); }, 8_000);
    }
  }, [idempotencyKey, finish, tr]);

  const runNativeCapture = useCallback(async () => {
    if (captured.current) return;
    captured.current = true;
    setPhase('capturing');
    let result: Awaited<ReturnType<typeof captureTapToPay>> | null = null;
    try {
      result = await captureTapToPay({ amountCents, idempotencyKey });
    } catch (e: any) {
      // the reader refused / the SDK threw BEFORE any authorization: an honest non-result, not a decline, not unknown
      const code = String(e?.code || '');
      if (code === 'TAP_NOT_PROVISIONED' || code === 'TAP_UNSUPPORTED') { setPhase('blocked'); setMessage(e?.message || tr('pay.tap.notAvailable')); return; }
      if (/cancel/i.test(code) || /cancel/i.test(String(e?.message || ''))) { setPhase('canceled'); setMessage(tr('pay.tap.canceled')); return; }
      // anything else after the card may have been presented is UNKNOWN until verified (§74, §129)
      void verify(); return;
    }
    try {
      const adv = await mobileCheckoutApi.captureResult(idempotencyKey, { ...result, deviceId: DEVICE_ID });
      if (finish(adv.to, { paymentId: (adv as any).paymentId, cardBrand: result.brand ?? null, cardLast4: result.last4 ?? null })) return;
      if (adv.to === 'declined') { clearActiveAttempt(); setPhase('declined'); setMessage(tr('pay.tap.declinedHint')); return; }
      void verify();   // timed_out / unknown → verifying
    } catch (e: any) {
      // the result never reached the backend (network dropped right after the tap): UNKNOWN — verify, never re-tap (§74, §159)
      if (String(e?.code || '') === 'PAYMENT_IN_PROGRESS') { void verify(); return; }
      void verify();
    }
  }, [amountCents, idempotencyKey, finish, verify, tr]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        if (recovered) {
          // §130/§160: the attempt is read back from the backend; nothing new is charged
          const a = await mobileCheckoutApi.getAttempt(idempotencyKey);
          if (finish(a.status, { paymentId: a.paymentId ?? undefined, cardBrand: a.cardBrand, cardLast4: a.cardLast4 })) return;
          if (a.status === 'created' || a.status === 'ready') { clearActiveAttempt(); await mobileCheckoutApi.cancelAttempt(idempotencyKey).catch(() => {}); setPhase('canceled'); setMessage(tr('pay.tap.canceled')); return; }
          if (UNRESOLVED.has(a.status)) { setMessage(tr('pay.tap.recovered')); void verify(); return; }
          clearActiveAttempt(); setPhase(a.status === 'declined' ? 'declined' : 'canceled'); setMessage(a.status === 'declined' ? tr('pay.tap.declinedHint') : tr('pay.tap.canceled')); return;
        }
        await mobileCheckoutApi.createAttempt(ticketId, { sessionId: SESSION_ID, idempotencyKey, amountCents, deviceId: DEVICE_ID });
        rememberActiveAttempt({ ticketId, idempotencyKey, amountCents, handoff });
        const attempt: PaymentAttempt = await mobileCheckoutApi.attemptReadiness(idempotencyKey, DEVICE_ID);
        if (attempt.status !== 'ready') {
          clearActiveAttempt();
          const code = attempt.lastErrorCode || '';
          setPhase(code === 'TAP_TO_PAY_DISABLED' || code === 'TAP_TO_PAY_PROVIDER_UNAVAILABLE' ? 'unavailable' : 'blocked');
          const dev = deviceErrorCode({ code });   // M6-4: a device refusal reads in plain English (pending / suspended / branch / key)
          setMessage(code === 'TAP_TO_PAY_DISABLED' ? tr('pay.tap.unavailable') : dev ? deviceErrorMessage(dev) : 'This device isn’t set up to take Tap to Pay yet.');
          return;
        }
        setPhase('ready');
        if (isTapToPayAvailable()) void runNativeCapture(); // real device: drive the native reader
      } catch (e: any) {
        clearActiveAttempt();
        const code = String(e?.code || '');
        // M6-6: CHECKOUT_STALE — this payment was started on an older version of the checkout; go back and re-open it
        if (code === 'CHECKOUT_VERSION_CONFLICT' || code === 'CHECKOUT_STALE') { setPhase('error'); setMessage(tr('pay.ticket.versionChanged')); return; }
        if (code === 'TAP_TO_PAY_DISABLED' || code === 'TAP_TO_PAY_PROVIDER_UNAVAILABLE' || code === 'TAP_TO_PAY_NOT_AVAILABLE') { setPhase('unavailable'); setMessage(tr('pay.tap.unavailable')); return; }
        setPhase('error');
        setMessage(e?.message || tr('pay.tap.backendDown'));
      }
    })();
    return () => { if (verifyTimer.current) clearTimeout(verifyTimer.current); };
  }, [ticketId, idempotencyKey, amountCents, handoff, recovered, runNativeCapture, verify, finish, tr]);

  const onCancel = useCallback(async () => {
    setCanceling(true);
    try { await mobileCheckoutApi.cancelAttempt(idempotencyKey); } catch { /* best-effort */ }
    clearActiveAttempt();
    if (handoff) setStaffAsk(true); else nav.back();
    setCanceling(false);
  }, [idempotencyKey, nav, handoff]);

  const nativeAvailable = isTapToPayAvailable();
  const leave = () => { if (handoff) setStaffAsk(true); else nav.back(); };

  return (
    <>
      <div className="pay-sechead">
        {!handoff && <button className="pay-back" onClick={onCancel} aria-label={tr('pay.tap.cancel')}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg></button>}
        <div className="t pay-serif">{tr('pay.tap.title')}</div>
      </div>

      <div className="pay-taphero">
        <div className="lbl">{tr('pay.tap.amountDue')}</div>
        <div className="amt">{formatCents(amountCents)}</div>
      </div>

      {phase === 'preparing' && (
        <div className="pay-reader"><div className="cap">{tr('pay.tap.preparing')}</div><div className="subcap">{message || tr('pay.tap.preparingHint')}</div></div>
      )}

      {phase === 'ready' && !nativeAvailable && (
        <>
          <div className="pay-nativebadge">⚠ {tr('pay.tap.preview')}</div>
          <div className="pay-reader ready">
            <div style={{ position: 'relative' }}><span className="wave" /><div className="phone" /></div>
            <div className="cap">{tr('pay.tap.hold')}</div>
          </div>
        </>
      )}

      {(phase === 'ready' && nativeAvailable) || phase === 'capturing' ? (
        <div className="pay-reader ready" aria-live="polite">
          <div style={{ position: 'relative' }}><span className="wave" /><div className="phone" /></div>
          <div className="cap">{tr('pay.tap.hold')}</div>
          <div className="subcap">{tr('pay.tap.reading')}</div>
        </div>
      ) : null}

      {phase === 'verifying' && (
        <div className="pay-reader verifying" role="status" aria-live="assertive">
          <div className="cap">{tr('pay.tap.verifying')}</div>
          <div className="subcap">{tr('pay.tap.verifyingHint')}</div>
          {message && <div className="muted" style={{ marginTop: 8 }}>{message}</div>}
          <button className="pay-ghostbtn" style={{ marginTop: 12 }} onClick={() => { if (verifyTimer.current) clearTimeout(verifyTimer.current); void verify(); }}>{tr('pay.tap.verifyNow')}</button>
        </div>
      )}

      {phase === 'declined' && (
        <div className="pay-reader" role="alert"><div className="cap">{tr('pay.tap.declined')}</div><div className="subcap">{message}</div></div>
      )}
      {phase === 'canceled' && (
        <div className="pay-reader" role="status"><div className="cap">{tr('pay.handoff.cancel')}</div><div className="subcap">{message}</div></div>
      )}
      {(phase === 'blocked' || phase === 'error' || phase === 'unavailable') && (
        <div className="pay-reader" role="alert"><div className="cap">{phase === 'error' ? 'Something went wrong' : tr('pay.tap.notAvailable')}</div><div className="subcap">{message}</div></div>
      )}

      <div className="pay-stickyfoot">
        {phase === 'declined' || phase === 'error' || phase === 'canceled' || phase === 'unavailable' || phase === 'blocked'
          ? <button className="pay-btn" onClick={leave}>{phase === 'declined' ? tr('pay.tap.tryAgain') : handoff ? tr('pay.handoff.returnToStaff') : tr('pay.tap.tryAgain')}</button>
          : phase === 'verifying'
            ? <button className="pay-btn ghost" onClick={leave}>{handoff ? tr('pay.handoff.returnToStaff') : 'Back'}</button>
            : <button className="pay-btn ghost" disabled={canceling || phase === 'capturing'} onClick={onCancel}>{canceling ? tr('pay.tap.canceling') : tr('pay.tap.cancel')}</button>}
      </div>
      {staffAsk && <ReturnToStaff onDone={() => nav.returnToStaff()} onDismiss={() => setStaffAsk(false)} />}
    </>
  );
}
