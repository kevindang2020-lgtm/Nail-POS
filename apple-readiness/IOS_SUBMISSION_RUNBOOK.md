# iOS Submission Runbook — AIPowerSalon

Copy-paste steps to take the four scaffolded iOS apps from this repo to TestFlight / the App Store.
Everything here runs **on a Mac with Xcode** (the one thing that can't be done in the Linux build env). The web builds,
Capacitor sync, icons, splash, compliance screens, and account/privacy endpoints are already done and verified.

> Replace the two placeholders wherever they appear:
> - `APP_STORE_TEAM_ID` → your Apple Developer Team (Xcode picks it from your signed-in Apple ID).
> - `https://api.yourdomain.com` → the **absolute** production URL of the NestJS API (`apps/api`).

---

## 0) One-time prerequisites
1. **Apple Developer Program** membership (the org enrollment from the pilot blockers).
2. A **Mac with Xcode** (latest) + command line tools: `xcode-select --install`.
3. Sign Xcode into your Apple ID: Xcode ▸ Settings ▸ Accounts ▸ **+** ▸ Apple ID.
4. **CocoaPods is NOT used** — these projects use Swift Package Manager (Capacitor 8). Nothing to install.
5. Node 22 + repo deps: from the repo root, `npm ci`.

---

## 1) The four apps (exact values)

| App | Workspace | Bundle ID | Display name | Permissions | Distribution |
|---|---|---|---|---|---|
| Customer | `aipowersalon-customer-web` | `com.aipowersalon.customer` | AIPowerSalon | Location (when-in-use) | **App Store** |
| Owner | `aipowersalon-owner-web` | `com.aipowersalon.owner` | AIPowerSalon Owner | none | **App Store** |
| Technician | `aipowersalon-tech-web` | `com.aipowersalon.technician` | AIPowerSalon Tech | none | **App Store** |
| Check-in display | `aipowersalon-customer-display` | `com.aipowersalon.display` | AIPowerSalon Display | none | **ABM Custom App** (private) |
| Check-in kiosk | `aipowersalon-go-check-in-kiosk` | `com.aipowersalon.checkin` | AIPowerSalon Check-In | none | **ABM Custom App** (private) |

The Location string for the Customer app is already in its `Info.plist`
(`NSLocationWhenInUseUsageDescription`). `ITSAppUsesNonExemptEncryption=false` is set in all four (no export docs needed).

---

## 2) Build web + sync iOS  (run once per app)

Point the build at the production API, build the web bundle, sync it into the iOS shell, refresh icons, open Xcode.
Example shows the **Customer** app — repeat with each row's workspace + folder.

```bash
# from repo root
export VITE_API_BASE="https://api.yourdomain.com"     # absolute prod API URL — required for a device build

npm run build --workspace aipowersalon-customer-web    # → apps/customer-web/dist
cd apps/customer-web
npx cap sync ios                                       # copies dist + plugins into ios/App
npx @capacitor/assets generate --ios                   # (only needed if you changed brand/ art)
npx cap open ios                                       # opens the project in Xcode
```

Folder ↔ workspace map: `apps/customer-web` ↔ `aipowersalon-customer-web`,
`apps/owner-web` ↔ `aipowersalon-owner-web`, `apps/tech-web` ↔ `aipowersalon-tech-web`,
`apps/customer-display` ↔ `aipowersalon-customer-display`, `apps/go-check-in-kiosk` ↔ `aipowersalon-go-check-in-kiosk`.

> **Check-in kiosk nuance:** it's a static page, not a Vite app. Its `npm run build` just stages `index.html` into `www/`,
> and it ignores `VITE_API_BASE`. Set its API base by adding `<script>window.APS_API_BASE='https://api.yourdomain.com'</script>`
> to `apps/go-check-in-kiosk/index.html` (before the main script), then `npm run build` + `npx cap sync ios`. Or launch with `?api=`.

> Confirm `VITE_API_BASE` is actually baked in: open `apps/<app>/dist/assets/*.js` and search for your domain, **or**
> in the running app check the network calls hit `https://api.yourdomain.com`, not `localhost`.

---

## 3) Xcode: sign, version, archive, upload  (per app)

With the project open (`npx cap open ios`), select the **App** target:

1. **Signing & Capabilities**
   - Check **Automatically manage signing**.
   - **Team** → select your team (`APP_STORE_TEAM_ID`).
   - Confirm **Bundle Identifier** matches the table (e.g. `com.aipowersalon.customer`).
2. **Version & build** (General ▸ Identity), or use the CLI in §6:
   - **Version** (marketing) → `1.0.0`
   - **Build** → `1` (bump this for every new upload of the same version).
3. **Deployment target** → iOS 14.0 or later (match what your devices run).
4. Destination dropdown (top bar) → **Any iOS Device (arm64)**.
5. **Product ▸ Archive**. Wait for the build.
6. Organizer opens automatically → select the archive → **Distribute App** →
   **App Store Connect** → **Upload** → accept the defaults (automatic signing) → **Upload**.

Repeat 1–6 for each app. (Bump **Build** to `2`, `3`, … if you re-upload the same version.)

---

## 4a) App Store Connect — the three consumer apps

For **Customer / Owner / Technician** at https://appstoreconnect.apple.com :

1. **My Apps ▸ +** ▸ New App → iOS → name, primary language, **Bundle ID** (pick the matching one), SKU (any unique string).
2. **TestFlight tab** (after the build finishes processing, ~5–30 min):
   - Add yourself + staff as **Internal Testers** → install via the TestFlight app. No review needed for internal.
   - External testers require a quick **Beta App Review**.
3. **App Store tab** (for public release) — fill from the drafts in `APP_STORE_METADATA_DRAFTS.md`:
   - Screenshots (see `APP_STORE_SCREENSHOT_PLAN.md`), description, keywords, support URL, marketing URL.
   - **App Privacy** questionnaire — answers in §5 below.
   - **Age rating** questionnaire.
   - **Privacy Policy URL** — host the text from `apps/<app>` Privacy screen (or a public page) and paste the URL.
   - Review notes: provide the demo logins from `APP_REVIEW_TEST_ACCOUNTS.md`.
4. **Submit for Review**.

## 4b) Apple Business Manager — the Check-in display AND kiosk

`customer-display` and `go-check-in-kiosk` are private in-salon iPad apps (no public listing, no end-user account). Distribute as a **Custom App**:
1. Create the app record in App Store Connect as above (bundle `com.aipowersalon.display`).
2. **Pricing and Availability** → distribution method → **Private / Custom App** → make available to your organization
   (and any client salon orgs) via **Apple Business Manager**.
3. Upload the build the same way (§3). It still goes through processing but is delivered privately through ABM, not the
   public store. See `CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION.md`.

---

## 5) App Privacy questionnaire — accurate answers

Use these (verify against your final data practices). Detail in `MOBILE_SECURITY_REPORT.md` / `EXPORT_COMPLIANCE_NOTES.md`.

- **Customer app** — *Data linked to the user*: Name, Email, Phone (account); Coarse Location (find-salons, when-in-use,
  used on-device for nearby search). Payment is processed by Fiserv/CardPointe — **no raw card data is stored by the app**.
  Account deletion is in-app (Profile ▸ Delete Account → `POST /customer/me/delete-account-request`); data export via
  `GET /me/privacy-export`.
- **Owner / Technician apps** — *Data linked to the user*: Name, Email, Phone (staff account). No location, no tracking.
  In-app **deactivation** request (`/owner|/tech/me/delete-account-request`).
- **Check-in display** — **no account, no personal data collected on device**; shows queue/now-serving via token-scoped
  public endpoints.
- **Tracking**: none of the apps use third-party ad tracking → answer **"No, we do not track."**
- **Export compliance**: `ITSAppUsesNonExemptEncryption=false` is already in each Info.plist → on upload, answer that the
  app uses only standard/exempt encryption (HTTPS). No CCATS / year-end self-classification needed.

---

## 6) CLI alternative to the Xcode version fields

```bash
cd apps/<app>/ios/App
xcrun agvtool new-marketing-version 1.0.0     # CFBundleShortVersionString
xcrun agvtool new-version -all 1              # CFBundleVersion (bump per upload)
```

---

## 7) Troubleshooting
- **"No account/team"** → §0.3 (sign Xcode into your Apple ID), then re-select Team in Signing.
- **"Missing app icon" / placeholder rejected** → already fixed; if you changed art, re-run
  `npx @capacitor/assets generate --ios` and re-archive.
- **App calls `localhost` / can't reach API on device** → `VITE_API_BASE` wasn't set at build time; rebuild (§2).
- **Bitcode errors** → Bitcode is deprecated; leave it off (Xcode default). Nothing to do.
- **Upload stuck "Processing"** → normal, up to ~30 min; TestFlight testers can't install until it finishes.
- **White screen on launch** → almost always the API base / network; check the WebView console (Safari ▸ Develop ▸ your
  device) and confirm HTTPS + CORS allow the app origin.

---

## 8) Suggested order
1. **Owner** app first (no permissions, simplest privacy answers) — shortest path to a successful TestFlight upload, proves
   your signing + pipeline end-to-end.
2. **Technician** (same simplicity).
3. **Customer** (adds the Location privacy answer + richer metadata).
4. **Check-in display** via ABM once the public three are flowing.

Each successful upload validates the next; once the first archives and uploads cleanly, the rest are the same steps with
different identifiers.
