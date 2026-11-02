// useTechStream.ts — the Technician App's realtime hook, now a thin adapter over @aipowersalon/realtime-client
// (Constitution 9 §174). Contract unchanged: `onEvent(name)`, with 'reconcile' meaning "refetch now"; 'ping' and
// 'connected' never reach screens. Underneath: jittered reconnects owned by the client (§37) instead of the
// browser's fixed retry, per-room sequence numbers with resync (§31–36), and fallback polling ONLY while the
// stream is unavailable (§191–193) — the previous version started a poll on error and polled while reconnected.
import { useEffect, useRef } from 'react';
import { createRealtimeClient, startVisibleSafetySync, SYNC_POLICY } from '@aipowersalon/realtime-client';
import { api, apiUrl, transport } from '../api/client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';
import { BranchFrameThrottle, OWN_ROOM_SLOT, type TechFrameFilter } from './techRelevance';

// BUILD_PLAN Phase 13 (bug 1): native opens the ABSOLUTE stream URL with a fresh single-use ticket before every (re)connect
// (the shell has no cookie; a bearer never goes in a URL); the web keeps the relative path + cookie. Sign-out and a dead
// session disconnect it.
export const techRealtime = createRealtimeClient({ streamPath: apiUrl('/tech/stream'), streamUrl: realtimeStreamUrl(transport, '/tech/stream'), post: (p, b) => api.post(p, b) });
bindRealtimeToSession(techRealtime);

// `relevant` (M4, Oct 24 2026): which frames this card refetches on (lib/techRelevance). Omitted = every frame, as before.
// With it: own-room frames and 'reconcile' (safety sync, gap, reconnect) refetch at once; relevant branch frames at most
// once per BRANCH_REFETCH_MIN_MS (leading + trailing) — 200 phones no longer re-read on every frame of the salon.
export function useTechStream(onEvent: (event: string) => void, pollMs: number = SYNC_POLICY.operationalMs, relevant?: TechFrameFilter): void {   // §82: the technician's live queue is operational → 15 s
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const rel = useRef(relevant);
  rel.current = relevant;
  useEffect(() => {
    if (typeof window === 'undefined') return;                 // SSR only. No EventSource ⇒ the safety sync alone keeps the screen current (spec §110)
    techRealtime.connect();
    const throttle = new BranchFrameThrottle((ev) => cb.current(ev));
    const offEvent = techRealtime.onEvent((d) => {
      const r = rel.current;
      if (!r) { cb.current(d.event); return; }
      if (d.stream === OWN_ROOM_SLOT) { throttle.immediate(d.event); return; }
      if (r(d)) throttle.branch(d.event);
    });
    const offReconcile = techRealtime.onReconcile(() => throttle.immediate('reconcile'));
    // Smooth Refresh spec (closing line, §81/§96): an ALWAYS-ON background safety sync — jittered, hidden-tab throttled,
    // single-flight — replaces the poll that only ran while live updates were down.
    const stopSync = startVisibleSafetySync(() => cb.current('reconcile'), { intervalMs: Math.max(5_000, pollMs) });
    return () => { offEvent(); offReconcile(); stopSync(); throttle.cancel(); };
  }, [pollMs]);
}
