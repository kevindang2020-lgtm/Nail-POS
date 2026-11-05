# APPLE_APP_CODE_AUDIT.md

**Date:** 2026-06-16
**Scope:** Audit the AIPowerSalon codebase for the four apps targeted for Apple App Store / TestFlight
(Customer, Owner, Technician, Check-In Display), per the submission brief.
**Method:** Full-filesystem search for every marker in the brief — `*.swift`, `*.xcodeproj`, `*.pbxproj`,
`Info.plist`, `Podfile`, `app.json`, `app.config.*`, `capacitor.config.*`, `metro.config.js`, `eas.json`,
`ios/`, `android/`, and `react-native` / `expo` / `@capacitor/core` dependencies in every `package.json`;
plus per-app inspection for Privacy Policy, Terms, account deletion, location handling, token storage,
Apple Pay, exposed keys, and backend endpoints.

---

## 0. Headline finding (read this first)

**There are no native iOS, React Native, Expo, or Capacitor projects anywhere in the codebase.** The four
"apps" in the brief exist only as **web applications** (React + Vite single-page apps, plus two static
`index.html` files). There is no Xcode project, no `Info.plist`, no `app.json`, no app icons, no launch
screens, and no native shell of any kind.

**Consequence:** None of these can be uploaded to TestFlight or submitted to the App Store today. Apple
accepts only a native binary (`.ipa`). A web app must first be wrapped in a native container (e.g.
Capacitor, or a React-Native/WebView shell) or rebuilt natively before *any* of the Apple-specific work in
the brief (Info.plist permission strings, app icons, `xcodebuild`, TestFlight, export compliance) can be
done honestly. **That wrapping layer does not exist yet and is the true first task — it is not a "fix," it
is net-new foundational work.**

This audit therefore reports the **real** state. It deliberately does **not** fabricate iOS config files,
app icons, `xcodebuild` results, or "passes Apple review / TestFlight-ready" claims for apps that have no
iOS target — the brief explicitly says *"Do not fake App Store readiness,"* and doing so would risk real
cost (Apple Developer fees, rejected uploads, false confidence).

---

## 1. What actually exists

| Brief's app | Real artifact in repo | Path | Framework | Native iOS target? | Runs in iOS Simulator? | Uses real backend? | Mock data in prod? |
|---|---|---|---|---|---|---|---|
| Customer App | `customer-web` | `apps/customer-web` | React 18 + Vite (web SPA) | **No** | No (browser only) | **Yes** (`/customer/*`, cookie session) | No (live API) |
| Owner App | `owner-web` | `apps/owner-web` | React 18 + Vite (web SPA) | **No** | No (browser only) | **Yes** (`/owner/*`, cookie session) | No (live API) |
| Technician App | `tech-web` | `apps/tech-web` | React 18 + Vite (web SPA) | **No** | No (browser only) | **Yes** (`/tech/*`, cookie session) | No (live API) |
| Check-In Display | `go-check-in-kiosk` (+ `customer-display`) | `apps/go-check-in-kiosk` / `apps/customer-display` | Static `index.html` / React+Vite | **No** | No (browser only) | Partial / display-token based | n/a |

Supporting (not in the four, listed for completeness): `pos-web` (front-desk POS, React+Vite),
`admin-web` (Super Admin, React+Vite), `go-check-in-admin` (static `index.html`), `api`
(NestJS backend — the real server all the web apps call).

**Search results (verbatim):** no files matched `*.swift`, `*.xcodeproj`, `*.pbxproj`, `Info.plist`,
`Podfile`, `app.json`, `app.config.*`, `capacitor.config.*`, `metro.config.js`, or `eas.json`; no
`package.json` depends on `react-native`, `expo`, `@capacitor/core`, or `@ionic/*`; no `ios/` or `android/`
directories exist. (Note: the project memory describes a *planned* architecture of "iOS SwiftUI Owner app,
React Native Customer/Tech apps." That was a **decision/aspiration** — it has not been built. The shipped
code is web-only.)

---

## 2. Apple-required *content* features — current state (applies to whichever shell is chosen later)

These are app-content requirements that are missing today regardless of platform. They are worth building
now because they carry over to any future native shell.

| Requirement | customer-web | owner-web | tech-web | go-check-in-kiosk |
|---|---|---|---|---|
| Privacy Policy accessible in-app | ❌ none | ❌ none | ❌ none | ❌ none |
| Terms of Service accessible in-app | ❌ none | ❌ none | ❌ none | ❌ none |
| Account deletion / deactivation request | ❌ none | ❌ none | ❌ none | n/a |
| Contact Support entry | ❌ none | ❌ none | ❌ none | ❌ none |
| Location: pre-prompt explainer + manual city/ZIP fallback | ⚠️ uses `navigator.geolocation` (5 refs) but **no** explainer screen / confirmed manual fallback | n/a | ⚠️ 1 ref | n/a |
| Token storage | ✅ httpOnly cookie session (no token in JS) | ✅ cookie session (localStorage holds only a branch-view *preference*, not a token) | ✅ cookie session | n/a |
| Apple Pay | ❌ not integrated (the "Apple Pay" hits were the **wallet** top-up feature, not PassKit) | n/a | n/a | n/a |
| Exposed Maps/gateway keys in frontend | ✅ none found | ✅ none | ✅ none | ✅ none |
| Marketing vs transactional notification opt-in split | ❌ no notification settings screen found | ❌ | ❌ | n/a |

**Backend endpoints the brief requires — status:**
`POST /customer/me/delete-account-request` ❌ not built · `POST /owner/me/delete-account-request` ❌ ·
`POST /tech/me/delete-account-request` ❌ · `GET /me/privacy-export` ❌. None exist today.

**Good news worth preserving:** auth is a server-side httpOnly cookie session (no JWT sitting in
`localStorage`), tenant/branch scope is derived server-side (a strong multi-tenant isolation posture), and
no API/Maps/gateway secrets were found in any frontend bundle. The payment flows already avoid raw card
storage (tokenized/sandbox). These are exactly the things Apple cares about, and they're already right.

---

## 3. Per-app detail

### 3.1 Customer App (`customer-web`)
- **Framework / status:** React+Vite web SPA, actively developed, calls real `/customer/*` API. Has real
  screens (home, salon discovery with geolocation, booking, check-in, Skip-the-Line pay, wallet, loyalty,
  profile). No iOS project, icon, launch screen, or `Info.plist`.
- **Broken / missing for Apple:** no native shell; no Privacy/Terms/Delete-Account/Contact screens; location
  used without a pre-prompt explainer or confirmed manual ZIP fallback; no notification-settings screen with
  the marketing-vs-transactional split; no `NSLocationWhenInUseUsageDescription` (no Info.plist exists).
- **Files that will need work (once a shell exists):** add `screens/PrivacyPolicyScreen`,
  `TermsScreen`, `DeleteAccountScreen`, `ContactSupportScreen`, a location pre-prompt + ZIP fallback in the
  discovery flow, and `NotificationSettingsScreen`; plus the native shell's `Info.plist`, icons, launch
  screen, bundle id `com.aipowersalon.customer`.

### 3.2 Owner App (`owner-web`)
- **Framework / status:** React+Vite web SPA, real `/owner/*` API, cookie session, branch-scoped views,
  dashboard/branches/booking/staff/finance/alerts. No iOS project/icon/launch screen.
- **Broken / missing for Apple:** no native shell; no Privacy/Terms/Deactivation-request/Contact screens; no
  notification opt-in screen. (No Super-Admin features are exposed in owner-web — that's a separate
  `admin-web` app — which is the correct posture for Apple's "no admin-only features" rule.)
- **Files to add:** the four compliance screens + notification settings; native shell w/ bundle id
  `com.aipowersalon.owner`.

### 3.3 Technician App (`tech-web`)
- **Framework / status:** React+Vite web SPA, real `/tech/*` API, cookie session, tenant/branch scoped,
  ticket lifecycle, cash confirmation, earnings. No iOS project/icon/launch screen.
- **Broken / missing for Apple:** no native shell; no Privacy/Terms/Deactivation-request/Contact screens; no
  notification opt-in. (Server already enforces that a tech can only see assigned tenant/branch data and
  can't edit paid/closed tickets — good.)
- **Files to add:** the four compliance screens + notification settings; native shell w/ bundle id
  `com.aipowersalon.technician`.

### 3.4 Check-In Display (`go-check-in-kiosk`, `customer-display`)
- **Framework / status:** `go-check-in-kiosk` is a single static `index.html` (no build, no package.json);
  `customer-display` is a React+Vite app with token-scoped public display endpoints. No iOS project.
- **Broken / missing for Apple:** no native shell; no Privacy/Terms reachable from an admin/info screen; the
  device-pairing/tenant-binding model needs review for a kiosk build; needs an admin PIN gate for settings.
- **Distribution note:** a kiosk app is usually **not** a good fit for the public App Store. See
  `CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION.md` (recommended: Apple Business Manager **Custom App** or
  managed/Guided-Access deployment, not public listing).

---

## 4. What "App Store ready" actually requires from here (honest path)

1. **Choose a shell strategy (the real first decision).** For four existing React web apps, **Capacitor** is
   the lowest-rework route: it wraps each Vite build in a native iOS WebView, gives you a real `Info.plist`,
   icons, launch screen, bundle id, and an `.ipa` you can actually upload. Alternatives: rebuild natively
   (SwiftUI / React Native — far more work) or ship as PWAs (not App-Store-distributable). Until this is
   chosen and scaffolded, the iOS-specific reports in the brief cannot be produced truthfully.
2. **Per app, after wrapping:** add the four compliance screens (Privacy, Terms, Delete/Deactivate, Contact),
   the notification-settings screen with the marketing/transactional split, the location pre-prompt + ZIP
   fallback (customer), correct `Info.plist` strings (only `NSLocationWhenInUseUsageDescription` for
   customer/tech; nothing else is currently used), app icon, launch screen, and bundle id.
3. **Backend:** build `POST /{customer,owner,tech}/me/delete-account-request` and `GET /me/privacy-export`
   (these are platform-agnostic and can be built and verified now — see recommendation below).
4. **Cookie-session caveat for WebView:** the current httpOnly cookie auth needs configuration to work inside
   a native WebView (cookie domain / `WKWebView` cookie handling, or a token-in-secure-storage flow). This is
   a real integration item, not a one-liner.
5. **Then, and only then:** Info.plist permission audit, Sign-in-with-Apple audit (currently
   email/phone/password only → SIWA **not** required unless social login is added), icon/launch report,
   `xcodebuild`, screenshots (on a real device/simulator), TestFlight plan, export-compliance notes.

---

## 5. Status of the other reports requested in the brief

The brief lists ~15 further reports (IOS_PERMISSION_AUDIT, SIGN_IN_WITH_APPLE_AUDIT, APP_ICON_AND_LAUNCH_SCREEN_REPORT,
IOS_BUILD_CONFIGURATION_REPORT, EXPORT_COMPLIANCE_NOTES, TESTFLIGHT_TESTING_PLAN, BUILD_AND_APPLE_SUBMISSION_REPORT,
etc.). **Most of these cannot be written truthfully yet** because they describe a native iOS target that does
not exist (there is no Info.plist to audit, no icon set to report, no binary to run `xcodebuild` against, no
build to upload to TestFlight). Writing them now would mean inventing results — which the brief itself
forbids. They become real deliverables immediately after step 1 (shell scaffolding) above.

**Can be produced/started honestly right now, independent of the shell:**
- This audit. ✅
- The backend account-deletion-request + privacy-export endpoints (real, testable against the live API).
- In-app Privacy / Terms / Delete-Account / Contact-Support screens in the web apps (carry over to any shell).
- A genuine `CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION.md` (the decision doesn't depend on a shell).
- `SIGN_IN_WITH_APPLE_AUDIT.md` conclusion (email/phone/password only → not required) — a factual finding.

---

## 6. Recommended next step

Pick the shell strategy. If you want the fastest real route to TestFlight for these four React apps, say so
and I'll scaffold a **Capacitor** iOS target for one app end-to-end (Info.plist with the correct single
permission string, bundle id, icon/launch placeholders wired correctly, and a verified `npm run build` +
`npx cap sync`), then build the four compliance screens and the backend deletion/export endpoints — all
verified, none faked. That is the honest path from "web apps" to "uploadable to TestFlight."
