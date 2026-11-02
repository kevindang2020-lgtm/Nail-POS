// useCheckoutStream.ts — the Tap-to-Pay app's realtime hook, a thin adapter over
// @aipowersalon/realtime-client (Constitution 9 §174: one client, not a hand-rolled EventSource per app).
//
// WHY THIS APP NEEDED IT: CheckoutQueueScreen loaded its list once on mount and never refreshed. A manager
// holding the Tap-to-Pay device saw the queue as it was when the screen opened — so if the front desk took the
// payment on the POS, the manager's list still showed that ticket and they could tap a ticket already paid.
//
// WHICH STREAM: `/realtime/stream`, the EXISTING POS stream, reused rather than given a seventh SSE endpoint.
// It requires `pos.login`, and the only roles that reach this app — OWNER and MANAGER — resolve to both
// `pos.login` and `mobile_checkout.login` through the rbac spreads. (A raw read of ROLE_PERMISSIONS suggests
// otherwise; the permissions arrive via spread constants, so the resolved list is what counts.) A new endpoint
// would have been a second way to say the same thing.
//
// WHICH EVENTS: only the ones that can change what this queue shows. Refetching on every tenant event would
// make a payment screen flicker for a cash-drawer movement in another room.
import { useEffect, useRef } from 'react';
import { createRealtimeClient, FallbackPoller } from '@aipowersalon/realtime-client';
import { api, apiUrl, transport } from '../api/client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';

/** Events that change the set of tickets awaiting checkout, or one's total. Anything else is ignored. */
export const CHECKOUT_QUEUE_EVENTS: readonly string[] = [
  'ticket_ready_checkout',   // a ticket entered the queue
  'ticket_paid',             // …or left it — the case that made a stale list dangerous
  'payment_approved',
  'payment_failed',
  'checkout_total_recalculated',
  'ticket_assigned',
  'service_done',
  'queue_updated',
];

// BUILD_PLAN Phase 13 (bug 1): native opens the ABSOLUTE stream URL with a fresh single-use ticket before every (re)connect
// (the shell has no cookie; a bearer never goes in a URL); the web keeps the relative path + cookie. Sign-out and a dead
// session disconnect it.
export const checkoutRealtime = createRealtimeClient({ streamPath: apiUrl('/realtime/stream'), streamUrl: realtimeStreamUrl(transport, '/realtime/stream'), post: (p, b) => api.post(p, b) });
bindRealtimeToSession(checkoutRealtime);

/**
 * Calls `onRefresh` when the checkout queue may have changed. Mirrors useTechStream's contract:
 * 'reconcile' means "refetch now", and 'ping'/'connected' never reach screens.
 *
 * The fallback poll runs ONLY while the stream is unavailable (§191–193), so a connected device is not also
 * polling — and it is skipped while the tab is hidden, because a backgrounded payment app has nothing to show.
 */
export function useCheckoutStream(onRefresh: () => void, pollMs = 20_000): void {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    if (typeof window === 'undefined') return;   // SSR: no EventSource ⇒ "unavailable" ⇒ the poller covers it
    checkoutRealtime.connect();

    const offEvent = checkoutRealtime.onEvent((d: { event: string }) => {
      if (CHECKOUT_QUEUE_EVENTS.includes(d.event)) cb.current();
    });
    const offReconcile = checkoutRealtime.onReconcile(() => cb.current());

    const poller = new FallbackPoller(() => { if (!document.hidden) cb.current(); }, { intervalMs: Math.max(5_000, pollMs) });
    poller.onStatus(checkoutRealtime.status());
    const offStatus = checkoutRealtime.onStatus((s: unknown) => poller.onStatus(s as never));

    return () => { offEvent(); offReconcile(); offStatus(); poller.stop(); };
  }, [pollMs]);
}

/**
 * Secure Tap to Pay M6-6 (§150): the front desk sent a ticket to THIS phone. The event arrives on the phone's own realtime
 * room (the server subscribes a stream whose session was opened on a registered payment phone); `deviceId` filters out a
 * branch-room copy meant for another phone.
 */
export function useSentToThisPhone(deviceId: string, onSent: (ticketId: string) => void): void {
  const cb = useRef(onSent); cb.current = onSent;
  useEffect(() => checkoutRealtime.onEvent((d: { event: string; payload?: any }) => {
    if (d.event === 'checkout_sent_to_mobile' && d.payload?.deviceId === deviceId && typeof d.payload?.ticketId === 'string') cb.current(d.payload.ticketId);
  }), [deviceId]);
}
