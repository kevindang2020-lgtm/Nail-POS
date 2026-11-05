// RealtimeStatusPill.tsx — the §18/§36 subtle indicator + the Smooth Refresh spec's §23/§92 sync line.
// Invisible while CONNECTED and syncing normally (the normal state deserves no chrome); a small pill appears only when
// live updates are disrupted OR a background refresh failed (then it names the age of the data still on screen), and
// it never blocks POS work. There is deliberately no global spinner and no shading (spec §93).
import { useEffect, useState } from 'react';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { REALTIME_STATUS, realtimeStatus } from './realtime-client';
import type { RealtimeStatus } from './realtime-core';
import { syncStatus } from './useRealtime';
import { syncIndicatorText, syncIndicatorCoded, type SyncStatusSnapshot } from '@aipowersalon/realtime-client';
import { codedText } from '../i18n/coded-text';

// the connection state → its sentence (admin.realtime.<STATE>), read at render; CONNECTED shows the sync indicator instead
const LABEL_KEY: Record<RealtimeStatus, string | null> = { CONNECTED: null, RECONNECTING: 'admin.realtime.RECONNECTING', OFFLINE: 'admin.realtime.OFFLINE', DEGRADED: 'admin.realtime.DEGRADED' };

export default function RealtimeStatusPill() {
  const [status, setStatus] = useState<RealtimeStatus>(realtimeStatus());
  const [sync, setSync] = useState<SyncStatusSnapshot>(syncStatus.snapshot());
  useEffect(() => {
    const h = (e: Event) => setStatus((e as CustomEvent<{ status: RealtimeStatus }>).detail.status);
    window.addEventListener(REALTIME_STATUS, h);
    const off = syncStatus.subscribe(setSync);
    return () => { window.removeEventListener(REALTIME_STATUS, h); off(); };
  }, []);
  // the sync line is worded in the POS language from its code (Vietnamese POS §21); the package's English is the fallback
  const now = Date.now();
  const label = LABEL_KEY[status] ? t(LABEL_KEY[status]!) : (() => { const c = syncIndicatorCoded(sync, now); return c ? codedText(c, syncIndicatorText(sync, now)) : null; })();
  if (!label) return null;
  const alarming = status === 'DEGRADED' || (status === 'CONNECTED' && sync.lastErrorAt != null);
  return (
    <div role="status" aria-live="polite" data-testid="realtime-status-pill"
      style={{ position: 'fixed', bottom: 10, right: 10, zIndex: 60, fontSize: 11.5, padding: '4px 10px', borderRadius: 999,
               background: alarming ? '#B85B4D' : '#8a7a66', color: '#fff', opacity: 0.92, pointerEvents: 'none' }}>
      {label}
    </div>
  );
}
