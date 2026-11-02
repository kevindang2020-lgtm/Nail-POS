import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon Customer — iOS / Android shell (Capacitor). Wraps the Vite web build (dist) in a native WebView.
// NOTE: for a device build the web bundle must call an ABSOLUTE https API base (set VITE_API_BASE at build time).
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

  appId: 'com.powersalon.customer',
  appName: 'AIPowerSalon',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      launchShowDuration: 10000,
      launchAutoHide: false,
      backgroundColor: "#fdfefbff",
      showSpinner: false,
      androidSplashResourceName: "splash"
    },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
