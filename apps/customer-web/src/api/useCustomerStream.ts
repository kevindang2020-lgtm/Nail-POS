// useCustomerStream.ts — the Customer App's realtime hook, now a thin adapter over @aipowersalon/realtime-client
// (Constitution 9 §174). Contract unchanged: `onEvent(name)`, 'reconcile' = refetch now. §55: the customer app
// may disconnect when backgrounded — the client reconnects on foreground and reconciles, and fallback polling
// runs only while live updates are unavailable (§191–193).
import { useEffect, useRef } from 'react';
import { createRealtimeClient, startVisibleSafetySync, SYNC_POLICY } from '@aipowersalon/realtime-client';
import { api, apiUrl, transport } from './client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';

// BUILD_PLAN Phase 13 (bug 1): native opens the ABSOLUTE stream URL with a fresh single-use ticket before every (re)connect
// (the shell has no cookie; a bearer never goes in a URL); the web keeps the relative path + cookie. Sign-out and a dead
// session disconnect it.
export const customerRealtime = createRealtimeClient({ streamPath: apiUrl('/customer/stream'), streamUrl: realtimeStreamUrl(transport, '/customer/stream'), post: (p, b) => api.post(p, b) });
bindRealtimeToSession(customerRealtime);

export function useCustomerStream(onEvent: (event: string) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof window === 'undefined') return;                 // SSR only. No EventSource ⇒ the safety sync alone keeps the screen current (spec §110)
    customerRealtime.connect();
    const offEvent = customerRealtime.onEvent((d) => cb.current(d.event));
    const offReconcile = customerRealtime.onReconcile(() => cb.current('reconcile'));
    // Smooth Refresh spec (closing line, §81/§96): an ALWAYS-ON background safety sync — jittered, hidden-tab throttled,
    // single-flight — replaces the poll that only ran while live updates were down.
    const stopSync = startVisibleSafetySync(() => cb.current('reconcile'), { intervalMs: SYNC_POLICY.detailMs });
    return () => { offEvent(); offReconcile(); stopSync(); };
  }, []);
}
