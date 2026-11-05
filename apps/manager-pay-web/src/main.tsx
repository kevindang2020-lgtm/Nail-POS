import React from 'react';
import { initNative } from './auth/native-bootstrap';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { AppErrorBoundary, initErrorReporting } from '@aipowersalon/ui';
import { mobileShell } from './lib/mobile-shell';

initNative();   // no-op on the web; installs the Keychain token store on native

// Constitution 11 §199: uncaught errors, unhandled rejections and failed-request references are reported from here on,
// and a crash in any screen shows the recovery card instead of a blank page.
initErrorReporting('manager-pay');
// Universal links / App Links (native) and the web fallback's ?link= — opened once the signed-in UI binds its routes.
void mobileShell.start();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
  <React.StrictMode>
    <App />
  </React.StrictMode>
  </AppErrorBoundary>
);
