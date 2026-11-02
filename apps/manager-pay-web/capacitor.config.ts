import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon Owner & Manager Payment App — iOS / Android shell (Capacitor). Wraps the Vite build (dist) in a native WebView.
// Tap to Pay on iPhone requires the Apple entitlement (PSP = Fiserv) + the native FiservTTP plugin, both added in Xcode
// on a physical device. For a device build set an absolute VITE_API_BASE. (Local dev against http://10.0.2.2:3000 from
// the Android emulator: APS_MOBILE_ENV=dev — the debug network-security config allows exactly those hosts.)
// BUILD_PLAN Phase 13 D (Constitution 6 §137–138, audit bugs 8 + 10):
//  • appId = the NATIVE project's bundle id / applicationId (Xcode PRODUCT_BUNDLE_IDENTIFIER, Gradle applicationId, the APNs
//    topic) — the native projects are the truth; tooling/mobile/check-native-config.mjs fails on drift.
//  • RELEASE by default: https WebView scheme, no cleartext. `APS_MOBILE_ENV=dev npx cap sync` (or `cap run`) is the
//    debug-only escape for local development — cleartext + an http scheme so the shell can reach a LAN dev API / the Vite
//    live-reload server (CAP_SERVER_URL). Never sync a store build with it (the gate reads this file's defaults).
const DEV = process.env.APS_MOBILE_ENV === 'dev';

const config: CapacitorConfig = {
  server: {
    // The WebView's origin. The API decides who may receive a bearer token from the `Origin` header (a browser
    // sets it; page script cannot forge it), and both schemes below are on its native allowlist. Changing them
    // without updating NATIVE_APP_ORIGINS would block every request at CORS *and* stop the app being recognised
    // as native — and the API would log nothing, because the requests never arrive. Declared explicitly so the
    // link is visible; a guard pins it.
    iosScheme: 'capacitor',      // → origin: capacitor://localhost
    androidScheme: 'https',      // → origin: https://localhost
    ...(DEV ? { cleartext: true, androidScheme: 'http', ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL } : {}) } : {}),
  },

  appId: 'com.aipowersalon.managerpay',
  appName: 'AIPowerSalon Pay',
  webDir: 'dist',
  plugins: { PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] } },
  ios: { contentInset: 'always' },
};

export default config;
