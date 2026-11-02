// toast.tsx — the in-app surface for a push that arrives while the page is open (the worker posts it instead of showing
// an OS notification). The developer's copies did `alert()` — modal, blocks the front desk mid-checkout. This is a
// corner toast that goes away on its own; nothing here is a notification store (the in-app feeds are).
import { useEffect, useState } from 'react';
import type { WebPushClient, WebPushMessage } from './web-push';

export function WebPushToast({ client, ms = 6000 }: { client: WebPushClient | null | undefined; ms?: number }) {
  const [items, setItems] = useState<(WebPushMessage & { id: number })[]>([]);
  useEffect(() => {
    if (!client) return;
    let seq = 0;
    return client.onMessage((m) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-2), { ...m, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms);
    });
  }, [client, ms]);
  if (!items.length) return null;
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9999, display: 'grid', gap: 8, maxWidth: 360 }}>
      {items.map((m) => (
        <div key={m.id} data-testid="web-push-toast" style={{ background: '#2A2118', color: '#FFFDF8', borderRadius: 12, padding: '12px 14px', boxShadow: '0 10px 30px rgba(0,0,0,.25)', fontSize: 14 }}>
          <div style={{ fontWeight: 700 }}>{m.title}</div>
          {m.body ? <div style={{ opacity: .85, marginTop: 2 }}>{m.body}</div> : null}
        </div>
      ))}
    </div>
  );
}
