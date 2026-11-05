# Mobile release setup — what Kevin does (BUILD_PLAN Phase 13 D)

Constitution 6 §33–42, §58–66, §130, §137–138, §179, §245–246, §290. The code side is done and gated
(`node tooling/mobile/check-native-config.mjs`, part of `tooling/ci/run-gates.mjs`). Everything below needs Kevin's Apple /
Google / Firebase accounts, a Mac, or real devices. **Nothing here is ever committed** — every value goes in an env var, a
CI secret, or a file the root `.gitignore` already excludes (`*.jks`, `key.properties`, `*.p8`, `*.p12`,
`google-services.json`, `GoogleService-Info.plist`, `*.mobileprovision`).

## The four apps (decision: the native projects are the truth)

| App | Bundle id / applicationId (Xcode, Gradle, `capacitor.config.ts`, APNs topic) | push `app` id | link prefix |
|---|---|---|---|
| Customer | `com.powersalon.customer` | `customer` | `/app-links/customer/` |
| Technician | `com.powersalon.technician` | `tech` | `/app-links/tech/` |
| Owner | `com.powersalon.owner` | `owner` | `/app-links/owner/` |
| Manager Pay | `com.aipowersalon.pay` | `manager` | `/app-links/manager-pay/` |

To move to one prefix later (e.g. all `com.aipowersalon.*`): change Xcode + Gradle first, then `capacitor.config.ts` and
`packages/api-contracts/src/mobile-links.ts` `MOBILE_BUNDLE_IDS` — the gate fails until all agree.

## 1. Apple (Apple Developer account + a Mac with Xcode)

1. **Identifiers** (developer.apple.com → Certificates, IDs & Profiles → Identifiers): one App ID per bundle id above, each
   with the capabilities **Push Notifications** and **Associated Domains** (Manager Pay also: the Tap to Pay on iPhone
   entitlement, already requested per `apps/manager-pay-web/NATIVE_TAP_TO_PAY_INTEGRATION.md`).
2. **APNs key**: Keys → "+" → Apple Push Notifications service → download `AuthKey_<KEYID>.p8` once. Put it in the API's
   secret store (never the repo): `APNS_KEY_P8` (the PEM text) or `APNS_KEY_P8_B64`, `APNS_KEY_ID=<KEYID>`,
   `APNS_TEAM_ID=<your 10-char Team ID>`, `APNS_ENV=production` (or `sandbox` for TestFlight/dev builds), and the topics
   `APNS_TOPIC_CUSTOMER=com.powersalon.customer`, `APNS_TOPIC_TECH=com.powersalon.technician`,
   `APNS_TOPIC_OWNER=com.powersalon.owner`, `APNS_TOPIC_MANAGER=com.aipowersalon.pay`.
3. **Universal links**: set `APPLE_TEAM_ID=<Team ID>` on the API. Check `https://<links host>/.well-known/apple-app-site-association`
   returns JSON (404 means the variable is missing). The links host is the API host by default (`api.aipowersalon.com`).
4. **Entitlements** — in Xcode, for each app target → Signing & Capabilities → "+ Capability":
   - *Push Notifications* (adds `aps-environment`);
   - *Associated Domains* → add `applinks:api.aipowersalon.com` (or your links host);
   - *Keychain Sharing* is NOT needed (each app keeps its own Keychain group — §137 "do not give all apps identical entitlements").
   Xcode writes `App/App.entitlements`; commit that file (it holds no secret). Equivalent snippet:
   ```xml
   <key>aps-environment</key><string>production</string>
   <key>com.apple.developer.associated-domains</key><array><string>applinks:api.aipowersalon.com</string></array>
   ```
5. **Build configurations**: Debug uses `App/Info-Debug.plist` (adds only `NSAllowsLocalNetworking` for a LAN dev API);
   Release uses `App/Info.plist` (no ATS exception). Archive with the **Release** configuration only.
6. **Face ID**: `NSFaceIDUsageDescription` is in all four `Info.plist`s. After one successful enrolment + sign-in on a real
   iPhone against staging, set `FACE_ID_ENABLED=1` on production (see FACE_ID_ENABLEMENT_RUNBOOK.md).
7. **Privacy labels** (App Store Connect): device ID (app functionality), crash data, product interaction (sanitized analytics).

## 2. Google (Play Console + Firebase)

1. **Rotate the committed upload keys first.** `apps/{customer,owner,tech}-web/android/*.jks` and their `key.properties`
   (with the store password) were committed before this phase. Treat them as compromised: create new upload keystores
   *outside the repo* (`scripts/make-android-keystore.sh`), register them in Play Console (App integrity → Upload key →
   request reset if the app was already uploaded with the old key; use **Play App Signing**), then delete the old files from
   the tree and drop them from `LEGACY_SIGNING_FILES` in `tooling/mobile/check-native-config.mjs` (the list only shrinks).
   Purge them from git history before the repo is shared with anyone.
2. **Firebase** (console.firebase.google.com): one project, four Android apps with the package names above. Download each
   `google-services.json` into `apps/<app>/android/app/` on the build machine / CI only (gitignored). The Gradle build applies
   the plugin only when the file exists.
3. **FCM server credential**: Project settings → Service accounts → Generate new private key → put the JSON in the API's
   secret store as `FCM_SERVICE_ACCOUNT_JSON` (or base64 `FCM_SERVICE_ACCOUNT_B64`). The legacy server key is retired.
4. **App Links**: Play Console → each app → App integrity → App signing → copy the **SHA-256 certificate fingerprint** of the
   app-signing key AND of the upload key. On the API set `ANDROID_CERT_SHA256_CUSTOMER`, `_TECH`, `_OWNER`, `_MANAGER_PAY`
   (comma-separated, `AA:BB:…` form). Check `https://<links host>/.well-known/assetlinks.json`. The manifest's
   `autoVerify` intent filter uses the host from the Gradle property `APS_APP_LINKS_HOST` (default `api.aipowersalon.com`).
5. **Not-installed fallback**: set `APP_LINK_WEB_CUSTOMER`, `APP_LINK_WEB_TECH`, `APP_LINK_WEB_OWNER`,
   `APP_LINK_WEB_MANAGER_PAY` to each web app's https URL; `/app-links/...` then redirects there with `?link=`.
6. Release builds: `./gradlew bundleRelease` (release network-security config = TLS only; `allowBackup=false`; owner and
   manager-pay set `FLAG_SECURE`).

## 3. Build variants (dev / staging / prod)

Web layer: `apps/<app>/.env.{development,staging,production}.example` → copy to `.env.<mode>`, `npx vite build --mode <mode>`.
Native shell: `capacitor.config.ts` is RELEASE-safe by default; `APS_MOBILE_ENV=dev npx cap sync` (optionally
`CAP_SERVER_URL=http://<lan-ip>:5173` for live reload) enables cleartext + the http Android scheme for that sync only.
Android debug builds also get `src/debug/res/xml/network_security_config.xml` (cleartext to 10.0.2.2 / localhost only).
Separate store listings per environment (applicationId suffixes) were deliberately NOT added: each would need its own
Firebase app, APNs topic, App ID and assetlinks entry — add them only if you want staging installable beside production.

## 4. Real-device checks (cannot run here)

- Face ID: enrol in each app (Settings / Profile → Security / Account), kill the app, wait for the session to expire, sign in
  with Face ID; change the password elsewhere → Face ID must refuse and ask for the password.
- Push: one push per category to each app; tap → the right screen; signed-out tap → sign-in first, then the screen.
- Universal links: open `https://<links host>/app-links/customer/appointments` from Notes/Mail with the app installed and
  not installed.
- App switcher: owner / manager-pay show a cover (iOS) / blank card (Android); 5 / 3 idle minutes → lock screen.
