# DEVELOPER_HANDOFF_FINAL_2026-10-28.md — AIPowerSalon: the code is finished, here is what is left

**For:** Kevin (owner) and Kevin's developer. **Branch:** `merge-github-main` (HEAD = the commit printed in
`PACKAGE_MANIFEST.txt` inside the package). **Host of record:** Railway (`DEPLOYMENT.md`). **Nothing has been pushed to
GitHub** — pushing is step 6 of the K-12 incident sequence and waits for steps 1–5 (§4 below).

This document is the one place to start. It replaces nothing — it points to the canonical documents and says, in order,
what to do. Variable **names** only; never a value (`SECRETS_REQUIRED.md` rule).

---

## 1. What you are receiving

| File in the package | What it is |
|---|---|
| `aipowersalon-2026-10-28-<sha>.tar.gz` | the full source tree at HEAD (`git archive`) — no `node_modules`, no `dist`, no secrets, no `.git` |
| `aipowersalon-2026-10-28-<sha>.bundle` | the complete git history of `merge-github-main` (`git bundle`) — `git clone aipowersalon-….bundle aipowersalon` gives the developer the real repository with every commit |
| `SHA256SUMS.txt` | checksums of both — verify before unpacking: `sha256sum -c SHA256SUMS.txt` |
| `PACKAGE_MANIFEST.txt` | HEAD sha, file count, how the package was made |

Prefer the **bundle** (full history, blame, the commit map) and keep the tarball as the plain copy.

```bash
sha256sum -c SHA256SUMS.txt
git clone aipowersalon-2026-10-28-<sha>.bundle aipowersalon && cd aipowersalon
git checkout merge-github-main
npm ci --ignore-scripts            # ALWAYS --ignore-scripts for this repository (START-HERE.md §2)
npm run build:packages && npm run build:modules && npm run build:api
VITE_API_BASE=https://<api-domain> npm run build:frontends
```

Read next, in this order: `START-HERE.md` → `DEPLOYMENT.md` (how a release works: one image, two entry points,
pre-deploy migrate, health, rollback) → `EXTERNAL_SETUP_CHECKLIST.md` (X-1 … X-19, every outside account) →
`docs/HOSTING_ACTIONS_FOR_KEVIN.md` (what only the account owner can click) → `BUG_REGISTER.md` (K-05 … K-13 open) →
`NEXT_STEPS.md` §0 (FST-1 … FST-9).

## 2. State of the code (Oct 28 2026)

- 10 apps (Front Desk POS, Owner, Tech, Customer, Manager / Tap to Pay, Super Admin, Customer Display, Go Check-In
  kiosk, public booking page, the API), 27 domain modules, 21 shared packages, 647 migrations (all applied on PostgreSQL
  16 in the Oct 28 full-system test), 3,126 API routes with an OpenAPI manifest.
- Today's work (all on this branch, all documented in `docs/mandates/status/`): Checkout, Service Done, Serving, Customer
  Queue, Overview, Check-In and Live Operations rebuilt to the 27-inch one-screen mandates (every module kept, every quick
  action wired, server-authoritative state, before / after measurements and E2E in `tooling/checkout-one-screen/`); then
  the whole-repository pilot scan — `docs/pilot-runs/2026-10-28/PILOT_SCAN_REPORT.md`.
- Pilot scan verdict: **27 / 27 modules wired, every controller registered, 0 dead screens, 0 unhandled buttons, 7 / 7
  frontends compile, 170 / 170 environment variables documented**; 12 dead navigation links fixed; **2 real defects fixed**
  (stale CSP hashes that would have blocked the booking page and the kiosk from bootstrapping on deploy; one unreviewed
  push notification); 738 more unit spec files exercised — 634 pass here, 104 need the real vitest / Nest runtime (none
  failed on product logic when read).
- Verdict line (unchanged since Oct 10 and still true): **CODE_READY_FOR_DEVELOPER_HANDOFF = YES · PRODUCTION_READY = NO.**
  Production readiness is gated by the owner actions in §4–§6, not by code.

What is deliberately **not** in the code and never will be: raw card numbers (CardPointe tokens only), a print feature,
a "V2" of any screen, Vietnamese anywhere but the Front Desk POS, a duplicate of a salon feature.

## 3. Still open IN the code (developer, with a real `npm ci`)

These are verification steps the offline build environment could not run, not known bugs. From `NEXT_STEPS.md` §0:

| # | What | Command / where | Done when |
|---|---|---|---|
| FST-1 (P0) | Full gate run on a real toolchain | `npm ci --ignore-scripts` → `npm run typecheck` → `npm run ci:gates` → `npm run ci:test:{packages,modules,apps,api}` → `npm run ci:test:race` → pilot day on a fresh DB (`TEST_RESULTS.md` §7) | every gate green; the 12 environment-bound gates in `TEST_REPORT.md` run for real; the 104 harness-limited specs in `docs/pilot-runs/2026-10-28/unit-sweep-remaining.tsv` green under vitest |
| FST-7 (P2) | 27-inch EN / VI POS pilot run on this commit, in branded Chrome **and Edge**, on the physical touchscreen | `docs/pilot-runs/<date>/`; harness `tooling/checkout-one-screen/` (`build.mjs`, `measure.mjs PAGE=…`, `interact-*.mjs`) | one-screen matrix on the real monitor; touch targets by hand |
| FST-9 (P3) | only if the stand-in harness is reused | run each spec from its package directory | — |
| i18n | Vietnamese review | `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` sections A1 … A34 — a Vietnamese-speaking reviewer approves the new strings (next section is A35) | reviewer initials on each section |
| CSP | whenever an `index.html` inline script / style changes | `node apps/api/scripts/generate-app-headers.mjs` and commit the `_headers` files (CI's `app-headers.vitest.spec` fails otherwise) | spec 22 / 22 |
| Vite | production builds of the 7 React apps | `VITE_API_BASE=… npm run build:frontends` | `dist-frontends/<app>` for each |

Decisions already made that look like gaps but are rulings (`BUG_REGISTER.md`): K-05 per-salon staff logins, K-07 no
success envelope, K-08 app-sealed provider secrets, K-09 `useRealtime` + `load()` instead of a cache library, K-10
booking deposits = setting only (no money), K-11 technicians may sign into the POS.

## 4. FIRST — the K-12 security sequence (Kevin's developer, before anything is pushed or deployed)

`SECURITY_REMAINING_ACTIONS.md` §A, in this order; nothing else is deployed before it is done:

1. Rebuild the developer machine that held the exposed material (no restore of the old home directory).
2. Rotate **every** credential in `SECRETS_REQUIRED.md` and every provider key — CardPointe, CommerceHub, Twilio,
   SendGrid, AI, Google, AWS — new values only in the host's secret store (Railway variables). Never in the repo, never in
   chat, never in a document.
3. Revoke the exposed Firebase service-account key; issue a new one (`FCM_SERVICE_ACCOUNT_JSON` or `FCM_SERVICE_ACCOUNT_B64`).
4. New Google Play upload key.
5. New database password; close port 5432 to the internet (private networking only).
6. Only then push the rewritten history: `git push https://github.com/kevindang2020-lgtm/Nail-POS merge-github-main:main`
   (`docs/COMMIT_MAP_K12_REWRITE.md`); gitleaks full-history must be clean.
7. Remove `continue-on-error` from the gitleaks CI job.

Do not rotate live secrets, reissue keys or force-push without Kevin's explicit approval of each step.

## 5. Hosting (Kevin + developer) — `DEPLOYMENT.md`, `docs/HOSTING_ACTIONS_FOR_KEVIN.md` §A

1. Railway project: PostgreSQL 16 (private), API service from the `Dockerfile` (`railway.json`: pre-deploy
   `node scripts/db-preflight.mjs && node scripts/migrate.mjs`, start `node dist/main.js`, health `GET /health/ready`),
   later a worker service (`railway.worker.json`, `node dist/worker.js`) and Redis before a second API replica.
2. Variables: `DATABASE_URL` (+ `MIGRATE_DATABASE_URL`, `PG_WORKER_DATABASE_URL`), `AUTH_SESSION_SECRET`,
   `SERVICE_TOKEN_SECRET`, `PAYMENT_ENC_KEY`, `PROVIDER_VAULT_KEK` (≥ 32 chars), `NODE_ENV=production`, `APP_BASE_URL`,
   `PUBLIC_API_BASE_URL`, `WEB_CORS_ORIGINS` (every app origin), `DB_TENANT_RLS=1`, `DB_TENANT_RLS_STRICT=1`,
   `RATE_LIMIT_STORE` + `REDIS_URL` when more than one replica. Full list with meaning: `DEPLOYMENT.md` §6,
   `ENV_INVENTORY.md`, `SECRETS_REQUIRED.md`.
3. Frontends: `VITE_API_BASE=https://<api> npm run build:frontends`; one static service (or CDN bucket) per app from
   `dist-frontends/<app>`; serve each app's `public/_headers` (CSP). Same-origin serving is also supported
   (`DEPLOY_RAILWAY.md` Step 5).
4. Edge: Cloudflare (or equal) in front — WAF / bot rules on `/auth/*`, TLS, DDoS (X-5). Backups + PITR with an isolated
   restore account (X-4; drill `tooling/full-system-test/backup-drill.sh`). GitHub branch protection + secret-scanning push
   protection (X-8).
5. Verify a release: `GET /health` shows the new `commit` and `schemaVersion`; Super Admin → System Operations all HEALTHY.
   Rollback = Railway → previous deployment → Redeploy; never roll a migration back automatically.

## 6. PAYMENT GATEWAY — Fiserv CardPointe merchant accounts (Kevin, per salon) — X-7, FST-3

**Decision (final, `PAYMENTS_INTEGRATION.md` §1):** Fiserv only. CardPointe for card-present (terminal) and card-not-present
(saved cards, booking); Fiserv CommerceHub for Tap to Pay on iPhone (§7). No Stripe or Square integration exists (only a Stripe-style HMAC webhook signature scheme).

**What is built and race-tested:** the CardPointe adapter, claim-first idempotency, UNKNOWN → verify recovery (an unknown
payment is never a decline), void / refund, per-tenant encrypted credentials, kill switch, sandbox processor
(`PAYMENTS_SANDBOX=1`). Everything to the live processor is NOT VERIFIED by policy until a real MID runs the UAT below.

### What Kevin does outside the code
1. **Fiserv / CardPointe ISV agreement** (Schedule-A pricing is an owner sign-off item). Ask Fiserv for: the **UAT**
   gateway host and a UAT merchant (MID + API user + API password), then **production** credentials per salon.
2. **One merchant account (MID) per salon / location.** Each salon is underwritten by Fiserv on its own (legal name, EIN,
   bank account for settlement, owner ID, processing volume estimate). The platform routes by location MID
   (`e574752d`) — a salon with two branches that settle separately needs two MIDs.
3. **Terminals** (X-19): CardPointe / Clover terminals per location; Fiserv gives each terminal an HSN. The POS pairs a
   terminal per location (POS → Devices → Payment Terminals, `/tenant/devices/payment-terminals`). Bolt (terminal API) base URL + key come from Fiserv:
   `BOLT_BASE_URL`, and for UAT `BOLT_UAT_BASE_URL`, `BOLT_UAT_AUTH_KEY`, `BOLT_UAT_HSN`.

### What the developer does in the product
4. **Sandbox first** (no money): `PAYMENTS_SANDBOX=1`, `PAYMENTS_ALLOW_ENV_FALLBACK=1` and the UAT variables
   `CARDPOINTE_BASE_URL`, `CARDPOINTE_SITE`, `CARDPOINTE_MERCHID`, `CARDPOINTE_USERNAME`, `CARDPOINTE_PASSWORD`,
   `CARDPOINTE_CURRENCY` on the API (sandbox only — in production credentials live per tenant, never in env).
5. **Gateway communication test** — Fiserv's own validation form: `cd apps/api && npm run uat:cardpointe`
   (`scripts/uat/cardpointe-uat.mjs`: $1.00 sale → void; `--decline-amount 1500.00` for the RPCT decline codes). Keep the
   log (approve + void) for Fiserv.
6. **Enter each salon's production MID** in **Super Admin → Tenants → the salon → Payment Gateway**
   (`POST /super-admin/tenants/:id/payment-gateway`: processor, environment = production, merchant ID, API username, API
   password; Bolt URL / key for terminals). Stored encrypted with `PAYMENT_ENC_KEY`; the oversight list is
   **Super Admin → Payment Gateways** (MID shown masked). Then flip `PAYMENTS_SANDBOX=0`.
7. **Refund-inquiry shape**: run one timeout-refund in UAT and confirm the `inquireByOrderid` listing matches what
   `modules/payments` expects; only then set `PAYMENTS_REFUND_INQUIRY_VERIFIED=1` (until then a refund whose answer was lost
   stays "pending review" instead of auto-releasing — by design).
8. **Live settlement**: after the first production day, reconcile Super Admin → Settlements against the Fiserv portal
   (`PAYMENTS_INTEGRATION.md` §5).

Acceptance (X-7): UAT log shows approve + void; a timeout refund settles exactly once; one real $1 sale per salon in
production, voided, visible in that salon's Checkout history and in Settlements.

## 7. TAP TO PAY on iPhone — Fiserv CommerceHub + Apple (Kevin + developer) — X-9

Deliberately a labelled skeleton until credentials exist: without a CommerceHub client the API answers
**501 `TapToPayNotImplemented`** (honest, not a fake success). Per-location MID routing, refunds / voids, device keys and
pairing are built; the **VERIFY** markers in `modules/payments/src/payments/commercehub.client.ts` are the field names to
confirm against Fiserv's current CommerceHub contract.

Kevin: Apple Developer **Tap to Pay on iPhone entitlement** (Apple reviews the business), CommerceHub **sandbox** access +
SDK + one ISV key acting for each location MID (confirm with Fiserv), 3 eligible iPhones, a Mac with Xcode.
Developer: `COMMERCEHUB_BASE_URL`, `COMMERCEHUB_TTP_ENV`, `COMMERCEHUB_TTP_API_KEY`, `COMMERCEHUB_TTP_API_SECRET`,
`COMMERCEHUB_TTP_APPLE_MERCHANT_ID`, `COMMERCEHUB_TTP_CURRENCY`, `COMMERCEHUB_TTP_TERMINAL_PROFILE_ID`
(`COMMERCEHUB_TTP_MERCHANT_ID` = sandbox fallback; per-location merchant in Super Admin, migration 704); implement the
capture call inside the existing TapToPay socket; sandbox sale → refund → void reconcile; physical 3-phone pilot
(`apps/api/scripts/lib/pilot-secure-tap-to-pay.mjs`). Native build: `MOBILE_CONVERSION_HANDOFF.md`, `docs/mobile/MOBILE_RELEASE_SETUP.md`.

## 8. TWILIO — SMS, Verify, A2P 10DLC (Kevin platform account + each salon) — X-10

**Built:** per-salon subaccount / own-account routing, encrypted per-tenant credentials, Messaging Service + number
purchase from the app, status callbacks, inbound STOP / START / HELP, Verify (booking OTP), the AI Reception Copilot,
A2P brand + campaign automation (TrustHub) with a **Mock** mode, offboarding of cancelled salons. Without credentials every
send takes the "not configured" path (no silent failure, no fake "sent").

### Kevin — the platform (ISV) account
1. Create / fund the **Twilio parent account**. Complete the **ISV Primary Customer Profile** in Trust Hub (Twilio
   approves it; you receive a `BU…` SID). This is the one-time ISV step — without it no salon brand can be registered.
2. Buy **one shared default number** (E.164) for platform messages and as the fallback sender.
3. Create a **Verify service** (booking OTP) in the Twilio console.
4. Give the developer, through the host's secret store only: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`,
   `TWILIO_PRIMARY_PROFILE_SID`, `TWILIO_ISV_EMAIL` (an address you own — TrustHub status mail goes there), and the Verify
   service SID (entered per tenant in Super Admin, see 7).

### Developer — the API
5. Variables (`MESSAGING_A2P_GO_LIVE_RUNBOOK.md` §1): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`,
   `TWILIO_STATUS_CALLBACK_URL` (= `https://<api>/webhooks/twilio/sms/status`), `TWILIO_VERIFY_BASE_URL`,
   `PROVIDER_VAULT_KEK` (≥ 32 chars — encrypts per-salon tokens), `PUBLIC_API_BASE_URL`, `TWILIO_ISV_EMAIL`,
   `TWILIO_PRIMARY_PROFILE_SID`; override `TWILIO_A2P_POLICY_SID` / `TWILIO_SECONDARY_PROFILE_POLICY_SID` only if Twilio's
   documented defaults change; `MESSAGING_OFFBOARD_GRACE_DAYS`.
6. **Webhooks** on every sending number (the app sets them automatically on numbers it buys): inbound SMS →
   `<api>/webhooks/twilio/sms/inbound`, status callback → `<api>/webhooks/twilio/sms/status`. Signatures are verified with
   the owning account's token (the AccountSid on the callback selects the tenant).
7. **Super Admin → Messaging Environment** (`/messaging-environment`) must be green: E.164 from-number, KEK length, ISV
   profile shape, webhook URLs. The Copilot card shows amber (template drafts) until an AI key is set (X-14) — functional either way.

### Per salon (Super Admin → Twilio Setup `/tenants/:tenantId/messaging`, or the salon's own POS → Text Messaging Setup)
8. Optional: the salon's **own** Twilio account SID + auth token (encrypted with `PROVIDER_VAULT_KEK`); blank = sends on the
   shared account under a subaccount. Enter the **Verify service SID** here.
9. **Buy** a number by area code or **Register** one the salon already owns → it becomes that salon's sender; webhooks are set.
10. **Send test SMS** to a phone you own — a returned SID proves credentials + number end to end.
11. **A2P 10DLC** (Super Admin → `/tenants/:tenantId/a2p`; template text in `A2P_10DLC_REGISTRATION_KIT.md` — it is an
    ISV registration, **one brand + one campaign per salon, never shared**):
    - **0 · Business profile**: legal name, EIN, address, industry, authorized representative → Create secondary profile
      (runs the TrustHub sequence; needs `TWILIO_ISV_EMAIL` + `TWILIO_PRIMARY_PROFILE_SID`).
    - **1 · Inputs**: brand type, use case **Mixed**, campaign description, the sample messages and the opt-in / message-flow
      text from the kit (the #1 rejection field), the salon's privacy-policy and terms URLs (the kit §4 says what they
      must contain). **Toggle Mock first** — dry-run without fees.
    - **2 · Submit**: brand → wait APPROVED (usually minutes) → campaign (TCR review ≈ 10–15 business days) → **Attach
      number** (the `PN…` SID). Status is shown on the rail.
    - STOP / HELP auto-replies are already configured by the app on the Messaging Service (kit §3).
12. **Validate the loop** (runbook §6): send a reminder from the salon's number; reply STOP → opt-out recorded; START →
    re-subscribed; HELP → help text; the delivery receipt flips the notification to `delivered`.

Acceptance (X-10): one real SMS per salon delivered with a status callback on staging; no customer phone numbers in logs;
booking OTP received via Verify.

Kevin's rule from Oct 28 stays: all customer-facing messages are **English only**; only the Front Desk POS is EN + VI.

## 9. The other outside accounts (Kevin) — `EXTERNAL_SETUP_CHECKLIST.md`

| # | Account | Variables (names) | Without it |
|---|---|---|---|
| X-11 | SendGrid (invites, receipts, trusted-device links) | `SENDGRID_API_KEY`, `SENDGRID_FROM` | invite link is handed to the manager on screen; no e-mail |
| X-12 | Push — Firebase (Android / web) + APNs (iOS) | `FCM_SERVICE_ACCOUNT_JSON` or `_B64`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8_B64`, `APNS_ENV`, `APNS_TOPIC_{CUSTOMER,MANAGER,TECH,OWNER,POS}` | push "not configured", in-app notices still work |
| X-13 | Receipt OCR / evidence bucket | `EVIDENCE_S3_*`, `EVIDENCE_SCAN_*`, `MEDIA_*` | receipts stored without OCR |
| X-14 | AI / voice receptionist (English only) | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`; `RETELL_API_KEY`, `RETELL_WEBHOOK_SIGNING_KEY`, `RETELL_DEFAULT_VOICE_ID` | template drafts; no phone receptionist |
| X-15 | Google Maps / Places | `GOOGLE_MAPS_SERVER_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_DEFAULT_COUNTRY` | no map / autocomplete |
| X-16 | Apple Developer + Play Console | — | no native builds (`ANDROID_SUBMISSION_RUNBOOK.md`, `apple-readiness/`) |
| X-17 | Payroll provider (optional) | — (`PAYROLL_PROVIDER_NOT_CONFIGURED`) | check + cash payouts only |
| X-18 | Independent penetration test | — | after X-2 … X-6 |
| X-19 | Hardware — terminals, cash drawer, customer-display tablets, the 27-inch touchscreen | per-location pairing in the POS | — |

## 10. Order of operations (the short version)

1. Developer: §4 K-12 steps 1–5 → push (step 6) → CI green on GitHub (`security.yml`, `build-image.yml`).
2. Developer: §3 FST-1 — the full gate / test run on a real toolchain; fix anything it surfaces (expected: nothing in product logic).
3. Developer + Kevin: §5 hosting — staging first (`PAYMENTS_SANDBOX=1`, no Twilio), migrate, `/health`, System Operations.
4. Kevin: §8 Twilio platform account + ISV profile (start now — TCR campaign review is the longest lead time, ≈ 2–3 weeks per salon).
5. Kevin: §6 Fiserv UAT credentials → developer runs `npm run uat:cardpointe` → production MIDs per salon.
6. Pilot salon: one real SMS, one $1 sale + void, a day on the 27-inch touchscreen (FST-7), Vietnamese review (A1 … A34).
7. Then X-11 … X-19 as each salon needs them; §7 Tap to Pay when Apple + Fiserv grant access.

Every step above has a "done when" in `EXTERNAL_SETUP_CHECKLIST.md` or `SECURITY_REMAINING_ACTIONS.md`; tick them there.
