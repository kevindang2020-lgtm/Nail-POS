# NEW_CHAT_HANDOFF_2026-11-14.md — start the next chat here

Supersedes `NEW_CHAT_HANDOFF_2026-11-13.md` (kept for history). All 160 SUNMI PDFs, the extras backlog, the round-12
standalone booking board / CPad walk-in / Team Tips build, Kevin's Nov 13 decisions, and the round-12/13 open items are
done to the end of code. Only hardware testing and outside-account rows remain.

## 1. Where the code is
- **GitHub:** `kevindang2020-lgtm/nail-pos` (GitHub now redirects to `kevindang2020-lgtm/Nail-POS`; point the remote there),
  branch **`merge-github-main`**, HEAD **`71e56734`** (plus this handoff commit).
- Restore from GitHub: `git clone https://github.com/kevindang2020-lgtm/Nail-POS && cd Nail-POS && git checkout merge-github-main && npm ci --ignore-scripts` (Node 22).
- Restore from the package: see `PACKAGE_README.md` in the package (join the bundle parts, verify checksums, clone).
- Database: PostgreSQL 16; `MIGRATE_DATABASE_URL=… node apps/api/scripts/migrate.mjs` — 817 migrations, through **993**.

## 2. Verified at 71e56734 (all run in the closing session, Nov 13–14 2026)
| Check | Command | Result |
|---|---|---|
| Gates | `node tooling/ci/run-gates.mjs` | 57 gates + 26 audits passed (83/83) |
| POS | `cd apps/pos-web && TZ=UTC npx vitest run` (~17 min) | 2,950 / 2,950 |
| API | `cd apps/api && TZ=UTC npx vitest run` (~30 min, alone, no `DATABASE_URL`) | 3,356 passed, 138 skipped |
| Real-Postgres race lane | `PG_RACE_URL=postgres://… node tooling/ci/run-race-tests.mjs` (migrated PG16) | 430 / 430, 0 skipped — run twice back-to-back on one database |
| Module suites | queue 872 · payments 556 · booking 814 · booking-schedule-board 65 | all passed |
Notes: POS typecheck needs `NODE_OPTIONS=--max-old-space-size=6144`. Rebuild `packages/api-contracts` (`npx tsc -p .`)
and any changed `modules/*` (`npx tsc -p tsconfig.json`) before typechecking dependents.
A local PG16 for the race lane: `initdb -A trust`, start on a port, `createdb race`, `DATABASE_URL=… npm run db:migrate`.

## 3. What was done in this chat (newest first)
**Round 14 — open items closed (commit 71e56734)**
- Two-station booking race on real Postgres: `modules/booking/src/booking/booking-two-station-board.postgres-race.vitest.spec.ts`
  (separate pg pools; same-slot book · create vs drag · same-card drag with version → VERSION_CONFLICT; 25 rounds each).
- Race-test fixture bugs found by running the lane (test-only fixes): reminder 23:59 end time; AI Front Desk fixed key
  hash `'h'`; card-data scan reading the hex checkout version as a PAN.
- AI optimizer marks on the new board: package prop `overlay` (`BoardOverlay` in `packages/booking-schedule-board`),
  POS mapping `apps/pos-web/src/screens/booking/schedOverlay.ts`.
- Per-location walk-in settings: migration 993 `branch_walkin_settings` (NULL = same as salon; six switches);
  `GET /pos/settings/go-check-in/branches`, `PUT …/branches/:branchId`; POS panel `BranchWalkInSettings.tsx`.
- Team Tips: `branchId` scope on all tips reads + export; `GET /pos/payments/tips/branches`; Location select + Export CSV.

**Round 13 — Kevin's Nov 13 decisions (commit 9523a5ea)**
- Print Schedule: stays OFF (no print anywhere).
- CPad: guests may pick a technician — **ON by default** (migration 992 sets the default and turns it on for existing salons).
- CPad: **full service menu** (every active service in an active category; the online-booking flag no longer hides it).
- Tips with 3+ technicians: **equal split to the exact cent by default**; proportional only if the salon chooses it;
  the customer's explicit split still wins. Owner UI shows "Equal (default)".

**Round 12 — four PDFs + standalone board zip (commit 2b065a40)**: Booking Schedule Board merged on `/pos/booking`
(Classic board switch kept), six KPI cards, 200-technician proof, CPad 14 walk-in service selection (Section 4A,
migrations 990–991), Team Tips rebuilt on the Payments tip read model. Details: `docs/handoff/SUNMI_BATCH9_2026-11-10.md`.

## 4. Standing rules (Kevin's, verbatim where quoted)
- "never report a test/build/gate as passing unless it ran in this session."
- "No PAN, CVV, passwords, terminal keys or portal credentials in code, logs, tests or evidence."
- "No live card transactions before Fiserv certification · no flat 3% surcharge · production payments disabled."
- "Money = integer cents. Payments = Fiserv + Clover only."
- "One backend… Extend, never duplicate."
- New SQL runs on PG16; pgcrypto is not guaranteed.
- New Vietnamese text is marked `// DRAFT — Kevin reviews`. Vietnamese is for the web POS only.
- Native iPhone Tap to Pay is read-only.
- Never remove or rename modules, routes or nav. Never invent counts; show "—".
- No receipt printer (REMOVED). No printing controls at all (check:no-print; OWNER DECISION).
- Fix gate failures in code, not by raising baselines.
- Read-only previews never move money, change history or send anything.
- Commit as Kevin Dang <kevindang2020@gmail.com>. Push to the `github` remote, branch `merge-github-main`, only after
  gates + POS + API pass.
- Backlog marks name their evidence (files + tests with counts).
- Never reference casino projects in the context of AIPowerSalon.
- Kevin's style: terse; "continue" = do the next logical unit fully, no confirmation gates, honest status at the end.

## 5. Kevin's decisions (all built)
- In-app follow-ups respect the **SMS** STOP list (email unsubscribe not included).
- Churn is judged by **Customer Retention only** (Profile Assistant, Churn Watch, CI overview and the server flag).
- Closed cash records are **reopenable** (`cash_handoff.reopen`, owner + manager; migration 846).
- A customer who texted STOP **still gets booking verification codes** (`consent-boundary.ts`).
- Nov 13: Super Admin warnings — **high / critical always go; low / medium follow the owner's own SMS / e-mail switches**
  (`accountNoticeCategory` in `packages/api-contracts/src/tenant/me-prefs.ts`; warning dispatch job).
- Staff notification switches are enforced through one rule (`staffNotificationAllowed`) + one reader
  (`modules/communications/src/notifications/staff-notification-prefs.ts`); security / sign-in always go.
- Nov 13: Print Schedule OFF · CPad technician choice ON · CPad full services · 3+ technician tips split equally (exact cents).
- Nov 13: walk-in settings can differ per location (NULL = follow the salon); Team Tips filters by location for salon-wide logins only.

## 6. Backlog state (`docs/handoff/EXTRAS_BACKLOG.md`)
About 1,360 real task rows: ~1,336 done with evidence (BUILT or EXISTS), 447 parser noise, 4 removed by decision.
**24 rows are not fully done — every one needs something outside the code:**

**A. Kevin's switches / values (built OFF or blank; behaviour unchanged until set)**
1. 200-Technician Large Salon 4 · 08 — bulk technician invites (salon switch + platform kill switch; preview, 200 cap).
2. ADD-ONS MANAGEMENT · 06 — add-ons use up stock (recipe per add-on; salon switch).
3. Device Health · 06 — assign devices to employees (optional; audited).
4. AI Usage Limits · 07 — Super Admin AI price table (empty; every version must answer "existing salons keep previous price").
5. Reviews Reputation · 07 — price per review-request text (blank → "not available").
6. Membership Overview · 07 — Twilio A2P message template approval.

**B. Outside accounts / feeds**
7. Payment Terminals · 09 — Clover/Fiserv terminal API account + certified device.
8. PAYMENTS MONEY · 04 — processor settlement / batch report.
9. Device Integration Logs · 11 — terminal firmware feed.
10. AI Front Desk · 09 — Retell + Twilio usage-billing access.
11. AI Receptionist · 09 — Retell + Twilio usage-billing access.
12. Phone Messaging Text Messaging Setup · 09 — the salon's Twilio account (number webhook check).
13. AI Usage Limits · 08 — AI billing provider account (invoice reconcile).
14. GLOBAL LOYALTY REWARDS · 04 — a live token-funding provider.
15. AI Business Reports · 15 — an AI model provider key in the API environment.

**C. Hardware / review**
16. PRODUCTION-READY POS 5 · 04 — a real SUNMI FLEX 3 at 100 % zoom (open each module, press Screen Check); also the new\n    booking board and the CPad 14 walk-in flow on the real devices.
17. Individual Technician Tipping · 04 — a real SUNMI customer display + the native iPhone build (card routing).
18. English Vietnamese POS Localization · 07 — Kevin's review of ~4,100 Vietnamese draft strings.
19. AI Booking Assistant · 14 — screenshots in support reports need the OS screen-sharing prompt (staff attach their own).

**D. K-12 server / account steps (PRODUCTION-READY POS 5 · 01, 05–08 = rows 20–24)** — `docs/K12_RUNBOOK.md`, checked by
`node tooling/k12/verify-k12.mjs` (never prints a secret): rebuild the machine → rotate every credential, revoke the old
Firebase key, new Play upload key → new PostgreSQL password → close public port 5432 → validate → only then push the
rewritten history and make the CI gitleaks job blocking.

Also outside code: Fiserv / CardPointe UAT certification; Textract / S3 / scanner for live OCR (`HOSTING_ACTIONS_FOR_KEVIN.md` A10–A11).

## 7. What a new chat can do next
- Hardware day: run the board, CPad 14 walk-in (per-location settings, technician choice, full menu) and Team Tips on a
  real SUNMI FLEX 3 + CPad 14; record results against section 6C.
- When Kevin sets a value or switch (6A) or an outside account arrives (6B): wire it, run its live check, close the row.
- Kevin's review of the Vietnamese drafts: `docs/handoff/VI_DRAFT_REVIEW.md` (5,692 rows; every `// DRAFT — Kevin reviews`).
- CI: add a job that starts PG16, migrates, and runs `tooling/ci/run-race-tests.mjs` (the lane is green now).

## 8. How the work was run (if parallel agents are used again)
- One worktree per agent (`git worktree add ../wtN -b extras-agentN`), symlink `node_modules`, copy `packages/*/dist` and
  `modules/*/dist`. Each agent gets a migration number range (next free: **994+**) and a marks file.
- Merge one branch at a time; i18n conflicts → `tooling/handoff/keepboth.py <files>` then check duplicate keys;
  never commit while `^<<<<<<< ` / `^>>>>>>> ` markers remain (`git grep`).
- After merges run the regenerators (list in `tooling/handoff/AGENT_BRIEF.md` §0 / `docs/handoff/SUNMI_BATCH9_2026-11-10.md`),
  review `node apps/api/scripts/role-matrix.mjs --diff` against sibling routes before `--write`, then gates → POS → API.
- Gate lessons that recur: B-12 tenant-consistency trigger on every tenant FK; idor-routes fixture + BRANCH_TABLES for id
  routes; db-ownership `--write` + kysely.types for new tables/columns; no GET handler named like a mutation; no role-name
  checks (capabilities / permissions); every `tenant_settings` writer calls `notifySettingsChanged`; audit writes through
  `modules/audit` (`recordAuditStrict` / `recordPlatformAuditStrict` inside a transaction); literal table refs (no
  `sql.table(var)`); named api-contracts types on new routes; no `select *`; POS strings behind `t()`.

## 9. Narrative history
Round notes: `docs/handoff/SUNMI_BATCH9_2026-11-10.md` (rounds 1–14) and the earlier `SUNMI_BATCH*` files.
