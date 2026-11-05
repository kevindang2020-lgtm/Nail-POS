// useSuperAdminStream.ts — Constitution 9 Phase 20: the Super Admin Live Operations stream, as a thin adapter over
// @aipowersalon/realtime-client (§174). GET /super-admin/stream carries ONE event, `platform_ops_snapshot`, every
// 10 s while this tab is connected — aggregate counts and gateway health, never a tenant's raw events or anyone's
// identity (§60/§146/§206). 'reconcile' = refetch the request/response views now (§34–36). Fallback polling only
// while live updates are unavailable (§191–193).
import { useEffect, useRef, useState } from 'react';
import { createRealtimeClient, FallbackPoller, type RealtimeStatus } from '@aipowersalon/realtime-client';
import { api, apiUrl } from './client';
import type { PlatformOpsSnapshot } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)


export const superAdminRealtime = createRealtimeClient({ streamPath: apiUrl('/super-admin/stream'), post: (p, b) => api.post(p, b) });

export function useSuperAdminStream(onSnapshot: (s: PlatformOpsSnapshot) => void, onReconcile: () => void): { status: RealtimeStatus; polling: boolean } {
  const snap = useRef(onSnapshot); snap.current = onSnapshot;
  const recon = useRef(onReconcile); recon.current = onReconcile;
  const [status, setStatus] = useState<RealtimeStatus>(superAdminRealtime.status());
  const [polling, setPolling] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;                 // SSR only. No EventSource ⇒ "realtime unavailable" ⇒ the poller runs (§191)
    superAdminRealtime.connect();
    const offEvent = superAdminRealtime.onEvent((d) => {
      if (d.event !== 'platform_ops_snapshot') return;
      const env = d.payload as { data?: PlatformOpsSnapshot } | undefined;          // sealed envelope (§20)
      if (env?.data) snap.current(env.data);
    });
    const offReconcile = superAdminRealtime.onReconcile(() => recon.current());
    const poller = new FallbackPoller(() => { if (!document.hidden) recon.current(); }, { intervalMs: 15_000, graceMs: 15_000, onStateChange: setPolling });
    poller.onStatus(superAdminRealtime.status());
    const offStatus = superAdminRealtime.onStatus((s) => { setStatus(s); poller.onStatus(s); });
    return () => { offEvent(); offReconcile(); offStatus(); poller.stop(); };
  }, []);
  return { status, polling };
}
export type { PlatformOpsSnapshot };
