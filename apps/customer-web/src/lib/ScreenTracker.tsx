// ScreenTracker — Constitution 6 §116 (BUILD_PLAN Phase 13): `screen_viewed` on every route change (the path only; the
// shared allowlist strips ids and the query string before anything is sent) and launch → first screen once.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackScreen } from '@aipowersalon/mobile-sdk';

export function ScreenTracker(): null {
  const { pathname } = useLocation();
  useEffect(() => { try { trackScreen(pathname); } catch { /* telemetry never breaks navigation */ } }, [pathname]);
  return null;
}
