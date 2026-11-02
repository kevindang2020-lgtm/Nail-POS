# iOS Build Configuration Report

## Toolchain (verified)
- **Capacitor 8.4.0**, iOS platform via **Swift Package Manager** (no CocoaPods/Podfile needed).
- Each app: `capacitor.config.ts` (appId, appName, webDir `dist`) + a generated `ios/App/App.xcodeproj`.
- Web build: Vite (`npm run build` → `dist`), copied into the native shell by `npx cap sync ios`.

## Bundle identifiers & display names
| App | Bundle id | Display name | Permissions in Info.plist |
|---|---|---|---|
| Customer | `com.aipowersalon.customer` | AIPowerSalon | `NSLocationWhenInUseUsageDescription` (only) |
| Owner | `com.aipowersalon.owner` | AIPowerSalon Owner | none |
| Tech | `com.aipowersalon.technician` | AIPowerSalon Tech | none |
| Check-In | `com.aipowersalon.checkin` | AIPowerSalon Check-In | (not scaffolded yet) |

All scaffolded apps have `ITSAppUsesNonExemptEncryption=false` set (standard TLS only — see EXPORT_COMPLIANCE_NOTES.md).

## Versioning (action needed)
- Web `package.json` versions are `0.1.0`. iOS uses Xcode build settings `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`.
- **Set for first submission:** `CFBundleShortVersionString = 1.0.0`, `CFBundleVersion = 1`. Increment `CFBundleVersion`
  on every TestFlight upload.

## Capabilities / entitlements
- **None required today.** Add the **Push Notifications** capability + `aps-environment` entitlement only when APNs/FCM
  is implemented. No Apple Pay capability (not integrated; do not add until configured).

## Signing & upload (Mac-only — not doable here)
1. Open `apps/<app>/ios` in Xcode on a Mac (`npx cap open ios`).
2. Signing & Capabilities → select Team, confirm bundle id, set automatic signing (or a distribution provisioning
   profile + distribution certificate).
3. Set the **API base** before building the web bundle: `VITE_API_BASE=https://api.yourdomain npm run build && npx cap sync ios`.
4. Validate cookie-session login inside the WebView (see MOBILE_SECURITY_REPORT.md).
5. Product → Archive → Distribute App → App Store Connect → Upload (TestFlight).

## Per-app repeat
Owner and Tech are already scaffolded; only the **Check-In display** still needs a shell (it's a static `index.html`, so
either wrap that folder as the `webDir` or build it into a tiny Vite app first). Check-In ships via ABM Custom App.
