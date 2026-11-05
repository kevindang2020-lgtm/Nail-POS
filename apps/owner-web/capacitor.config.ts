import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon owner-web — iOS shell (Capacitor). Wraps the Vite build (dist) in a native WKWebView.
// No device permissions are required by this app. For a device build set an absolute VITE_API_BASE (see MOBILE_SECURITY_REPORT.md).
/** Dev shells only (emulator → http://10.0.2.2:3000). A store build never sets it. */
const DEV = process.env.APS_MOBILE_ENV === 'dev';

const config: CapacitorConfig = {
  server: {
    // The WebView's origin. The API decides who may receive a bearer token from the `Origin` header (a browser
    // sets it; page script cannot forge it), and both schemes below are on its native allowlist. Changing them
    // without updating NATIVE_APP_ORIGINS would block every request at CORS *and* stop the app being recognised
    // as native — and the API would log nothing, because the requests never arrive. Declared explicitly so the
    // link is visible; a guard pins it.
    iosScheme: 'capacitor',      // → origin: capacitor://localhost
    androidScheme: 'https',      // → origin: https://localhost (release: no cleartext anywhere)
    // `APS_MOBILE_ENV=dev npx cap sync` is the ONLY way to get the old http origin + cleartext, for an emulator talking to
    // http://10.0.2.2:3000. Both origins are on the API's native allowlist (NATIVE_APP_ORIGINS).
    ...(DEV ? { androidScheme: 'http', cleartext: true } : {}),
  },

  appId: 'com.powersalon.owner',
  appName: 'AIPowerSalon Owner',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_launcher",
      iconColor: "#488AFF"
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    }
  }
};

export default config;
