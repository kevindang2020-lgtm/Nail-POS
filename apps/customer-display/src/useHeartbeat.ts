// useHeartbeat.ts — 23-inch spec §85–§86: a paired display reports itself every 30 seconds and whenever what it is doing
// changes — its mode (check-in, checkout, advertising, idle), its app version, its screen and its display profile. The
// POS derives ONLINE / OFFLINE from these reports (never a stored flag), and the answer says whether the owner put the
// display in maintenance. Best-effort: a missed heartbeat is just a later "last seen".
import { useEffect, useRef } from 'react';
// runtime values from the contracts' ROOT entry (a realm entry re-exports them one level deeper, which the production
// bundler's CommonJS analysis cannot follow); the types from the customer realm
import { DISPLAY_HEARTBEAT_MS, displayProfileFor } from '@aipowersalon/api-contracts';
import type { DisplayHeartbeatAck, DisplayReportedMode } from '@aipowersalon/api-contracts/customer';
import { sendHeartbeat, type Creds } from './api';

declare const __DISPLAY_VERSION__: string | undefined;
/** The build's version (vite define), 'dev' when run unbuilt. */
export const DISPLAY_APP_VERSION: string = typeof __DISPLAY_VERSION__ === 'string' && __DISPLAY_VERSION__ ? __DISPLAY_VERSION__ : 'dev';

export function currentScreen(): { width: number; height: number; pixelRatio: number } {
  const w = typeof window !== 'undefined' ? Math.round(window.innerWidth || 0) : 0;
  const h = typeof window !== 'undefined' ? Math.round(window.innerHeight || 0) : 0;
  const pr = typeof window !== 'undefined' ? Number(window.devicePixelRatio || 1) : 1;
  return { width: Math.min(10000, Math.max(100, w)), height: Math.min(10000, Math.max(100, h)), pixelRatio: Math.min(8, Math.max(0.5, Math.round(pr * 100) / 100)) };
}

/** G7: `adPolicy` = the advertising policy of the playlist this display is actually playing (its acknowledgment) */
export function useHeartbeat(creds: Creds | null, mode: DisplayReportedMode | null, onAck: (ack: DisplayHeartbeatAck) => void, adPolicy: { version: number; mode: 'PLATFORM_ONLY' | 'TENANT_ONLY' } | null = null): void {
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const policyRef = useRef(adPolicy);
  policyRef.current = adPolicy;
  const ackRef = useRef(onAck);
  ackRef.current = onAck;
  const beatRef = useRef<() => void>(() => undefined);
  const lastSent = useRef<DisplayReportedMode | null>(null);

  useEffect(() => {
    if (creds?.mode !== 'device') { beatRef.current = () => undefined; return; }
    let live = true;
    const beat = () => {
      const m = modeRef.current;
      if (!m) return;   // nothing on screen yet
      lastSent.current = m;
      const screen = currentScreen();
      sendHeartbeat(creds, { mode: m, appVersion: DISPLAY_APP_VERSION, screen, profile: displayProfileFor(screen.width, screen.height), ...(policyRef.current ? { adPolicy: policyRef.current } : {}) })
        .then((a) => { if (live) ackRef.current(a); })
        .catch(() => { /* offline: the POS will show it as offline — nothing to do here */ });
    };
    beatRef.current = beat;
    beat();
    const t = setInterval(beat, DISPLAY_HEARTBEAT_MS);
    // a new screen size is reported once the window settles (a drag to the second monitor fires dozens of resizes)
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => { if (settle) clearTimeout(settle); settle = setTimeout(beat, 1_000); };
    window.addEventListener('resize', onResize);
    return () => { live = false; clearInterval(t); if (settle) clearTimeout(settle); window.removeEventListener('resize', onResize); beatRef.current = () => undefined; };
  }, [creds]);

  // a mode change is reported at once (the POS shows "Checkout" the moment a checkout takes the screen)
  useEffect(() => { if (mode && mode !== lastSent.current) beatRef.current(); }, [mode]);
  // G7: a newly applied advertising policy is acknowledged at once (the Super Admin fleet status waits for it)
  const ackKey = adPolicy ? `${adPolicy.mode}:${adPolicy.version}` : '';
  useEffect(() => { if (ackKey) beatRef.current(); }, [ackKey]);
}
