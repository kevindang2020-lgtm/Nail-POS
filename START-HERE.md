# START HERE
### AI PowerSalon — developer entry point (rewritten Oct 10 2026, BUILD_PLAN Phase 15; the Oct 1–3 version is kept at the end)

Multi-tenant nail-salon platform: one NestJS API (`apps/api`) on PostgreSQL 16, domain code in `modules/*`, shared
libraries in `packages/*`, React/Vite web apps in `apps/*` (four of them also ship as Capacitor native apps). npm
workspaces, Node 22. Host of record: Railway.

## 1. Where things stand (read these, in this order)
| Read | For |
|---|---|
| [`DEVELOPER_HANDOFF_FINAL_2026-10-28.md`](DEVELOPER_HANDOFF_FINAL_2026-10-28.md) | **start here (Oct 28 2026)** — the packaged code, the pilot-scan verdict, and in order what is left: K-12, hosting, Fiserv CardPointe MIDs + UAT, Tap to Pay, Twilio / Verify / A2P 10DLC, the other accounts |
| [`DEVELOPER_HANDOFF_2026-10-13.md`](DEVELOPER_HANDOFF_2026-10-13.md) | the Oct 13 merge handoff — the one merged tree (this platform + the developer's Oct 6 tree + the other chat's Oct 12 package), the security actions, what is finished per mandate, what the developer still has to finish, and how to deploy it over a running salon |
| `BUILD_PHASES_REPORT.md` | what BUILD_PLAN Phases 1–15 built, each with evidence, tests, mutation checks and what it does NOT do — the newest phase is last |
| `CONSTITUTIONS_STATUS_2026-10-08.md` | the thirteen Architecture Constitutions and seven module specs, one verdict each |
| [`docs/PROGRAMME_DOD_STATUS.md`](docs/PROGRAMME_DOD_STATUS.md) | every Definition-of-Done line of every constitution: DONE / DECIDED / HOSTING, with Kevin's exact action (written in Phase 15) |
| `BUILD_PLAN_2026-10-06.md` | the 15-phase plan and its working rules (failing test first, reuse never duplicate, mutation checks) |
| `CHANGELOG_HANDOFF.md` | change log across sessions |
| `docs/HOSTING_ACTIONS_FOR_KEVIN.md` | **everything only Kevin (the account owner) can do** — Railway, AWS, Cloudflare, GitHub, providers, devices; in order: before go-live, before a second replica, later |

Older status documents (`CONSTITUTIONS_CONFORMANCE_2026-10-03.md`, `STATUS_CHECK.md`, `COMPLETE_MODULE_WIRING_MATRIX.md`,
`SAFETY_COMMUNITY_PHASE1.md`, `PERMISSION_AUDIT.md`, …) carry a dated "superseded / re-verified" note at the top saying
what changed. When a document and the code disagree, the code and the gates win.

## 2. Build
```bash
npm ci --ignore-scripts                    # always --ignore-scripts for this repository
npm run build:packages                     # packages/* (order matters: packages → modules → API)
npm run build:modules                      # node tooling/modules/build-modules.mjs
npm run build:api                          # apps/api → apps/api/dist (main.js = API, worker.js = job worker)
npm run build:frontends                    # every web app → dist-frontends/<app> (VITE_API_BASE=https://<api> for a deploy)
```
One web app: `cd apps/<app> && npx vite build && npx tsc --noEmit -p tsconfig.json`. Two full builds at once race on
`dist/` — run one at a time.

## 3. Run locally
```bash
USE_DOCKER_DB=1 npm run setup:local        # Postgres 16 in Docker (docker-compose.yml), migrations, seeds, API build
#   or: DATABASE_URL=postgres://… npm run setup:local   (your own Postgres)
cp .env.example .env                       # then fill the values for local use; production values live only in Railway
npm run dev                                # API (node --env-file=.env apps/api/dist/main.js) + every web app (concurrently)
```
Migrations alone: `npm run db:migrate` (`apps/api/scripts/migrate.mjs`; forward-only, advisory-locked, checksummed;
`MIGRATE_DATABASE_URL` overrides `DATABASE_URL` for it). Seeds: `npm run db:seed`, `npm run db:seed:demo`.
`setup:local` prints the local test accounts. Locally an MFA prompt accepts any 6 digits for a user with no enrolled
authenticator; production (`NODE_ENV=production`) or `MFA_REQUIRE_TOTP=1` requires a real enrolled TOTP
(`packages/auth/src/security.ts` `requireRealTotpEnrollment`).

## 4. Test
| Lane | Command | Notes |
|---|---|---|
| Gates + audits | `npm run ci:gates` (`node tooling/ci/run-gates.mjs`) | every `check:*` gate (42 on Oct 10, plus Phase 15 additions) and 12 audits incl. `architecture:test`; needs the packages / modules built; must stay green |
| API | `npm run ci:test:api` (or `cd apps/api && TZ=UTC npx vitest run <files>`) | sharded; PGlite gives real-Postgres semantics for `*.pgtest.vitest.spec.ts` |
| Modules / apps / packages | `npm run ci:test:modules` · `ci:test:apps` · `ci:test:packages` | one module: `cd modules/<m> && TZ=UTC npx vitest run` |
| Real-Postgres race lane | `PG_RACE_URL=postgres://…/race npm run ci:test:race` | needs a MIGRATED database; FAILS (never skips quietly) without `PG_RACE_URL`, on any skipped test, or when no file is found |
| Real browser | `npm run perf:booking -w apps/pos-web` · `npm run perf:realtime -w apps/pos-web` · `apps/api/scripts/live-phase*.mjs` | run before every release — jsdom once passed while every POS screen crashed in Chromium |
| Local pre-commit (opt-in) | `npm run hooks:install` (remove: `npm run hooks:install -- --uninstall`) | Security Deep Scan §144: every commit's STAGED content is scanned for secret shapes and credential files, the supply-chain injection gate runs, and `gitleaks protect --staged` when gitleaks is installed (`tooling/security/pre-commit.mjs`) |
| DoD scripts | `node apps/api/scripts/control-plane-dod-check.mjs` · `audit-ai-dod.mjs` · `observability-dod-check.mjs` · `security-dod-check.mjs --run` | per-constitution Definition of Done |

CI (`.github/workflows/`): `security.yml` (fast checks, tests, race lane on a Postgres 16 service, full scan),
`build-image.yml` (docker build, image + IaC scan, SBOM; publish on manual dispatch), `mobile.yml` (Android build,
iOS sync). Rules for every change: write the failing test first, then the fix, then a mutation check; never write a test
whose result depends on today's date.

## 5. Deploy
`DEPLOYMENT.md` is the reference (one image, two entry points: `node dist/main.js` and `node dist/worker.js`; Railway
pre-deploy `db-preflight.mjs && migrate.mjs`; least-privilege DB logins; every environment variable). First-deploy click
path: `DEPLOY_RAILWAY.md`. Recovery: `DISASTER_RECOVERY.md`, `RUNBOOKS.md`. Secrets: `SECURITY_SECRETS.md` (generated
from `apps/api/src/common/secrets-inventory.ts`) and `SECRETS_REQUIRED.md`.

## 6. Map of the code
| Path | What |
|---|---|
| `apps/api` | the one backend — `src/main.ts` (HTTP), `src/worker.ts` (jobs), `db/migrations` (forward-only SQL), `scripts/` (migrate, gates, audits, DoD, drills, live proofs), `openapi/manifest.txt` (every route, reviewed by `check:openapi`) |
| `modules/*` | domain modules (booking, checkout, customers, identity, payments, queue, workforce, ai, safety, super-admin, …) |
| `packages/*` | shared libraries (database, permissions, auth, events, realtime-contracts, api-contracts, money, date-time, media, observability, mobile-sdk, …) |
| `apps/pos-web` · `admin-web` · `owner-web` · `tech-web` · `customer-web` · `manager-pay-web` · `customer-display` | the React/Vite web apps (POS, Super Admin, owner, technician, customer, Tap to Pay, customer display); customer / tech / owner / manager-pay also build as Capacitor apps |
| `apps/booking-public` · `apps/go-check-in-kiosk` | static HTML apps (public booking page; check-in kiosk, Capacitor-wrapped). The legacy single-file apps `booking-html`, `booking-schedule-html` and `go-check-in-admin` were removed in Phase 15 — their replacements are customer-web → Book, pos-web booking and admin-web → Check-In Devices (`REPOSITORY_ARCHITECTURE_AUDIT.md`; recover from git with `git checkout 62a1875d -- <path>`) |
| `tooling/` | CI gate runner, architecture tests, module build, permission docs generator |
| `docs/` | programme DoD status ([`docs/PROGRAMME_DOD_STATUS.md`](docs/PROGRAMME_DOD_STATUS.md) — the final per-constitution count and every open / HOSTING / decided line), hosting actions, retention policy, permission docs, audit evidence (`docs/audit-2026-10-06/`, `docs/audit-2026-10-08/`) |

Generated references (regenerate, never hand-edit): `API_INVENTORY.md` (`cd apps/api && node scripts/generate-api-inventory.mjs > ../../API_INVENTORY.md`),
`docs/PERMISSIONS.md` (`node tooling/permissions/generate-permission-docs.mjs`), the realtime catalog
(`generate-realtime-catalog.mjs`; gate `check:realtime-catalog` fails on an UNCLASSIFIED event or a stale catalog), `SECURITY_SECRETS.md`.

## 7. Standing rules
- **Only one working session at a time on this repository** — parallel sessions committing at once overwrote work
  (Sep 30, Oct 1).
- Never commit credentials; the repository ships no values (audits `db credentials` and `hidden code` in the gate run; `secrets-exposure-check.mjs`; GitHub secret scanning is HOSTING A13).
- Kevin's decisions recorded so far stay decided unless he reopens them (the "Decisions" sections of
  `BUILD_PHASES_REPORT.md` and `docs/HOSTING_ACTIONS_FOR_KEVIN.md`).
- Security actions outside the code that are Kevin's alone (also in `docs/PROGRAMME_DOD_STATUS.md` / the Phase 15
  report): rotate the external database password and close port 5432 (credentials exist in git history); re-key the
  committed Android upload keystores through Play App Signing, then delete them and purge history; the clean-up from
  the September merge below.

---

## History — START-HERE as of Oct 1–3 2026 (superseded Oct 10 2026, kept as written)
Corrections to it, checked against the code on Oct 10: the "State at hand-off" table is Oct 3's (493 migrations, 25
gates — today 558+ migrations and the gate list above); "the work of Constitutions 1–6 is NOT in this repository" is no
longer true (all thirteen are built here — `CONSTITUTIONS_STATUS_2026-10-08.md`); Constitution 7 remains 71 DONE · 2 by
decision; `tooling-scripts/save.sh` is not in this repository — the bundle is refreshed at the end of each phase.

#### (original heading) START HERE
#### AI PowerSalon — package of October 1, 2026, evening (Functional Decisions gaps built; Smooth Refresh built; Constitution 7 at 71/73)

#### Open these first
000. **`AUTHENTICATION_AUDIT.md`** — Constitution 3 is being re-applied to this tree (Kevin, Oct 3): the audit and the §163
    build order mapped onto today's code. Step 1 (realms) is next.
00. **`CONSTITUTIONS_CONFORMANCE_2026-10-03.md`** — the thirteen constitutions vs this repository. Seven are built here
    (7–13); the work of Constitutions 1–6 is NOT in this repository (built in September on another copy, never applied).
0. **`FUNCTIONAL_DECISIONS_AUDIT.md`** — the 38 Developer Functional Decisions checked against the code, then every
   ranked gap built (D22, D20, D34, D27, D12, D15, D30, D29, D7, D9, D38, D31, D35, D33, D1) with commit hashes, the bugs
   found on the way, and what is still open. **Read its "open" items and the confirmed behaviour changes below first.**
1. **`SMOOTH_REFRESH_STAGING_RUNBOOK.md`** — the one remaining job for the Smooth Refresh spec: what to run on staging
   and production, in order, with pass/fail criteria. **Do the pre-deploy index step before deploying.**
2. **`SMOOTH_REFRESH_WIRING_CHECK.md`** — all 123 spec sections checked against the code, with evidence for each.
3. **`SMOOTH_REFRESH_REPORT.md`** — the spec §123 final report: the cause of the screen shading, every change, measured
   numbers, risks, and the follow-up log.
4. `RESUME-CONSTITUTION-7.md` — Constitution 7 (Super Admin & Control Plane): 71 DONE · 2 PARTIAL · 0 NOT DONE; the
   two PARTIALs are design decisions, and how to reopen them.
5. `MERGE_REPORT_2026-09.md` — the developer-tree merge (malware found and removed, security holes fixed, hash table).
6. `ARCHITECTURE_AUDIT.md` — the audit that preceded the Smooth Refresh build.

### The repository
`AIPowerSalon-repo.bundle` — branches `master` and `developer-2026-09`, plus git notes. Restore with:
`git clone AIPowerSalon-repo.bundle AIPowerSalon && cd AIPowerSalon && git fetch origin 'refs/notes/*:refs/notes/*'`
then `npm ci --ignore-scripts` (always `--ignore-scripts` for this repo).
**Delete any copy of the Sep 29 bundle, and any clone made from it** — its history still contains the malware.

### State at hand-off — verified on this exact tree (`5258b2d` + this document, Oct 3 2026)
| Check | Result |
|---|---|
| API (6 shards) | 1,604 pass; opt-in real-Postgres files skip here and run with PG_RACE_URL (below) |
| Harness specs (`*-core.spec.ts`) | 124 pass, 0 fail (were 10 failing since the Sep 28 merge — found and fixed Oct 1) |
| Apps | pos-web 859 · admin-web 855 · owner-web 264 · customer-web 229 · tech-web 108 · manager-pay 57 · customer-display 43 |
| Module suites | all 25 pass (super-admin 1,403 · ai 1,409 · booking 447 · workforce 406 · checkout 373 · identity 365 · …) |
| Real Postgres 16 | 493 migrations apply fresh; schema matches the code (653 tables); every `*.postgres*.vitest.spec.ts` passes together on one fresh database — 71 tests (booking 13, checkout 16, identity 7, customers 7, gift cards 2, queue 4, API 22) |
| Real-Postgres race suites (opt-in `PG_RACE_URL`) | booking 7 · customers 3 · checkout 2 · gift card 1 · queue 2 · reconciliation 3 · control plane 2 |
| Real-browser checks (Chromium) | `npm run perf:booking -w apps/pos-web` OK · `npm run perf:realtime -w apps/pos-web` 13/13 |
| Gates | 25 gates + 3 audits |
| Constitution 7 DoD | 71 DONE · 2 PARTIAL · 0 NOT DONE of 73 |

### Before every release
Run the two real-browser checks above. They exist because the sync layer once crashed **every POS screen in Chromium**
("Illegal invocation") while every unit test passed — jsdom cannot stand in for a real browser.

### Behaviour changes made Oct 1–2 — CONFIRMED by Kevin (Oct 2)
All three are decided product behaviour now; do not revert them.
1. **Front-desk price overrides:** a changed price or custom service on a booking / walk-in now needs a manager
   (checkout override permission) and a reason. The New Booking / Walk-In screens show "Edit price" only to staff who
   have that permission, and require a reason.
2. **Auto-lock:** every POS device now locks after 5 idle minutes unless switched off in Security settings (it was off
   by default, and turning it off used to delete the setting). The SESSION is locked on the server too (every tab; 423
   until the PIN). After 8 hours locked, the session ends — full sign-in.
3. **Customer self-signup** chooses a salon (Oct 3, Kevin): search by name / city / ZIP or "Use my location", or a salon
   code. Never guessed (customers used to be placed in the platform's OLDEST salon). The chosen salon is the default;
   Profile → My salon changes it (same salon business: at once; another one: their account there, sign in again).

### If the work environment resets
`/home/claude` (the working tree), `/tmp` and installed tools are NOT kept across a container reset — it happened Oct 2.
The bundle `AIPowerSalon-repo.bundle` in outputs is refreshed after EVERY commit (`tooling-scripts/save.sh`); restore with
`git clone AIPowerSalon-repo.bundle full`, then `npm ci --ignore-scripts`, `npm run build:packages`, `npm run
build:modules`, and reinstall postgresql-16 for the real-Postgres tests. `tooling-scripts/` also holds the battery and
boot-check scripts.

### What is left
- **Functional Decisions, still open (details in the audit):** D22 inquiry response shape to confirm against the
  CardPointe sandbox.
- **Smooth Refresh — needs your environment (Kevin):** follow `SMOOTH_REFRESH_STAGING_RUNBOOK.md`: pre-build migration
  484's indexes CONCURRENTLY on production, confirm on the real POS devices that the board renders and does not dim
  every 15 s, and take the latency / scale measurements the spec asks for (§3, §97–§99, §101).
- **Constitution 7 — decisions, not missing work:** the `/platform` API is an alias of `/super-admin`; the Super Admin
  app is one app with permission-aware navigation. Reopen either only if you want them changed.
- **Security clean-up from the merge — your actions, outside the code:**
  1. Treat the developer's computer and GitHub account as compromised; tell them.
  2. Anyone who ran npm or ESLint on the developer's code: change passwords/tokens from a clean device.
  3. Anyone who used Face ID in the developer's test builds: turn it off and change their password.
  4. Replace the Sep 29 bundle as above.

### To resume in a new chat
Upload this zip and say what you want next, e.g. *"Resume from START-HERE.md — staging results attached"*.
**Only one working session at a time on this repository** — on Sep 30, and six more times on Oct 1, two sessions
committed to it at once. Every collision was backed up (`parallel-session-backup/`), reviewed and re-verified, but it
is how work gets overwritten.
