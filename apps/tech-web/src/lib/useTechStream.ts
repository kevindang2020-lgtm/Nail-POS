import { useEffect, useRef } from 'react';

// useTechStream — subscribes to the technician SSE stream (GET /tech/stream, same-origin so the session cookie rides
// along) and calls onEvent(eventName) for each server event. EventSource auto-reconnects; on error we ALSO start an
// interval poll so screens keep updating even if SSE is blocked/unsupported. 'ping'/'connected' are ignored.
// The push transport itself is validated against a running server — this hook is the thin client over it.
export function useTechStream(onEvent: (event: string) => void, pollMs = 20000): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => { if (!poll) poll = setInterval(() => cb.current('poll'), pollMs); };

    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => { if (poll) clearInterval(poll); };
    }
    try {
      es = new EventSource('/tech/stream');
      es.onmessage = (m: MessageEvent) => {
        try {
          const data = typeof m.data === 'string' ? JSON.parse(m.data) : m.data;
          const ev = data?.event;
          if (ev && ev !== 'ping' && ev !== 'connected') cb.current(ev);
        } catch { /* ignore malformed frame */ }
      };
      es.onerror = () => { startPolling(); }; // EventSource keeps retrying; polling guarantees liveness meanwhile
    } catch {
      startPolling();
    }
    return () => { es?.close(); if (poll) clearInterval(poll); };
  }, [pollMs]);
}
