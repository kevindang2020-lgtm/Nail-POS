// useOwnerStream.ts — the Owner App's realtime hook, now a thin adapter over @aipowersalon/realtime-client
// (Constitution 9 §174: one shared client). The hook's contract is unchanged for every screen: `onEvent(name)`
// with 'reconcile' as the "refetch now" signal. What changed underneath:
//   • sequence numbers per room + resync on reconnect (§31–36) — a missed owner alert is now noticed, not lost
//   • fallback polling only while live updates are unavailable ≥15s, every 15s, stopping on reconnect (§191–193)
//     — the previous 60s poll ran even while connected
//   • eventId dedupe and version-regression guard (§30/§183), presence AWAY/ONLINE reports (Phase 14)
import { useEffect, useRef } from 'react';
import { createRealtimeClient, startVisibleSafetySync, SYNC_POLICY } from '@aipowersalon/realtime-client';
import { api, apiUrl, transport } from './client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';

// BUILD_PLAN Phase 12: the stream is /api/v1/owner/stream on the same API base as every other call (it read only the
// runtime APS_API_BASE before, so a native build's VITE_API_BASE never reached it).
// BUILD_PLAN Phase 13 (bug 1): native opens the ABSOLUTE stream URL with a fresh single-use ticket before every (re)connect
// (the shell has no cookie; a bearer never goes in a URL); the web keeps the relative path + cookie. Sign-out and a dead
// session disconnect it.
export const ownerRealtime = createRealtimeClient({ streamPath: apiUrl('/owner/stream'), streamUrl: realtimeStreamUrl(transport, '/owner/stream'), post: (p, b) => api.post(p, b) });
bindRealtimeToSession(ownerRealtime);

export function useOwnerStream(onEvent: (event: string) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof window === 'undefined') return;                 // SSR only. No EventSource ⇒ the safety sync alone keeps the screen current (spec §110)
    ownerRealtime.connect();
    const offEvent = ownerRealtime.onEvent((d) => cb.current(d.event));
    const offReconcile = ownerRealtime.onReconcile(() => cb.current('reconcile'));
    // Smooth Refresh spec (closing line, §81/§96): an ALWAYS-ON background safety sync — jittered, hidden-tab throttled,
    // single-flight — replaces the poll that only ran while live updates were down.
    const stopSync = startVisibleSafetySync(() => cb.current('reconcile'), { intervalMs: SYNC_POLICY.detailMs });
    return () => { offEvent(); offReconcile(); stopSync(); };
  }, []);
}
