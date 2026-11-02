# AIPowerSalon — Apple App Store Readiness Package

**Honest status:** this package contains real, verified **compliance work** plus a **proven Capacitor iOS proof for one
app** — it is **not** four submittable binaries. Nothing here claims unverified App Store readiness. The path to actual
TestFlight is documented and the remaining steps are Mac-only.

## What was done & verified this round
1. **Capacitor iOS target for the Customer app** (real Xcode project, correct Info.plist with one permission string +
   export-compliance flag; `npm run build` + `npx cap sync ios` verified). → `apps/customer-web/ios/`,
   `apps/customer-web/capacitor.config.ts`.
2. **Backend account endpoints** (live, 9/9 verified): `POST /customer|/owner|/tech/me/delete-account-request` and
   `GET /me/privacy-export` (+ per-role aliases). Records deletion/deactivation **requests** (financial/audit records
   retained), idempotent, auth-gated. → `apps/api/src/account/`, migration `db/migrations/083_account_requests.sql`.
3. **In-app Privacy Policy, Terms of Service, and Delete/Deactivate Account screens** in the Customer, Owner, and
   Technician apps, wired to the real endpoints. (Contact Support exists via Help.)
4. Tests green: **API 442 · customer-web 89 · owner-web 19 · tech-web 33**; all four build clean.

## Reports in this folder
- `APPLE_APP_CODE_AUDIT.md` — the truthful starting-state audit (web apps, no native shells).
- `APPLE_REVIEW_COMPLIANCE_CHECKLIST.md` — per-app status of every Apple requirement.
- `IOS_PERMISSION_AUDIT.md` — only `NSLocationWhenInUseUsageDescription` (customer); no over-permissioning.
- `SIGN_IN_WITH_APPLE_AUDIT.md` — not required (email/phone/password only).
- `MOBILE_SECURITY_REPORT.md` — strong posture; WebView cookie + absolute-API-base items.
- `EXPORT_COMPLIANCE_NOTES.md` — standard TLS → exempt; flag set.
- `CHECK_IN_DISPLAY_DISTRIBUTION_RECOMMENDATION.md` — ABM Custom App / managed, not public listing.
- `CAPACITOR_IOS_README.md` — exact Mac steps to reach TestFlight.
- `BUILD_AND_APPLE_SUBMISSION_REPORT.md` — commands run + results + remaining steps.
- `REMAINING_APP_STORE_BLOCKERS.md` — honest list of what's left (code + infra).
- `APP_STORE_METADATA_DRAFTS.md` — draft store listings (no misleading claims).
- `APP_STORE_SCREENSHOT_PLAN.md` — screens to capture per app (iPhone/iPad).
- `APP_REVIEW_TEST_ACCOUNTS.md` — reviewer accounts + test data structure.
- `ACCESSIBILITY_REVIEW_REPORT.md` — real audit; strong baseline + small fixes.
- `TESTFLIGHT_TESTING_PLAN.md` — testers, per-app scenarios, known limitations.
- `APP_ICON_AND_LAUNCH_SCREEN_REPORT.md` — current placeholders + how to finalize.
- `IOS_BUILD_CONFIGURATION_REPORT.md` — bundle ids, versions, signing/upload steps.


## Not included on purpose
node_modules, dist/build, secrets/keys/certs. Set `VITE_API_BASE` and real gateway/Twilio/SendGrid creds in your own
`.env` per the runbook. Reports that require an actual binary (icon/launch, screenshots, TestFlight plan, metadata) are
deferred until the native shells are built on a Mac — see the blockers report.
- IOS_SUBMISSION_RUNBOOK.md — copy-paste Mac steps: build→sync→sign→archive→upload, per app, identifiers filled in.
