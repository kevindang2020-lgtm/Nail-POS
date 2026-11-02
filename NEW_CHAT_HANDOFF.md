# NEW_CHAT_HANDOFF.md — start the next chat here (Oct 28 2026; updated at the end of the Oct 28 session — read §8 first)

Give this file to the new chat first. After it, read `NEXT_STEPS.md` (the full queue),
`docs/MANDATE_COMPLETION_MATRIX.md` and `docs/mandates/status/*.md` (the status of every section).

## 1. The code

- **Branch:** `merge-github-main`. **HEAD:** the commit that updates this file at the end of the Oct 28 session (it comes after
  `7eae34fe`; the Oct 28 work starts after `b6a4613b`). §8 says what that session did and what it could NOT verify.
- **Already restored at `b6a4613b`?** Fetch only the Oct 28 commits: `git pull aipowersalon-oct28.bundle merge-github-main`.
- **Restore from the bundle:**
  ```
  cat aipowersalon-*-history.bundle.* > h.bundle
  git clone -b merge-github-main h.bundle aipowersalon
  cd aipowersalon
  ```
- **Push to GitHub** (this cannot be done from the old chat, because its safety check blocks `git push`):
  ```
  git push https://github.com/kevindang2020-lgtm/Nail-POS merge-github-main:main
  ```
  Kevin's developer runs the K-12 steps (below). The old chat only committed locally and never pushed.
- **~~Unfinished work, not committed~~ — committed Oct 28 as `c2292a19` (see §8):** `wip-as-any-cleanup.patch` (206 files, ±1,502 lines). It removes more `as any`
  casts in `apps/api` and `modules/*` (ai, …). The cleanup agent that wrote it stopped on a usage limit **before running
  its gates**, so the patch is unverified. To use it:
  1. `git apply wip-as-any-cleanup.patch`
  2. `npm run typecheck`
  3. `npm run ci:gates`
  4. Fix anything that fails. In particular, `check:silent-catch` and `check:tenant-builder` fail when `.catch(() => [] as any[])` becomes `.catch(() => [])`; type it properly instead.
  5. Lower `apps/api/scripts/as-any.baseline.json` and commit.

  If you'd rather not, throw the patch away. Nothing depends on it.

## 2. Kevin's standing rules (keep them)

- **Secrets:** never paste a password or key into chat or notes. Use env var names only.
- Never associate AIPowerSalon with casino content.
- Kevin's background is described only as "prior Kotlin/Android experience".
- Don't remove a feature a salon uses; harden or deprecate it instead. Never build a duplicate "V2" system.
- **No false PASS:**
  - PASS needs executed evidence.
  - BLOCKED_EXTERNAL is only for a real outside dependency.
  - An unknown payment result is never called a decline.
  - No blind retries.
- **No print features** (`check:no-print`). The pay stub is a download, not a print.
- Accepted Tech Queue offers stay `ready_to_start`.
- The clock-in PIN uses a lowered hash cost; don't raise it.
- In Vietnamese, a technician is **"Thợ"**.
- Service and product names are not bilingual.
- The font is **Hanken Grotesk**.
- A technician with no services set up is bookable through the category fallback. Technicians whose services are set up are matched exactly.
- **Every new Vietnamese string** goes into `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` for Kevin, who is a native speaker, to review.
- Super Admin (admin-web) stays English only.
- **Full System Run / Wiring mandate (142 sections): SKIPPED** by Kevin's decision. Don't start it unless he asks.
- **K-12 security steps belong to Kevin's developer**, in this order:
  1. Rebuild the machine.
  2. Rotate credentials.
  3. Revoke the Firebase key.
  4. Create new Play upload keys.
  5. Change the DB password and close port 5432.
  6. Only then push the rewritten history.
- **Commits:** stage explicit paths and never use `git add -A` on a shared tree. When several agents work at once, build the
  commit from `git read-tree HEAD` plus the agent's own paths, then `git commit-tree` plus a compare-and-swap
  `git update-ref`. An Oct 27 commit built on a stale tree silently reverted 50 files of other agents' work (repaired in `f013c6c2`).

## 3. How to run

1. Start Postgres 16 with `pg_ctlcluster 16 main start` (it stops when the container restarts).
2. Build: `npm run build:packages`, then build the frontends.
3. Static checks:
   - `npm run typecheck`
   - `npm run ci:gates`: 56 gates + 21 audits. `check:strict-bodies-types` takes about 15 minutes cold and is cached by an input hash.
4. Test suites: `ci:test:{packages,modules,apps,api}`.
5. Race lane: `PG_RACE_URL=… npm run ci:test:race`.
6. Live proofs: `tooling/ci/live-proofs.sh`.
7. Pilot day: `DATABASE_URL=… PORT_PROOF=3201 node apps/api/scripts/live-pilot-day.mjs`. Use a fresh database and no `PILOT_SKIP`.

## 4. Finished in the last chat (Oct 27, Kevin's "finish this right now" list)

| Item | Result |
|---|---|
| Stricter checking of request types (the 362 left) | **DONE.** 1,245 of 1,268 body routes refuse unknown fields. The 23 exceptions are provider webhooks, Twilio, Retell AI voice, OAuth (RFC 6749) and 3 open-by-design settings routes, each with a written reason in `apps/api/security/strict-bodies.baseline.json`. A new type-aware gate `check:strict-bodies-types` proves every first-party caller. On the way it found and fixed a bug: every POS walk-in would have been refused (`263bcaa4` / `1fcb00c2`). A pilot on a fresh DB checked 9,977 validated bodies and found 0 unknown fields. |
| English server messages on Vietnamese screens | **DONE.** 1,476 throw sites now carry a registry code (`withCode`), with 681 new EN + VI codes. Gate `check:error-text`. Kevin still has to review rows V5M-1…681. |
| Downloadable pay stub | **DONE.** A PDF in EN / VI for approved, locked statements, downloadable from the Tech App, the POS statement drawer and the Owner panel. Downloads are audited, rate-limited and never cached. Routes: `…/pay-stub.pdf` (`81ec8ead`, `f013c6c2`, `5f2e072b`). |
| Code-cleanup counts | **PARTLY DONE.** Lint `react-hooks/exhaustive-deps` 75 → 0 and `no-unused-vars` 117 → 0, so the lint baseline is now zero (`af5036f6`). `as any` went 5,753 → 4,994 committed (`84e4de76` and earlier). The next batch is the unverified patch above. |

Last full regression (on the Oct 27 final-pass code `3c5ae402` / `b01f8d71`):
- 19,281 unit / PGlite tests passed.
- Race lane: 336 passed.
- Live proofs: 24 / 24.
- Pilot: 235 / 235.
- Announcement browser proof: 58 / 58.
- Injection run: 0 failing.

Later commits ran their own lanes:
- Strict bodies: `ci:gates` all green, API 3,110 tests passed, pilot 234 / 236. The 2 failures were not body-related: a session expired under host load, and 1 of 45 technician invites failed.
- Pay stub: pilot 104 / 104 through phase 10.

## 5. What still needs to be finished — internal (a developer can do it in this repo)

Do them in this order:

| # | Item | Done when |
|---|---|---|
| **N-1** | **Oct 28: PARTLY — 43 dependency-free gates ran and pass; `typecheck` and the 13 gates that need `node_modules` / built packages could not (npm registry unreachable). Now V-28 in `NEXT_STEPS.md`.**  **Verify HEAD.** Run `npm run typecheck` and `npm run ci:gates` on the committed HEAD. No full regression has run since `84e4de76` / `af5036f6`. Fix anything red. | rc 0 |
| **N-2** | **Full regression on the final code:** all test lanes, the race lane, live proofs, and the whole pilot day on a fresh DB. Then refresh `TEST_REPORT.md`, `docs/FINAL_ACCEPTANCE_MATRIX.md`, `docs/MANDATE_COMPLETION_MATRIX.md` (the Weekly Paycheck row is now 161 / 161 and the Security §40 row is DONE) and `NEXT_STEPS.md`. Put the evidence in `docs/pilot-runs/2026-10-2x-final2/`. | every lane logged |
| N-3 | **Oct 28: WIP patch committed (`c2292a19`), `as any` 4,954 → 3,251; typecheck pending.**  **Finish the `as any` ratchet** (I-15, §39 / FAM-18). Use or rebuild the WIP patch, then keep going: `payment-gateway.resolver.ts`, `payment-reconciliation.service.ts`, payroll / permissions / tenant-context / booking. | baseline lower, gates green |
| N-4 | **Oct 28: BUILT (`7d23399e`) — verify under V-28.**  **AI kill switch** (SD-23). The POS `POSAiSettingsEditor` sends `settings.killSwitch`, but the server ignores it, so the "turn off all AI" checkbox does nothing. Either implement it on the server or remove it from the client. Then make `POST /ai/dashboard/settings` strict. | the checkbox works or is gone; the route is strict |
| N-5 | **I-18:** the busy-state one-screen responsive report is 55 / 90 (pilot phase 13, 200 technicians). It was 85 / 90 earlier. Compare the failing items. | ≥ 85 / 90 or each item explained |
| N-6 | **I-19:** the `verify-terminal-capture` first-pass flake (12 / 17 once, then clean). | cause found or 5 clean runs |
| N-7 | **Lane built (`aad5863f`); open: the client half.** **I-5 realtime-first outbox lane:** realtime lag p95 < 2 s under a 3,500-event burst. Also implement the client `resourceVersion` check, or correct the claim that clients drop stale frames. | bench p95 lower; order tests green |
| ~~N-8~~ | **Done Oct 27 (`247172f3`).** **I-6 Owner App at 200 technicians in the pilot:** Team / Performance / Payroll / Reports numbers vs the DB, with timings. | pilot lines PASS |
| ~~N-9~~ | **Done Oct 27 (`9ded9435`).** **I-12 Tech Queue lane states:** Appointment Soon / Hold come from the server. | filter test |
| N-10 | **I-8 security remainder:** CSP `'unsafe-inline'` style blocks (§89), `@ResourceScope` manifest (§38), egress allowlist (§93), mobile SBOM (§14), strict webhook payload schemas (§110), anon limiter replacing the per-process limiters. | each row DONE with a test |
| N-11 | **Oct 28: B-93 + R-5 BUILT (`7eae34fe`) — verify under V-28; R-1 … R-4 open.**  **Receipt / OCR:** R-1 filter chips, R-2 expense ÷ revenue KPI + PDF summary, R-3 permission keys, R-4 version-conflict race, R-5 `jobId` / `correlationId` on OCR audit rows, B-93 (the OCR store swallows write errors). | per `NEXT_STEPS.md` table |
| N-12 | **Weekly Paycheck W-1:** run pilot phase 10e2 on a full pilot day. | 10e2 checks PASS in the log |
| N-13 | **Vietnamese POS remaining rows:** 8 PARTIAL and 3 NOT DONE in `docs/mandates/status/VIETNAMESE_POS_STATUS.md`. | rows DONE |
| N-14 | **Platform Architecture Audit:** 41 PARTIAL rows (29 product gaps + 12 doc / debt rows) in `PLATFORM_ARCHITECTURE_AUDIT_STATUS.md`. | rows DONE |
| N-15 | **200-tech:** §1 / §2 / §101 roster-wide state reads. Remaining production: §43, the Capacitor Tech App shell in the pilot. | rows DONE |
| N-16 | **I-14 dead-code batch 2:** exports, dead client methods, manager-pay i18n keys. | gates green; report updated |
| N-17 | **I-16:** clock-in burst p95 read-back on the pilot host. | p95 recorded |
| N-18 | **Older items:** S-A2 (Nest 11 + kysely ≥ 0.28.17, before 2027-01-31), S-A3 (vitest 4 / vite 6.4.4), S-A4, S-A5, S-A8, S-A11, M5-4 (watch). | per `NEXT_STEPS.md` |
| N-19 | **Oct 28: BUILT (`f0ee9ef0`) — verify under V-28.**  **Check the super-admin export handlers.** A handler that returns a bare `Buffer` gets serialized as JSON; the pay-stub routes had this bug and now use `StreamableFile`. | each export downloads a real file (test) |

## 6. What still needs to be finished — external (Kevin or his developer)

- **K-12 security sequence** (his developer, in the order in section 2), then the push.
- **Kevin reviews the Vietnamese strings** in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` (about 4,700 lines, including V5M-1…681, the pay-stub rows and the paycheck close-out rows). A developer then applies his corrections.
- **CardPointe:** each salon's MID and credentials, then a $1 sale / void on UAT.
- **Tap to Pay:**
  - Apple entitlement.
  - CommerceHub SDK, sandbox and webhook secret.
  - Merchant accounts for each location.
  - A Mac and three iPhones.
- **OCR:** private S3 bucket, ClamAV, AWS Textract.
- **Messaging:**
  - Twilio A2P + Verify.
  - SendGrid (also needed for the Super Admin trusted-device email).
  - A new Firebase account + APNs.
  - AI provider keys.
- **Payroll provider:** ACH / direct deposit / ADP / Gusto (W-4).
- **Hosting:**
  - Cloudflare WAF.
  - Railway variables (names in `DEVELOPER_HANDOFF.md`).
  - DB roles and private networking.
  - `_headers` on static hosting.
  - GitHub branch protection.
  - Image digest pins.
  - Store rebuilds.
  - A pen test.
  - A real backup restore.
- **Decisions for Kevin:**
  - S-B11: the admin password-reset matrix.
  - S-A9: the map tile provider.
  - K-05 and K-07 … K-11, K-13.
  - Whether to bring back the Tech App Face-ID auto-prompt.

Full list with defaults: `NEXT_STEPS.md` §2 and `docs/HOSTING_ACTIONS_FOR_KEVIN.md`.

## 7. Mandate scoreboard (DONE / PARTIAL / NOT DONE / BLOCKED_EXTERNAL)

| Mandate | Status (after the Oct 28 re-audit; "BUILT" rows count as DONE only once V-28 passes) |
|---|---|
| Secure Tap to Pay | 62 / 15 / 0 / 1, + DoD and §XIX PARTIAL. Re-audit downgraded §22 / §24 (one platform MID — Kevin), §41 / §43 (refund / void now refused here, no provider refund yet), §59; fixed §16 / §35 / §36 / §73 software halves. |
| 200-Technician | 100 / 3 / 0 / 0, + §6 / §54 decided by Kevin (the old "102" counted them). |
| Remaining Production | 52 / 2 / 0 / 19 (§54 is PARTIAL: internal remainder). §23 / §24 / §25 / §61 BUILT Oct 28. |
| Security Deep Scan | Re-audit Oct 28: §59 / §76 / §84 / §133 / §137 / §138 / §139 were not true — fixed (Support Mode bypass, missing step-ups, TRUNCATE guard); §74 / §75 / §187 PARTIAL. Recount after V-28. |
| Platform Announcement | 168 / 0 / 0 / 0 (re-audit: no code defect; stale "56 / 58" lines corrected). |
| English + Vietnamese POS | 117 / 7 / 0 / 0, + 3 N/A by Kevin's ruling (§50 / §52 / §53). Re-audit found §22 / §58 / §30 / §54 / §119 false; all fixed Oct 28 (incl. the customer SMS texts). |
| Platform Architecture Audit | 216 / 42 / 0 / 3, + §142 BUILT Oct 28 (unpaid gift-card mint retired); §43 client stale-frame check BUILT; §233 / §236 PARTIAL until V-28. |
| Weekly Paycheck | 158 / 3 / 0 / 0 (was "161 / 0"). Branch scope incl. the legacy reads, cash cap, re-handoff, drawer lock BUILT Oct 28; 17.7 / 4.2 / 21.25 open. |
| Receipt / Expense / OCR | 192 / 18 / 1 / 1, of which 13 DONE rows were false and are BUILT Oct 28 (F1–F6). |
| Full System Run / Wiring | SKIPPED (Kevin) |

## 8. Oct 28 session — what was done, and what is still unverified

**The session had no npm registry access** (the network proxy refused `registry.npmjs.org`), so there was no `node_modules`.
Kevin chose "write code now, verify later". Nothing was pushed. Commits, in order after `b6a4613b`:

| Commit | What | Checked here | Still to run |
|---|---|---|---|
| `75c45d6d` | **Lint gate false PASS fixed**: `check:lint` answered "0 errors" whenever eslint could not run (empty output read as `[]`). | executed: fails now without eslint | — |
| `7d23399e` | **N-4 / SD-23 AI kill switch**: "Turn off all AI in this salon" turns every AI task OFF for the salon / branch. Found on the way: NO caller passed the tenant's saved AI settings into AiPlatform / the OCR gateway, so none of the AI settings screen's choices applied at runtime — both now read them per call (a caller can only tighten). `POST /ai/dashboard/settings` strict (1,246 / 1,268). **Behaviour change: salons' saved caps / disabled tasks are now enforced.** | specs run in a stand-in harness: ai-safety-policy 21/21 (negative control: the old policy fails the 2 new tests), ai-settings-store 22/22, ai-platform 36/36, ai-provider-task-gateway 9/9; gates | typecheck; real vitest; regenerate `strict-bodies.typeproof.json` + `.report.json` (hand-edited) |
| `c2292a19` | **N-3 `as any` 4,954 → 3,251**: the Oct 27 WIP patch. Proven runtime-identical: for all 206 files the type-stripped JS of HEAD and of the commit is the same, and no changed line touches a decorator. Removing a cast exposed a whole-row read (`loyalty_ledger`), now column-selected. | runtime equivalence; syntax; gates incl. silent-catch / tenant-builder / response-exposure | **typecheck** (a removed cast may be a compile error) |
| `f0ee9ef0` | **N-19**: 5 Super Admin exports (queue xlsx / pdf, settlements xlsx / pdf, loyalty xlsx) sent `{"type":"Buffer","data":[…]}` on the synchronous path. Fixed once in `AsyncExportInterceptor` (the worker path still gets the raw bytes it stores); `minimizeFields` no longer rebuilds file bodies for a Super Admin with hidden field classes. | field-policy 6/6, async-export 19/20 in the harness (the 1 is the decorator-metadata test the harness cannot run); gates | real vitest; download each of the 5 exports once |
| `7eae34fe` | **B-93**: OCR store writes throw instead of being swallowed; reads still degrade; the audit and posting-attempt history rows are logged best effort. **R-5 / §191**: OCR audit rows carry correlationId / requestId (+ jobId in the extraction job). silent-catch baseline 2,484 → 2,475. | new store-writes spec 8/8 (6/8 fail on the old store); 21 other OCR specs identical before / after; gates | real vitest |
| `2699744a` | docs: `NEXT_STEPS.md` (Oct 28 block, V-28), status rows marked BUILT — not DONE — until V-28, this section. | — | — |
| `c9a72331` | **Receipt F1**: a corrected / typed subtotal, tax, fees, discount reach the document row the posting reads. | new spec 4/4 (fails on old) | real vitest; pgtest |
| `7cad2089` | **Tap to Pay recovery**: lookup — any approval wins, decline only when explicit, unclear → unknown; kill switch fails closed. | new spec; fakes updated | real vitest |
| `8a6f5ce2` | **Gift card P0**: `POST /pos/checkout/gift-cards` (unpaid mint) answers 410; card + ledger in one transaction. | new spec | real vitest; rewrite `e2e-giftcard.mjs` |
| `b8ca06da` | **Paycheck**: payout mutations / report / owner summary branch-scoped; cash-cap odd cent; paid re-handoff refused; drawer advisory lock. | unit + pgtest additions in the harness | real vitest; pgtest; race lane |
| `0c6d0a0f` | **Receipt F2–F6**: receipts and suggestions branch-scoped; CSV import no duplicate override; dedup read throws; split on a one-branch expense refused. | new spec; pgtests extended | real vitest; pgtests |
| `d8f2967e` | **Tap to Pay refund / void refused here** (`TAP_TO_PAY_REFUND_AT_PROCESSOR`); refund sweep → review unless `PAYMENTS_REFUND_INQUIRY_VERIFIED=1`. | 96 checkout specs identical before / after; new tests fail on old | real vitest; pilot S11 |
| `c47fbac9` | **AI plan lines** follow the eligibility authority per service (same single batch read). | queue / AI / workforce specs; new tests fail on old | real vitest |
| `bafe612c` | **Vietnamese POS re-audit**: server English on Vietnamese screens (11 sites); glossary gate for every app (17 strings fixed); customer notices in the customer's language; Owner / Tech follow the salon default; 4 accent-folded searches; status recount. | error-text 20/20, notice table 4/4, booking specs identical | real vitest; pgtests; Kevin reviews A28-1…A28-27 |
| `ba73e2ef` | **Eligibility authority required at boot** in booking, customer booking, check-in, Go check-in, Tech Queue; detail flag from the authority. | new specs | boot the API once with a database |
| `041a8ff6` | **Secure Tap**: revoke releases the phone's claims (not in-flight ones); attempt routes location-scoped; env var documented. | mobile-checkout specs identical; new tests fail on old | real vitest |
| `c62fc159` | docs: every status report re-audited (a "Re-audit — Oct 28 2026" block + row notes), this section, NEXT_STEPS. | — | — |
| `c46c5fc2` | **Payroll legacy period reads branch-scoped**; expense attach / match version races + audit; OCR retention order; e2e-giftcard on the paid flow. | expense-version-races 3/3 (fails on old); pgtests added | pgtests |
| `28062a34` | **Realtime stale frames**: server says the version's source; the shared client drops a strictly older aggregate version. | client 3 new tests (fail on old); event specs identical | real vitest |
| `a3460b50` | **Customer SMS in the customer's language**: phone change, AI proposal, review request. | 3 specs (fail on old) | Kevin reviews A28-28…31 |
| `74208ced` | **Security re-audit**: Support Mode bypass closed; step-up on lockdown lift / cancel, salon Twilio credentials (POS prompts), partner payouts, branch-access, queue support request; sort-key fix; migration 703 (no TRUNCATE on audit tables); manager-PIN budget in Postgres. | critical-step-up 97 / 93 / 4; migration-safety; tenant; raw-sql | regenerate the manifest (10 lines hand-edited); pgtests |
| `8505efa1` | **Receipts §162 / §96**: not-tax-advice disclaimer on exports; same vendor same day flag. | finance-core | pgtest |
| this commit | docs: status rows for the second batch, NEXT_STEPS, this section. | — | — |

**Kevin's ruling (Oct 28 2026): customers get English only** — every customer message (reminders, receipts, notices, SMS)
and the Customer App are English; Vietnamese is for the salon's staff screens. One switch: `customerMessageLanguage()` in
`packages/api-contracts/src/language.ts`.



**Kevin's answers (Oct 28 2026) — all built the same day, BUILT until V-28:**
1. **Tap to Pay — each location uses its own merchant account: YES** (`e574752d`, migration 704). A location's own row decides
   (active + Tap to Pay MID, else MERCHANT_NOT_CONFIGURED — never the salon default's MID); else the salon default; the env MID
   only in a sandbox. Super Admin forms have the two fields. VERIFY in the CommerceHub sandbox that one ISV key acts per MID.
2. **Tap to Pay refunds in the POS: YES** (`33034f61`). Refund / void go to the location's CommerceHub merchant on the same
   claim-first, three-outcome path; a lost void answer is VOID_STATUS_UNKNOWN; a lost refund goes to a person in the sweep.
   CommerceHub client fix: a DECLINED state is no longer read as success.
3. **Paychecks: YES to all three** (`78a07f6b`): "Your pay is complete" push (no amount); a paid week goes back to finalized /
   partially paid after a later void (system-only move); bonuses and reversals itemised.
4. **Membership renewal / expiry SMS: YES** (`cf4af25b`): English, transactional, the salon messenger, at most once.
5. **Photo malware screening: YES** — already built (`251b24d2`): once `CLAMAV_HOST` is set, every image is scanned and an
   infected / unscannable one refused (quarantined). Hosting ClamAV is the only step left (BLOCKED_EXTERNAL until then).
   **Cancelled salons' Twilio numbers: YES** (`f9ff96c4`, migration 705): released + subaccount closed after 30 days
   (`MESSAGING_OFFBOARD_GRACE_DAYS`), or at once from Super Admin; a salon's own Twilio account is never touched.
6. **Vietnamese: only the POS is in Vietnamese; everything else English** — and then the authoritative `POSLanguage.pdf`
   (`05ac57cd`): every non-POS app enforces English at bootstrap; see `docs/mandates/status/POS_LANGUAGE_SCOPE_STATUS.md`.
   Only POS rows of `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` need review now.
7. **Refuse to boot when login-failure counting is not shared across servers: NO** — nothing built; `LOGIN_THROTTLE_STORE`
   stays a deployment choice (use `redis` with more than one API replica).

**Also built Oct 28 on Kevin's instruction:** the manager PIN works only at a location that manager may enter, and only in
her own salon (`039e3725`, `STAFF_BRANCH_ACCESS` wiring).

**AI voice receptionist: English only** (Kevin, Oct 28 2026 — built, migration 706): the provider always speaks en-US; the POS
offers no other receptionist language.

**"Stand-in harness"** = Node 22's own TypeScript stripper + a small vitest-compatible shim + stand-ins for
`@nestjs/common` / `kysely` / `rxjs`, with decorators blanked. It runs real repository code, and each new test was shown to
FAIL on the old code. It is NOT committed (it would be a second test runner next to vitest) and it does not replace the real
lanes: everything above counts as BUILT until V-28 passes.

**Gates on the final HEAD** (the `ci:gates` list, run one by one): 43 pass. 13 cannot run without dependencies or built
packages: sql, types-drift, sql-identifiers, lint (now honestly), error-text, openapi, api-contract, permission-docs,
db-ownership, actor-stamp, async-exports, unique-tenant-review, strict-bodies-types. None failed on a finding.
Audits: 17 / 21 pass; architecture tests, frontend builds, app types and pos-i18n need TypeScript / Vite.

**Next, in order:** V-28 (`NEXT_STEPS.md`) → N-2 full regression → the decisions above → the rest of §5. Untouched this session: N-5 … N-10,
N-12 … N-18, and R-1 … R-4 of N-11.
