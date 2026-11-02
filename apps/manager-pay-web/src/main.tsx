import './language-policy';   // FIRST (POSLanguage.pdf §20): this app is English only — before any catalogue registers
import React from 'react';
import { configureMobileSdk, initNative, initMobileTelemetry } from '@aipowersalon/mobile-sdk';
import { api, apiBase } from './api/client';
import { mobile } from './lib/mobile';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './i18n/catalog';   // C6 §97 (Phase 13): this app's EN / VI strings
import { AppConfigGate } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 B: /app-config, UPDATE_REQUIRED screen, maintenance / module banners
import './styles.css';
import { AppErrorBoundary, initErrorReporting } from '@aipowersalon/ui';
import { installAuthRefresh } from '@aipowersalon/api-client';
import { nativeTokenStore, isNativePlatform } from '@aipowersalon/mobile-sdk';
// Constitution 3 Step 2b: renew the 15-minute session silently on a 401 (one refresh, one retry), every API call.
installAuthRefresh(window, { apiBase: apiBase(), native: isNativePlatform() ? nativeTokenStore : null });

// Constitution 11 §199: uncaught errors, unhandled rejections and failed-request references are reported from here on.
initErrorReporting('manager-pay');
// Constitution 6 §116–119 (Phase 13): sanitized analytics + perf marks, batched to /client-telemetry/events.
initMobileTelemetry({ app: 'manager-pay', apiBase, version: (import.meta as any).env?.VITE_APP_VERSION });

configureMobileSdk({ http: api, apiBase });   // the SDK takes THIS app's API client by injection (Constitution 13 §89)
initNative();   // no-op on the web; installs the Keychain token store on native
void mobile.start();   // Phase 13 D: universal links / App Links (native) or the web fallback's ?link= → the route gate

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <React.StrictMode>
    <AppConfigGate app="manager-pay" version={(import.meta as any).env?.VITE_APP_VERSION}><App /></AppConfigGate>
  </React.StrictMode>
  </AppErrorBoundary>
);
