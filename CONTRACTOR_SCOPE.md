# AIPowerSalon — Contractor Scope of Work (Handoff)

**Purpose:** hand this to the developer you hire. It states exactly what is built, what remains, where the remaining
work lives in the code, how to verify it, and what external accounts you (the owner) must provide. Estimates are rough
ranges for one experienced full-stack developer and will move depending on choices (payment processor, hosting, etc.).

---

## 1. What this project is

A multi-tenant **nail-salon POS SaaS**. One backend serves six front-end apps:

| App | Who uses it | Folder |
|---|---|---|
| POS Front Desk | salon front desk / owner | `apps/pos-web` (22 screens) |
| Super Admin | platform operator (you) | `apps/admin-web` (20 screens) |
| Technician app | technicians | `apps/tech-web` (12 screens) |
| Customer app | salon customers | `apps/customer-web` (49 screens) |
| Owner app | salon owners | `apps/owner-web` (12 screens) |
| Customer Display | the screen the customer sees at checkout | `apps/customer-display` |

**Stack:** Backend = NestJS + Kysely + PostgreSQL 16 (59 controllers, 75 migrations, 316 source files), row-level
security with 112 tenant-isolation policies. Frontends = React + Vite + TypeScript. Payments = Fiserv/CardPointe. SMS =
Twilio. Email = SendGrid. Money is stored as integer cents. npm workspaces monorepo.

## 2. Current state — honest assessment

**This is a near-complete codebase, not a skeleton.** Verified by running it:

- All 7 apps **build clean**; backend test suite **326 tests pass**; live end-to-end + RLS suites pass against a real
  Postgres; all 75 migrations apply cleanly.
- **5 of 6 UIs were driven in a real browser** (login → authenticated data, 0 JS errors): POS, Super Admin, Technician,
  Customer, Owner. Customer Display is a station-pairing flow (not a login).
- One-command local setup exists (`npm run setup:local` + `npm run dev:all`) with seeded test data and accounts.
- There are **no "coming soon" stub screens** and only 4 trivial code markers. The remaining work is integrations,
  infrastructure, and a small number of explicitly-unfinished features (listed below).

So you are paying a contractor to **finish and ship**, not to rebuild. See `LOCAL_BROWSER_TESTING_GUIDE.md` to run it in
~5 minutes and `FULL_POS_BROWSER_TEST_AUDIT.md` for the module-by-module audit.

## 3. What is already DONE (do not pay to redo)

- Full POS flow screens + APIs: dashboard, check-in, booking, queues, serving, service-done, checkout, customers,
  technicians, services, reports, settings — all wired to the backend with real data.
- Super Admin, Owner, Technician, Customer apps — all wired and browser-verified.
- Multi-tenant isolation (RLS, 112 policies, fail-closed) — verified.
- Checkout money math incl. tip, tax, **card surcharge on splits** (the avoidance loophole is closed), and the
  surcharge/tax "collected" KPIs.
- Card payments **in sandbox/test mode** (approve locally, labeled `sbx_`) so the full checkout is testable now.
- Customer Display backend + token-scoped public endpoints; SSE realtime push bus.
- Auth: salon-scoped login for all roles, password reset across roles, WebAuthn/passkey scaffolding.
- Local dev: Docker Postgres option, idempotent seeds, test accounts.

---

## 4. WORK PACKAGES — what needs to be finished

Each item: **what · where · acceptance · effort**. "Required" = needed to launch to a real salon; "Optional" = nice to
have / depends on your go-to-market.

### WP1 — Production card payments (Fiserv/CardPointe) — **Required** — ~3–6 days
- **What:** wire a live merchant account so real cards are charged. Today card capture runs in sandbox mode; the real
  CardPointe client + adapter already exist and are exercised against a mock gateway in tests.
- **Where:** `apps/api/src/payments/*` (CardPointe adapter, gateway resolver), `apps/api/src/checkout/checkout.service.ts`
  (card/split/refund paths), per-tenant gateway config in `super-admin-tenants` + `settings`. Status flag logic in
  `checkout.dto.ts` (`resolvePaymentStatus`, `fiservStatus`).
- **Do:** provision a Fiserv/CardPointe MID; store per-tenant credentials securely; flip a tenant to `connected`; run a
  real authorize+capture, void, and refund against the CardPointe **sandbox** then production; confirm surcharge +
  receipts; review PCI scope (tokenization via CardPointe iframe/tokenizer so raw PANs never hit the server).
- **Acceptance:** a real (sandbox) card is authorized, captured, voided, and refunded end-to-end from the POS; amounts
  and surcharge match; audit logs record `connected` (not `sbx_`).

### WP2 — SMS notifications (Twilio + A2P 10DLC) — **Required** — ~2–4 days (+ carrier registration lead time)
- **What:** real text messages (receipts, queue/booking notifications, reset codes). Real `TwilioSmsSender` exists;
  falls back to a mock when `TWILIO_*` env is absent.
- **Where:** `apps/api/src/auth/sms.service.ts`, `customer/customer.module.ts`, `queue/queue.service.ts` (notify),
  reset modules.
- **Do:** set `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`; complete **A2P 10DLC** brand+campaign
  registration (carrier requirement for US business texting — has multi-day lead time); verify a real send for each
  message type.
- **Acceptance:** real SMS delivered for receipt + queue notification + password reset on a registered number.

### WP3 — Email notifications (SendGrid) — **Required** — ~1–2 days
- **What:** real transactional email (receipts, resets). Real `SendGridEmailSender` exists; mock fallback otherwise.
- **Where:** `apps/api/src/auth/email.service.ts`, `system-reset.module.ts`, receipts.
- **Do:** set `SENDGRID_API_KEY` / `SENDGRID_FROM`; authenticate the sending domain (SPF/DKIM); verify deliverability.
- **Acceptance:** real receipt + reset email delivered and not spam-foldered.

### WP4 — Push notifications (FCM) — **Optional/Required if mobile push is a feature** — ~3–5 days
- **What:** there is **no push sender implemented** in the backend (no FCM adapter found). If the customer/tech apps are
  to receive push, this must be built.
- **Where:** new `apps/api/src/.../push.service.ts` + device-token storage + send hooks; client registration in
  `customer-web`/`tech-web`.
- **Do:** decide if push is in scope for launch (web push vs native). If yes, build an FCM adapter behind the same
  "real-or-mock by env" pattern used for SMS/email, store device tokens, and trigger on the relevant events.
- **Acceptance:** a device receives a push on a real event; mock path keeps local dev working.

### WP5 — Real MFA / TOTP — **DONE / verified** — ~0 days (enroll admins at go-live)
- **What:** Super Admin (and opted-in roles) MFA was **format-gated** (any 6-digit code passes) (local / non-production only: with `NODE_ENV=production` or `MFA_REQUIRE_TOTP=1` a user with no enrolled authenticator cannot pass MFA with a bare 6-digit code — `packages/auth/src/security.ts` `requireRealTotpEnrollment`; corrected Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep)) for local
  testing. Implement real TOTP enrollment + verification.
- **Where:** `apps/api/src/auth/*` (login attempt, MFA path), TOTP utilities + replay guard already exist
  (migration `040_mfa_totp_replay_guard`).
- **Do:** add enrollment (QR/secret), store the secret encrypted, verify real codes, keep recovery codes; gate behind a
  flag so local/dev can stay permissive.
- **Status:** DONE — real RFC 6238 TOTP (enroll/confirm/verify) with replay guard + encrypted secrets was verified
  end-to-end (enroll → login with a real code → wrong/replayed codes rejected). Added `MFA_REQUIRE_TOTP=1` (auto-on in
  production) to disable the any-6-digit local fallback, and `scripts/enroll-mfa.ts` for the operator bootstrap. See
  MFA_PRODUCTION.md. **At go-live:** set `MFA_REQUIRE_TOTP=1` + a stable `MFA_ENC_KEY`, and enroll each admin.

### WP6 — Deployment & infrastructure — **Required** — ~4–8 days
- **What:** there is no live hosting yet. Stand up production.
- **Do:** host the API (containerized — a `Dockerfile` exists); provision **managed Postgres 16** and run migrations;
  provision **Redis** for login throttling + the realtime bus across multiple API nodes (both have in-process fallbacks
  today — see `login-throttle-redis.ts`, `realtime-bus.ts`); host the six built frontends (static) and point each at the
  API origin via `dist/config.js` or `VITE_API_BASE` (see `CONFIG_API_ORIGIN.md` — runtime, no rebuild); set all secrets
  (`AUTH_SESSION_SECRET`, DB URL, payment/SMS/email keys); set up TLS, backups, logging/monitoring, and CI/CD.
- **Acceptance:** the platform is reachable over HTTPS, migrations are applied, all six apps load against the hosted API,
  sessions persist, and a deploy pipeline exists.

<!-- WP7 update: Customer Display pairing/realtime: DONE (npm run verify:display, 12/12). e2e workflow: DONE (npm run e2e:workflow, 22/22). Remaining: click-through of the same chain in the actual browser UIs. -->
### WP7 — End-to-end workflow + realtime + Customer Display — **Required** — ~3–5 days
- **What:** per-app login is verified, but the **full cross-app chain has not been verified end-to-end**, and the
  Customer Display pairing/realtime-follow flow needs a live check.
- **Do:** drive and harden the full path — check-in → queue → assign tech → tech accepts → start → edit live ticket →
  service done → checkout (tip + payment) → receipt → reports + technician earnings update; pair the Customer Display to
  a POS station and confirm it follows the checkout in realtime (SSE) or polling. Add an automated e2e for this chain.
- **Acceptance:** the whole workflow completes in the browser with data propagating across POS, Tech, Customer Display,
  Reports, and earnings; an automated test covers it.
- **Status:** an automated cross-surface workflow test is DONE and passing (`npm run e2e:workflow`, 22/22) — it drives
  check-in → queue → tech → service done → checkout (sandbox card) → and asserts propagation to checkout KPIs, reports
  revenue, and technician earnings. Remaining: drive it through the actual browser UIs across apps, and verify Customer
  Display pairing + realtime follow.

<!-- Customer CSV import: DONE — bulk import of name/phone/email/birthday into the tenant customers table (the same Postgres the tenant AI reads); preview+commit endpoints, dedup, batched insert, pos-web UI; verified at 50k (~20k rows/sec, npm run verify:import). See CUSTOMER_IMPORT_GUIDE.md. -->
### WP8 — Services CSV import — **DONE (API + UI)**
- **What:** service **export** (CSV) works; **import** (upload → preview → commit) is explicitly **not wired**
  (`services.service.ts` `import()` returns "not configured").
- **Do:** implement file ingestion, a preview/validation step, and a commit that upserts services.
- **Status:** DONE on the backend — `POST /pos/services/import/preview` (dry run) + `/import/commit`, dollar prices,
  create/update matching by Id then Name, auto-creates categories, round-trips with Export. Tested (6 unit tests) and
  verified live. See SERVICE_IMPORT_GUIDE.md. The pos-web Services screen now has an **Import CSV** panel (paste or load a .csv → preview table with
  per-row create/update/error + parsed prices → commit), verified in-browser. Nothing remaining.

### WP9 — External booking integrations — **Optional** — ~2–4 days each
- **What:** booking integration status reports "not configured until a tenant connects them"
  (`booking.repository.ts`). If you want third-party calendar/booking sync, build the connectors.
- **Acceptance:** a tenant connects an external booking source and appointments sync.

### WP10 — NailShowcase social ranking — **Optional** — ~2–4 days
- **What:** the NailShowcase feed/post/reaction is live; the **social ranking** piece has an erroring stub
  (`nail-showcase-social.repository.ts`). Finish only if this feature is in scope for launch.
- **Acceptance:** ranking computes and displays from real engagement data.

### WP11 — Google Places salon discovery — **Optional** — ~0.5 day
- **What:** the Customer app shows partner/seeded salons without a key; a `GOOGLE_PLACES_API_KEY` adds non-partner
  Google results (`customer-salons/*`). Just set the key + verify.

### WP12 — Polish before launch — **Recommended** — ~2–4 days
- Lint cleanup (a handful of cosmetic errors/warnings, `npm run lint`); audit loading/empty/error states on each screen;
  a 24-inch-Mac and iPad fit pass (the design system enforces a fixed-shell rule — keep tables scrolling internally);
  basic accessibility pass.

---

## 5. External accounts / credentials YOU must provide

The contractor cannot create these for you. Have them ready:

- **Fiserv / CardPointe** merchant account (MID, API credentials, tokenizer keys) — for WP1.
- **Twilio** account + a number + **A2P 10DLC** brand/campaign registration — for WP2 (start early; carrier approval
  takes days).
- **SendGrid** account + authenticated sending domain — for WP3.
- **Firebase/FCM** project (if push is in scope) — for WP4.
- **Hosting** for the API + Postgres + Redis + static frontends, plus a **domain** + TLS — for WP6.
- **Google Cloud** Places API key (optional) — for WP11.

## 6. Suggested order & rough total

1. **Infra first (WP6)** so there's somewhere to deploy and test integrations.
2. **Payments (WP1)** — highest business risk; do early against sandbox.
3. **SMS + Email (WP2/WP3)** — start A2P registration on day one (lead time).
4. **MFA (WP5)** and **E2E/realtime hardening (WP7)**.
5. Optional features (WP4, WP8–WP11) and **polish (WP12)** as scope allows.

**Rough total for a production launch (required items WP1–WP3, WP5–WP7):** ~**15–28 developer-days**, i.e. roughly
3–6 weeks for one experienced full-stack developer, excluding external approval lead times (A2P) and your decisions.
Optional items add as scoped.

## 7. How the contractor verifies their work (definition of done)

- `npm run setup:local` + `npm run dev:all` runs the whole platform locally (Docker Postgres option included).
- `npm test` (backend) stays green; they add tests for new work (the repo has 326 backend tests + e2e harnesses to
  follow as a pattern — `apps/api/scripts/e2e-*.mjs`).
- Every changed flow is verified in a real browser, not just unit-tested (this is how two real bugs were found during
  handoff: an Overview render crash and a broken Owner login — both fixed).
- No secrets in the repo; all live credentials via environment/secret manager.

## 8. Risks & notes

- **Payments + PCI:** keep card data tokenized client-side (CardPointe tokenizer) so raw card numbers never reach the
  server; this keeps PCI scope minimal. Don't shortcut this.
- **A2P 10DLC lead time:** US SMS won't deliver reliably until brand/campaign registration clears — begin immediately.
- **Multi-node realtime/throttle:** the in-process fallbacks are fine for a single API node; wire Redis before scaling
  horizontally.
- **The mock-or-real pattern is deliberate:** most integrations already switch to the real provider automatically when
  the right env vars are set — so a lot of WP1–WP4 is "provide credentials + verify," not "write from scratch."

---

*Companion docs in this package:* `LOCAL_BROWSER_TESTING_GUIDE.md` (run it), `FULL_POS_BROWSER_TEST_AUDIT.md`
(module audit), `BUILD_AND_TEST_REPORT.md` (verification evidence), `CONFIG_API_ORIGIN.md` (deploy/API origin),
`FRONTEND_BACKEND_CONNECTION_MAP.md`, `BUG_FIX_REPORT.md`, `REMAINING_BLOCKERS.md`.
