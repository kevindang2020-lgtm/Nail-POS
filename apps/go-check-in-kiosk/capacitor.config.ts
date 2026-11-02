import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon check-in kiosk — iOS shell (Capacitor). Wraps the self-contained kiosk page (staged into www/) in a native
// WKWebView for an in-salon self-check-in iPad. No device permissions; tenant/branch are resolved server-side from the
// slug and the kiosk never sends them. Set the API base for a packaged build via window.APS_API_BASE (see README), or
// launch with ?api=https://your-api. Distribution: Apple Business Manager Custom App (private), not the public store.
const config: CapacitorConfig = {
  appId: 'com.aipowersalon.checkin',
  appName: 'AIPowerSalon Check-In',
  webDir: 'www',
  ios: { contentInset: 'always' },
};

export default config;
