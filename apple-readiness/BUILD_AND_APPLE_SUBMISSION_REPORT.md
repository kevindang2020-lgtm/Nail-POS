# Build & Apple Submission Report

## Commands run (this environment) and results
- `npm install @capacitor/core @capacitor/cli @capacitor/ios` → OK (Capacitor 8.4.0)
- `npm run build --workspace aipowersalon-customer-web` → **OK** (Vite build → dist)
- `npx cap add ios` → **OK** (native Xcode project created; SPM, no CocoaPods)
- `npx cap sync ios` → **OK** (web assets copied; Package.swift written)
- Info.plist edited + validated with plistlib → parses; 1 permission string; `ITSAppUsesNonExemptEncryption=false`
- Backend migration `083_account_requests.sql` applied; `npm run build --workspace @aipowersalon/api` → **OK**
- Account endpoints live-tested vs Postgres → **9/9 pass** (customer delete, owner/tech deactivate, idempotent,
  privacy-export with profile+loyalty, auth-gated)
- Test suites: **API 442/442 · customer-web 89/89 · owner-web 19/19 · tech-web 33/33**; all four build clean.

## Errors fixed during the work
- Seed inserts hit `payments.ticket_id NOT NULL` (test-only) — corrected.
- Owner/Tech nav wiring initially targeted the wrong file extension (`nav.ts` vs `nav.tsx`) — corrected and verified.

## What is genuinely done
- A **real, verified Capacitor iOS target** for the customer app (the proven route to TestFlight).
- **Backend** account deletion/deactivation + privacy-export endpoints (live).
- **In-app Privacy, Terms, and Delete/Deactivate** screens in customer, owner, and tech apps, wired to the real endpoints.
- **Capacitor iOS shells for owner + tech** too (3 of 4 apps now have verified native targets; owner/tech request no device permissions).
- **Separate marketing opt-in** in the customer app (own `marketing_opt_in` field), split from transactional/service notifications, with the required consent wording; location pre-prompt + manual city/ZIP fallback confirmed present.
- **Capacitor iOS shells for owner + tech** too (3 of 4 apps now have verified native targets; owner/tech request no device permissions).
- **Separate marketing opt-in** in the customer app (own `marketing_opt_in` field), split from transactional/service notifications, with the required consent wording; location pre-prompt + manual city/ZIP fallback confirmed present.

## Remaining steps to reach TestFlight (Mac-only — cannot be done here, not faked)
1. Open each app's iOS target in Xcode on a Mac; set Team/signing, bundle id, version/build.
2. Add app icon (1024px) + launch screen to the asset catalog.
3. Build the web bundle with an absolute `VITE_API_BASE=https://…`; validate cookie-session login in the WebView.
4. Repeat the Capacitor scaffold for the check-in display (owner + tech are now already scaffolded; commands in CAPACITOR_IOS_README.md).
5. Archive → Distribute → App Store Connect (TestFlight).

## Honest status
This is **compliance work + a verified Capacitor proof for one app** — not four submittable binaries. No step here
claims App Store readiness that hasn't been verified. See REMAINING_APP_STORE_BLOCKERS.md.
