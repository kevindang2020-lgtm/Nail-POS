import { useEffect, useRef } from 'react';

// useCustomerStream — subscribes to the customer SSE stream (GET /customer/stream) and invokes onEvent(eventName) when
// the server pushes a domain event (queue_updated, service_started, ...). The server sends event NAMES only (no payload),
// so screens refetch their own scoped data. Degrades gracefully: if EventSource is unavailable or errors, callers keep
// their polling fallback. The browser's EventSource reconnects automatically.
export function useCustomerStream(onEvent: (event: string) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    try {
      es = new EventSource('/customer/stream', { withCredentials: true });
      es.onmessage = (e: MessageEvent) => { try { const d = JSON.parse(e.data); if (d && typeof d.event === 'string') cb.current(d.event); } catch { /* ignore malformed frames */ } };
      es.onerror = () => { /* auto-reconnect; polling fallback covers gaps */ };
    } catch { /* EventSource construction failed — rely on polling */ }
    return () => { try { es?.close(); } catch { /* noop */ } };
  }, []);
}
