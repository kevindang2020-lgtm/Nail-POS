import { useEffect, useState, useCallback, useRef } from 'react';
import { mobileCheckoutApi, type PaymentAttempt } from '../api/mobileCheckoutApi';
import { formatCents } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';
import { isTapToPayAvailable, captureTapToPay, type NativeCaptureOutcome } from '../native/tapToPay';
import { usePayNav } from '../shell/nav';

// Tap to Pay screen. Creates the persisted attempt (idempotent) and runs the backend readiness step. When the attempt
// is 'ready' AND the native reader is available, it runs the native capture and posts the processor result to the §5
// bridge, routing to Success on a confirmed capture. When the native plugin is NOT present (web / any build without the
// FiservTTP plugin), it shows an honest "attaches on the on-device build" state and never invents a result.
type Phase = 'preparing' | 'ready' | 'capturing' | 'declined' | 'blocked' | 'error';

function outcomeMessage(outcome: NativeCaptureOutcome): string {
  switch (outcome) {
    case 'declined': return 'The card was declined. Ask for another card or try again.';
    case 'timeout': return 'The tap timed out. Try again.';
    default: return 'The result was unconfirmed. Check the History before retrying.';
  }
}

export function TapToPayScreen({ ticketId, idempotencyKey, amountCents }: { ticketId: string; idempotencyKey: string; amountCents: number }) {
  const nav = usePayNav();
  const [phase, setPhase] = useState<Phase>('preparing');
  const [message, setMessage] = useState<string>('');
  const [canceling, setCanceling] = useState(false);
  const started = useRef(false);
  const captured = useRef(false);

  const runNativeCapture = useCallback(async () => {
    if (captured.current) return;
    captured.current = true;
    setPhase('capturing');
    try {
      const result = await captureTapToPay({ amountCents, idempotencyKey });
      const adv = await mobileCheckoutApi.captureResult(idempotencyKey, result);
      if (adv.to === 'confirmed') { nav.openSuccess(ticketId, amountCents); return; }
      setPhase('declined');
      setMessage(outcomeMessage(result.outcome));
    } catch (e: any) {
      setPhase('error');
      setMessage(e?.message || 'The card could not be read.');
    }
  }, [amountCents, idempotencyKey, ticketId, nav]);

  useEffect(() => {
    const heartbeat = setInterval(() => { mobileCheckoutApi.refreshLock?.(ticketId, SESSION_ID)?.catch?.(() => {}); }, 30_000);
    return () => {
      clearInterval(heartbeat);
      mobileCheckoutApi.releaseLock?.(ticketId, SESSION_ID, 'left')?.catch?.(() => {});
    };
  }, [ticketId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await mobileCheckoutApi.acquireLock?.(ticketId, SESSION_ID, DEVICE_ID);
        await mobileCheckoutApi.createAttempt(ticketId, { sessionId: SESSION_ID, idempotencyKey, amountCents, deviceId: DEVICE_ID });
        const attempt: PaymentAttempt = await mobileCheckoutApi.attemptReadiness(idempotencyKey, DEVICE_ID);
        if (attempt.status !== 'ready') { setPhase('blocked'); setMessage('This device isn’t set up to take Tap to Pay yet.'); return; }
        setPhase('ready');
        if (isTapToPayAvailable()) void runNativeCapture(); // real device: drive the native reader
      } catch (e: any) {
        setPhase('error');
        setMessage(e?.message || 'Could not prepare the payment.');
      }
    })();
  }, [ticketId, idempotencyKey, amountCents, runNativeCapture]);

  const onCancel = useCallback(async () => {
    setCanceling(true);
    try { await mobileCheckoutApi.cancelAttempt(idempotencyKey); } catch { /* best-effort */ }
    nav.back();
  }, [idempotencyKey, nav]);

  const nativeAvailable = isTapToPayAvailable();

  return (
    <>
      <div className="pay-sechead">
        <button className="pay-back" onClick={onCancel} aria-label="Cancel">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div className="t pay-serif">Tap to Pay</div>
      </div>

      <div className="pay-taphero">
        <div className="lbl">Amount Due</div>
        <div className="amt">{formatCents(amountCents)}</div>
      </div>

      {phase === 'preparing' && (
        <div className="pay-reader"><div className="cap">Preparing…</div><div className="subcap">Setting up the reader for this payment.</div></div>
      )}

      {phase === 'ready' && !nativeAvailable && (
        <>
          <div className="pay-nativebadge">⚠ Native Tap to Pay reader attaches on the on-device build — no card is read in this preview.</div>
          <div className="pay-reader ready">
            <div style={{ position: 'relative' }}><span className="wave" /><div className="phone" /></div>
            <div className="cap">Hold card near the top</div>
            <div className="subcap">Ask the customer to hold their card or phone to the top of the device.</div>
          </div>
        </>
      )}

      {(phase === 'ready' && nativeAvailable) || phase === 'capturing' ? (
        <div className="pay-reader ready">
          <div style={{ position: 'relative' }}><span className="wave" /><div className="phone" /></div>
          <div className="cap">Hold card near the top</div>
          <div className="subcap">Reading the customer’s card…</div>
        </div>
      ) : null}

      {phase === 'declined' && (
        <div className="pay-reader"><div className="cap">Not completed</div><div className="subcap">{message}</div></div>
      )}
      {(phase === 'blocked' || phase === 'error') && (
        <div className="pay-reader"><div className="cap">{phase === 'blocked' ? 'Not available' : 'Something went wrong'}</div><div className="subcap">{message}</div></div>
      )}

      <div className="pay-stickyfoot">
        {phase === 'declined'
          ? <button className="pay-btn" onClick={nav.back}>Try again</button>
          : <button className="pay-btn ghost" disabled={canceling || phase === 'capturing'} onClick={onCancel}>{canceling ? 'Canceling…' : 'Cancel'}</button>}
      </div>
    </>
  );
}
