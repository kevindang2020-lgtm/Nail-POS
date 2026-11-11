import './i18n';   // FIRST: registers the POS EN / VI catalogues and picks this device's language before any module-level
                   // string (nav tables, KPI labels) is evaluated — importing it after ./App left those in English
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';
import { applySpacing, readSpacing } from './shell/spacingPref';
applySpacing(readSpacing());   // the person's Compact / Standard spacing for this device, before the first paint
import { installOfflineReadCache } from './api/offline-read-cache';
import { installSessionLockWatch } from './api/session-lock-watch';
import { installHitSlop } from './shell/hitSlop';
import { applyPlatformBranding } from '@aipowersalon/ui';
import './components/uiText';   // WP-C4: translated text for the shared @aipowersalon/ui components
import { AppErrorBoundary, initErrorReporting } from '@aipowersalon/ui';
import { installAuthRefresh } from '@aipowersalon/api-client';
import { apiBase } from './api/client';
// Constitution 3 Step 2b: renew the 15-minute session silently on a 401 (one refresh, one retry), every API call.
installAuthRefresh(window, { apiBase });

// Constitution 11 §199: uncaught errors, unhandled rejections and failed-request references are reported from here on.
initErrorReporting('pos');

// Apply any Super-Admin colour overrides at boot (best-effort; locked defaults already loaded).
applyPlatformBranding();

// Decision 33: last copy of today's board / queue / schedule / catalog when offline; every write refused while offline.
installOfflineReadCache();
// Decision 35: a 423 SESSION_LOCKED from the server locks this screen too (closes the second-tab bypass).
installSessionLockWatch();
// §78: compact controls keep their size; their finger target grows to 44 × 44 px where the neighbours allow.
installHitSlop();
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
