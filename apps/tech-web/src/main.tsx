import './language-policy';   // FIRST (POSLanguage.pdf §20): this app is English only — before any catalogue registers
import React from 'react';
import { configureMobileSdk, initNative, initMobileTelemetry } from '@aipowersalon/mobile-sdk';
import { api, apiBase } from './api/client';
import { mobile } from './lib/mobile';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './i18n/catalog';   // C6 §97 (Phase 13): this app's EN / VI strings
import './i18n/errors.generated';   // V-5: server refusals in the user's language (same text as the POS)
import { AppConfigGate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 B: /app-config, UPDATE_REQUIRED screen, maintenance / module banners
import './styles.css';
import { applyPlatformBranding } from '@aipowersalon/ui';
import { AppErrorBoundary, initErrorReporting } from '@aipowersalon/ui';
import { installAuthRefresh } from '@aipowersalon/api-client';
import { nativeTokenStore, isNativePlatform } from '@aipowersalon/mobile-sdk';
// Constitution 3 Step 2b: renew the 15-minute session silently on a 401 (one refresh, one retry), every API call.
installAuthRefresh(window, { apiBase: apiBase(), native: isNativePlatform() ? nativeTokenStore : null });

// Constitution 11 §199: uncaught errors, unhandled rejections and failed-request references are reported from here on.
initErrorReporting('tech');
// Constitution 6 §116–119 (Phase 13): sanitized analytics + perf marks, batched to /client-telemetry/events.
initMobileTelemetry({ app: 'tech', apiBase, version: (import.meta as any).env?.VITE_APP_VERSION });

// Apply any Super-Admin colour overrides at boot (best-effort; locked defaults already loaded).
applyPlatformBranding();

configureMobileSdk({ http: api, apiBase });   // the SDK takes THIS app's API client by injection (Constitution 13 §89)
initNative();   // no-op on the web; installs the Keychain token store on native
void mobile.start();   // Phase 13 D: universal links / App Links (native) or the web fallback's ?link= → the route gate

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <React.StrictMode>
      {/* react-router v7 future flags (opted in Jul 27, 2026). v7_startTransition wraps router state updates in
          React.startTransition; v7_relativeSplatPath changes relative-path resolution inside splat routes — inert
          here, since the only splat is the `path="*"` catch-all and nothing resolves a relative path within it.
          Opting in early removes the console warnings and keeps the upgrade to react-router v8 a no-op.
          To revert: delete the `future` prop. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppConfigGate app="tech" version={(import.meta as any).env?.VITE_APP_VERSION}><App /></AppConfigGate>
    </BrowserRouter>
  </React.StrictMode>
  </AppErrorBoundary>
);
