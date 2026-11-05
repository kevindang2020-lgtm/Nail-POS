import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// The display's two typefaces ship with the app (Oct 6 2026): a display that restarts with no internet keeps them, and
// nothing is fetched from a font CDN. Each file covers every script subset by unicode-range — the browser loads only the
// ones a page uses. (The Google Fonts link it replaced named "Hanken Grotesque", a family Google does not have.)
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource/hanken-grotesk/800.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import './styles.css';
import { AppErrorBoundary, initErrorReporting } from '@aipowersalon/ui';

// Constitution 11 §199: uncaught errors, unhandled rejections and failed-request references are reported from here on.
initErrorReporting('customer-display');
createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <StrictMode><App /></StrictMode>
  </AppErrorBoundary>
);
