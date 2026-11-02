# Mandate completion matrix — Oct 26 2026 (final table Oct 27 2026)

## Final table — Oct 27 2026 final pass

Counts re-read from each per-mandate report after the final pass (full regression on the final-pass code `3c5ae402` /
`b01f8d71`: 19,281 unit / PGlite passed, race 336, 24 / 24 live proofs, pilot 235 / 235, announcement proof 58 / 58 —
`TEST_REPORT.md` "Oct 27 2026 — final pass"). DONE / PARTIAL / NOT DONE / BLOCKED_EXTERNAL.

| Mandate | Sections | DONE | PARTIAL | NOT DONE | BLOCKED_EXTERNAL | What is left |
|---|---|---|---|---|---|---|
| Secure Tap to Pay device authentication | 78 | 67 | 10 | 0 | 1 | every PARTIAL waits on a device or CommerceHub only |
| 200-Technician large salon | 105 | 102 | 3 | 0 | 0 | §1 / §2 / §101 roster-wide state reads (internal); §24 closed by Kevin's Oct 27 decision (`ded4729d`) |
| Remaining production work | 73 (+23 acceptance rows) | 52 | 1 | 0 | 20 | §39 lint / `as any` debt (internal) |
| Security deep scan / zero trust | 192 | 155 | 20 | 0 | 17 | strict bodies on more routes, CSP `unsafe-inline`, quarantine, webhook schemas … (`SECURITY_DEEP_SCAN_STATUS.md`); SD-21 fixed in the final pass |
| Platform announcement (POS top bar) | 168 | **168** | 0 | 0 | 0 | — (§108 / §165 closed: browser proof 58 / 58) |
| English + Vietnamese POS | 127 | 116 | 8 | 3 | 0 | §58: 264 free-text server refusals left (338 before V-5); the other PARTIAL / NOT DONE rows in `VIETNAMESE_POS_STATUS.md` |
| Platform Architecture Audit | 262 | 218 | 41 | 0 | 3 | 29 product gaps + 12 document-refresh / debt rows (§234–235, 238, 246–252, 254, 261); §233 / 236 / 239 / 245 / 255 / 258 closed on the final run (was 212 / 47) |
| Weekly Technician Paycheck | 161 | 160 | 1 | 0 | 0 | 17.5 pay-stub PDF worker (being built by another agent; not on the final-pass code) |
| Receipt, Expense, Invoice, OCR & Accounting Intelligence | 212 rows | 192 | 18 | 1 | 1 | the PARTIAL rows in `RECEIPT_EXPENSE_OCR_STATUS.md`; B-93 open |
| Full System Run | — | — | — | — | — | **SKIPPED by Kevin's decision Oct 27** |

Not covered by these counts: commits by other agents after the final pass (`6a1a76e8`) and their uncommitted work; on the
branch HEAD `ci:gates` fails 7 gates because of that work (attributed in `TEST_REPORT.md`). The sections below are the
history (pre-build audit at `ef7eb6bf` and each build round).

## History

Kevin's open mandates (five, plus the English + Vietnamese POS mandate added Oct 26 and the Weekly Paycheck mandate audited Oct 27), audited section by section against the code at `ef7eb6bf` (merge-github-main). Each row in
the per-mandate reports cites the code / test files that were opened; leads from earlier reports were verified, not
copied. Status words: DONE · PARTIAL (the missing part is named) · NOT DONE · BLOCKED_EXTERNAL (needs an account,
device, decision or hosting only Kevin can provide).

| Mandate | Sections | DONE | PARTIAL | NOT DONE | BLOCKED_EXTERNAL | Report |
|---|---|---|---|---|---|---|
| Secure Tap to Pay device authentication | 78 | 59 | 18 | 0 | 1 | `docs/mandates/status/SECURE_TAP_STATUS.md` |
| 200-Technician large salon | 105 | 84 | 19 | 2 | 0 | `docs/mandates/status/200_TECHNICIAN_STATUS.md` |
| Remaining production work | 73 (+23 acceptance rows) | 36 | 18 | 0 | 19 | `docs/mandates/status/REMAINING_PRODUCTION_STATUS.md` |
| Security deep scan / zero trust | 192 | 131 | 42 | 2 | 17 | `docs/mandates/status/SECURITY_DEEP_SCAN_STATUS.md` |
| Platform announcement (POS top bar) | 168 | 159 | 8 | 1 (§84, marked "future") | 0 | `docs/mandates/status/PLATFORM_ANNOUNCEMENT_STATUS.md` |
| English + Vietnamese POS (added Oct 26 2026; audited at `ab1c628b`) | 127 | 41 | 41 | 44 | 1 | `docs/mandates/status/VIETNAMESE_POS_STATUS.md` |
| Weekly Technician Paycheck, Cash Payout & Owner Approval (audited Oct 27 2026 at `f90c183d`) | 161 | 141 | 20 | 0 | 0 | `docs/mandates/status/WEEKLY_PAYCHECK_STATUS.md` |
| Receipt, Expense, Invoice, OCR & Accounting Intelligence (audited Oct 27 2026 at `f90c183d`) | 217 (212 rows) | 145 | 46 | 20 | 1 | `docs/mandates/status/RECEIPT_EXPENSE_OCR_STATUS.md` |

**After the Oct 26 build** (counts from the updated per-mandate reports): Secure Tap 66 / 11 / 0 / 1 · 200-Technician
94 / 11 / 0 / 0 (§6 / §54 Print Schedule closed as decided-against — Kevin kept the no-print rule) · Remaining production
unchanged 36 / 18 / 0 / 19 · Security 140 / 34 / 1 / 17 · Platform announcement unchanged 159 / 8 / 1 / 0
(DONE / PARTIAL / NOT DONE / BLOCKED_EXTERNAL). The table above is the pre-build audit at `ef7eb6bf`.

**After the Oct 27 build** (INTERNAL PARTIAL items of two mandates): Secure Tap **67 / 10 / 0 / 1** — §51 closed (unusual-registration
rule + owner / platform panels, `278c5bad`), §26 / §35 / §36 / §73 software halves proven (`d90c1bfe`), §XIX hand-back docs
DONE; every remaining PARTIAL row is external-only. Platform announcement **166 / 2 / 0 / 0** — §34 §60 §72 §84 §98 §106 §116
§164 closed (`4dd41f0e`, `d6631f8e`); browser proof re-run 56 / 58: §108 (readable room at 1366 / 1280 after the header
language switch) is the one open item, with §165 rolling it up.

**Remaining production — INTERNAL round (Oct 27 2026):** **52 / 1 / 0 / 20** (was 36 / 18 / 0 / 19). Built: §68 pilot phase 14
(four recovery flows, `44988993`), §15 / §16 / §58 wallet webhook leg (`2dbeb916`), §22 / §60 split-tender race (`2a7cd107`),
§65 allocation matrix (`ffc1b9d6`), §24 one skill rule (`3fa531bc`; Kevin's Oct 27 decision `ded4729d` — category fallback for unconfigured technicians), §30 OCR through the central AI gateway and
§31 perceptual hash (`aee55104`; §31's real S3 / Textract run moves it to BLOCKED_EXTERNAL), §59 reconnect test (`93d84d84`),
§66 technician cross-tenant probe (`fdbcaf69`); §45 / §69 / §70 / §71 / §73 re-verified DONE. §39 stays PARTIAL
(exhaustive-deps 81 → 76, `as any` 5,772 → 5,753). Acceptance rows: 11 / 2 / 0 / 10 (FAM-17 / FAM-18 are §39).

**Security deep scan — internal remainder (Oct 27 2026):** **155 / 20 / 0 / 17** (DONE incl. "DONE (app)" / PARTIAL / NOT DONE /
BLOCKED_EXTERNAL). Closed: S-A13 trusted device for platform sign-in (`d598d8d3`), §12 / §13 supply-chain gates (`54107bd4`),
§128 log-capture scan (`6e1647fa`), §144 pre-commit hook (`87ca7624`), §157 data handling + anonymiser (`6c64dbbf`, was the
one NOT DONE), §36 / §68 (`67eec1dc`), §134 (`7cd0548e`), §75 branch IDOR rows (`c1f9fea2`), §2 / §176 / §178 / §180 docs,
§163 local injection pass. Still PARTIAL with an internal half: §38, §40 (906 / 1,268 strict), §89 (3 apps), §93, §110,
§14, §192; the rest of the PARTIAL rows are external-only.

**Weekly Paycheck — close-out (Oct 27 2026):** **160 / 1 / 0 / 0** — all 13 INTERNAL items built (`15a79fef`): manager
"ready for review" push, branch-confined managers (view + mutation + salon-wide refusals), `period.calculated` audit,
`payroll.manager_review_started` + `payroll.period_canceled` events, biweekly / semimonthly / monthly periods, the CANCELED
period, itemised reversals, the cash-envelope / check-run preparation report, time-clock evidence in the drill-down (POS +
Owner App), Owner KPIs, Tech App lifecycle words, the live split counter, and QR / signature / manager + technician cash
confirmations (migration 701). The one PARTIAL row (17.5) is the pay-stub PDF worker and the unconnected payout provider.
Evidence: unit 30, PGlite close-out 10, real-Postgres race 6, POS 11, Owner 12, Tech 8 — all run; pilot phase 10e2 added.

**Receipt / Expense / OCR — close-out (Oct 27 2026):** **192 / 18 / 1 / 1** — the INTERNAL list built (`9a0a1dd1` → `2eefe1de`; the
gateway route + perceptual hash in `aee55104`): multi-page documents with "one receipt or several?", server-side quality verdict
with Retake / Process anyway, thumbnails + review copies beside the untouched original, extraction as a durable job with a
retry ladder and a dead letter, the per-field reading persisted with stored corrections (Verify / Confirm / Edit), receipt →
existing-expense suggestion and expense ↔ payment matching (MATCHED / POSSIBLE_MATCH / UNMATCHED, never fabricated), owner
auto-approval rules, five notification switches + four new owner alerts + weekly / monthly summaries, offline encrypted capture,
nightly retention (archive, never delete), the receptionist / technician switches enforced, richer field coverage, SA quality
metrics, a 16-fixture accuracy corpus (100 %) and the 100k-expense scale test (migration 700). The one NOT DONE row is §181
purchase orders (allowed-not-required, decided against); BLOCKED_EXTERNAL stays §127 (encryption at rest / TLS). Still PARTIAL:
the list filter chips (§87), the ratio KPI + PDF export (§94 / §98), the permission keys (§73 — Security lane), the live-provider
halves (§197 / §203) and the DoD / final-flow roll-ups that cite them.

**English + Vietnamese POS — final (Oct 27 2026, WP-J):** 113 DONE / 11 PARTIAL / 3 NOT DONE / 0 BLOCKED_EXTERNAL. The NOT DONE
rows are §50 / §52 / §53 only: bilingual catalogue names, which are not built because of Kevin's ruling. The PARTIAL rows are:

- Kevin's review of 3,465 strings (§36);
- touch-target size (§78);
- the responsive report items (§79);
- language-model prose (§120);
- server validation prose and the exact-text label bridge (§2 / §21 / §58);
- three kept design decisions (§18 / §19 / §122);
- §125, which follows from the others.

Evidence: a full pilot day on a fresh database, **224 / 224**, all phases including phase 13 Vietnamese, in
`docs/pilot-runs/2026-10-27-vietnamese/`. Engineering report: `docs/i18n/VIETNAMESE_POS_ENGINEERING_REPORT.md`.

**English + Vietnamese POS — open items pass (Oct 27 2026, V-2 … V-6):** **116 DONE / 8 PARTIAL / 3 NOT DONE / 0 BLOCKED_EXTERNAL**.
§78 (44 px hit areas, look unchanged), §79 (smaller screens + 2560) and §120 (AI prose in the reader's language) are DONE; §55's
picker was already built. PARTIAL now: §36 Kevin's review (3,640 rows), §2 / §21 / §58 (free-text service validation prose and
the exact-text bridge; schema and customer-form refusals are coded), §18 / §19 / §122 (kept decisions), §125. Evidence:
`docs/pilot-runs/2026-10-27-vietnamese-open/`, report §M.
The audit row in the table above is the pre-build state.

Section counts differ from earlier hand-off notes (the Security mandate has 192 numbered sections, not 206; Remaining
Production has 73 numbered sections plus a 23-row acceptance matrix) — these are the counts in the mandate texts in
`docs/mandates/`.

Each report ends with an **INTERNAL — buildable now** list (priority order) and an **EXTERNAL — needs Kevin** list. The
internal lists are the build queue for the Oct 26 continuation; the external lists are consolidated in
`docs/HOSTING_ACTIONS_FOR_KEVIN.md` and `NEXT_STEPS.md`.

Corrections found by the audit (claims in earlier reports that were not true):
- `modules/checkout/src/mobile-checkout/mobile-unsettled-guard.vitest.spec.ts` (cited by the Secure Tap engineering
  report and commit 9dd22660) was never written; the unsettled-tender guard code exists but its mobile-side spec does not.
- `DEVELOPER_HANDOFF.md` still said M6 "not started"; TEST_REPORT / PROJECT_STATUS / INTEGRATION_STATUS carried nothing
  after Oct 22.
- The outbox lane commit (3c6c8294) claimed clients drop realtime frames older than `resourceVersion`; no client read it.
