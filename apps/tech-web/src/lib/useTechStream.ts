import { useEffect, useRef } from 'react';
import { createRealtimeClient, FallbackPoller, type RealtimeClient } from '@aipowersalon/realtime-client';
import { realtimeStreamUrl, bindRealtimeToSession } from '@aipowersalon/mobile-sdk';
import { transport } from '../api/client';

// useTechStream — the technician's live updates through the SHARED realtime client (@aipowersalon/realtime-client):
// sequence tracking, reconnect with jittered backoff, a reconcile after any gap, and on native a single-use stream ticket
// per (re)connect (realtimeStreamUrl — EventSource cannot send the bearer, and a token never goes in a URL).
//
// The callback contract is unchanged: onEvent(eventName) for each server event, 'reconcile' after a reconnect (refetch —
// something may have been missed) and 'poll' while the stream is down (fallback polling keeps the screen current).
// One stream per app: the first screen that subscribes opens it, the last one to unmount closes it; sign-out and a dead
// session close it too (bindRealtimeToSession).
const STREAM_PATH = '/tech/stream';
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

export function useTechStream(onEvent: (event: string) => void, pollMs = 20000): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    // No EventSource (tests, very old WebViews): poll only.
    if (typeof EventSource === 'undefined') {
      const t = setInterval(() => cb.current('poll'), pollMs);
      return () => clearInterval(t);
    }
    const c = acquire();
    const poller = new FallbackPoller(() => cb.current('poll'), { intervalMs: Math.max(5000, pollMs), graceMs: 5000 });
    const offEvent = c.onEvent((d) => { if (d.event && d.event !== 'ping' && d.event !== 'connected') cb.current(d.event); });
    const offReconcile = c.onReconcile(() => cb.current('reconcile'));
    const offStatus = c.onStatus((s) => poller.onStatus(s));
    poller.onStatus(c.status());
    return () => { offEvent(); offReconcile(); offStatus(); poller.stop(); release(); };
  }, [pollMs]);
}
