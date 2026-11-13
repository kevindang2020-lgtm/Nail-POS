# NEW_CHAT_HANDOFF_2026-11-13.md — start the next chat here

Kevin's 160 SUNMI PDFs (batches 1–9) and the optional extras backlog have been worked through to the end of what code can
do. This file is the single place a new chat needs: where the code is, what is verified, the rules, the decisions, and
exactly what is left.

## 1. Where the code is
- **GitHub:** `kevindang2020-lgtm/nail-pos`, branch **`merge-github-main`**, HEAD **`98dc725a`** (plus this handoff commit).
- Restore: `git clone https://github.com/kevindang2020-lgtm/nail-pos && cd nail-pos && git checkout merge-github-main && npm ci`
  (Node 22). Database: PostgreSQL 16; `cd apps/api && MIGRATE_DATABASE_URL=… node scripts/migrate.mjs` (migrations through 971).
- Coordination tools from this chat are saved in `tooling/handoff/` (agent brief with every decision and gate lesson,
  the backlog marker `bl.py`, `applymarks.py`, the i18n merge helper `keepboth.py`, `addkeys.py`).

## 2. Verified at 98dc725a (all run in the closing session, Nov 13 2026)
| Check | Command | Result |
|---|---|---|
| Gates | `node tooling/ci/run-gates.mjs` | 57 gates + 26 audits passed (83/83) |
| POS | `cd apps/pos-web && TZ=UTC npx vitest run` (~17 min) | 2,904 / 2,904 |
| API | `cd apps/api && TZ=UTC npx vitest run` (~30 min, run it alone) | 3,356 passed, 138 skipped |
Notes: POS typecheck needs `NODE_OPTIONS=--max-old-space-size=6144`. Run the API suite without `DATABASE_URL` set.
After merging work, rebuild `packages/api-contracts` (`npx tsc -p .`) before typechecking modules.

## 3. Standing rules (Kevin's, verbatim where quoted)
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

## 4. Kevin's decisions (all built)
- In-app follow-ups respect the **SMS** STOP list (email unsubscribe not included).
- Churn is judged by **Customer Retention only** (Profile Assistant, Churn Watch, CI overview and the server flag).
- Closed cash records are **reopenable** (`cash_handoff.reopen`, owner + manager; migration 846).
- A customer who texted STOP **still gets booking verification codes** (`consent-boundary.ts`).
- Nov 13: Super Admin warnings — **high / critical always go; low / medium follow the owner's own SMS / e-mail switches**
  (`accountNoticeCategory` in `packages/api-contracts/src/tenant/me-prefs.ts`; warning dispatch job).
- Staff notification switches are enforced through one rule (`staffNotificationAllowed`) + one reader
  (`modules/communications/src/notifications/staff-notification-prefs.ts`); security / sign-in always go.

## 5. Backlog state (`docs/handoff/EXTRAS_BACKLOG.md`)
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
16. PRODUCTION-READY POS 5 · 04 — a real SUNMI FLEX 3 at 100 % zoom (open each module, press Screen Check).
17. Individual Technician Tipping · 04 — a real SUNMI customer display + the native iPhone build (card routing).
18. English Vietnamese POS Localization · 07 — Kevin's review of ~4,100 Vietnamese draft strings.
19. AI Booking Assistant · 14 — screenshots in support reports need the OS screen-sharing prompt (staff attach their own).

**D. K-12 server / account steps (PRODUCTION-READY POS 5 · 01, 05–08 = rows 20–24)** — `docs/K12_RUNBOOK.md`, checked by
`node tooling/k12/verify-k12.mjs` (never prints a secret): rebuild the machine → rotate every credential, revoke the old
Firebase key, new Play upload key → new PostgreSQL password → close public port 5432 → validate → only then push the
rewritten history and make the CI gitleaks job blocking.

Also outside code: Fiserv / CardPointe UAT certification; Textract / S3 / scanner for live OCR (`HOSTING_ACTIONS_FOR_KEVIN.md` A10–A11).

## 6. What a new chat can do next
- When Kevin sets a value or turns on a switch in section 5A: verify it end to end and close the row (keep evidence).
- When an outside account arrives (5B): wire it behind the existing port, run its live check, close the row.
- Otherwise there is no code work queued from the PDFs. Optional internal items from older handoffs remain in
  `CONTINUE_HERE.md` / `NEXT_STEPS.md` (race lane `ci:test:race`, responsive busy-state report, real-Chromium axe sweep,
  CSP `unsafe-inline`, `as any` ratchet, NestJS 11).

## 7. How the work was run (if parallel agents are used again)
- One worktree per agent (`git worktree add ../wtN -b extras-agentN`), symlink `node_modules`, copy `packages/*/dist` and
  `modules/*/dist`. Each agent gets a migration number range (next free: **972+**) and a marks file.
- Merge one branch at a time; i18n conflicts → `tooling/handoff/keepboth.py <files>` then check duplicate keys;
  never commit while `^<<<<<<< ` / `^>>>>>>> ` markers remain (`git grep`).
- After merges run the regenerators (list in `tooling/handoff/AGENT_BRIEF.md` §0 / `docs/handoff/SUNMI_BATCH9_2026-11-10.md`),
  review `node apps/api/scripts/role-matrix.mjs --diff` against sibling routes before `--write`, then gates → POS → API.
- Gate lessons that recur: B-12 tenant-consistency trigger on every tenant FK; idor-routes fixture + BRANCH_TABLES for id
  routes; db-ownership `--write` + kysely.types for new tables/columns; no GET handler named like a mutation; no role-name
  checks (capabilities / permissions); every `tenant_settings` writer calls `notifySettingsChanged`; audit writes through
  `modules/audit` (`recordAuditStrict` / `recordPlatformAuditStrict` inside a transaction); literal table refs (no
  `sql.table(var)`); named api-contracts types on new routes; no `select *`; POS strings behind `t()`.

## 8. Narrative history
Round notes: `docs/handoff/SUNMI_BATCH9_2026-11-10.md` (rounds 1–11) and the earlier `SUNMI_BATCH*` files.
