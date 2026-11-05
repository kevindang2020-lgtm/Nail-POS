// useOwnerStream.ts — Owner App live events, upgraded to the platform realtime standard (Jul 27, 2026).
//
// Same discipline as the POS client, scaled to this app's needs:
//   §29/§30 owned reconnects — close on error, reopen after exponential backoff with full jitter (cap 30s);
//                              the browser's fixed-interval auto-retry is herd-prone and is not used.
//   §15/§16/§17 gap recovery — after ANY real disruption (error, offline, ≥30s hidden tab / slept device),
//                              the next successful open — or the wake itself — fires onEvent('reconcile') so the
//                              screen refetches current state instead of trusting a dead socket.
//   §14 fallback              — a 60s visible-only safety refetch rides underneath (owner dashboards are
//                              30–60s-band surfaces, not sub-second operational screens).
// The backend still forwards event NAMES only — payloads never ride the owner stream.
import { useEffect, useRef } from 'react';
import { apiBase } from './client';

const FALLBACK_MS = 60_000;
const STALE_HIDDEN_MS = 30_000;

function delayMs(attempt: number): number {
  const exp = Math.min(30_000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.floor(exp / 2 + Math.random() * (exp / 2));
}

/** `onEvent` receives DOMAIN event names only. The hook itself decides when a full refetch is owed
 *  (reconnect gap, wake, 60s fallback) and calls `onEvent('reconcile')` — consumers that filter by prefix
 *  should treat unknown names as ignorable EXCEPT 'reconcile', so the standard wrapper below is what screens use. */
export function useOwnerStream(onEvent: (event: string) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disrupted = false;
    let everConnected = false;
    let hiddenAt: number | null = null;
    let closed = false;

    const open = () => {
      if (closed) return;
      try { es?.close(); } catch { /* dead already */ }
      try {
        es = new EventSource(`${apiBase()}/owner/stream`, { withCredentials: true });
        es.onopen = () => {
          const owed = disrupted && everConnected;
          attempts = 0; disrupted = false; everConnected = true;
          if (owed) cb.current('reconcile');                  // §15: never assume no events were missed
        };
        es.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d && typeof d.event === 'string' && d.event !== 'ping' && d.event !== 'connected') cb.current(d.event); } catch { /* keepalive */ } };
        es.onerror = () => {
          try { es?.close(); } catch { /* noop */ }
          es = null; disrupted = true; attempts += 1;
          if (retry) clearTimeout(retry);
          retry = setTimeout(open, delayMs(attempts));       // §29/§30 jittered backoff
        };
      } catch { es = null; }
    };

    const onVisibility = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt != null && Date.now() - hiddenAt >= STALE_HIDDEN_MS) {
        cb.current('reconcile');                              // §16/§17: waking shows current state, not 45-min-old state
        disrupted = true;
        if (retry) clearTimeout(retry);
        open();                                               // a slept device's socket is usually dead but silent
      }
      hiddenAt = null;
    };
    const onOnline = () => { disrupted = true; if (retry) clearTimeout(retry); open(); };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    const fallback = setInterval(() => { if (!document.hidden) cb.current('fallback'); }, FALLBACK_MS);   // §14

    open();
    return () => {
      closed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      clearInterval(fallback);
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);
}
