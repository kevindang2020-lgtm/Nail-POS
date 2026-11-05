import type { CapacitorConfig } from '@capacitor/cli';

// AIPowerSalon Customer — iOS shell (Capacitor). Wraps the Vite web build (dist) in a native WKWebView.
// NOTE: for a device build the web bundle must call an ABSOLUTE https API base (set VITE_API_BASE at build
// time); relative '/customer' paths only resolve via the dev proxy, not inside the native shell.
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
    cleartext: true,
    iosScheme: 'capacitor',
    androidScheme: 'http'
  }
};

export default config;
