import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon tech-web — iOS shell (Capacitor). Wraps the Vite build (dist) in a native WKWebView.
// No device permissions are required by this app. For a device build set an absolute VITE_API_BASE (see MOBILE_SECURITY_REPORT.md).
const config: CapacitorConfig = {
  server: {
    // The WebView's origin. The API decides who may receive a bearer token from the `Origin` header (a browser
    // sets it; page script cannot forge it), and both schemes below are on its native allowlist. Changing them
    // without updating NATIVE_APP_ORIGINS would block every request at CORS *and* stop the app being recognised
    // as native — and the API would log nothing, because the requests never arrive. Declared explicitly so the
    // link is visible; a guard pins it.
    iosScheme: 'capacitor',      // → origin: capacitor://localhost
    androidScheme: 'http',       // → origin: http://localhost
    cleartext: true
  },

  appId: 'com.aipowersalon.technician',
  appName: 'AIPowerSalon Tech',
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
