import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon customer-display — iOS shell (Capacitor). Wraps the Vite build (dist) in a native WKWebView for an
// in-salon iPad queue/now-serving display. No device permissions and no end-user account (token-scoped public endpoints).
// Distribution is Apple Business Manager (Custom App) per CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION, not the public store.
// For a device build set an absolute VITE_API_BASE (see MOBILE_SECURITY_REPORT.md).
const config: CapacitorConfig = {
  appId: 'com.aipowersalon.display',
  appName: 'AIPowerSalon Display',
  webDir: 'dist',
  ios: { contentInset: 'always' },
};

export default config;
