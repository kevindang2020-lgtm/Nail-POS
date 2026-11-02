// app-version.mjs — every web and mobile build knows its own version (Oct 6 2026, BUILD_PLAN Phase 1).
//
// VITE_APP_VERSION was read in two places and set nowhere: every client error report said version "unknown", and the
// Tap-to-Pay app's minimum-version check (MOBILE_PAY_MIN_APP_VERSION) would have refused EVERY device the day the
// variable was set on the server. The version is the app's package.json `version` — BUILD_PLAN Phase 13 B: for a store app
// that IS the store version (tooling/mobile/sync-versions.mjs writes it into Android versionName and iOS MARKETING_VERSION;
// its --check is a gate). An explicit VITE_APP_VERSION in the environment still wins (a CI pipeline can stamp a build).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function resolveAppVersion(appDir, env = process.env) {
  if (env.VITE_APP_VERSION) return String(env.VITE_APP_VERSION);
  try { return String(JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version || '0.0.0'); } catch { return '0.0.0'; }
}

export function appVersion() {
  return {
    name: 'aipowersalon:app-version',
    config: (_cfg, { mode }) => {
      void mode;
      const v = resolveAppVersion(process.cwd());
      return { define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(v) } };
    },
  };
}
