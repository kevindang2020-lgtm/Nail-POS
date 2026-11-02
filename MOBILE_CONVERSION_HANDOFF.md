# AI PowerSalon — Mobile Conversion Handoff

**For:** the development team picking this up next.
**Decision being handed off:** convert the native-app-candidate frontends to real iOS/Android apps; **pos-web stays a web app** (the salon front-desk system — see the hardware note in §0 below, since the target device just changed). This document is the full technical brief — current state, what's already done, what's genuinely left, what the developer needs from Kevin, and a phased plan.

---

## 0. Hardware update: POS terminal is now a Dell, not an iMac

Kevin is no longer using an iMac for the front-desk POS — the iMac has no touchscreen. The POS hardware is now a **Dell 24 All-in-One EC24250 Touch** — a genuine touchscreen, running **Windows**, not macOS.

What this changes:
- **Target OS/browser for pos-web is now Windows (Edge/Chrome)**, not macOS/Safari. This is a simpler target in practice — mainstream Chromium-based browsers on Windows have fewer of the WebKit-specific quirks Safari brings.
- **Touch is now real, not simulated.** Prior guidance treated a tap as "click, since no touchscreen iMacs exist" — that assumption is gone. pos-web's UI was already built with touch in mind (≥48pt targets, immediate pressed feedback), so no rebuild is expected, but this is now genuinely testable end-to-end on the actual hardware rather than assumed: multi-touch behavior, on-screen keyboard interaction, and any hover-dependent UI (tooltips, hover-to-reveal actions) should be checked for touch-only use, since Windows touchscreens have no true "hover" state the way a trackpad does.
- **Screen size target is unchanged** (still 24") — the design/layout work already done for a 24" display carries over; this is a display and input-method change, not a size change.

**Important — do not confuse this with the Mac required for iOS builds (§6).** That's a completely separate requirement: Apple requires a Mac with Xcode to build, sign, and submit iOS apps, regardless of what hardware runs the POS. Switching the salon's POS terminal to a Dell does not remove or reduce that need — the development team still needs its own Mac for the iOS side of this project.

---

## 1. The most important fact: this isn't a cold start

The codebase already anticipated this pivot. Five of the seven customer-facing frontends are **pre-wired with Capacitor**, and their own config files say so in plain comments:

```
apps/owner-web/capacitor.config.ts:
  // AIPowerSalon owner-web — iOS shell (Capacitor). Wraps the Vite build (dist) in a native WKWebView.
```

Identical framing exists in `tech-web`, `customer-web`, `customer-display`, and `manager-pay-web`. `@capacitor/ios` and `@capacitor/android` (v8.4.0) are already listed as dependencies in all five. There's a root-level `ANDROID_SUBMISSION_RUNBOOK.md` and a whole `apple-readiness/` folder (14 documents: code audit, permission audit, App Store metadata drafts, TestFlight plan, accessibility review, reviewer test accounts, export-compliance notes, and more). **Read `apple-readiness/REMAINING_APP_STORE_BLOCKERS.md` first** — it's a prior honest gap-list and most of it is still accurate.

**One honest caveat the incoming developer must know:** the generated native project folders (`apps/<app>/ios/`, `apps/<app>/android/` — the actual Xcode/Android Studio projects that `npx cap add ios/android` produces) are **not present in this delivered codebase**, even though the docs describe them as generated and verified. That work was almost certainly done in a prior session on a machine with Xcode/Android Studio (this development environment cannot run either — no macOS, no Xcode, no Android SDK/emulator). The Capacitor *config* and *dependencies* are real and correct; the native *projects* need to be (re)generated. That's genuinely a 10-minute task per app (`npx cap add ios && npx cap add android` from each app's folder, after `npm run build`), not a rewrite — but don't assume they already exist.

## 2. What does NOT change

This is the most reassuring part, and worth saying plainly: **the backend does not change at all.** The NestJS API, PostgreSQL database, all business logic, authentication, RBAC, tenant/branch isolation, the revenue-split and surcharge engines, the compensation system — every migration, every service, every test — is completely framework-agnostic. A native Capacitor shell talks to the exact same REST API a browser does. Converting the frontend to a native shell is additive work on top of the existing apps, not a re-platform of the product.

## 3. Target-platform decision, app by app

| App | Current stack | Screens / ~LOC | Recommended target | Why |
|---|---|---|---|---|
| **pos-web** | Vite, no Capacitor | 177 screens / ~46,500 | **Stays web** | Explicit ask. Salon front-desk system, now running on a **Dell 24 All-in-One EC24250 Touch** (Windows, real touchscreen) — see §0. Largest app in the repo — staying web avoids by far the biggest conversion cost. |
| **admin-web** (Super Admin) | Vite, no Capacitor | 143 screens / ~51,500 | **Recommend: stays web** — *flagging for your decision* | You said "keep web app for POS system only," which is ambiguous about Super Admin. It's dense data tables and charts built for a 24" desktop display (your own internal ops tool, not a customer-facing app) — a poor fit for a phone screen, and at 51.5K lines it would be by far the most expensive conversion in this list. My recommendation is it stays web like POS. Confirm before work starts — this is the single highest-cost decision in the whole plan if it goes the other way. |
| **owner-web** | Vite + Capacitor (pre-wired) | 41 screens / ~10,800 | **iOS + Android** | Already scaffolded as an "iOS shell" per its own config. Public store app. |
| **tech-web** | Vite + Capacitor (pre-wired) | 25 screens / ~6,750 | **iOS + Android** | Same. Public store app (technicians). |
| **customer-web** | Vite + Capacitor (pre-wired) | 66 screens / ~12,200 | **iOS + Android** | Same. Public store app — largest of the five native candidates. |
| **manager-pay-web** | Vite + Capacitor (pre-wired) | 8 screens / ~2,600 | **iOS + Android** | Smallest native candidate, but carries the Tap-to-Pay native plugin work (see §5). |
| **customer-display** | Vite + Capacitor (pre-wired) | (queue board, no screen-routed UI) / ~1,800 | **iOS only, private distribution** | Existing docs (`CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION.md`) already conclude this ships via Apple Business Manager to salon-owned iPads, not the public App Store. No end-user account; token-scoped public endpoints. Lowest priority. |
| **go-check-in-kiosk** / **go-check-in-admin** | Capacitor / static HTML | kiosk front-desk devices | **Stays as-is (kiosk shell)** | Already device-bound, not a public app. Not part of this conversion — separate concern if it needs updates. |

## 4. What's genuinely already done (per the existing docs — verify, don't redo)

Read these in full before writing any code; they're detailed and mostly still current:

- **`apple-readiness/MOBILE_SECURITY_REPORT.md`** — WebView session/cookie handling, no secrets in the frontend bundle, `Origin`-header-based token issuance (the API allowlists the native scheme).
- **`apple-readiness/IOS_PERMISSION_AUDIT.md`** — camera/location/etc. permission strings already reviewed. Per `REMAINING_APP_STORE_BLOCKERS.md`, the customer app's location pre-prompt explainer and manual city/ZIP fallback on denial are confirmed present.
- **`apple-readiness/APPLE_APP_CODE_AUDIT.md`**, **`SIGN_IN_WITH_APPLE_AUDIT.md`** (concluded not required), **`EXPORT_COMPLIANCE_NOTES.md`** (standard TLS, flag already set).
- **`apple-readiness/APP_REVIEW_TEST_ACCOUNTS.md`**, **`APP_STORE_METADATA_DRAFTS.md`**, **`APP_STORE_SCREENSHOT_PLAN.md`**, **`TESTFLIGHT_TESTING_PLAN.md`** — drafted; some entries need a real binary to finalize.
- **`ANDROID_SUBMISSION_RUNBOOK.md`** — the exact per-app Play Store build/signing steps, with `applicationId`s already assigned (e.g. `com.aipowersalon.owner`, `com.aipowersalon.customer`, `com.aipowersalon.technician`, `com.aipowersalon.display`).
- **Face ID scaffolding** — `src/auth/native-faceid.ts` exists in owner-web, tech-web, customer-web, and manager-pay-web. Per prior verification, WebAuthn is mounted and the real verifier fails closed, but **it ships disabled by a feature flag** (`FACE_ID_ENABLED` off). Enabling it is a config change, not a code change — see `FACE_ID_ENABLEMENT_RUNBOOK.md`.
- **Tap-to-Pay groundwork** — `manager-pay-web`'s Capacitor config already notes the requirement: *"Tap to Pay on iPhone requires the Apple entitlement (PSP = Fiserv) + the native FiservTTP plugin, both added in Xcode on a physical device."* The backend adapter (`api/src/mobile-checkout/fiserv-commercehub-ttp.adapter.ts`) is a deliberate throwing skeleton waiting on your CommerceHub sandbox credentials — this is the same standing blocker from the payments work, and it now also gates the native Tap-to-Pay plugin integration specifically.

## 5. What's genuinely still required (real work, not busywork)

From `apple-readiness/REMAINING_APP_STORE_BLOCKERS.md`, cross-checked against the current tree:

1. **Regenerate the native projects.** `npx cap add ios` and `npx cap add android` per app (owner-web, tech-web, customer-web, customer-display, manager-pay-web), then `npx cap sync`. Requires a Mac with Xcode for the iOS side; Android Studio (any OS) for Android.
2. **Real app icons and launch screens.** Docs say placeholders only — needs actual asset-catalog assets on a Mac.
3. **Absolute production API base.** Every app's Capacitor config comment repeats this: a native WebView can't use relative `/owner`, `/customer`, etc. paths — `VITE_API_BASE` must be an absolute `https://` URL at build time. This needs your production hosting domain decided first.
4. **Push notifications.** APNs (iOS) and FCM (Android) aren't wired yet — needs your Apple/Firebase push credentials, then real device-token registration + send paths on the backend (which doesn't have push infrastructure yet — this is new backend work, not a frontend wrapper task).
5. **Tap-to-Pay native plugin** (manager-pay-web only) — the FiservTTP Xcode plugin + Apple's Tap-to-Pay entitlement, both added directly in Xcode on a physical device. Blocked on your CommerceHub sandbox credentials (existing standing blocker) plus a new Apple entitlement request.
6. **Face ID enablement** — flip `FACE_ID_ENABLED` on per the runbook once you're ready; low effort, already built.
7. **Kiosk polish** (lower priority, private-distribution devices) — Privacy/Terms on an admin/info screen, staff-PIN settings gate, device-pairing review.
8. **Finalize the binary-dependent reports** — several `apple-readiness/` docs (build-configuration report, final screenshot set, some metadata fields) can only be honestly completed once a real signed build exists.

## 6. What the developer needs from you before/during this work

These are genuine external dependencies — no amount of code can substitute for them:

- **Apple Developer Program enrollment** ($99/yr) **and a Mac with Xcode** — required for any iOS signing, archiving, or App Store/TestFlight upload. This is the single hard blocker for the entire iOS side. (This is the development team's own Mac, unrelated to the POS terminal hardware — see §0.)
- **Google Play Console account** ($25 one-time) for the Android side.
- **APNs push certificate/key** and a **Firebase project (FCM)** for Android push.
- **Production hosting + a real domain** with an HTTPS API base — needed before any native build can be finalized (see item 3 above).
- **Twilio + A2P 10DLC registration** (SMS) and **SendGrid** (email) — if not already live, these gate any in-app messaging that reaches real phones/inboxes.
- **CommerceHub sandbox credentials** — the standing blocker from the payments work; now also gates the Tap-to-Pay native plugin specifically.
- **A decision on Super Admin** (§3 above) before that work is scoped.

## 7. Recommended approach: keep Capacitor, don't rewrite in React Native

Worth stating explicitly since "convert to iOS and Android" could be read either way. The existing architecture (Capacitor wrapping the same React/Vite app in a native WebView shell) is the right call to continue, not restart as a React Native rewrite:

- **The business logic doesn't move.** Screens, API clients, forms, state — all of it is reused as-is. A React Native rewrite means re-implementing all ~32,000 lines across these five apps in a different UI framework, by hand, with new bugs to find.
- **Native capability where it matters is still available.** Face ID/biometrics, Tap-to-Pay, camera, push notifications — all go through real native plugins (Capacitor's own, or a custom plugin like FiservTTP) called from the same JS/TS code. Capacitor apps are not "just a browser tab" — they're compiled native app bundles with a WebView as the UI layer, indistinguishable to users from Play Store review guidelines standpoint when done correctly (which the `apple-readiness/` audits already confirm for this codebase).
- **The cost/quality tradeoff favors Capacitor here.** These are CRUD-heavy business apps (forms, lists, dashboards) — not games or apps needing 60fps custom animation, where React Native or fully-native code would matter more. For this kind of app, Capacitor is standard industry practice and Apple/Google both accept it in the stores (verified by your own `apple-readiness/APPLE_REVIEW_COMPLIANCE_CHECKLIST.md`).

If there's a specific reason you want true React Native or fully-native Swift/Kotlin (a particular native UI feel, a specific SDK Capacitor can't wrap), say so — that's a materially different, larger engagement, and worth deciding explicitly rather than defaulting into it.

## 8. Suggested phased plan

**Phase 1 — Foundation (no store dependency, can start immediately):**
Decide the Super Admin question (§3). Stand up production hosting + domain + absolute API base. Regenerate the five apps' native projects. Get real app icons/launch screens made.

**Phase 2 — Core native capability:**
Wire push notification infrastructure (backend device-token registration + send + APNs/FCM). Enable Face ID per the existing runbook. Confirm WebView session/token handling end-to-end on a real device for each app.

**Phase 3 — Payments-specific (manager-pay-web):**
Once CommerceHub sandbox credentials exist: finish the Fiserv adapter, add the FiservTTP Xcode plugin, request the Apple Tap-to-Pay entitlement, test on a physical iPhone (Tap-to-Pay cannot be tested in a simulator).

**Phase 4 — Store submission:**
Follow `ANDROID_SUBMISSION_RUNBOOK.md` and `apple-readiness/IOS_SUBMISSION_RUNBOOK.md` step by step. Fill in the binary-dependent reports. TestFlight beta (plan already drafted) before public release.

**Phase 5 — Kiosk polish** (customer-display, go-check-in-kiosk): lower priority, can run in parallel with any phase above since it's private-distribution, not store-gated.

## 9. Team & skills needed

- A developer comfortable with Capacitor + iOS/Android build tooling (Xcode, Android Studio, signing/provisioning) — this is more "mobile build & release engineering" than "learn a new UI framework," since the React/TypeScript code is unchanged.
- Access to a Mac for all iOS work (non-negotiable — Apple requires it).
- Backend work for push notifications (device-token storage, APNs/FCM send integration) — regular NestJS/Kysely work, same patterns as the rest of the API.
- No new design work needed beyond real app icons/launch screens — the existing cream/gold/orange design system and screens carry over unchanged into the native shells.

## 10. Open questions to resolve with Kevin before work starts

1. Does Super Admin (`admin-web`) also convert to native, or stay web alongside POS? (Recommendation: stay web — see §3.)
2. Is a true React Native / fully-native rewrite wanted instead of continuing with Capacitor? (Recommendation: no — see §7.)
3. Timeline/budget for the external dependencies in §6 (Apple/Google accounts, a Mac, push credentials, hosting) — these gate real calendar time regardless of engineering speed.
4. Should `customer-display` and the kiosk apps be in scope for this phase, or deferred (they're private-distribution, lower urgency)?

---

*This document is a companion to the existing `apple-readiness/` folder and `ANDROID_SUBMISSION_RUNBOOK.md` — it summarizes and orients; those documents remain the detailed source of truth for their respective platforms.*
