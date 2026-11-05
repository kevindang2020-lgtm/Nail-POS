import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon Customer — iOS shell (Capacitor). Wraps the Vite web build (dist) in a native WKWebView.
// NOTE: for a device build the web bundle must call an ABSOLUTE https API base (set VITE_API_BASE at build
// time); relative '/customer' paths only resolve via the dev proxy, not inside the native shell.
/** Dev shells only (emulator → http://10.0.2.2:3000). A store build never sets it. */
const DEV = process.env.APS_MOBILE_ENV === 'dev';

const config: CapacitorConfig = {
  appId: 'com.powersalon.customer',
  appName: 'AIPowerSalon',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_launcher",
      iconColor: "#488AFF"
    },
    SplashScreen: {
      launchShowDuration: 10000,
      launchAutoHide: false,
      backgroundColor: "#fdfefbff",
      showSpinner: false,
      androidSplashResourceName: "splash"
    },
    FirebaseMessaging: {
      presentationOptions: ["badge", "sound", "alert"],
    },

    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    }
  },
  server: {
    iosScheme: 'capacitor',      // → origin: capacitor://localhost
    androidScheme: 'https',      // → origin: https://localhost (release: no cleartext anywhere)
    // `APS_MOBILE_ENV=dev npx cap sync` is the ONLY way to get the old http origin + cleartext, for an emulator talking to
    // http://10.0.2.2:3000. Both origins are on the API's native allowlist (NATIVE_APP_ORIGINS).
    ...(DEV ? { androidScheme: 'http', cleartext: true } : {}),
  },
};

export default config;
