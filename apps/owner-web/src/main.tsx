import React from 'react';
import { initNative } from './auth/native-bootstrap';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';
import { applyPlatformBranding } from '@aipowersalon/ui';
import { AppErrorBoundary, initErrorReporting } from '@aipowersalon/ui';
import { mobileShell } from './lib/mobile-shell';
import { installAuthRefresh } from '@aipowersalon/api-client';
import { Capacitor } from '@capacitor/core';
import { nativeTokenStore } from '@aipowersalon/mobile-sdk';
import { apiBase } from './api/client';

// Nov 6 2026: the access token lives 15 minutes (AUTH_ACCESS_TTL). This renews it silently on the first 401 and retries
// the request once (@aipowersalon/api-client auth-refresh). It was built in October but never switched on, so every app
// signed people out about 15 minutes after sign-in. Installed before anything fetches.
installAuthRefresh(window, { apiBase: apiBase(), native: Capacitor.isNativePlatform() ? nativeTokenStore : null });   // native: the Keychain pair

// Apply any Super-Admin colour overrides at boot (best-effort; locked defaults already loaded).
applyPlatformBranding();

initNative();   // no-op on the web; installs the Keychain token store on native

// Constitution 11 §199: uncaught errors, unhandled rejections and failed-request references are reported from here on,
// and a crash in any screen shows the recovery card instead of a blank page.
initErrorReporting('owner');
// Universal links / App Links (native) and the web fallback's ?link= — opened once the signed-in UI binds its routes.
void mobileShell.start();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
  <React.StrictMode>
      {/* react-router v7 future flags (opted in Jul 27, 2026). v7_startTransition wraps router state updates in
          React.startTransition; v7_relativeSplatPath changes relative-path resolution inside splat routes — inert
          here, since the only splat is the `path="*"` catch-all and nothing resolves a relative path within it.
          Opting in early removes the console warnings and keeps the upgrade to react-router v8 a no-op.
          To revert: delete the `future` prop. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
  </AppErrorBoundary>
);
