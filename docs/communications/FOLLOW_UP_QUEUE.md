# Follow-Up Queue — Complete Build Guide (Oct 30 2026) — implementation & handoff

Guide 13 of 20. Route `/follow-ups` (POS → Communications). Built on the End-of-Day Follow-Ups work (`END_OF_DAY_FOLLOW_UPS.md`, guide 12): the same
`service_follow_up_tasks`, the same 8 PM generation, the same send path (`claimAndSendTask`). **No second queue, scheduler or send path.** Local commit only;
nothing pushed, deployed, sent or charged. Migration **746** (indexes only) is on the local `aps` test template only.

## What the screenshot showed, and why (guide §01, §08)

| Observation | Finding from the code |
|---|---|
| Sidebar said **Missed Call Follow-Up**, page said "end-of-day client follow-ups by technician" | The nav item `comm-missed` pointed at `/follow-ups`, which has only ever shown **after-service** tasks. Missed calls live in a different source (`call_intelligence_events`, answered from the SMS Inbox); there was never a missed-call task table. **Fixed:** the item is now **Follow-Up Queue** (same id, same route), and the page has a separate **Missed Call** type. |
| Five counters at **0** | Legitimate when nothing qualifies: tasks exist only after the 8 PM run (or Generate Now) finds completed service lines for the salon-local day. The old counters had no written basis and a failed load looked like 0. **Fixed:** one written basis (the task's due date), a visible "Unknown" when the load fails, the day's generation run (eligible / created / excluded by reason) and the overdue-from-earlier-days count. |
| Generate Now gave a one-line note | **Fixed:** it reports *eligible · created now · already existed · created today · not created by reason · failed*, and never sends. A second click creates nothing (proved). |
| Date was a plain input, no paging | **Fixed:** presets (Today / This Week / This Month / This Year / Custom) + the shared month **RangeCalendar**, an explicit date basis, server paging 10/20/50. |

## Task lifecycle (business vs provider state, guide §07)

```
candidate (completed line, not yet generated) ──8 PM / Generate Now──► pending ──► sent ──► customer_replied
                                                                   │  ▲ (manager approve)         rebooked = DERIVED (a later booking), never a status write
                       pending_manager_approval ◄──technician submit─┘  │
                         │ └──reject──► rejected ──resubmit──► pending_manager_approval
                         └──────────────┬──► skipped / dismissed / customer_not_available (no Customer App) / expired (history kept)
```
Delivery evidence is separate from the task status: the Customer App inbox row (`customer_notifications`, created / read). This workflow sends **no SMS and no
email** (unchanged; SMS / email delivery for follow-ups is NOT built — Twilio / email provider evidence therefore does not apply here).

## Built

| Area | Status | Notes |
|---|---|---|
| Original screen kept (title, five counters, date, status, Generate Now, task list) + nav correction | COMPLETED_AND_VERIFIED | E2E step 1: counters = database for the due date; sidebar shows "Follow-Up Queue", no "Missed Call Follow-Up" |
| Counters with one basis (§05): Pending (unsent incl. awaiting approval), Sent (sent / replied / rebooked), Skipped (skipped / dismissed / no app), Rebooked (a booking created ≤ 30 days after the send), Total Today — all on the salon-local **due** date | COMPLETED_AND_VERIFIED | pgtest "KPIs on one basis"; E2E; unknown-not-zero in the POS unit test (needs CI) |
| Generate Now result + idempotency (§08) | COMPLETED_AND_VERIFIED | pgtest: one task after two clicks; E2E: "2 created now" then "0 created now · 2 already existed" |
| 8 PM scheduler on tenant timezone (§09) | COMPLETED_AND_VERIFIED (guide 12) | unchanged; covered by eod-center pgtest + eod race spec + EOD E2E |
| Search (§06): name, phone digits, technician, service, ticket no., task / ticket / booking / customer / technician ID — server-side, all pages | COMPLETED_AND_VERIFIED | pgtest "search reaches beyond page 1"; E2E 12 matches → 10 + 2; phone never in the URL |
| Filters: status, technician, priority, due (overdue / today / upcoming), date basis (created · due · sent · last visit · rebooked), Clear All | COMPLETED_AND_VERIFIED | E2E + pgtest (salon-local boundary 03:59Z in, 04:30Z out) |
| Month From/To calendar + presets | COMPLETED_AND_VERIFIED | shared `RangeCalendar` anchored to its button (E2E: month grid, Cancel closes) |
| Pages 1/2/3, 10/20/50, operational order due → priority → completed → id; history newest first | COMPLETED_AND_VERIFIED | pgtest "overdue stays ahead"; E2E |
| Smart Follow-Up Priority (§10) — `fuq-priority-v1`: +2 overdue, +2 open low-rating / escalated review (60 days, not resolved, not spam), −2 already booked, −1 follow-up inside the cooldown, −1 two or more earlier follow-ups with no booking after; High ≥ 2, Low ≤ −1. Every reason shows its source timestamp. A tie-breaker inside a due date only; never sends | COMPLETED_AND_VERIFIED | pgtest + E2E ("Open concern on record (rating 2.0) (Oct 29 …)") |
| Duplicate Message Protection (§11): Eligible · Recently Contacted · Already Sent · Missing Contact · Blocked (archived) · Needs Approval, with the last follow-up, cooldown and other-channel contact | COMPLETED_AND_VERIFIED | pgtest + E2E. **Opted Out**: see decisions |
| Detail overlay (§12): customer, technician, service, ticket, due, delivery (in-app inbox / read), contact check, priority, message preview + character count, Send / Approve / Return to technician / Skip with reason / Retry (no-app task once the customer has the app) / Open Customer / Book Appointment, this customer's follow-up history; Close always visible | COMPLETED_AND_VERIFIED | E2E: Pia skipped "customer_declined" (no message), Amy approved (+1 message), Rita "Already Sent" (no Send), Nora "Missing Contact" (no Send / Retry), Close visible at 1024 |
| Two staff on one task (§07/§12) | COMPLETED_AND_VERIFIED | race spec 3/3 on real Postgres, 4 sessions: Send vs Skip (5 rounds), Approve vs Reject (5 rounds), and a **forced interleaving** (a Skip that read "pending" reaches the row after a Send committed → refused "cannot move from sent to skipped"; task stays sent, one message) |
| Missed Call type (§07, §13): its own list from `call_intelligence_events` (inbound, status missed), states Recovered (booked) · Replied (text / email / call-back after the call) · Awaiting callback, filter, Open SMS Inbox, Book (when a customer is linked); never counted as after-service | COMPLETED_AND_VERIFIED | pgtest + E2E |
| Customer follow-up history (§13) | COMPLETED_AND_VERIFIED in the overlay | `GET pos/follow-up-queue/customers/:id/history`; **not** embedded in the Customer Profile screen (handoff below) |
| Book Appointment with the customer preselected | COMPLETED_AND_VERIFIED (handoff URL) | `/booking/new?customerId=…&from=follow-up-queue` — the Booking screen's own flow (availability, six-digit verification) is unchanged |
| Results dashboard (§14): funnel eligible → generated → sent → in the app → viewed → booked after → came back; associated revenue from later paid visits (excluding the source ticket); by technician (small-sample flag); skip / expiry reasons; unsent queue age; the "association, not causation" note | COMPLETED_AND_VERIFIED | pgtest (one booking counted once; revenue 7500) + E2E |
| Health (§16) | COMPLETED_AND_VERIFIED (reused) | the EOD health endpoint (Ready / Attention / Pending / Unknown / Not used), shown on this page |
| Technician App (§13) | COMPLETED_AND_VERIFIED (guide 12) | unchanged |
| Tenant isolation, branch scope, roles, audit | COMPLETED_AND_VERIFIED | every query `tenant_id` + session branch; pgtest "tenant A cannot see tenant B"; writes audited by the existing service |
| CSV export of results | NOT_IMPLEMENTED | would need the async-export contract; not built |
| POS unit test `POSFollowUpsScreen.test.tsx` (rewritten), POS / API type-check | IMPLEMENTED_NOT_VERIFIED | needs CI (no React types / Vitest here) |
| Physical ASUS 27″ at 100 % zoom | BLOCKED_EXTERNAL | browser viewports only: 1920×945, 1536×864, 1440×900, 1366×768, 1024×768 — no sideways scroll |
| Migration 746 on staging / production | BLOCKED_EXTERNAL | owner approval |

## API (all `customers.edit`, tenant + branch from the session)

`GET pos/follow-up-queue/kpis?date` · `GET …/tasks` (view, q, status, technicianId, priority, due, basis, from, to, page, pageSize) ·
`GET …/tasks/:id/contact-check` · `GET …/missed-calls` (q, state, from, to, page, pageSize) · `GET …/results` (from, to, technicianId) ·
`GET …/customers/:customerId/history` · `POST …/generate`. New error code `FOLLOWUP_QUEUE_INVALID_FILTER` (400). Writes stay on `pos/follow-ups/:id/skip`,
`pos/eod-follow-ups/tasks/:id/{send,approve,reject}`.

## Migration 746 (indexes only) — rollback
`ix_sfut_unsent_due` (unsent tasks by due date) and `ix_call_intel_branch_time`. Rollback: `DROP INDEX IF EXISTS ix_sfut_unsent_due; DROP INDEX IF EXISTS ix_call_intel_branch_time;`
Applied twice to `aps` (idempotent).

## Decisions and conflicts
- **Nav label** corrected (guide §07 "investigate before coding"): same item id / route; the catalog key `pos.missed_call_follow_up` is untouched (catalog frozen) — the
  nav uses the new `fuq.nav`.
- **Missed calls are not tasks.** No code generates missed-call follow-up tasks (MESSAGE_TEMPLATES.md: "No automatic missed-call text exists"); the queue shows them as
  their own type with derived callback states and hands off to the SMS Inbox. No new task table was invented.
- **Opted Out** is reported only as information (SMS STOP / email opt-out by address, marketing flags) because follow-ups are delivered **in the Customer App** and
  no in-app opt-out exists in the code. Whether an SMS STOP or a marketing opt-out should also block in-app service follow-ups is an owner decision.
- **Other-channel contacts** (a staff SMS, a campaign) inside the window are **shown, not enforced**; the enforced cooldown stays the same-purpose follow-up cooldown
  from guide 12, so existing sends do not change behaviour silently.
- **Retry** = re-send a `customer_not_available` task once the customer has the Customer App; there is no provider attempt to retry (in-app delivery).
- **Old panel** (`FollowUpQueuePanel.tsx`, `FollowUpTaskTable.tsx`) is no longer imported; per the dead-code rule it is **registered** in `docs/dead-code-plan.json`
  (SAFE_DELETE, "2026-10-31 follow-up-queue"), not deleted. The by-technician chips (`FollowUpTechnicianSummary`) are kept on the new screen.
- **Found, not changed:** the End-of-Day settings page wraps the same `RangeCalendar` in an un-anchored container, so its popover can draw away from its button
  (this page anchors it). Worth the same one-line fix there.
- Harness limit: the old `GET pos/follow-ups` list needs the Kysely query builder, so the technician chips are empty in the harness (handled; works in production).

## Tests (31 Oct 2026, local)
| Suite | Result |
|---|---|
| `followup-queue.pgtest.vitest.spec.ts` (stand-in, real schema through 746) | 14/14 |
| `followup-queue.postgres-race.vitest.spec.ts` (real PostgreSQL 16, 4 sessions) | 3/3 |
| Regression: eod-center 15/15 · EOD core 20/20 · EOD generation 17/17 · branch-timezone 4/4 · customer-notifications 18/18 · message-templates 17/17 · eod race 4/4 | all pass |
| Browser `fuq` (Chromium; 5 viewports; EN + VI) | 7/7 |
| Combined browser run `seg,cp,do,promo,cc,mg,mt,cn,pm,bv,ms,eod,fuq` | **146/146** (the known harness page error "not in the harness" after the Book navigation) |
| `comms` section | 12/12 |
| Gates | 52 `check:*` via npm + 6 through the stand-in (sql-prepare, types-drift, sql-identifiers, db-ownership, unique-review, actor-stamp) pass; lint, boot, api-contract, strict-bodies-types cannot run here (CI) |

Commands: `FST_PG_TEMPLATE=aps REPO_ROOT=$PWD bash tooling/full-system-test/unit-standin/run.sh $PWD <spec>` ·
`PG_RACE_URL=postgres://postgres@127.0.0.1:55432/<db> … run.sh $PWD <race spec>` · `node tooling/checkout-one-screen/build.mjs && node tooling/catalog-one-screen/interact.mjs fuq-e2e fuq`.
Screenshots: `tooling/catalog-one-screen/results/fuq-e2e/`.

## Handoffs
- **Customer Profile:** embed the follow-up history section (`GET pos/follow-up-queue/customers/:id/history`) in the profile screen (the overlay already shows it).
- **14 Appointment Reminders / 15 Email:** if follow-ups ever get SMS / email delivery, use the notifications send path with consent, quiet hours and the new
  contact-check categories, and bind a salon template (`resolveBoundTemplate`).
- **16 Retention / Win-Back, 19 Reviews:** the priority's "open concern" signal reads `reviews`; keep resolution / escalation statuses consistent there.
- **Missed-call automation** (an automatic text after a missed call) does not exist; if built, it should create its own source type and keep counts separate.

## Owner decisions
1. Should an SMS STOP or a marketing opt-out also stop **in-app** service follow-ups?
2. Should a staff text or a campaign message inside the cooldown **block** a follow-up (today it is shown, not enforced)?
3. Is a 30-day window right for "Rebooked" and associated revenue?
