// realtime-harness.tsx — the POS live-update client in a REAL browser against a REAL SSE endpoint (the driver's server).
// Until Sep 30 2026 this client had only ever run against a fake EventSource. Exposes window.__rt for the driver:
//   refetches      — how many times useRealtime('booking') asked the screen to refetch (events only: safety sync OFF,
//                    spec §111), with the reason inferred from what the driver just sent
//   deliveries     — for each dispatched event, browser receive time minus the server's sentAt (same machine clock)
//   statuses       — every connection status the client published
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useRealtime } from '../src/realtime/useRealtime';
import { REALTIME_EVENT, REALTIME_STATUS, REALTIME_RECONCILE } from '../src/realtime/realtime-client';

const rt = { refetches: 0, deliveries: [] as number[], statuses: [] as string[], reconciles: [] as string[], errors: [] as string[] };
(window as any).__rt = rt;
window.addEventListener('error', (e) => rt.errors.push(String(e.message)));
window.addEventListener(REALTIME_EVENT, (e: Event) => {
  const p = (e as CustomEvent).detail?.payload;
  if (p && typeof p.sentAt === 'number') rt.deliveries.push(Date.now() - p.sentAt);
});
window.addEventListener(REALTIME_STATUS, (e: Event) => rt.statuses.push((e as CustomEvent).detail?.status));
window.addEventListener(REALTIME_RECONCILE, (e: Event) => rt.reconciles.push((e as CustomEvent).detail?.reason ?? 'reconcile'));

function Probe() {
  useRealtime('booking', () => { rt.refetches++; }, { intervalMs: 0 });   // events + reconciles only
  return <div id="probe">probe</div>;
}
createRoot(document.getElementById('root')!).render(<Probe />);
