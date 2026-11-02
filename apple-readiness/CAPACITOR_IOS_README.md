# Capacitor iOS — Setup & Mac Handoff (Customer app, proven)

The customer app now has a **real native iOS target** generated with Capacitor 8 (Swift Package Manager — no
CocoaPods needed). This is the proven route to TestFlight for the React/Vite apps.

## What's in the repo (verified on Linux)
- `apps/customer-web/capacitor.config.ts` — appId `com.aipowersalon.customer`, appName `AIPowerSalon`, webDir `dist`.
- `apps/customer-web/ios/App/App.xcodeproj` — the native Xcode project.
- `apps/customer-web/ios/App/App/Info.plist` — display name `AIPowerSalon`, **one** permission string
  (`NSLocationWhenInUseUsageDescription`, exact App Store wording), `ITSAppUsesNonExemptEncryption=false`.
- `npm run build` (Vite) + `npx cap sync ios` both succeed and copy the web build into the native shell.

## Steps that MUST run on a Mac with Xcode (cannot be done here, not faked)
1. `cd apps/customer-web && npm install && npm run build && npx cap sync ios`
2. `npx cap open ios` (opens Xcode).
3. Signing: select your Team, set the bundle id `com.aipowersalon.customer`, set Version/Build.
4. App icon + launch screen: drop a 1024px icon into the asset catalog (`App/Assets.xcassets/AppIcon.appiconset`).
5. **Set the API base:** the web bundle must call an absolute `https://` API (see MOBILE_SECURITY_REPORT.md). Build
   the web app with `VITE_API_BASE=https://api.yourdomain` before `cap sync`.
6. Product → Archive → Distribute App → App Store Connect (TestFlight).

## Repeat for the other apps
Same procedure with appId `com.aipowersalon.owner`, `com.aipowersalon.technician`, `com.aipowersalon.checkin`
(owner/checkin need NO location string; only customer/tech use location).

## customer-display (added) — 4th native shell
`apps/customer-display` now has a Capacitor iOS shell, scaffolded with the same verified flow as the consumer apps:
- **appId** `com.aipowersalon.display` · **appName** "AIPowerSalon Display" · webDir `dist`.
- **No permission usage strings** — it's a passive in-salon queue/now-serving display with **no end-user account**
  (token-scoped public endpoints), so no camera/location/mic and no account-deletion/privacy-export screens apply.
- `ITSAppUsesNonExemptEncryption=false`; `cap add ios` + `cap sync ios` succeed; Xcode project + synced web assets present.
- **Distribution:** Apple Business Manager **Custom App** (private, to salon iPads) — not the public App Store — per
  CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION. The same ABM path applies to the static check-in kiosk, which still needs
  a minimal build setup before it can be wrapped (documented, not yet scaffolded).

### Native-shell status (here-verifiable parts)
| App | iOS shell | Perms | Distribution |
|---|---|---|---|
| customer-web | ✓ | NSLocationWhenInUse | App Store |
| owner-web | ✓ | none | App Store |
| tech-web | ✓ | none | App Store |
| customer-display | ✓ | none | ABM Custom App |
| go-check-in-kiosk | ✓ (static page staged to www/) | none | ABM Custom App |


**Update:** all five deployable surfaces now have a verified iOS shell. The check-in kiosk (`com.aipowersalon.checkin`, "AIPowerSalon Check-In") wraps its self-contained page via a tiny `npm run build` that stages `index.html` into `www/`; set the API base for a packaged build with `window.APS_API_BASE` (or launch with `?api=`). It has no device permissions and no end-user account (phone-only check-in; tenant resolved server-side from the slug). `go-check-in-admin` remains an internal web page, not a distributed app.

## Android (added)
All five surfaces above now also have Capacitor **Android** projects (`apps/<app>/android/`) with matching `applicationId`, generated icons + splash, and synced web assets. Build/sign/submit steps are in the repo-root `ANDROID_SUBMISSION_RUNBOOK.md`.
