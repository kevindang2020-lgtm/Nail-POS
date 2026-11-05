import { useEffect, useRef } from 'react';
import { createRealtimeClient, type RealtimeClient } from '@aipowersalon/realtime-client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';
import { transport } from './client';

// useCustomerStream — the customer's live events (GET /api/v1/customer/stream) through the SHARED realtime client:
// reconnect with backoff, sequence tracking, and on native a single-use stream ticket per (re)connect (realtimeStreamUrl —
// the Capacitor shell has no cookie and a bearer never goes in a URL). The server sends event NAMES only, so screens
// refetch their own scoped data. onEvent(eventName) as before, plus 'reconcile' after a reconnect gap; callers keep their
// polling fallback. One stream per app, closed when the last screen unmounts, on sign-out, or when the session dies.
const STREAM_PATH = '/customer/stream';
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

export function useCustomerStream(onEvent: (event: string) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const c = acquire();
    const offEvent = c.onEvent((d) => { if (d.event && d.event !== 'ping' && d.event !== 'connected') cb.current(d.event); });
    const offReconcile = c.onReconcile(() => cb.current('reconcile'));
    return () => { offEvent(); offReconcile(); release(); };
  }, []);
}
