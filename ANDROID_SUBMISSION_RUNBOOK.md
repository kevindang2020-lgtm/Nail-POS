# AIPowerSalon — Android Build & Play Store Submission Runbook

Companion to `apple-readiness/IOS_SUBMISSION_RUNBOOK.md`. All five mobile surfaces now have Capacitor **Android** projects
(`apps/<app>/android/`) with real launcher icons + splash and the correct `applicationId`. This is the copy-paste path to
signed builds.

## The five Android apps
| App folder | applicationId | Store track |
|---|---|---|
| `owner-web` | `com.aipowersalon.owner` | Play – public |
| `customer-web` | `com.aipowersalon.customer` | Play – public |
| `tech-web` | `com.aipowersalon.technician` | Play – public |
| `customer-display` | `com.aipowersalon.display` | private / kiosk hardware |
| `go-check-in-kiosk` | `com.aipowersalon.checkin` | private / kiosk hardware |

## Prerequisites (once)
- **Android Studio** (latest) — bundles the JDK, Android SDK, and Gradle. No separate installs needed.
- **Google Play Console** developer account ($25 one-time) for the three public apps.
- Set the production API base before building: `VITE_API_BASE=https://<your-api-host>` (and `window.APS_API_BASE` for the
  kiosk). Same value you use for iOS.

## Per-app build (repeat for each)
```bash
cd apps/<app>
VITE_API_BASE=https://<your-api-host> npm run build   # kiosk: build stages index.html → www/
npx cap sync android                                   # copies web assets into the Android project
npx cap open android                                   # opens Android Studio
```

### One-time signing keystore (do NOT lose this file)
```bash
keytool -genkey -v -keystore aipowersalon-release.keystore \
  -alias aipowersalon -keyalg RSA -keysize 2048 -validity 10000
```
Store the keystore + passwords in a password manager. Losing it means you can never update the app under the same
listing. (Enrolling in **Play App Signing** at upload time is recommended — Google holds the app-signing key and you keep
the upload key.)

### Version bumps (each release)
In `apps/<app>/android/app/build.gradle` → `defaultConfig`: increment `versionCode` (integer, must go up every upload) and
set `versionName` (e.g. `"1.0.0"`). Defaults are `versionCode 1` / `versionName "1.0"`.

### Build the signed bundle
Android Studio → **Build ▸ Generate Signed Bundle / APK ▸ Android App Bundle (.aab)** → select the keystore → release →
finish. The `.aab` lands in `android/app/release/`.

## Play Console (per public app)
1. **Create app** → name, default language, app/free, declarations.
2. **Store listing:** short + full description, the generated icon (512×512 is in `android/.../mipmap-xxxhdpi`), feature
   graphic, ≥2 screenshots.
3. **Content rating** questionnaire.
4. **Data safety form** — Play's equivalent of Apple's App Privacy. Declare what's collected (account info; location for
   the customer app). The **account-deletion** + **data-export** endpoints already built satisfy Play's data-deletion
   requirement — link the in-app deletion + your web deletion URL.
5. **Upload the `.aab`** to the **Internal testing** track first → add testers → roll out. Promote to Production when ready.

## Kiosk + display (customer-display, go-check-in-kiosk)
These are dedicated-hardware apps, not public listings. Options (parity with the iOS ABM Custom App path):
- **Managed Google Play / private app** published only to your organization, or
- Direct-install the signed `.aab`/APK on the kiosk/display tablets you provision.
Both have no public store presence and no account/marketing requirements (the display is passive; the kiosk is check-in only).

## Notes
- Android needs no `ITSAppUsesNonExemptEncryption` flag (that's iOS-only).
- `customer-web` already declares `ACCESS_FINE/COARSE_LOCATION` in its manifest (parity with iOS `NSLocationWhenInUse`);
  the WebView will prompt at runtime. The other four request no sensitive permissions.
- Suggested order (mirrors iOS): **Owner** first (simplest), then Tech, then Customer, then the two kiosk/display apps.
