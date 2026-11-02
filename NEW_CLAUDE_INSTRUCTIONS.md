# NEW_CLAUDE_INSTRUCTIONS.md

**Read this, then `PROJECT_STATUS.md`, then map the codebase — before changing anything.**

---

## What this is

**AI PowerSalon** — a multi-tenant SaaS for nail salons. One platform, many salon businesses, each with its own
staff, customers, payments and settings.

It is **not greenfield**. It is large (2,900+ API source files, 431 migrations, 10 workspaces), mostly working, and has
invariants that will bite you. **Do not rebuild what exists. Repair and connect it.**

## Stack — do not replace it

| | |
|---|---|
| Backend | NestJS 10 · TypeScript · **Kysely** (not Prisma/TypeORM) · PostgreSQL 16 |
| Frontend | React 18 · Vite |
| Native | Capacitor (iOS + Android) for 4 apps |
| Tests | Vitest; **PGlite** for real-schema tests |
| Monorepo | npm workspaces (`apps/*`, `packages/*`) |

## The apps

| App | Users | Runs on |
|---|---|---|
| `api` | — | NestJS backend |
| `pos-web` | Salon staff | **iMac / Safari — web only** |
| `admin-web` | Super Admin | Desktop web |
| `customer-web` | Customers | **iOS/Android (Capacitor)** |
| `owner-web` | Owners (multi-salon) | **iOS/Android** |
| `tech-web` | Technicians | **iOS/Android** |
| `manager-pay-web` | Managers (payroll) | **iOS/Android** |
| `customer-display`, `go-check-in-*` | In-salon screens | Kiosk |

---

## The invariants. Break these, break the product.

1. **Money is INTEGER CENTS.** Everywhere. `BIGINT` in the DB. Never floats.
2. **Tenant identity is SERVER-DERIVED** — from the signed session, never the request body. The client may *ask*;
   the server *decides*.
3. **Tenant isolation is enforced in SQL.** A guard test fails the build on an unscoped query.
   **Do not allowlist it to make it pass — scope the query.**
4. **A salon = a tenant. A branch = a location inside it.** Salons have their own Store Code, subscription and
   merchant account. **Never merge separate salons into one tenant.**
5. **Payments: Fiserv / CardPointe / Bolt / Clover ONLY.** No Stripe, no Square.
6. **Audit logs are append-only.**
7. **Sessions carry a `sid` and are revocable.** A session minted without one can never be killed by "sign out
   other devices". A guard enforces this.

## Authentication

One endpoint `POST /auth/login`, with a **portal**:

| Portal | Who | Store Code? |
|---|---|---|
| `tenant` | Salon staff | **Yes** |
| `owner` | Owners | **No** — an owner with 3 salons has 3 codes |
| `customer` | Customers | **No** |
| `super-admin` | Super Admin | No |

**The security lives in the SQL.** Each portal's lookup is role-filtered (`where role = 'OWNER'`), so a manager
physically cannot sign in through the customer or owner app — there is nothing for the query to find.

**Web** = httpOnly cookie. **Native** = bearer token in the Keychain, issued *only* to native clients (decided
from the unforgeable `Origin` header, so XSS in a web app can never obtain one).

## Roles

`OWNER`, `MANAGER`, `RECEPTION`/`FRONT_DESK`, `TECHNICIAN`, `CUSTOMER`, `SUPER_ADMIN`.

**Multi-salon owners have a role PER SALON** (`user_branch_access.access_level`). An owner may run payroll at
Salon A and be reports-only at Salon B. **Never apply the best role they hold anywhere to every salon.**

---

## Run this before you touch anything

```bash
npm install
cd apps/api && npx tsc --noEmit -p tsconfig.json      # must be 0 errors
npx vitest run --shard=1/3 && npx vitest run --shard=2/3 && npx vitest run --shard=3/3
```

The API suite is **sharded because a single run gets reaped by the memory limit** — that is normal, not a failure.

**Run the WHOLE suite before claiming anything works.** A targeted run tells you nothing about what you broke
elsewhere. This has bitten repeatedly.

## The guards — read them before you fight them

| Guard | Catches |
|---|---|
| `common/tenant-isolation` | An unscoped query on a tenant-owned table |
| `common/no-orphaned-controllers` | A `@Controller` in no module (routes silently never load) |
| `common/sql-schema-consistency` | An INSERT/UPDATE naming a column that doesn't exist |
| `common/auth-boundary` | A new public route not in the reviewed baseline |
| `common/image-assets` | A referenced image that isn't on disk |
| `auth/session-sid-coverage` | A session minted without a `sid` (unrevocable) |
| `auth/session-401-coverage` | An app that doesn't handle a 401 |
| `auth/native-auth-coverage` | A native app that can't authenticate on a phone |
| `auth/cors-native-origins` | Native origins drifting out of the CORS allowlist |

**If a guard fails, it is almost certainly right.** Each was written *because* a real bug shipped past a green
suite.

## Patterns to preserve

- **Controller → Service → Port (interface) → Repository (Kysely) → Postgres.** No business logic in controllers.
- Every repository has an **in-memory twin** for tests. **The fake must ENFORCE the same tenant scoping as the
  real one** — a fake that ignores it lets a cross-tenant leak pass every test. This has happened.
- **Honest states.** A failed load shows an error, never zeros. Never fabricate a dashboard value.
- **Fail closed.** A missing tenant returns *nothing*, never *everything*.

## Do NOT

- Create a second auth system, or a duplicate tenant/branch/user/settings model.
- Add a table when `user_branch_access` already expresses the relationship.
- Weaken a guard to make it pass.
- Claim a phase is done because the files exist.

## Highest-value next task

**Regenerate `apps/api/src/database/kysely.types.ts` from the live schema.** It is missing ~200 tables, and
`appointments` is missing its `tenant_id`. This one file is the root cause of the tenant-isolation guard's
historical blind spot, and fixing it restores compile-time tenant-scoping help across the whole backend.

---

## Update 2026-07-16
A **Technician Skills / Helper / Tip Allocation** feature was added (see `CHANGELOG_HANDOFF.md` + `COMPLETION_REPORT.md`). New backend module `apps/api/src/technician-help/` — do **not** create a second helper/ticket/payroll path; reuse the compensation engine, `technician_services` eligibility, and `ticket_service_lines.technician_id` per-line ownership. **Apply migrations `398`, `399`, `400`** before running (`npm run db:migrate`). Before changing money code, read `COMPLETION_REPORT.md` — the tip 50/50 rule and refund reversal are surgical, reconciliation-preserving changes.

## Update for the incoming chat — Jul 20, 2026
- Read **PROJECT_STATUS.md → "Session update — Jul 19–20, 2026"** and the tail of **CHANGELOG_HANDOFF.md** first; then `SUPER_ADMIN_WIRING_MATRIX.md`, `COMMISSION_ARCHITECTURE.md`.
- **Money-model invariants (never violate):** integer cents everywhere; residual splits are **net-first + layered** via `computeLayeredResidualSplit` (costs off the top; tenant share carved from the platform's contractual 65%, never additive); percentages come from versioned agreements, never literals; four accounting buckets (surcharge / residuals / incentives / hardware) never mix.
- **Surcharge:** one chokepoint `splitCardSurchargeCents` (3% hard cap at calc; debit/prepaid → 0 when funding known). Do not duplicate the math anywhere.
- **Protected designs:** customer phone changes are a **verified SMS flow, not an edit field** (do not add a raw phone input to POSCustomersScreen; backend PATCH deliberately ignores phone). Processors: **Fiserv/CardPointe/Bolt/Clover only**. Never fabricate a payment result — the CommerceHub adapter throws until real sandbox credentials exist (the one standing blocker).
- **Verification commands:** from `apps/api`: the THIRTEEN gates `npm run -s check:{di,sql,crosswire,dead-client,unreached,perms,public,nav,types-drift,tenant,dialogs,money,html}`; `node scripts/verify-migrations-pglite.mjs` (431/431); vitest as **8 shards** `npx vitest run --shard=k/8` (4-way outgrew the sandbox call cap Jul 26; sum totals FROM THE LOGS after all eight return — never write a battery number before then); the 124 Nest-free `*-core.spec.ts` harnesses run via esbuild→node loop (NOT vitest — and skip the trailing vitest re-run in `scripts/run-core-specs.sh`, it times out). Frontends: `npx vitest run` per app (admin-web/pos-web need `--shard=k/3`), `npx tsc --noEmit`, `npx vite build`. `npm run security:fast` = the CI blocker lane (16 checks incl. secret scan).

## Update — Jul 20, 2026 (POS hardware + touch invariants)
- Primary POS hardware is a **Dell 24 AIO EC24250 Touch** (Windows 11, 1920×1080 touchscreen). Optimize pos-web for touch-first + Windows Edge/Chrome; keep mouse/keyboard and iMac/iPad compatibility. Never device-name sniff — capability media queries only (`hover`, `pointer`).
- Touch invariants: no hover-only functionality; interactive elements keep `touch-action: manipulation`; phone inputs are `type="tel"` (never `number`); search inputs `type="search" enterKeyHint="search"`; the Tech Queue board supports tap-to-assign AND drag — keep both. Booking drag is pointer-events with press-and-hold — do not regress it to mouse events.
- Read `MOBILE_CONVERSION_HANDOFF.md` before any native-app (iOS/Android) work — five apps are Capacitor-prewired; pos-web and admin-web stay web.

## Update — Jul 25, 2026 (kysely.types.ts regenerated — the "highest-value next task" is DONE)
The stale claim above (232 tables listed / 212 missing / `appointments` missing `tenant_id`) no longer reflects the file: a prior pass had already brought the `DB` interface to **all 604 tables**, and this pass closed the remaining drift — **162 missing column declarations across 23 interfaces** (columns added by later migrations: `payments.processor/*`, `tickets.surcharge_cents` + service-done fields, `branches` public-profile block, `users` reset/access-code fields, `tenant_subscriptions` billing fields, settlements/chargebacks reconciliation fields, etc.). Purely additive; no existing declaration changed. There is no `appointments` table in the schema — the booking table is `pos_tech_appointments` (declared, complete).
**New gate:** `npm run -s check:types-drift` (apps/api) applies all migrations to PGlite, introspects, and **fails on any missing/ghost table or column** in `kysely.types.ts` — add it to your verification battery so this can never silently drift again. Remediation helper: `scripts/patch-kysely-types.py` (reads `/tmp/schema.json` produced by the gate).
Verified after the change: api tsc 0 · all 8 gates + types-drift PASS · migrations 416/416 · API vitest 4 shards **5,725 passed + 4 skipped, 0 failed** · **124 core harnesses passed**. Frontends are untouched (nothing outside `apps/api` imports these types).

## Update — Jul 25, 2026 (push notifications: real APNs + FCM v1 transports, honest defaults, New-Assignment trigger)
§6.2's "nothing push-related exists server-side" was stale: the token registry (migration 075 `device_push_tokens`), `POST /push/register|unregister`, `PushService.dispatchToUser` with delivery logging, tech-web's full token lifecycle, and triggers in nail-showcase + customer-booking already existed. What was actually wrong, now fixed:
- The FCM provider used Google's **legacy server-key API, retired June 2024** — it could never deliver. Replaced by `FcmV1PushProvider` (OAuth2 service account → FCM HTTP v1). `FCM_SERVER_KEY` is recognized only to warn; it never selects a provider.
- There was **no APNs provider**, though Capacitor iOS tokens are raw APNs tokens. Added `ApnsPushProvider` (HTTP/2 token auth, ES256 JWT, per-app `apns-topic` from the token's registering `app`; env `APNS_KEY_P8(_B64)/APNS_KEY_ID/APNS_TEAM_ID/APNS_TOPIC[_TECH/_CUSTOMER/_OWNER/_MANAGER]/APNS_ENV`). `CompositePushProvider` routes ios→APNs, android/web→FCM.
- **Honesty:** unconfigured production used the mock, logging fabricated "delivered" rows. Production now selects a not-configured provider — every send logs failed `push_not_configured`. The mock exists only outside production. Dead tokens (`unregistered` results) auto-revoke.
- **New-Assignment trigger** (the push tech-web registers for): `queue.assignTechnician` (tap/drag/auto-balance/AI) and `tech-queue.reassign` now dispatch to the technician's linked user via tenant-scoped `technicianUserId` on both repo ports. Best-effort — can never fail the assignment.
Remaining push follow-ons: registration wiring in customer-web/owner-web/manager-pay-web (mirror `tech-web/src/lib/push.ts`), payroll-paid + check-in-ready + booking-reminder triggers, real-device delivery once APNs .p8 + Firebase service account exist. No new npm deps (node:crypto/node:http2). No new migration.

## Update — Jul 25, 2026 (push registration wired in the remaining three native apps)
customer-web, owner-web, and manager-pay-web now mirror tech-web's push lifecycle: `src/lib/push.ts` + `src/api/pushApi.ts` per app (registering with `app: 'customer' | 'owner' | 'manager'` — these route the per-app APNs topic, so keep them in sync with `APNS_TOPIC_*`). Registration fires when a session exists (AuthContext effect; App.tsx effect in manager-pay). **Sign-out revokes the push token FIRST** — `/push/unregister` is authenticated, so it runs before `authApi.logout()` in customer/owner AuthContext.logout and manager-pay AccountScreen.onSignOut; pinned per app by `src/lib/push-unregister.test.ts`. All four native-candidate apps now register AND revoke. Verified: tsc 0 × 3, suites 265/262/50 (each +4 = the new test), builds OK. Backend untouched.

## Update — Jul 25, 2026 (push triggers complete: payroll-paid + check-in-ready)
Payout events (§6.2) now push: marking a payroll period **paid** notifies each technician on the period (no dollar figures in the push by design — keep it that way); `finalized` intentionally sends nothing. `callNext` pushes "You're up!" to the customer's account (walk-ins without accounts are silently skipped). Both are best-effort structural-port injections (`PayrollPushLike` / existing queue push) — they can never fail the money/queue action. Remaining push work: optional booking-reminder trigger, and on-device delivery once APNs .p8 + Firebase SA credentials exist.


## Jul 25–26, 2026 — Application intake (read before touching applications/onboarding/website)
- The marketing site's canonical copy now lives at `marketing/website/` (form posts to `/public/website/applications`).
- `tenant_applications` = the single application system (migration 417). EIN: encrypted at rest via
  `src/common/field-encryption.ts` (`APP_DATA_ENCRYPTION_KEY`); reveal ONLY via the audited endpoint.
- Status changes go through `applications-lifecycle-core.ts` transitions — never set `status` directly.
- Approval→onboarding: `convertApplicationToOnboarding` (platform service, optional `OnboardingConvertLike` 3rd ctor
  arg) → onboarding module owns the 14-stage case; the application row is the immutable source record.
- Remaining spec phases: confirmation comms (P6), metrics (P7), extra fraud signals, onboarding SA console
  (module is still headless — no controller/screens), website deploy (repackage WP theme, API_BASE, CORS).


## Jul 26, 2026 — session token + viewport audit (read before touching auth or POS layout)
- NEVER re-embed the full permission list in the session token: the cookie must stay well under 4 KB (browser cap).
  `signSession` drops role-default permissions; `verifySession` re-derives from the signed role. Size pinned by tests.
- Real-browser viewport audit: `cd apps/api && AUDIT_ROUTES=first node scripts/pos-viewport-audit.mjs` (then `second`).
  Each half boots its own stack (PGlite) and must run inside one bounded call. `browser-e2e.mjs` supports `E2E_HOLD=1`.
- pos-web layout is the desktop-POS fixed shell (viewport-sized, internal scroll) — primary target ASUS V470
  1920×1080 @100%; also validated at 1536×864 / 1280×720 / 1600×900 / 1366×768 / 2560×1440.


## Jul 26, 2026 — Kevin's verification pillars (permanent, applies to every task)
A feature is NOT fully verified until each of these has been checked wherever it applies, and each is addressed
(or explicitly marked NOT VERIFIED with the reason) in the completion report:
1. **Tenant isolation** — cross-tenant reads/writes rejected; ctx.tenantId server-derived, never client-supplied.
2. **Branch isolation** — branch-scoped data respects ctx.branchId / scopedToBranches.
3. **RBAC / permissions** — perms minted in `src/auth/rbac.ts`, routes guarded (`@RequirePermission` /
   SuperAdminGuard), `check:perms` green, guard behavior tested.
4. **Database persistence** — real writes verified against the migrated schema (PGlite pgtest suites), not
   in-memory only.
5. **Audit behavior** — consequential actions write audit rows; sensitive reads (e.g. EIN reveal) are audited.
Existing machinery that enforces these: server-derived request ctx, tenant-scoped repositories, the 9-gate battery,
pgtest suites against the real migrated schema (420 migrations as of Jul 26), and AuditService. Use them; don't claim a pillar by assumption.


## Security workflow (Jul 26, 2026)
- **Gates are now 10**, not 9: the standard loop is di, sql, crosswire, dead-client, unreached, perms, public, nav,
  types-drift, **tenant** (`check:tenant` — every query on a tenant-scoped table must carry tenant_id). Extra gates
  also exist (`check:impossible`, `check:sql:select`, `check:nav:deep`) and run inside the security fast lane.
- `npm run security:fast` (~50s) = 12 static gates + committed-secret scan (values always redacted; localhost/
  placeholder Postgres URLs are triaged out) + deny-path census ratchet (RBAC-deny ≥15, scope-denial ≥25 — raise
  the floors when coverage grows, never lower) + quick auth suites. CI runs it on EVERY push/PR
  (.github/workflows/security.yml); the nightly cron runs `security:full` (adds the 4-shard battery + runtime-gated
  npm audit). Piecewise flags for constrained environments: `--shards=1` `--skip=gates,deps` `--merge=append|finalize`.
- **In-platform Security Audit Engine** (src/super-admin-security/audit-engine.*): advisory-locked runs,
  fingerprint-deduplicated findings, critical/high escalate ONCE into the existing security_incidents workflow,
  auto-resolve on re-verify, >26h gap self-detection. Armed via `SECURITY_AUDIT_WORKER_ENABLED` (fires in the
  01:00 local hour); manual: `POST /super-admin/security/audit/run`; visibility: the Security & Compliance screen.
- Dependency policy (spec §13): runtime criticals gate; runtime highs are tracked by name; major-version fixes
  (Nest 11 chain, kysely 0.29, vitest/vite dev majors) are DEFERRED deliberately — do not auto-upgrade them.

## Environment lessons (hard-won — do not relearn)
- Background processes do NOT survive between tool calls; long single-process work belongs to CI. Verify full-mode
  piecewise with the script's flags instead.
- Never `pkill -f`/`pgrep -f` a pattern that appears in your own command line (heredoc text included) — it matches
  your own shell. Inspect with `ps -eo pid,cmd | grep -v grep`, kill by explicit pid.
- Never pipe a command whose exit code matters (`timeout X cmd | tail` returns tail's rc and masks the kill).
- `memory_str_replace`-style partial edits that consume a line's opening fragment orphan the rest — reattach the
  prefix. (Applies to any anchored text splice.)


## Customer identity & 7 PM reconciliation (Jul 26, 2026)
- **The rule that governs this area: tenant data is NEVER copied between salons.** `customers` is the tenant
  relationship (notes, loyalty, memberships, history, preferences); `global_customers` + `customer_global_links`
  are the identity layer above it. Nothing in src/customer-identity writes tenant-owned columns — and
  `global_customers` has no such column to write. Keep it that way.
- Real-time prevention (§7/§8) is hooked at every customers-insert site: POS create, Check-In (both), Queue
  walk-in, Customer App registration. CSV import is deliberately reconciliation-owned. Hooks are best-effort —
  identity linking must never fail a salon's own workflow.
- The 7 PM engine (`CustomerReconciliationService`) is advisory-locked, incremental (unlinked or changed since the
  last completed full run), keyset-paged, per-tenant fault isolated (one tenant failing ⇒ PARTIAL, never abort).
  Armed by `CUSTOMER_SYNC_WORKER_ENABLED`; timezone from `PLATFORM_TIMEZONE` (default America/New_York).
- Phone normalization is ONE function per stored-data family (Jul 28, 2026): CUSTOMER identity uses
  `identity-core.normalizePhoneE164` (delegates to customer-activation-core); STAFF (`users.normalized_phone` —
  login/invites/password-reset) uses `auth/security.normalizeIdentifier`, and password-reset-core delegates to it.
  The families diverge on exactly one input ("+"+10 digits) and each must keep matching what IT stored — do NOT
  unify them without re-normalizing stored data (owner decision). Pinned by
  `src/auth/phone-normalization-parity.vitest.spec.ts`. CSV import's `normalizeImportPhone` is deliberately
  tolerant (reconciliation-owned) — not a legacy normalizer.
- Merges are reversible: the source identity is retired (`status='merged'`, `merged_into_id`), never deleted, and
  legal holds are consulted first. Conflicts are review rows, never automatic merges.


## Real-time synchronization standard (Jul 27, 2026)
- ONE realtime layer: `apps/api/src/realtime/` (SSE + REALTIME token + Redis fan-out) and per-app clients. NEVER
  add a second realtime system, a global POS refresh timer, or hidden-module polling — §39 of Kevin's spec
  prohibits it and check patterns above were removed deliberately.
- New emit sites: inject `{ token: REALTIME, optional: true }`, publish AFTER the repository write, wrap in
  try/catch (realtime is never load-bearing), and build payloads with `makeEnvelope` — ids/versions only.
  `payloadViolations()` is the guard: phone/email/notes/card data must never ride an event.
- Event names live in BOTH `realtime-core.ts` files (api + pos-web) — keep the catalogs and AFFECTS maps mirrored.
- Screens subscribe with `useRealtime(screenOrScreens, refetch)` — it already provides coalescing, reconcile, and
  the visible-only fallback. Reports use `useReportCadence()` from reportsCommon. Owner/Tech apps: the stream
  hooks emit 'reconcile'/'fallback'/'poll' meaning REFETCH REGARDLESS — consumer filters must pass them through.

## Frontend conventions established Jul 27, 2026 (all five apps)
- **Money input**: never `parseFloat(x) * 100`. Use `parseDollarsToCents` — `@aipowersalon/ui` in pos-web,
  `src/lib/money-input.ts` (hand-synced mirror) in admin/owner/tech/customer. It returns **null** on invalid
  input. At sites with a downstream validity guard, propagate `?? NaN` or check for null — a bare `?? 0` turns
  junk text into a silent $0.00 record. Percent fields are not money: leave them alone.
- **No native dialogs.** `window.prompt` / `window.confirm` must not reappear.
  - Short text answer → `useInlineAsk()` (admin: `src/components/InlineAsk.tsx`) or a per-screen inline editor
    in pos-web. Options: `optional`, `minLength`, `multiline`, `defaultValue`, `confirmLabel`.
  - Yes/no on a destructive action → `useInlineConfirm()` (`src/components/InlineConfirm.tsx`, mirrored per app).
    Pass `{ destructive: false }` for non-destructive flows so the button isn't red.
  - Call-site shape: `doThing = (args) => askConfirm(q, () => { void reallyDoThing(args); }, { confirmLabel })`
    with a **named continuation function** — don't inline the whole tail in the callback.
  - Mount `{askUi}` / `{confirmUi}` inside **the component that owns the hook** — in multi-component files that
    is often a sub-component (CatalogTab, Detail, a modal), NOT the screen root. Never wrap a whole file's
    return in a fragment to do it.
  - Preserve each site's original semantics: an optional reason stays optional, a required one stays required,
    a minimum length stays enforced, an extra high-risk step stays.
- **Never write a migration without grepping `db/migrations` for the column/concept first.** The schema is ahead
  of the code in places; a duplicate column was written and reverted because 379 already had it.


## Session addendum — Jul 27, 2026 (read this before changing frontend code)

Three conventions were established platform-wide this session and are enforced by gates. Breaking them fails CI.

1. **Money input** — never `parseFloat(x) * 100`. Use `parseDollarsToCents` (packages/ui for pos-web; mirrored at `src/lib/money-input.ts` in the other four apps). At a call site with a downstream validity guard use `?? NaN` or an explicit null check — **never `?? 0`**, which turns rejected input into a silent $0.00. Percent fields are not money. Gate: `npm run -s check:money`.
2. **Dialogs** — no `window.prompt/confirm/alert`. Text input → `useInlineAsk()`; yes/no → `useInlineConfirm()`. Mount `{askUi}` / `{confirmUi}` inside the component that owns the hook, not the screen root. Preserve the original semantics (`{optional:true}`, `{minLength:n}`, `{destructive:false}`). Gate: `npm run -s check:dialogs`.
3. **Before writing a migration**, grep `db/migrations` for the column or concept first. The schema is ahead of the code in places — a duplicate migration was written and deleted this session after the database's own CHECK constraint caught it.

**A defect class worth knowing about**: 31 controls were found whose click handler only printed a message and never called an API. They render, they typecheck, tests pass, and no gate flags them. Three turned out to have working backends all along. When auditing a screen, check that each control *does* something, and that any "not connected yet" message is true rather than describing an action that did not happen.

**Auditing a screen against a mockup**: bundle the screen file with the components it imports before searching (an element in a child file reads as missing otherwise); remember that data-driven lists have no literal in the screen file (server-supplied tabs, for example); and a score of zero means you opened the wrong file — resolve the sidebar route to its component first.

## Jul 28, 2026 — guarantee proration conventions (read before touching guarantee/payroll-build code)
- **The fail-safe is deliberate:** a zero/unknown proration denominator pays the FULL guarantee with a
  `prorationNote` — never $0. Do not "fix" it back. Withholding a guarantee belongs to the eligibility levers
  (`require_clocked_in`, `min_hours_required`), which now see real attendance from `technician_shifts` via
  `PayrollAutoBuildAdapter.periodFacts` (best-effort; a facts failure never fails a payroll build).
- **Never fabricate `scheduledHours`.** The schema models a shift as a date + actual punches; there are no scheduled
  start/end columns. Until that's modeled (a product decision), the hours-based modes fall back to the full
  guarantee with the note. If you add scheduled-hours modeling, feed it through `periodFacts` — don't invent a
  second facts path.

## Jul 28, 2026 — conventions from the six-unit session (read before adding metrics, clients, or cost logic)
- **Check the `@Controller` mount path BEFORE writing a frontend client.** A new Help Center client called `/help/*`
  when the controller mounts at `tenant/help`; `check:crosswire` caught all seven as would-404s. Run that gate after
  any new client method.
- **An absent SOURCE is never a zero MEASUREMENT.** Metrics that can't be sourced return
  `{ value: null, available: false, reason }` and render `—`, not `0`. Zero attempted campaign messages is not a 0%
  delivery rate; nothing answered yet is not a 0-minute response time. Genuine zeros still render 0. Same family as
  the guarantee fail-safe and the missed-call displays.
- **Cost eligibility defaults to NOT deductible.** Wrongly deducting understates what the platform owes a salon;
  wrongly excluding only understates the platform's own retention, so doubt resolves against the platform. Never
  silently deduct an unrecognized category — name it and exclude it (`residual-eligible-expenses.ts`).
- **Never write a battery total into a doc before every shard has returned.** It happened once this session
  (5,983/+14 written, actual 5,979/+10) and was caught only by summing the logs. Sum the shard logs, then write.
- **Audit before building — three times this session the backend already existed** and only the derivation or the
  wiring was missing (scheduled hours since migration 003; the whole Help Center backend; communications sources).
  A migration was nearly written for data that had been modelled for months.

## Jul 28, 2026 — the gate battery is THIRTEEN, and two apps live outside the type system
`check:html` joined the battery: `check:di sql crosswire dead-client unreached perms public nav types-drift tenant
dialogs money html`. It exists because `go-check-in-kiosk` and `go-check-in-admin` are **shipped production
surfaces written as single HTML files** — no tsconfig, no test suite, hand-written JavaScript. Before today nothing
opened them at all; `tsc` cannot see them, and vitest has no entry point for them.

If you edit either file, run `npm run -s check:html`. It fails on: a script block that does not parse, a
`getElementById`/`querySelector('#…')` reference with no matching element, a hardcoded `localhost`/IP origin (the
API base must stay configurable via `?api=` / `window.APS_API_BASE`), and credential patterns. It does **not**
check runtime DOM behavior — that needs a browser harness against a live API, and those apps still deserve a real
restructuring.

## Jul 28, 2026 — runtime coverage for the HTML apps: `npm run e2e:html`
`check:html` is the static floor; `e2e:html` (scripts/e2e-html-apps.mjs) is the runtime half — real Chromium drives
both single-file apps through their primary journeys against a stub API that records every call and **asserts the
walk-in payload server-side** (customerId + chosen serviceIds + chosen technicianId), so a dropped field fails even
when the screen looks right. Proven by sabotage: commenting out the technician field in the kiosk's payload fails
the run (readably — journeys are wrapped so a stall reports "did not complete", never an uncaught TimeoutError).
Stub field names were read from the files, not guessed — the device row keys off `d.deviceId`, not `d.id` (that
exact mistake cost one red run). Chromium may need `npx playwright install chromium-headless-shell` once per
sandbox. Not part of the vitest battery. Run it after editing either HTML file, alongside `check:html`.
