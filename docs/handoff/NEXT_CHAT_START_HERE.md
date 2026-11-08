# NEXT CHAT — START HERE

Nov 7, 2026 · Kevin Dang · last code commit: see `git log -1` (base `fb3738c` = the code Kevin uploaded Nov 4) · 23 commits since the
upload, 492 files changed. The June version of this file is in git history (`git show fb3738c:docs/handoff/NEXT_CHAT_START_HERE.md`).

## 1. Copy-paste opening prompt (for the new chat)

> I'm Kevin, solo founder of AIPowerSalon (multi-tenant nail-salon POS SaaS). Attached: `Power-Salon-main.zip` (the
> full repo WITH git history). Unzip it, read `docs/handoff/NEXT_CHAT_START_HERE.md` first, then
> `docs/handoff/DEVELOPER_HANDOFF_2026-11-05.md` and `docs/handoff/SWEEP_REPORT_2026-11-05.md`. Run the verification in
> section 3 and tell me if anything differs from the numbers there before changing code. Rules: honest status only,
> never claim a test passed unless it ran; commits as "Kevin Dang <kevindang2020@gmail.com>"; no PAN/CVV/passwords/
> terminal keys in anything; no live card transactions before Fiserv certification; no flat 3% surcharge; production
> payments stay disabled. I write tersely — "continue" means do the next logical unit fully, without asking.
> Open decision waiting for me: see section 5.

## 2. What this is

ONE monorepo (npm workspaces, Node 22): NestJS + Kysely + Postgres 16 API (`apps/api`, 26 domain modules in `modules/`),
React/Vite apps (`pos-web`, `admin-web`, `owner-web`, `tech-web`, `customer-web`, `manager-pay-web`, `customer-display`, `booking-public`),
Capacitor native shells for the four store apps, two single-file HTML apps (Go Check-In kiosk + admin), shared packages
(`packages/`: ui, api-client, api-contracts, mobile-sdk, realtime-client, web-push, events, permissions, database, …).
Payments: Fiserv CardPointe/Bolt + Clover Compact, sandbox/UAT only.

## 3. Verify before changing anything (all of this ran green on Nov 6)

```bash
npm install
npm run build:packages && npm run build:modules && npm run build --workspace @aipowersalon/api   # gates read compiled output (as CI does)
node tooling/ci/run-gates.mjs                  # Nov 7 (after the merge): all 57 gates + 22 audits pass
node apps/api/scripts/security-audit.mjs --lane fast   # PASSED 20 · FAILED 2 (the same two) · secret scan clean
npm run architecture:test                      # "no regression"
node tooling/ci/lint-ratchet.mjs               # 0 errors, under baseline
npm run build:frontends                        # all 8 build
node tooling/ci/run-tests.mjs api              # 3,011 pass, 0 fail (~45 min)
node tooling/ci/run-tests.mjs modules          # 26 modules, all pass (~10,200 tests)
node tooling/ci/run-tests.mjs packages         # 20 packages, all pass
(cd apps/pos-web && npx vitest run)            # 1,594   — admin 1,032 · owner 275 · customer 254 · display 201 · tech 117 · manager-pay 60
# real-Postgres race lane (needs a migrated PG16 + `trust` auth for 127.0.0.1 — one test makes a password-less role):
DATABASE_URL=postgres://…/aps_race npm run db:migrate
PG_RACE_URL=postgres://…/aps_race node tooling/ci/run-race-tests.mjs   # 86 files, 295 tests
```

## 4. What the Nov 4–7 sessions did (newest first; details in the sweep report + `git log`)

| Commit | What |
| --- | --- |
| `a067ddf8`…`7e256cc6` | **SUNMI batch 2** (Kevin's 20 PDFs, Nov 7): 19 pages certified 114/114, Cash Drawer rebuilt with its Activity ledger, Supplier Directory load fix, Payments 4 × 2 KPIs — `docs/handoff/SUNMI_BATCH2_2026-11-07.md` |
| (batch 3) | **SUNMI batch 3** (Kevin's 20 PDFs, Nov 7): 17 pages registered + certified 102/102, all 55 pages 330/330, registry check now a gate, follow-up status tabs, phone-verification checks list — `docs/handoff/SUNMI_BATCH3_2026-11-07.md` |
| (batch 4) | **SUNMI batch 4** (Kevin's 20 PDFs, Nov 7 night): 17 AI / marketing / comms pages certified 102/102 + 136/136 fallback, Retention fallback-size layout fixed, pilot-day loopback host fixed (104/104 + large salon 79/79 at 1920×945), top-bar e2e at SUNMI sizes 76/76 — `docs/handoff/SUNMI_BATCH4_2026-11-07.md` |
| (batch 5) | **SUNMI batch 5** (Kevin's 20 PDFs, Nov 8): 22 AI / security / device pages certified 120/120 + fallback, Campaign Builder six steps (Offer + Schedule, migration 842), salon-time campaign launch fix, branch comparison 6th KPI, security deep scan run + fixes, Tap to Pay zero-change proof, production-ready traceability — `docs/handoff/SUNMI_BATCH5_2026-11-08.md` |
| (after `0e45a0bd`) | SUNMI certification re-run after the merge: 120/120 (20 pages × 1920×945 / 952 / 1032 × EN + VI) |
| `ffec73be` | POS session limit (the §5 decision, recommended option): the POS stays signed in while in use, a locked POS ends 8 h after the lock, 7-day cap |
| `8e8aec22` | SUNMI FLEX 3: Weekly Technician Paycheck one-screen workspace (1920×945 measured on the real stack) |
| `09066094` | **Merge of Power-Salon-main** (26 developer commits) — decisions, renumbered migrations 836–841, dead code removed: `docs/handoff/MERGE_2026-11-07.md` |
| `53b4492` | Busy-day sign-outs: refresh-token grace window (two POS tabs / a lost Wi-Fi reply no longer look like theft; `REFRESH_REUSE_GRACE_SECONDS`, default 30) + renewal retried on network errors/5xx |
| `65751d3` | **Every app signed people out ~15 min after sign-in** — the access-token renewal (`installAuthRefresh`) was never switched on; now installed in all 6 apps; phone sign-ins keep the refresh token |
| `4b69bbf` | 3 Vietnamese drafts approved; POS notifications banner translated (VI = DRAFT) |
| `d299b83` | Notification permission asked from a tap ("Turn on notifications" banner), never at sign-in; Super Admin moved onto the shared push client |
| `d74a353` | Face ID stays on after a normal sign-out (customer/tech/owner; Kevin's decision, changes Constitution 6 §37); migration 705 ends it whenever a session is revoked any other way; Manager Pay keeps the strict rule |
| `6292cea` | Full sweep — 14 bugs (customer booking-code send always 400; captcha dead end; duplicate payment pushes; browser push could never work; missing security headers; app versions "unknown"; expense realtime; gift-card uuid; …) |
| `bec2cd4`… | Mobile apps onto the shared SDK (transport, realtime, deep links, push), shared types, Face ID without stored passwords, manager-pay wire fixes |
| earlier | Fiserv P0 build, Clover Compact, UAT kit, surcharge gate + disclosure, cross-server cancel, unassigned terminals |

## 5. Open — what is NOT done

**Waiting on Kevin** — every item prepared step by step in `docs/handoff/OWNER_ACTIONS_2026-11-07.md`
(Vietnamese review sheet: `docs/handoff/VI_DRAFT_REVIEW.md`, applied with `tooling/i18n/vi-drafts.mjs`).
- The picks in `docs/handoff/MERGE_2026-11-07.md` (session limit built as recommended; Manager Pay keeps ending Face ID
  at sign-out; old saved cards must be re-added) — change any of them by saying so.
- Review the Vietnamese DRAFT strings: `pos.pushPrompt.*`, `payment.terminal.*`, `sunmi.profile.*`, `sunmi.pay.*`,
  `bv.hs.unchecked`, `bv.hd.*` (batch 3, `i18n/ns/bookverify.vi.ts`).
- SUNMI: confirm the CSS viewport on a physical FLEX 3 (Android browser); approve staging-only live Twilio / email / token tests.

~~Needs the lost "AI-PowerSalon POS 12" package~~ — closed: `check:crosswire` and `check:unreached` pass since the
Nov 7 merge.

**Owner-side** (handoff items 1–4): Fiserv answers + certification, Apple Tap to Pay entitlement, production hosting.
Browser push for every web build (POS, Super Admin, and the customer/owner/tech web builds) needs `VITE_FIREBASE_WEB_CONFIG` +
`VITE_FIREBASE_VAPID_KEY` at build time — the Firebase key is no longer in the source (commit after `327df91`). It IS in
git history from the uploaded code: restrict that key in Google Cloud Console (HTTP referrers + Firebase APIs only).
Deep links need `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256_*`, `APP_LINK_WEB_*` (in `.env.production.template`).

## 6. Hard rules

- Honest verification: never report a test/build/gate as passing unless it ran in this session.
- No PAN, CVV, passwords, terminal keys or portal credentials in code, logs, tests or evidence. Private Postman env only.
- No live card transactions before Fiserv certification · no flat 3% surcharge · production payments disabled.
- Money = integer cents. Payments = Fiserv + Clover only.
- One backend (`apps/api` + `modules/`). Extend, never duplicate; grep for an existing helper/table first.
- Frontends must not re-declare `api-contracts` types; customer apps never import the tenant realm.
- New SQL must run on real Postgres 16, not only PGlite (pgcrypto is NOT guaranteed — use core `sha256()`).
- Kevin reviews every Vietnamese string himself: mark new VI text `DRAFT`.
- Commits: author `Kevin Dang <kevindang2020@gmail.com>`, with the Co-Authored-By / Claude-Session trailers.

## 7. Gotchas learned the hard way

- Zip: exclude BOTH `node_modules/*` and `*/node_modules/*` (and `dist`), or the root `node_modules` leaks in.
- `pkill -f` with a pattern that also matches your own shell kills the shell.
- `check:validated-bodies` brace-matcher does not skip `/* … */` comments: an apostrophe inside one breaks it.
- Race lane: local Postgres must use `trust` for 127.0.0.1; restore `pg_hba.conf` afterwards.
- The local Postgres cluster in a fresh sandbox may be stopped: `pg_ctlcluster 16 main start`.
- `TZ=UTC` for vitest runs (date tests). The API suite is long — run it in the background with a JSON reporter.
- iPad attachments sometimes arrive empty — ask Kevin to paste or send a PDF.

## 8. Document map

| Read | For |
| --- | --- |
| `docs/handoff/DEVELOPER_HANDOFF_2026-11-05.md` | Full handoff: what was added, items 1–17 left to finish, owners |
| `docs/handoff/SWEEP_REPORT_2026-11-05.md` | Every bug found Nov 5–6, the proof, addenda (Face ID, push, sign-outs) |
| `.env.example` / `.env.production.template` | Every env var the code reads, with notes |
| `docs/EVENT_CATALOG.md` | Domain events (generated) |
| `HANDOFF_MANIFEST.md`, `DEVELOPER_HANDOFF.md` (root) | Older July front doors — still accurate for architecture; numbers there are July's |
