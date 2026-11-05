import { useEffect, useRef } from 'react';
import { createRealtimeClient, type RealtimeClient } from '@aipowersalon/realtime-client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';
import { transport } from '../api/client';

// useCheckoutStream — the payment phone's live checkout updates: the salon branch's realtime stream (the same room the
// front desk listens on) through the SHARED realtime client. On native each (re)connect gets a single-use stream ticket
// (realtimeStreamUrl — there is no cookie in the Capacitor shell and a bearer never goes in a URL).
//
// onEvent(eventName) for the checkout events below, and 'reconcile' after a reconnect gap (refetch: something may have been
// missed). Before this, the checkout queue only changed when the manager pulled to refresh.
const STREAM_PATH = '/realtime/stream';
export const CHECKOUT_EVENTS = new Set([
  'ticket_ready_checkout', 'ticket_paid', 'checkout_sent_to_mobile', 'checkout_total_recalculated',
  'checkout_payment_claimed', 'checkout_payment_claim_released', 'payment_approved', 'payment_failed', 'payment_recovered',
]);
let client: RealtimeClient | null = null;
let users = 0;
let unbind: (() => void) | null = null;

function acquire(): RealtimeClient {
  if (!client) {
    client = createRealtimeClient({
      streamPath: STREAM_PATH,
      streamUrl: realtimeStreamUrl(transport, STREAM_PATH),
      post: (p, b) => transport.post(p, b),
    });
  }
  if (users++ === 0) { unbind = bindRealtimeToSession(client); client.connect(); }
  return client;
}

function release(): void {
  if (--users > 0 || !client) return;
  unbind?.(); unbind = null;
  client.disconnect();
}

export function useCheckoutStream(onEvent: (event: string) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const c = acquire();
    const offEvent = c.onEvent((d) => { if (CHECKOUT_EVENTS.has(d.event)) cb.current(d.event); });
    const offReconcile = c.onReconcile(() => cb.current('reconcile'));
    return () => { offEvent(); offReconcile(); release(); };
  }, []);
}
