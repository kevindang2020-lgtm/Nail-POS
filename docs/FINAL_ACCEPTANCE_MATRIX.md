# Final Acceptance Matrix — Oct 27 2026 (final pass: full regression on HEAD)

The Build / Acceptance Matrix each of Kevin's mandates asks for, refreshed from the Oct 27 final-pass regression on
`merge-github-main` (product code under test `3c5ae402` for the build / unit lanes and `94ba69e9` = `b01f8d71` for the API lane,
pilot day and live proofs — the difference is two renames and test / harness / allowlist lines; see `TEST_REPORT.md`
"Oct 27 2026 — final pass"). Section-level detail stays in `docs/mandates/status/*.md` and `docs/MANDATE_COMPLETION_MATRIX.md`;
this file is the component-level verdict. The Oct 26 M7 numbers are kept in `TEST_REPORT.md` (history).

**Rules used here (strict).** PASS = built, wired, and proven by a test lane or pilot step executed in THIS run, with no known
internal gap in that component. FAIL = a known internal gap (buildable without Kevin) remains — the gap is named, even
when everything that exists passes. BLOCKED_EXTERNAL = the only thing missing needs an account, device, hosting or decision
only Kevin (or his developer) can provide. NOT_TESTED = the control exists but the test the mandate names was not run.
Where a mandate only offers PASS / FAIL, an external-only gap is still written BLOCKED_EXTERNAL rather than a false PASS.

## Evidence executed in this run (TZ=UTC, 2 cores / 7 GB) — Oct 27 final pass

| Lane | Command | Result |
|---|---|---|
| Install / migrations | `npm ci`; `migrate.mjs` on a fresh database | rc 0; **642 migrations** (001 … 702) |
| Build | `build:packages`, `build:modules`, `build:api`, `build:frontends` | rc 0 |
| Gates | `npm run ci:gates` | **all 54 gates + 21 audits passed** at `3c5ae402`; one FAIL after the API-lane renames (`check:role-checks`), fixed `b01f8d71`. **Branch HEAD `6a1a76e8` + other agents' uncommitted work: 7 FAIL** (tenant-builder, silent-catch from `6a1a76e8`; unreached, openapi, api-contract, list-queries, attack-surface from uncommitted pay-stub routes) — see `TEST_REPORT.md` |
| Typecheck / lint | `npm run -s typecheck`; `lint-ratchet.mjs` | rc 0; lint 0 errors, 192 warnings (exhaustive-deps baseline 75) |
| Packages | `ci:test:packages` | 20 suites · 129 files · **1,247 passed**, 0 failed |
| Modules | `ci:test:modules` (19 suites before a container restart + the other 8, same runner) | 27 suites · 1,345 files (+74 env-gated) · **11,027 passed**, 0 failed, 243 skipped |
| Apps (frontends) | `ci:test:apps`, 8 apps | 745 files · **3,897 passed**, 0 failed |
| API | `ci:test:api` | 380 files (+27) · **3,110 passed**, 0 failed, 137 skipped (first run 5 failed — test drift + two names, fixed `3f299d0a`) |
| Race (real PostgreSQL) | `race_final` migrated to 702, `ci:test:race` | **99 files, 336 tests, 0 skipped**, 15 packages |
| Harnesses | `test:harness` on a fresh database | 9 passed / 0 failed / 1 skipped on the re-run (first pass: terminal-capture 12 / 17, not reproduced) |
| final-run live lanes | route sweep, api harnesses, event wiring, display lifecycle, e2e:html | sweep **15 / 15** (first 14 / 15: a by-contract 409 → listed); api harnesses 1 / 1; event wiring **19 / 19**; display lifecycle **30 / 30**; e2e:html OK |
| Pilot day | `live-pilot-day.mjs`, fresh DB through 702, **no PILOT_SKIP**, screens on, phases 0–14 | **235 / 235** (first pass 230 / 235 — two harness bugs, fixed `94ba69e9`) — `docs/pilot-runs/2026-10-27-final/` |
| Restore drill | `drill-restore.mjs` on the pilot DB | **12 / 12** |
| Live proofs | `tooling/ci/live-proofs.sh` (24 proofs, fresh seeded DB each, `PROOF_TZ=Asia/Tokyo`) | **24 / 24 proofs, 606 checks** (display-ads-browser first 13 / 14 — a badge's case, harness `7d7787dd`) |
| Announcement browser proof | `tooling/e2e/pos-announcement-layout.mjs` (Chromium, 4 viewports) | **58 / 58** (§108's readable room passes again) |
| Vietnamese one-screen | `tooling/e2e/pos-vi-one-screen.mjs` empty / light; busy in pilot phase 13 | primary **18 / 18** in each of the three states; responsive report: empty 108 / 108, light 107 / 108, busy 55 / 90 |
| §163 injection pass | `live-injection-pass.mjs` (2,422 routes) | run 3: **22,250 requests, 0 failing** |

Unit + integration total: **19,281 tests passed, 0 failed** (after the fixes). Race 336. Pilot 235. Live proofs 606.

---

## 1. Secure Tap to Pay device authentication (mandate p.24–25, "Required Build Matrix")

Section status (`SECURE_TAP_STATUS.md`): **Oct 27: 67 DONE · 10 PARTIAL (all external-only) · 0 NOT DONE · 1 BLOCKED_EXTERNAL** (of 78; Oct 26: 66 / 11).

| Component | Result | Evidence / gap |
|---|---|---|
| API | PASS (Oct 27) | All routes built and proven (pilot phase 12 S0–S14 36/36; `mobile-checkout.controller.ts`; checkout + identity lanes green). §51 closed Oct 27 (`278c5bad`): the "unusual registration" rule (MEDIUM security event, never blocks), claim conflicts audited, owner panel `GET /mobile-checkout/devices/security-summary` (Owner App card) and platform panel `GET /super-admin/system/payment-devices` (System Operations) — `device-security-signals` 8/8, `payment-device-oversight.pgtest` 4/4 |
| POS | PASS | `TapToPayDevicesPanel` (pair / approve / rename / suspend / revoke), `TapToPayDevicesPanel.test.tsx`; pilot S1, S9 (Mobile Payments card), S10 (POS ↔ phone unsettled guard), S12 (Customer Display follows the phone) |
| Owner/Manager Payment App | BLOCKED_EXTERNAL | Web app green (`apps/manager-pay-web` 20 files / 120 tests; `ReturnToStaff`, `TapToPayScreen`, `DeviceScreens`). Hardware key store (Secure Enclave / Keystore, §2/§4), App Attest (§5 device half), on-device Face ID (§11), native switcher cover (§12) need a Mac + iPhone + Apple entitlement |
| Owner App | PASS | Owner payment history lists each mobile payment with device label + employee (pilot S9, S14 annex report) |
| Realtime | PASS | outbox `payment.captured` + `checkout.completed` published (S9); `payment-device-room` spec; S12 display projection |
| Database Migrations | PASS | 687–690 on a fresh DB (632 migrations through 692, pilot + race DBs); `device-identity.pgtest`, `checkout-lock-version.pgtest` |
| Unit Tests | PASS | modules/checkout 865, identity 585, packages/mobile-sdk 197, manager-pay-web 120 — 0 failed |
| Integration Tests | PASS | PGlite pgtests in the lanes + pilot phase 12 over HTTP against real PostgreSQL |
| Concurrency Tests | PASS | race lane `mobile-checkout.postgres-race` (in 328/328); pilot S3 (three phones at once), S4 (one claim wins) |
| Security Tests | PASS | pilot S6 (altered body, replay, stale timestamp, unsigned, copied key), S7, S11 refund trio; `mobile-unsettled-guard` (11), `device-security-signals` (4), `device-attestation` (7) |
| Tenant Isolation | PASS | `mobile-checkout-foreign-id` spec; `device-identity.pgtest` cross-salon branch refused; pilot phase 10 cross-salon checks |
| Branch Isolation | PASS | pilot S14 (DEVICE_BRANCH_NOT_AUTHORIZED, STEP_UP_REQUIRED, MERCHANT_NOT_CONFIGURED, money moves with the switch); `mobile-branch-switch` spec |
| Device Revocation | PASS | pilot S7 (sessions + refresh tokens revoked, 9 routes → DEVICE_REVOKED, other phones keep working); `refresh-device-binding.pgtest` |
| Payment Recovery | BLOCKED_EXTERNAL | UNKNOWN never declined, no double charge (pilot S8 ×4, S10). **Oct 27:** the software half is proven end to end with a provider test double — approved / declined / not found / still pending through the durable worker and the real service, and worker ↔ manual Verify converge on ONE payment (`mobile-recovery-convergence.vitest.spec.ts` 5/5, `d90c1bfe`). Final reconciliation needs the CommerceHub transaction inquiry (`fiserv-commercehub-ttp.adapter.ts` answers `no_inquiry`) — §26/§35/§36/§73 |

## 2. 200-Technician large salon (mandate p.15 "Required 200-Technician Pilot Matrix" + Login Matrix)

Section status (`200_TECHNICIAN_STATUS.md`): **102 DONE · 3 PARTIAL (§1, §2, §101)** · 0 NOT DONE (of 105; §6/§54 Print Schedule closed by
Kevin's no-print decision). Every row below is a check in `docs/pilot-runs/2026-10-26-final/pilot.log` (phase 11, 57/57); the
Oct 26 close-out rows are checks in `docs/pilot-runs/2026-10-26-200b/pilot.log` (fresh database through 697, all phases, **210 / 210**; phase 11 88 lines, phase 12 36 / 36).

| Row | Result | Evidence |
|---|---|---|
| Technicians created: 200 · page size 12 · 17 pages | PASS | pagination edges 0…201 |
| Page 1 (1–12) / Page 8 (85–96) / Page 17 (193–200) | PASS | "200-TECH PILOT MATRIX" line |
| Technician Search · Jump-to-Tech | PASS | same |
| Find an Opening · Best Matches | PASS | same; also with the 2,766 blocks present (§48) |
| Exact Service Eligibility | PASS | same |
| Concurrent Booking | PASS | pilot + race lane (`booking-concurrency`, `booking-same-customer`) |
| Fair Turn | PASS | Fair Turn at 105 clocked in; break #120 never recommended |
| Realtime | PASS | 55 streams, one event each exactly once; off-screen invalidation 0 grid fetches |
| Technician App Login (#1 / #25 / #100 / #193 / #200) | PASS | "TECHNICIAN APP LOGIN MATRIX" line (web Tech App at 390×844; native shells not driven — external) |
| 200-Tech Payroll | PASS | 200 statements in 143 ms; exceptions-only = 15 |
| 400 Payout Instructions | PASS | 400 instructions → 400 payouts (200 check + 200 cash), Σ = payable |
| Performance (§24 targets) | PASS | page change p95 32 ms, 12-column grid 40 ms (200b: p95 149 ms / 55 ms); clock-in burst p95 1,329 ms in the M7 run, **3,293 ms in 200b** (host load ≈ 5; bench p95 3.7–5.0 s) — CPU-bound on 2 cores, §1 stays PARTIAL |
| Realtime burst lag (§90, < 2 s p95 under 3,500 events) | PASS | realtime-first lane (`aad5863f`): live pilot SSE frame lag **p50 0.54 / p95 0.99 / max 1.29 s** over 4,625 events; bench 3,500: p95 1.3–1.6 s (load 2–3), 2.6–3.0 s under load ≈ 5 (M4: 13–34 s) — a dedicated host for the final number is still external |
| Schedule scale §48 / §49 / §76 (blocks dataset) | PASS | first live run: 2,766 / 2,766 blocks, availability / booking / board / openings honour them |
| §2 design for 1,000+ technicians | **FAIL** (narrowed) | Walk-In / New Booking / AI optimizer / Tech Appointments are roster-free and proved at 1,000 (`e7554049`, `roster-1000.test.tsx`); still linear: Tech Queue state (every lane, paged on screen), Time Clock / Check-In states, Owner Live Ops window 1,000 |
| §33 Tech Queue (Appointment Soon / Hold states) | PASS | `9ded9435`: server lane states from the Fair Turn ledger's HOLD and the board's appointment window; `tech-queue-lane-states.pgtest` |
| §62 / §69 Owner App at 200 (Team, Performance, Payroll, Reports in the pilot) | PASS | `247172f3`, 200b: 19 OWNER APP checks (+ the paid-day check) — week / month / YTD by technician (11 pages, 201 rows), branch, service, payment method, payout method (check / cash) and the Staff export all = PostgreSQL; Team / Reports / Payroll in Chromium at 390×844 |
| §104 hand-off docs | PASS (this commit) | TEST_REPORT, PILOT_DAY_REPORT and this matrix carry the run |

## 3. Remaining production work (mandate p.15 "Final Acceptance Matrix")

Section status (`REMAINING_PRODUCTION_STATUS.md`, Oct 27 2026): 52 DONE · 1 PARTIAL (§39) · 0 NOT DONE · 20 BLOCKED_EXTERNAL (of 73) — was 36 / 18 / 0 / 19 on Oct 26.

| Workstream | Result | Evidence / gap |
|---|---|---|
| K-12 SECURITY | BLOCKED_EXTERNAL | owner: Kevin's developer — rebuild → rotate → revoke Firebase key → Play keys → DB password + close 5432 → push rewritten history |
| REAL CARDPOINTE UAT | BLOCKED_EXTERNAL | UAT credentials + per-salon MIDs; loopback proofs green (pilot phases 4–6, 10) |
| WALLET TOP-UP RECOVERY | PASS | lost answer → Verify → one credit (`wallet-topup.postgres-race`); **Oct 27:** the payment webhook settles a top-up through the same conditional settle + `topup:<id>` key (`2dbeb916`), raced with Verify and the sweep (4/4); pilot phase 14a end to end |
| SKIP-LINE RECOVERY | PASS | `skip-line-recovery.postgres-race` + pgtests incl. recovery after reconnect (`93d84d84`); pilot phase 14b (POS Verify → one payment) |
| SPLIT PAYMENT GUARD | PASS | `split-tender-lost-card.postgres-race` (`2a7cd107`): lost POS / split card → cash, gift card, another card and a split at once all refused; the sweep settles → one tender (mutation-checked); pilot phase 14c |
| EXACT SERVICE ELIGIBILITY | PASS | pilot "Exact Service Eligibility"; **Oct 27:** one skill rule (`3fa531bc`), revised by Kevin's decision (`ded4729d`): a technician with no services set up is bookable through the category fallback (`basis: category_fallback_unconfigured`), a configured one strictly exact; the queue asks one function, no `skillMatch` fallback |
| RECEIPT OBJECT STORAGE | BLOCKED_EXTERNAL | S3 bucket + IAM |
| MALWARE SCANNING | BLOCKED_EXTERNAL | ClamAV host (uploads quarantine honestly without it) |
| TEXTRACT OCR | BLOCKED_EXTERNAL | AWS Textract access. Internal half DONE Oct 27 (`aee55104`): §30 extraction through the central AI gateway (task registry, quota, kill switch, breakers, ledger); §31 perceptual hash for near-duplicate receipts |
| REFUND UAT RECOVERY | BLOCKED_EXTERNAL | CardPointe UAT `inquireByOrderid` shape (`refund-race.postgres-race` + loopback green) |
| TWILIO DEFAULT FROM LEDGER | PASS | communications lane (467 tests) incl. the ledger specs |
| EXPENSE ALLOCATION | PASS | matrix complete Oct 27 (`ffc1b9d6`): 110 %, negative share, removed branch, edit after allocation (bug fixed: the hand split re-scales), history after a policy change (decision: read-time re-split; own splits fixed) |
| 200-TECH BOOKING | PASS | pilot phase 11 matrix |
| REAL TECH APP LOGIN | PASS | login matrix #1/#25/#100/#193/#200 (web Tech App; native shells external) |
| 200-TECH PAYROLL | PASS | 200 statements, 400 payouts |
| CUSTOMER DISPLAY CLEAR | PASS | pilot phase 4: 3,006 ms clear, no frame after shows the guest |
| LINT RATCHET | **FAIL** | ratchet enforced; `exhaustive-deps` baseline 81 → **76** (Oct 27); §39's screen-by-screen reduction in payments / checkout / payroll / permissions is not finished |
| TYPE SAFETY RATCHET | **FAIL** | `check:as-any` enforced; baseline 5,772 → **5,753** (Oct 27: payment webhook 21 → 4, queue service 12 → 10); `checkout.service.ts` 43, `payment-gateway.resolver.ts` 23, `payment-reconciliation.service.ts` 20 and the payroll / permissions / tenant-context / booking files remain |
| NATIVE IOS BUILD | BLOCKED_EXTERNAL | a Mac + Apple accounts |
| TAP TO PAY | BLOCKED_EXTERNAL | Apple entitlement, CommerceHub SDK + credentials, iPhones (internal M6 work: section 1 above) |
| HOSTING SECURITY | BLOCKED_EXTERNAL | TLS / WAF / private DB / KMS / backups / variables (posture checks ready) |
| BACKUP RESTORE TEST | BLOCKED_EXTERNAL | local drill **12 / 12 today**; a restore of a real hosted backup needs the hosting |
| PENETRATION TEST | BLOCKED_EXTERNAL | vendor + staging |

## 4. Security deep scan / zero trust (mandate p.17–18 "Security Acceptance Matrix")

Section status (`SECURITY_DEEP_SCAN_STATUS.md`, Oct 27 2026): 155 DONE · 20 PARTIAL · 0 NOT DONE · 17 BLOCKED_EXTERNAL (of 192).

| Control | Result | Evidence / gap |
|---|---|---|
| MALWARE / BACKDOOR SCAN | PASS | `docs/security/MALWARE_SCAN_REPORT.md` (eb691b77); gates `check:supply-chain-injection`, hidden code — green today |
| SECRET SCAN | BLOCKED_EXTERNAL | tree: `check:secrets` PASS today; history scan stays `continue-on-error` until the K-12 rotation + history push (§17/§18) |
| DEPENDENCY SCAN | PASS | npm audit gate (0 critical) + §13 lockfile hygiene gate (`check-lockfile.mjs`: install scripts reviewed, registry + integrity, < 7-day versions, typosquat) in ci:gates, `54107bd4` |
| SBOM | BLOCKED_EXTERNAL | backend / frontend SBOM in `docs/security/sbom/`; the mobile transitive SBOM needs a Gradle / Android SDK in CI (§14) |
| EDGE WAF | BLOCKED_EXTERNAL | §25–§27 |
| DDoS PROTECTION | BLOCKED_EXTERNAL | edge provider |
| BOT / ACCOUNT-TAKEOVER PROTECTION | BLOCKED_EXTERNAL | app half DONE (login throttle, per-IP `@AnonRateLimit`, tenant / session limiter — 0 × 429 to legitimate pilot traffic); edge bot / ATO rules external |
| APPLICATION SECURITY GATEWAY | **FAIL** | §35, §36 (`realm` / `deviceId` on the context, `67eec1dc`) DONE; §40 strict unknown-field refusal on 906 / 1,268 body routes (`327d2ddb`, ratchet gate). **Gaps:** §38 per-route `@ResourceScope` metadata; 362 body routes still strip-mode |
| AUTHENTICATION | PASS | §49–§58, §161; identity lane 585 tests; pilot phases 1, 12 |
| SUPER ADMIN MFA | PASS | §50, §132 (`require-totp`, `mfa-bypass-regression`) |
| SESSION ROTATION | PASS | §53 / §55; `refresh-session` (11) |
| REFRESH REUSE DETECTION | PASS | §54; `refresh-reuse-alert`, `refresh-device-binding.pgtest` |
| AUTHORIZATION | PASS | §67 / §69 / §162; §68 ASSIGNED + PLATFORM scopes (`67eec1dc`, `decision.test`); §134 dual approval for platform-admin actions (`7cd0548e`) |
| TENANT ISOLATION | PASS | §71–§74; `cross-tenant-suite.pgtest`, `check:tenant`, `check:tenant-builder`; pilot cross-salon checks |
| BRANCH ISOLATION | PASS | §75 / §187 `cross-branch-suite.pgtest`; pilot S14; branch rows in the IDOR table + live location attack (`c1f9fea2`, 38 / 39 refused — SD-21 open, Secure Tap owner) |
| IDOR TESTS | PASS | §74 `idor-route-coverage` |
| SQL INJECTION | PASS | static: parameterized SQL + `check:sql`, `check:raw-sql-inputs`, `check:sql-identifiers`; **§163 local dynamic pass** (`live-injection-pass.mjs`, Oct 27 2026): 2,422 routes, 22,250 requests — 0 SQL error text, 0 changed query behaviour; 13 routes answer 5xx to malformed input (robustness findings per owner, `SECURITY_TEST_REPORT.md` §4); staging run external |
| XSS | PASS | §87 / §88 (escape audit incl. single-file apps); §163 dynamic pass: no payload reflected as HTML; §89 `<style>` elements by sha256 (`d5269ecf`) — admin-web / customer-web / pos-web still allow `'unsafe-inline'` elements (computed `<style>`, status §89 PARTIAL) |
| CSRF | PASS | §90 |
| CORS | PASS | §48; `cors-native-origins` |
| SSRF | PASS | §91 / §92 / §164 (`safe-outbound`); note §93 process-wide egress allowlist still PARTIAL |
| COMMAND INJECTION | PASS | §94 / §95 — no shell execution with untrusted values; hidden-code gate |
| FILE UPLOAD SECURITY | BLOCKED_EXTERNAL | §102 / §103 / §165 DONE; §104 / §106 app half (`251b24d2`): images refused unscanned in production once a scanner is deployed; the ClamAV host itself is S-B5 |
| WEBHOOK SECURITY | **FAIL** | §107 / §109 DONE; **gap §110:** strict webhook payload schemas not built (§108 replay timestamps wait on the processors' spec — external) |
| REALTIME SECURITY | PASS | §111–§116, §168; `realtime-isolation`, `sse-session-guard` |
| PAYMENT SECURITY | PASS | §117–§129, §169 (pilot phases 4–6, 10, 12; race lane); §128 log-capture scan over payment / refund / webhook flows (`6e1647fa`) |
| SUPER ADMIN HARDENING | PASS | §131–§140: §134 approvable platform-admin actions (`7cd0548e`), §136 trusted device for platform sign-in (`d598d8d3`, S-A13); VPN / IAP external |
| AUDIT LOGGING | PASS | §49 / §50 / §137; append-only trigger; pilot S13 trace |
| SECURITY ALERTING | BLOCKED_EXTERNAL | §153 app signals DONE; routing to operators (§154) needs SendGrid / Twilio paging |
| DATABASE NETWORK SECURITY | BLOCKED_EXTERNAL | §32 / §85 private DB, `aps_api` / `aps_worker` roles in production |
| BACKUP ENCRYPTION | BLOCKED_EXTERNAL | §150 hosting |
| RESTORE TEST | BLOCKED_EXTERNAL | local drill 12 / 12 today; a hosted backup restore external (§151 / §190) |
| CI/CD SECURITY | BLOCKED_EXTERNAL | §23 / §146 DONE; branch protection + required checks (§141) are GitHub settings |
| SAST | BLOCKED_EXTERNAL | CodeQL workflow configured; first run after the K-12 push (§142) |
| SCA | PASS | npm audit gate today: critical 0, high 1 (reviewed, reviewBy 2027-01-31) |
| SECRET SCANNING | BLOCKED_EXTERNAL | as SECRET SCAN; push protection is a GitHub setting; §144 pre-commit hook built (`87ca7624`) |
| CONTAINER SCANNING | BLOCKED_EXTERNAL | Trivy workflow configured; first run after the push; base-image digest pins (S-B9) |
| PENETRATION TEST | BLOCKED_EXTERNAL | §171 |

§157 lower-environment data policy + anonymising dump: DONE Oct 27 2026 (`6c64dbbf`).

## 5. Platform announcement — POS top bar (mandate p.10 "Required Claude Final Build Matrix", PASS / FAIL)

Section status (`PLATFORM_ANNOUNCEMENT_STATUS.md`): **Oct 27 final pass: 168 DONE · 0 PARTIAL · 0 NOT DONE · 0 external** (§108 / §165 closed by the 58 / 58 browser proof; Oct 26: 159 / 8 / 1).

| Component | Result | Evidence / gap |
|---|---|---|
| API | PASS | `platform-notice.service.ts` / controller (step-up on publish / pause / resume / archive, audit, outbox); `platform-notice.pgtest` + core spec in the communications lane; pilot phase 10 "PLATFORM ANNOUNCEMENT" |
| POS | PASS (Oct 27) | `PlatformAnnouncementBar.test.tsx` 17/17. Closed Oct 27 (`4dd41f0e`): §72 stale in-flight snapshots dropped (sequence + serverTime); §116 POS snapshot / realtime / receipt failures counted on /metrics (`aipowersalon_client_events_total{app="pos"}`); §34 react-icons; §106 contrast measured (≥ 4.5:1 everywhere) + the More panel a modal dialog with a focus trap |
| Super Admin | PASS (Oct 27) | `PlatformAnnouncementsScreen.test.tsx` 15/15; §60 Created by column (platform user's name), §34 no emoji in the preview, §84 Suggest from System Status (draft only) |
| Realtime | PASS | `realtime-projection.platform-announcements.vitest.spec.ts`; browser proof offline → reconnect restores |
| Database Migrations | PASS | 674 on a fresh DB; RLS on the tenant-keyed tables. §98 (Oct 27, `d6631f8e`): EXPLAIN ANALYZE on a 20,000-notice fixture → migration 699 (POS snapshot 1.25 → 0.43 ms, admin list 20.1 → 0.68 ms) + the salon-search rewrite (941–1,540 → 6–11 ms) — `PERFORMANCE_REPORT.md` |
| Unit Tests | PASS | lanes green |
| Integration Tests | PASS | pgtest (PGlite, every migration) + pilot phase 10 / 13 (final pass 235 / 235) + browser proof 58 / 58 |
| Security Tests | PASS (Oct 27) | API snapshot / realtime / DOM leakage asserted; §164: the browser proof scans the whole API log (≈797 KB) for every published announcement text — none |
| Tenant Isolation | PASS | pgtest + pilot phase 10 (salon B's POS does not see salon A's notice) + browser proof |
| Responsive UI Tests | PASS (Oct 27 final pass) | `tooling/e2e/pos-announcement-layout.mjs` on the final HEAD: **58 / 58** — no horizontal overflow, Search ≥ 180 px, utilities visible and not overlapped, ≤ 2 lines, and the message keeps readable room at all four widths (209 px at 1366×768, 163 px at 1280×800 — the two checks that failed at `dd92f860`) |

---

## 6. English + Vietnamese POS (mandate §126 K "Build Matrix", added Oct 27 2026)

This run is separate from the M7 regression above. It was made on `merge-github-main` at `dd92f860`, the product code under
test, plus the WP-J documentation commit. It ran on a fresh database migrated through 697, with all pilot phases and no
`PILOT_SKIP`.

Section status (`docs/mandates/status/VIETNAMESE_POS_STATUS.md`): 113 DONE · 11 PARTIAL · 3 NOT DONE · 0 BLOCKED_EXTERNAL
(of 127). The full A–L report is `docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md`.

| Validation | Result | Evidence executed |
|---|---|---|
| POS build | PASS | backend build + `vite build` (pos / admin / owner / tech / customer-display) rc 0 |
| Typecheck | PASS | `npm run typecheck` rc 0; `tsc --noEmit` pos-web rc 0 |
| Lint / gates | PASS | `npm run ci:gates`: **all 54 gates + 19 audits passed** |
| i18n unit tests | PASS | pos-web **1,611 / 1,611** (345 files) |
| Integration tests | PASS | `ci:test:api` **3,070 passed** (375 files, 137 env-gated skipped); `vietnamese-unicode.pgtest` 4 / 4; owner-web 358; admin-web 1,055 |
| E2E English | PASS | pilot phases 0–12: 210 checks |
| E2E Vietnamese | PASS | pilot phase 13: 14 checks — **224 / 224 in total** (833 s), `docs/pilot-runs/2026-10-27-vietnamese/` |
| Visual (EN / VI) | PASS — layout assertions | one-screen matrix **54 / 54** at the primary viewport — a 1920×1080 screen with the browser chrome and taskbar visible, i.e. a 1920×945 page (9 modules × EN / VI × empty / light / busy at 200 technicians); full-screen 1920×1080 also 54 / 54. This is not a pixel diff; see report §K |
| Tenant isolation | PASS | `language.pgtest`, `vi-search.pgtest`, pilot 10f / 13g |
| User language persistence | PASS | pilot 13a |
| Tenant default language | PASS | pilot 13a |
| Super Admin English only | PASS | pilot 13i (Chromium) + `check-admin-english-only` |
| 1920×1080 Vietnamese fit | PASS | 27 / 27 Vietnamese views at the primary viewport (chrome + taskbar), and 27 / 27 full-screen |
| 200-technician Vietnamese test | PASS | pilot 13b–13f |
| Responsive full-screen 1920×1080 / 1600 / 1366 / 1280 (report only, WP-J run — fixed in the open-items pass below) | FAIL (internal) → fixed | busy 67 / 72 (empty and light 72 / 72; full-screen 1920×1080 18 / 18 in every state). Overview Notify × View All at 1366 / 1280 in EN and VI; Checkout VI row buttons at 1280 |
| Translation review | BLOCKED_EXTERNAL | 3,640 strings wait for Kevin (`docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md`; 3,465 at WP-J + 71 paycheck + 47 receipt AI + 57 open items) |

**Open items V-2 … V-6 (Oct 27 2026, second pass; commits `5b75796a`, `a56e4026`, `46e7bcd5`, `e1e32132`; evidence
`docs/pilot-runs/2026-10-27-vietnamese-open/`).** Section status now **116 DONE · 8 PARTIAL · 3 NOT DONE · 0 BLOCKED_EXTERNAL**.

| Validation | Result | Evidence executed |
|---|---|---|
| One-screen primary 1920×945 (EN / VI × empty / light / busy) | PASS | **54 / 54** (now also: visible-box overlaps, cut-off controls, hit areas, layout unchanged by hit areas) |
| Responsive 2560 / 1920×1080 / 1600 / 1366 / 1280 — fit | PASS | **270 / 270** no scroll / clip / cut-off / overlap (was busy 67 / 72); with hit areas 264 / 270 |
| Touch targets §78 (hit areas) | PASS (primary) | 0 short of 1,378 compact controls measured at the primary viewport (962 full, 343 neighbour-limited, 78 at a panel edge); 6 report items off-primary |
| Announcement top-bar proof | PASS | `pos-announcement-layout.mjs` 58 / 58 |
| AI prose language §120 | PASS | `ai-response-language.vitest.spec.ts` 12 / 12 (mock provider); modules/ai related suites 301 |
| Validation codes §58 | PARTIAL | request-schema 16, customer-validation-codes 4, error-text 16 / 16 (`HANDOFF_TOKEN_INVALID` has POS text since `b2783117`); V-5 final pass (`2fa57469`): 25 registry codes on 74 checkout / booking / queue throw sites + the deals engine's 42 reasons worded by the POS (`deal-reason-text.test` 5, checkout / booking / serving coded-refusal tests). **Gap (internal):** 264 free-text `ValidationError` sites remain in those four modules (338 before) and the other modules' services |
| Harness self-test | PASS | `node --test tooling/e2e/pos-vi-one-screen.test.mjs` 3 / 3 (real Chromium) |

## 7. Weekly Technician Paycheck, Cash Payout & Owner Approval — close-out (mandate §20 "Required test matrix", added Oct 27 2026)

The 13 INTERNAL PARTIAL items of `docs/mandates/status/WEEKLY_PAYCHECK_STATUS.md` were built Oct 27 2026 (commit `15a79fef`
+ the docs / pilot follow-up). Section status after the build: **161 DONE · 0 PARTIAL · 0 NOT DONE · 0 BLOCKED_EXTERNAL** (of 161; 17.5's pay-stub PDF built
Oct 27 2026 — its payout-provider half stays external, no provider connected). Suites below were RUN on this machine (TZ=UTC, 2 cores, a loaded host).

| Validation | Result | Evidence executed |
|---|---|---|
| Financial (§20.1) — the pure rules | PASS | `payroll-paycheck.vitest.spec.ts` **30 / 30** (incl. non-weekly windows, itemised reversals, CANCELED machine, signature strokes) |
| Integration on the real schema (§20.1 / §20.3 / §20.4) | PASS | `payroll-paycheck-closeout.pgtest.vitest.spec.ts` **10 / 10** (PGlite, every migration incl. 701): manager push without amounts; CANCELED + re-open; itemised reversals; branch-confined manager (view + mutation refused + salon-wide steps refused); hours evidence; preparation report reconciles; QR code (wrong / replaced / expired refused, right one once); PIN + signature; manager + technician dual; paid + unpaid = payable on every statement |
| Concurrency (§20.2) — money moving concurrently | PASS | real Postgres `race_final` (migrated through 702): `payroll-paycheck-closeout.postgres-race` **3 / 3** (QR ×10 → one confirmation / one event; dual ×10 → one; open ×10 → one period, cancel ×10 → one cancel, fresh period after) + the existing `payroll-paycheck.postgres-race` **3 / 3** still green |
| POS screen (§7.4 / §8.4 / §12.4 / §3.4 / §11.5) | PASS | `POSPaycheckTab.test.tsx` **11 / 11** (live remaining counter, evidence drill-down, preparation tab, cancel with step-up, QR + signature pad + dual); `tsc --noEmit` pos-web rc 0 |
| Owner App (§9.3 / §9.5) | PASS | `OwnerPaycheckPanel.test.tsx` **10 / 10** + catalog 2 / 2 (gross / already paid / other KPIs; evidence drill-down) |
| Tech App (§15.3 / §11.5) | PASS | `TechPayStatementsPanel.test.tsx` **6 / 6** + catalog 2 / 2 (lifecycle words; handoff code) |
| Migration on real Postgres | PASS | `701_payroll_paycheck_closeout.sql` applied to `race_final` by `apps/api/scripts/migrate.mjs` (412 ms) |
| Gates touched by the change | PASS | `check:event-producers` (catalog rewritten), `check:realtime-contract`, `check:openapi` (manifest), `check:attack-surface`, `check:state-transitions` (vocab regenerated), `check:db-ownership`, `check:actor-stamp`, `check:validated-bodies`, `check:critical-step-up`, `check:permission-docs`, `check:audit-writers`, `check:list-queries`, `check:sql:select`, `check:raw-sql-inputs`, `check:dead-client`, `check:perms`, `check:response-exposure` (the token hash never leaves the verify read; the wire field is `handoffCode`), `check:as-any` (payroll files back at baseline) — see the hand-back note for the gates that fail in other agents' files |
| Pilot day (end to end through the API) | ADDED — runs with the next full pilot | `live-pilot-day.mjs` phase 10e (the three cash halves confirmed three ways; a wrong code → 401 `HANDOFF_TOKEN_INVALID`) and the new 10e2: PREPARATION REPORT (3 checks / 3 envelopes, totals reconcile, receptionist refused), MANAGER "READY FOR REVIEW" (registered device pushed once, `period.calculated` audited, `payroll.manager_review_started` in the outbox, re-open idempotent), BRANCH-SCOPED MANAGER (`BRANCH_MANAGER` template: scoped week, submit / calculate / cancel → 403 `branch_scoped`), CANCELED PERIOD (400 without a reason; voided statements; event; the week re-created; calculate → 409). Syntax-checked (`node --check`); not executed in this run (the host was shared with five other build lanes) |
| Pay-stub PDF (17.5 / NEXT_STEPS W-3) | PASS | `payroll-paystub.vitest.spec.ts` **9 / 9** (rows reconcile to the stored payable, itemised reversals, YTD, payout lines, dates in the salon zone, EN + VI text read back out of the PDF, two-page flow, rate window) · `payroll-paystub.pgtest.vitest.spec.ts` **7 / 7** (PGlite, every migration: draft → 409; manager stub = the stored row and reconciles, YTD over two approved weeks, audited without amounts; a later week's approved bonus leaves the issued stub identical line for line; the technician's own stub in Vietnamese with every diacritic; another technician / another branch / receptionist / another salon refused; 429 per person; 200 stubs measured ~90–180 ms each on the loaded 2-core host) · `TechPayStatementsPanel` 9 / 9, `POSPaycheckTab` 14 / 14, `OwnerPaycheckPanel` 11 / 11 · gates `check:openapi`, `check:api-contract`, `check:list-queries`, `check:attack-surface`, `check:unreached`, `check:no-print`, `check:async-exports`, role matrix · pilot day through phase 10 on a fresh database (migrated through 702, `PILOT_STOP_AFTER=10`) **104 / 104** — the new 10e PAY STUB step: Lisa's Tech App stub in Vietnamese ("PHIẾU LƯƠNG", "Thợ", the statement number read back out of the PDF), the owner's POS stub in English carrying gross / payable / paid / still to pay of the stored statement, attachment + no-store, another technician 404, both downloads audited. The first run of that step caught a real defect — a `Buffer` returned bare from a Nest handler is JSON-serialised (56 KB of `{"type":"Buffer"…}` under `application/pdf`); the routes now return `StreamableFile` |
| EN + VI strings | PASS | 71 POS keys (`people.{en,vi}.ts`, appended to `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` — 3,536 rows now wait for Kevin), 19 Owner keys, 24 Tech keys; catalog tests green |

## 8. Receipt, Expense, Invoice, OCR & Accounting Intelligence — close-out (mandate §208 Definition of Done / §209 report, added Oct 27 2026)

The INTERNAL list of `docs/mandates/status/RECEIPT_EXPENSE_OCR_STATUS.md` was built Oct 27 2026 (commits `9a0a1dd1` → `2eefe1de`,
plus `aee55104` for the gateway route + perceptual hash). Section status after the build: **192 DONE · 18 PARTIAL · 1 NOT DONE
(§181 purchase orders — allowed-not-required, decided against) · 1 BLOCKED_EXTERNAL (§127)** of 212 rows. Migration 700. Suites
below were RUN on this machine (TZ=UTC, 2 cores, PGlite through 702).

| Validation | Result | Evidence executed |
|---|---|---|
| Receipt pipeline on the real schema (§12 / §17 / §18 / §24 / §25 / §35–§38 / §74 / §75 / §113–§115 / §131 / §142 / §159) | PASS | `ai-ocr-receipt-close.pgtest.vitest.spec.ts` **9 / 9**: channel + quality verdict; thumbnail beside the untouched original (bucket) / nothing pretended (no bucket); pages under ONE document, deferred reading, every page key to the provider, merged reading, maxPages cap; job-enqueued vs inline; the flaky-provider ladder end to end (1 min, 2 min, dead letter, sweep never re-picks it, a person's retry); fields + lines persisted, corrections stored; upload switches; suggestion stored, never linked; retention archives, keeps a live expense, honours the hold and the 30-day floor. Every other OCR suite still green: **24 files / 179 tests** |
| Finance on the real schema (§62 / §63 / §74 / §75 / §83 / §142 / §177–§179) | PASS | `expense-close.pgtest.vitest.spec.ts` **6 / 6**; `expense.pgtest` **25 / 25**; `expense-shared-costs.pgtest` green; `finance-core.vitest` green |
| Scale (§205) | PASS | `expense-scale.pgtest.vitest.spec.ts` **6 / 6** at 10,000 expenses (routine) and **6 / 6** at the mandate's 100,000 (`SCALE_TESTS=1`, 277 s): one page + counted total, filters / search, SQL aggregates reconcile, index plans, OCR list cap, idempotent postings |
| OCR quality evaluation (§147 / §197 — adapter + validator; the live provider stays external) | PASS | `ai-ocr-receipt-accuracy.vitest.spec.ts` **17 / 17** over 16 synthetic fixtures: 100 % vendor / date / total / subtotal / tax / number / lines / type / routing; `ai-ocr-receipt-quality.vitest` **8 / 8** |
| Notifications (§113 / §121 / §177–§179) | PASS | `in-app-notification.pgtest.vitest.spec.ts` **14 / 14** (+1 case: four new events, five switches, a failed reading never silenced, tenant mismatch refused) |
| Offline capture (§155–§157) | PASS | `receipt-capture-queue.test.ts` **6 / 6** (ciphertext at rest under a non-extractable key; refuses without WebCrypto; deleted on confirmation; 48 h TTL; cap; one sync per reconnect) |
| POS Receipt AI screen (§18 / §26 / §38 / §115 / §142 / §155) | PASS | `POSAIOcrReceiptScreen.test.tsx` **6 / 6**; `tsc --noEmit` pos-web: only another lane's `error-text.test.ts` fails |
| Owner App Expenses (§18 / §26 / §83 / §111 / §155 / §177) | PASS | `ExpensesScreen.test.tsx` **19 / 19** (15 existing + 4) |
| Super Admin overview (§78 / §115 / §145 / §149) | PASS | `super-admin-ai-ocr-receipt.pgtest.vitest.spec.ts` **2 / 2** (counts and rates only; nulls on an empty platform) |
| Routes / registries | PASS | manifest (+5 routes), role-matrix snapshot (+5), route-types baseline, IDOR fixture `documentId` (coverage 8 / 8), event catalog (`expense.summary_ready`), kysely types, api-contracts types; `check:openapi` `check:api-contract` `check:attack-surface` `check:db-ownership` `check:actor-stamp` `check:validated-bodies` `check:list-queries` `check:mass-assignment` `check:critical-step-up` green for these files |
| Pilot day (receipt step 10d) | RUN — both checks PASS (`docs/pilot-runs/2026-10-27-receipt-ocr/pilot.txt:116-117`, phases 1–10 on a fresh DB, 94 / 96 overall; the 2 failures are the paycheck lane's 10e2) | `live-pilot-day.mjs` 10d: RECEIPT CLOSE-OUT (channel + quality verdict on a 1 px upload, page 2 under the same document) and FINANCE CLOSE-OUT (the monthly switch off / the rest on; an auto-approval rule read back normalised; an unread receipt's suggestion UNMATCHED; payment match UNMATCHED with its reason; a person's link → matched). Executed Oct 27 2026 against the built API |
| EN + VI strings | PASS | 47 POS keys (`people.receiptAi.*`, appended to `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` — 3,640 rows now wait for Kevin); the Owner App strings are English-only as the rest of that app |

## Internal gaps that keep a component from PASS (buildable without Kevin) — Oct 27 final pass

200-Tech §1 / §2 / §101 (roster-wide state reads; see `200_TECHNICIAN_STATUS.md`) · Remaining §39 lint / `as any` reduction
(192 warnings, 5,708 `as any`) · Security §14, §17, §30, §38, §40 (strict bodies — more routes), §89 (CSP `unsafe-inline` in 3
apps), §93, §104 / §106 image quarantine, §108 / §110 webhook payload schemas, §142, §145, §149, §151, §154, §156, §190, §192
(each named in `SECURITY_DEEP_SCAN_STATUS.md`) · Vietnamese POS §58 (264 free-text server refusals left in checkout / booking /
queue / deals, plus the other modules) and the 8 PARTIAL / 3 NOT DONE rows of `VIETNAMESE_POS_STATUS.md` · Receipt / Expense / OCR 18 PARTIAL rows (`RECEIPT_EXPENSE_OCR_STATUS.md`) · B-93 (OCR store swallows
writes). Closed in the final pass: SD-21, the 13 malformed-input 5xx routes, Announcement §108 / §165, the 10e2 handoff code,
`check:unreached` (Owner App suggested expense), Kevin's §24 decision (category fallback for unconfigured technicians).

## EXTERNAL — for Kevin

1. **K-12 sequence** (owner: Kevin's developer) — rebuild the machine, rotate every credential, revoke the Firebase key,
   new Play upload keys, DB password + close 5432, push the rewritten history; then the first CodeQL / gitleaks / Trivy /
   dependency-review runs and branch protection with required checks.
2. **Payments** — CardPointe UAT credentials and each salon's live MID; confirm `inquireByOrderid` for refunds / top-ups /
   app intents; Fiserv CommerceHub SDK + sandbox credentials + webhook secret + per-location merchant enrollment (one
   CommerceHub MID from the environment today); the processors' webhook signing / timestamp spec.
3. **Apple / devices** — Tap to Pay on iPhone entitlement, three physical iPhones, a Mac for the native iOS builds (Secure
   Enclave key store, App Attest, Face ID, switcher cover); native Tech App shells.
4. **Hosting** — TLS, edge WAF / bot / DDoS, private database + `aps_api` / `aps_worker`, KMS or an accepted
   Railway-variables decision, encrypted backups + a real restore, monitoring / alert routing, Railway variables.
5. **Providers** — Twilio (A2P, numbers, Verify), SendGrid (key, domain), Firebase / APNs keys, AI provider keys, S3 bucket +
   IAM, ClamAV, Textract.
6. **Independent penetration test** against staging after item 4.
7. **Measurement on production-class hardware** — the §90 realtime lag target (< 2 s p95 under a 3,500-event burst): on this 2-core
   host the final-pass pilot measured p95 0.95 s; confirm on the production class.
