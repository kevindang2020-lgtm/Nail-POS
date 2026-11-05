// useOwnerStream.ts — Owner App live events through the SHARED realtime client (@aipowersalon/realtime-client).
//
// The client owns what this hook used to hand-roll: jittered reconnects, sequence tracking, and a reconcile after any
// disruption (error, offline, a slept device) — so a screen refetches current state instead of trusting a dead socket.
// On native it opens the stream with a single-use ticket per (re)connect (realtimeStreamUrl): there is no cookie in the
// Capacitor shell and a bearer never goes in a URL. Sign-out and a dead session close the stream (bindRealtimeToSession).
//
// The callback contract is unchanged: DOMAIN event names, plus 'reconcile' (refetch — something may have been missed) and
// 'fallback' (a 60 s visible-only safety refetch — owner dashboards are 30–60 s surfaces). Screens filtering by prefix must
// still treat 'reconcile' and 'fallback' as "refetch".
import { useEffect, useRef } from 'react';
import { createRealtimeClient, type RealtimeClient } from '@aipowersalon/realtime-client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';
import { transport } from './client';

const STREAM_PATH = '/owner/stream';
const FALLBACK_MS = 60_000;
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

export function useOwnerStream(onEvent: (event: string) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    const c = acquire();
    const offEvent = c.onEvent((d) => { if (d.event && d.event !== 'ping' && d.event !== 'connected') cb.current(d.event); });
    const offReconcile = c.onReconcile(() => cb.current('reconcile'));
    const fallback = setInterval(() => { if (!document.hidden) cb.current('fallback'); }, FALLBACK_MS);   // §14
    return () => { offEvent(); offReconcile(); clearInterval(fallback); release(); };
  }, []);
}
