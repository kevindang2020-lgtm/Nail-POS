# Build queue — guides uploaded Nov 3 2026

Every guide Kevin uploaded on Nov 3 2026, in the order received. Status: QUEUED → AUDITED → BUILDING → BUILT (commit). A guide is BUILT only when its gaps from the audit are closed and tested; anything deliberately not built is listed under "Not built" with the reason.

## Batch A (10:33) — 20 AI guides
| # | Guide | Route | Status |
|---|---|---|---|
| A1 | AI Center (refreshed) | /tenant/ai/command-center | BUILT — P0 counts reconciled with the AI gate, honest KPIs, Check AI System (7a1cec0, 9192e30); directory in 2–3 columns, every card opens the 6-tab details overlay, Usage & history opens the activity log in place |
| A2 | AI Business Alerts (newer) | /tenant/ai/business/alerts | BUILT (core) — edit / duplicate / per-rule history, quarter & year, failed evaluations recorded, archive; incidents, scheduler and notifications listed as not built in docs/ai/AI_BUSINESS_REPORTS_AND_ALERTS.md |
| A3 | AI Branch Comparison | /tenant/ai/business/branches | BUILT (core) — see docs/ai/AI_BRANCH_COMPARISON.md (health checker, fair scorecard, AI explanation not built) |
| A4 | AI Business Assistant | /tenant/ai/business | BUILT (core) — see docs/ai/AI_BUSINESS_ASSISTANT.md (stored conversation history, extra ranges, record search not built) |
| A5 | AI Scheduling Optimizer | /tenant/ai/scheduling-optimizer | BUILT (gaps) — Yesterday / Last 7 presets, health checks branch-scoped in salon time, per-branch runs, device-day fallback; technician full-day overlay and neighbour preview still open (owner decision in SCHEDULING_OPTIMIZER.md) |
| A6 | AI Queue | /tenant/ai/queue | BUILT — salon-day ranges (bb92dd5); Check AI Queue System (13 parts, recorded — 789), assignment history with server search / filters / numbered pages / URL filters, 7-tab guest overlay (8a5c84d) |
| A7 | AI Booking Assistant | /tenant/ai/booking | BUILT — operations center over the existing booking records, activity, 8-tab overlay, recovery cases (draft-only messages, audited Dismiss), Check AI Booking System (790, 8a5c84d); Review alternatives from POS Booking's availability and Request Manager Approval through POS Approvals (afb238a) |
| A8 | AI Reception Copilot | /tenant/ai/reception-copilot | BUILT (fixes) — links, reschedule proposal, waitlist claim, midnight windows, sender check, branch scope, Yesterday, menu gating, error texts; name pickers / URL filters / health 'responsible role' still open |
| A9 | AI Receptionist Settings | /tenant/ai/receptionist/settings | BUILT (core) — versions + history + restore, stale save refused (409), effective source shown, salon fallback, no silent default overwrite, coded errors; NOT built: the live agent reading these settings (shown honestly on the page), consent-script approval, health checker |
| A10 | AI Calls | /tenant/ai/receptionist/calls | BUILT (fixes) — health never green when the receptionist checks fail, pending-code count branch-scoped and 'unknown' on error, per-branch runs, page kept from the URL, ?call= opens a call; NOT built: caller / dialed-number columns, Twilio SID search, extra date bases, call_links table, SSE |
| A11 | AI Calendar | /tenant/ai/receptionist/calendar | BUILT (fixes) — health check survives one failed read (savepoints), per-branch runs, failed-call count branch-scoped, metrics check can warn, no silent New York, overlay reports unreadable sections; open-slot hours and Booking deep-link remain owner decisions (AI_CALENDAR.md) |
| A12 | Business Setup | /tenant/ai/receptionist/business-setup | BUILT (fixes): FAQ request key reuse refused (422 IDEMPOTENCY_KEY_REUSED); technician eligibility limited to branch services; Today/Week/Month/Year presets; device-day today. Not built: FAQ overlay tabs, tags, filters, holiday exceptions, recorded health runs |
| A13 | AI Follow-Ups | /tenant/ai/receptionist/follow-ups | BUILT (fixes): edits without the row version refused (422 VERSION_REQUIRED); overdue alert keyed by due time + reopen count (a moved due time or a reopened task alerts again); Edit details (description, due time) versioned + audited. Earlier: attempts on resolved tasks, escalation per level on task branch, per-branch health reuse. Not built: missed-call / Reception Copilot sources, recommended assignee, hold expiry, notify assigned staff, health history |
| A14 | AI Front Desk | /tenant/ai/receptionist/front-desk | BUILT (fixes): each branch judged by its own latest call (one branch no longer marks others Degraded); directory + summary follow the salon selector; handoffs = real handoffs with transferred / failed split; "booked" = appointments created (holds, cancels, reschedules no longer counted), waiting-for-code shown; calendar today is the device day; dead links fixed earlier. Kept on purpose: "provider agent also linked in another salon" warning (a yes/no safety check, no other-salon data shown). Not built: assigned number / creator search, call search by customer / phone / appointment, call detail overlay, average duration |
| A15 | AI Receptionist | /tenant/ai/receptionist | BUILT (fixes) — one failed read no longer breaks the check, activity search / overlay appointments / control history branch-scoped, no silent New York time zone, voice minutes N/A without calls; NOT built: missed / in-progress statuses, agent / service / duration filters, URL filters, live updates |
| A16 | Reception Copilot (v2) | /tenant/ai/copilot | Same screen as A8 (fixes shared); tabbed workspace and Calls/SMS search scope NOT built |
| A17 | Reviews & Reputation | /tenant/marketing/reviews | BUILT (fixes): KPI strip follows the technician / source filters (scope stated); review overlay no longer shows branch "null"; moderation history staff names joined within the salon only. Not built: assign workflow, communication history tab, first/last name search split, recorded health runs |
| A18 | Referral Program | /tenant/marketing/referrals | BUILT (fixes): a reward waiting for approval shows in Needs review only (was in Qualified too); archived customers refused and staff names salon-scoped (fixed earlier). Not built: branch / eligibility / creator / reviewer filters, more fraud signals, communication tab, recorded health runs |
| A19 | Customer Retention / Win-Back | /tenant/marketing/win-back | BUILT (fixes): search by email; accent-insensitive names ("nguyen" finds "Nguyễn"); every word of a first + last name must match; % and _ are literal. Test fixture made date-proof (failed on the 1st–3rd of a month). Not built: search scopes, service category / technician / spend-band filters, "New" definition change, Add to eligible audience |
| A20 | Birthday Campaigns | /tenant/marketing/birthdays | BUILT (fixes): message / offer / visit KPIs follow the chosen range (customers whose birthday is in it) and the branch; Feb 29 birthdays sort on their celebrated day (Feb 28 / Mar 1 policy); visit association anchored on send time; history branch-scoped (earlier). Not built: more date bases, history dialog search / range / page size, activity / tier / source filters, offer status column, birthday timeline |

## Batch B (10:35) — 18 marketing / communications guides
B1 Customer Segments · B2 Coupons & Promotions · B3 Deals & Offers · B4 Promotions · B5 Campaign Center · B6 Global Loyalty Final Completion · B7 Marketing & Growth · B8 Message Templates · B9 Notifications · B10 Phone Number Management · B11 Booking Phone Verification · B12 Text Messaging Setup · B13 End-of-Day Follow-Ups · B14 Follow-Up Queue · B15 Appointment Reminders · B16 Email · B17 LoyaltyTokens · B18 LoyaltyRules — all AUDITED (B5–B8 audit pending).

## Batch C (10:37) — 13 guides (LoyaltyTokens is an exact repeat of B17)
C1 Loyalty Complete · C2 Communications (updated) · C3 Four Modules · C4 Phone & Messaging combined · C5 Customer Retention (complete) · C6 Team Management · C7 Five Unfinished Features · C8 Technicians · C9 Tech Appointments · C10 Live Technician Schedule · C11 Tech Queue · C12 Commission Report — C1–C5 AUDITED Nov 4 night (findings in GUIDE_AUDIT_FINDINGS, "Batch C audits"); all 16 bugs fixed (4baf21a); C5 Cancel Campaign + branch sender built (53c4637). C6–C12: see below.

## Batch D (10:40) — 20 guides (Commission Report is an exact repeat of C12)
D1 Team Performance · D2 Services & Products · D3 Service Categories · D4 Service Pricing · D5 Add-Ons · D6 Membership · D7 Discounts · D8 Products · D9 Inventory · D10 Suppliers · D11 Stock Alerts · D12 Stock Alerts – Technician Usage · D13 Payments & Money · D14 Transactions · D15 Cash Drawer · D16 End-of-Day Cash · D17 Refunds & Voids · D18 Split Payments · D19 Tips — QUEUED.

Batch D was sent again at 11:09 (same 20 files; Commission Report again a repeat). Nothing new to queue.

## Build order
1. Wrong-number and money bugs found by the audits (they affect live salons now).
2. Guides in batch order, one at a time; each gets a commit.

## Wrong-number / money / scope bugs found by the audits (fix first)
1. ✅ FIXED — Appointment reminders skip `confirmed` appointments (only `booked` eligible).
2. ✅ FIXED — Loyalty: token purchase reversed/charged back after funding leaves tokens spendable; books check accepts it. (Also: a locked/suspended wallet is reported as a policy block, not "Buy Tokens".)
3. ✅ FIXED — Loyalty: refunds of tip/tax take back points (refund total vs eligible cents); a refund settled before the earning is no longer earned on.
4. ✅ FIXED — `'\D'` inside `sql` templates becomes `D` — phone search in phone center, inbox, templates.
5. ✅ FIXED — Email Delivery Rate drops bounced (failed) emails from the denominator.
6. ✅ FIXED — AI Business "why did revenue change" compares this month with this month.
7. ✅ FIXED — Business alerts: pause/delete not branch-scoped; evaluate uses caller's branch; min sample 0 allowed.
8. ✅ FIXED — Receptionist settings: failed read then save overwrites stored settings with defaults.
9. ✅ FIXED — EOD follow-ups: tech message edit bypasses "Allow tech to edit message = Off".
10. ✅ FIXED — Follow-up queue / EOD "Rebooked" counts cancelled and no-show appointments.
11. ✅ FIXED — Dead links to /tenant/booking, /tenant/queue, /tenant/ai/calls, /tenant/customers/:id fall to /overview.
12. ✅ FIXED — English catalog shows literal … / →.
13. ✅ FIXED — AI Queue decision history drops the whole "to" day.
14. ✅ FIXED — Notification retry: after_fix failures outside SMS skip the fixed-since check.
15. ✅ FIXED — Booking screen help panel asks the model for slots with no schedule data (invented availability).
16. ✅ FIXED — Health-check 30-second reuse shared across branches (calendar, scheduling, copilot, follow-ups, calls).
17. ✅ FIXED — Coupon assistant counts removed tickets; promotion trends count removed lines.
18. ✅ FIXED — Deal approvals show "within policy" with active-deal count forced to 0.
19. ✅ FIXED — Referral check ignores archived customers.
20. ✅ FIXED — Birthday history not branch-scoped.
21. ✅ FIXED — AI follow-ups: attempts recorded on resolved tasks; escalation alert uses caller's branch.

## Progress — Nov 3 afternoon
All 21 wrong-number / money / scope bugs above are fixed, each with a test (commits d197392 … 023d92a), plus four test files that were
failing before this work (front desk tab, notifications Nov-1 case, coupon slow-day case on Tuesdays, voice holds, forecast history).
Next: the guide gaps in batch order — A1 directory, A2–A20, then B, C, D. The audit tables for A and B are in
GUIDE_AUDIT_FINDINGS_2026-11-03.md; batch C/D audits have not been run yet.

## Batch B progress (Nov 3 evening)
- B1 Segments — FIXED: `%` / `_` in e-mail search were wildcards ("%" matched everyone); discard / link-to-campaign audit now in the same transaction as the change; dollar inputs parsed exactly (no float × 100).
- B2 Coupons — FIXED: Check-coupon spend parsed exactly; ticket-number lookup was already branch-scoped; assistant stats / removed tickets fixed earlier. NOT fixed: the assistant's draft deal and its provenance row are two writes (DealsService.createDeal has no transaction hook — needs a repository-port change).
- B3 Deals — FIXED: "technician deals within rules" health check now applies all six rules (min price, redemption cap, new-customer, duration added); approvals active-deal count fixed earlier.
- B4 Promotions — removed lines fixed earlier. BUILT Nov 4 (B1–B4 gaps): coupon location filter / export / Open Ticket / applied-vs-
  finalized basis / configurable expiring window / customer in the checker (5dd6721, 1dd3181); deals location filter on every tab,
  Open Ticket, approvals requested-date period (798d294, e50ae6b); promotions export + View Receipt (388446b); assistant draft
  all-or-nothing (58d6e09); recorded health runs with history for Coupons and Deals (800, 4018a73).
- B9 Notifications — FIXED: at most two resends per original (a resend of a resend was unlimited; new code NOTIFICATION_RETRY_LIMIT); "accepted by provider" no longer shows the creation time as the acceptance time. Earlier: after_fix evidence for every channel.
- B11 Booking Phone Verification — FIXED: the overlay offers Resend only when the number on record matches (same rule as the resend itself); "latest provider outcome" uses the same rule as the error count; a page past the end shows the last page.
- B16 Email — FIXED: a masked viewer cannot search by the e-mail address they are not allowed to see. ("auth_failed → down" reviewed: correct, the issue code keeps the difference.) Earlier: bounced in the delivery denominator, no resend of bounces.
- B13 End-of-Day Follow-Ups — FIXED: a missed 8 PM run (server down) is caught up the next day before 8 PM (only the last missed day, only for a branch that ran the day before). Earlier: tech edit with editing Off, Rebooked excluding cancellations. Found: the old tsx-run "generation-core" harness resolves @aipowersalon/date-time to its .d.ts (two of its cases fail in that runner only); the new behaviour is tested in eod-catch-up.vitest.spec.ts.
- B15 Appointment Reminders — FIXED: a page past the end showed "0 total" (count over() only on returned rows) — now the last real page with the real total. Earlier: confirmed appointments get reminders.
- B17/B18 Loyalty Tokens / Rules — FIXED: the rewards-liability journal lines are platform-level on earn too (earn tagged them to the salon, redeem did not). Earlier: reversed / charged-back purchases, refund eligibility, refund-before-earn, locked wallet message. The 3–4 PGlite race cases in global-rewards fail before and after (known).

## Batch D audit bugs (fixing before the D guides — they move stock and money)
- D13–D19 Payments & Money: the P0/P1 list in GUIDE_AUDIT_FINDINGS was already fixed in 6a69195 (net sales counted once, exact balance due, webhook dollars, refunds keep the sale, cash drawer / EOD cash never $0 on failure).
- D9 Inventory — FIXED: All Technicians "Used" is per unit (bottles and pairs were summed into one number); product detail and reorder alerts use the location's threshold overrides (the list did; detail used product defaults, alerts ignored critical level); a purchase order must name this salon's vendor (VENDOR_NOT_FOUND) and is written with its lines + audit in one transaction; Add Stock is one transaction under the stock lock, and a purchase-order id on a manual add is refused (PO_RECEIVE_FROM_PO); the same Service Done line delivered twice at once deducted twice (check and write not under one lock → per-line transaction lock; real-Postgres race test); an expired bottle was used on a client like any other (now never, soonest-expiring first); audit insert failures inside a transaction were swallowed (aborted transaction hidden) → rethrown; report approval swallowed every error → only 4xx refusals; expired bottles counted as on hand (cache, list, drift, value) → excluded everywhere, shown apart as Expired. Nov 4 (5591134, 5e3f4fa): transfer and count reconcile are one transaction (count applies counted − snapshot to today's stock); bottle open/low/empty/damaged one transaction, conditional; manual recipe deduction one transaction and needs an Idempotency-Key; one low-stock rule (override wins, inactive never low, LOW needs a reorder point); reorder suggestions subtract committed POs, drafts are not on order; PO lines snapshot the supplier pack (801) — receiving N cases = N × pack bottles at case cost ÷ pack. NOT fixed yet: recipe quantities are whole bottles (needs the unit-conversion build); D9 gaps list (variants, dispose/waste, in-transit transfers, PO edit / line discounts / damaged qty, etc.).
- D1 Team Performance — FIXED: tier filter used the raw average while the row showed the rounded score (4.45 showed "4.5 Excellent" but filtered as Very good); with a branch selected a technician's reviews / services were her whole salon's; the overall score counted archived technicians; search by customer name / phone without customers.view. Test fixture made date-proof (previous-period review fell two months back on the 1st–9th).
- D6 Membership renewals (auto-billing is OFF unless MEMBERSHIP_AUTOBILL_ENABLED) — FIXED: the sweep always charged as attempt 1 (dunning days never grew; the attempt number is now counted per cycle); each cycle is anchored on its original due date (a retry moved the paid period to the retry date and minted a new key every sweep); a charge already recorded under the cycle's key is never sent to the card again; one member's error no longer stops the sweep; member numbers were the customer id's first 6 characters (the same customer enrolled twice got the same number) → random, allocated under a per-salon lock, unique per salon (migration 785, old duplicates renumbered -2, -3); month arithmetic spilled over (Jan 31 + 1 month = Mar 3) and then drifted (Mar 28 forever) → clamped to month end and anchored on the start day. benefit reserve / release / redeem checked the balance and wrote without a lock (two tablets spent the last credit twice; a release racing the redeem of the same hold gave the credit back) → one transaction under a per-membership lock (real-Postgres race test); a walk-in redeem cancelled someone else's open hold in the balance math → only the redeem of that reservation closes it; a dollar-credit redeem was checked against service credits (always refused) and took the full value → spends the dollar balance up to the service price. a successful renewal never issued the new cycle's credits (members kept only the first month's) → issued once per cycle (rollover / expiry of the old cycle's credits not built). NOT fixed yet: first-period charge (enrollment is active without a first payment — needs the checkout build), demo-data migration 193.
- D2–D8 Catalog / Add-Ons / Discounts — FIXED: catalog sales figures, customer history and add-on usage were the whole salon's for a branch user (now the selected branch's tickets); a 4+ digit ticket number was searched only as phone digits; an unknown add-on key crashed the usage list (the '\u0000' placeholder) — now an empty list; discount redemptions were filtered by the deal's branch instead of where they were used. setting a service's tax answered "saved" (and audited a change) while nothing was stored → the unchanged setting is accepted, a change is refused (SERVICE_TAX_NOT_CONFIGURABLE; per-service tax is NOT built — services are taxed at the salon rate). two categories could have the same name in one location → create / rename refuse it (CATEGORY_NAME_DUPLICATE, case and spaces ignored). the plain service edit (PATCH /pos/services/:id) could still change price / duration with no reason and no history → refused (CHANGE_REASON_REQUIRED); changes go through the pricing editor (reason, conflict check, history). catalog change history showed every location's changes to a location user → this location's (and salon-wide) only. NOT fixed yet: legacy add-on route. (Services export now exports exactly the filtered list — every page — instead of the older export that took only the search text.) (Discount Redemptions card now counts confirmed ledger redemptions — it read the use counters, which disagreed with the ledger under it.)
- B5 Campaign Center — audited: built Oct 31 and the screenshot's "50 reached / 0 sent" case is honest (each count from its own source). FIXED: creator / approver / audit actor names are looked up within the salon only.
- B6 Global Loyalty Final Completion — audited against the guide's invariants (PAID only from a verified provider settlement, one terminal action per hold, books check). FIXED: a settlement arriving for a payable that was put ON_HOLD meanwhile left it silently unpaid while the cash-out was booked — now no journal against it and a high payout alert for finance.
- B7 Marketing & Growth — audited: unknown cost reads N/A (never 0x), totals reconcile with rows, revenue is code-attributed only. No new bug found.
- B8 Message Templates — audited: preview is side-effect free and a real-customer preview is permission-gated, salon/branch-scoped and audited. FIXED: creator / editor names joined within the salon.
- D15 Cash Drawer — FIXED: setting the float again on a counted drawer no longer overwrites the float it was counted against. Open / count / cash in-out run once per Idempotency-Key (a double tap or a retry after a dropped connection recorded the same cash-out twice); the POS keeps one key per action until it succeeds. Per-register drawers BUILT Nov 4 (f1458f9) — see below.
- B6 (second pass): the 3 always-failing global-rewards cases were PGlite artefacts (one connection cannot run two transactions at once) — rewritten back to back; real concurrency proven by global-rewards.postgres-race (4/4 on Postgres). Suite 72/72.
- B7 (second pass): date-dependent fixture fixed (gift-card activity "10 days ago" fell outside "this month" on the 1st–10th). 20/20.
Batch B: every guide audited; bugs fixed above; remaining NOT-built items are listed per guide.

## Batch C — being worked (claim: the session writing this section, from 18:30 Nov 3; another session should pick D-guide builds instead)
- C6–C12 (Team Management, Technicians, Tech Appointments, Live Schedule, Tech Queue, Commission Report, Five Unfinished Features) — all five C7 workstreams exist (commission review F1, rate/refund checks F2, export audit, one-day shift overrides, versioned 40/30/20/10 score) and workforce team-screens is 97/97. Static sweep FIXED: Team permission screens joined staff names from any salon (granted-by, audit actor / target, override target) — now this salon only; technician utilization showed 0 % when the day's bookings could not be read — now unknown (null), with a test.
- C12 / payroll — FIXED: pay-stub period dates showed one day early when the database driver returns a DATE as UTC midnight (PGlite; any such driver west of UTC). Staff-name lookups in deals / workforce / finance screens now require the same salon. The "Your pay is complete" test failed because its fixture technician (Ana) had no linked user, so there was nobody to notify — fixture fixed; the push works (payroll 67/67).
- Full-suite sweep of every module (Nov 3 evening) — REAL BUGS FOUND AND FIXED: (1) the all-salon membership renewal-reminder and expiry sweeps never ran — `$now + make_interval(...)` with an untyped parameter is resolved by Postgres as an interval ("timestamptz <= interval"); (2) the same error stopped §149's sweep that releases a cancelled salon's platform number and closes its Twilio subaccount. Both now cast the parameter; tests added. Stale tests rewritten to current behaviour (SID masking, retired gift-card void, dense revenue trend, status-row staff panel, Front Desk-only "live", delivery-receipt owner lookup, refund capability via permCtx) and date-dependent fixtures fixed (follow-up history, expense scale, marketing growth, payroll).
- Real-Postgres race suites (PG_RACE_URL, all modules) — now all pass. REAL BUGS FOUND AND FIXED: (3) the POS check-in appointment list crashed as soon as there was an appointment (an async loader mapped without Promise.all — every row was a promise); (4) two managers approving a referral reward at once deadlocked ("deadlock detected" instead of a clean conflict) — issue() now locks the referral before the reward, like review(). (5) dateColumnYmd (shared): a DATE read at UTC midnight showed a day early west of UTC (pay stubs, OCR document dates under PGlite-style drivers).

## Nov 3 late night — D-guide bugs + API gate sweep (session continuing batch C/D)
- D6 Membership — five more bugs fixed (see the D6 line above): member numbers unique per salon (785), month-end period
  clamp + start-day anchor, benefit reserve/release/redeem locked (real-Postgres race test), walk-in redeem no longer cancels
  another hold, dollar-credit redeem spends the dollar balance, renewals issue the new cycle's credits.
  Previous cycle's unused credits now expire at renewal unless the benefit allows rollover (held credits stay). NOT built: first-period charge at enrollment (needs the checkout build).
- D9 — expired bottles are not on hand anywhere (cache, list, drift, value).
- D15 — open / count / cash in-out idempotent (POS sends one key per action).
- API test sweep: 37 failures triaged. REAL BUGS FIXED: the Retell voice webhook was blocked by the tenant-context middleware
  (no call event could ever arrive); 35 tenant foreign keys from the Oct 30 – Nov 3 builds had no cross-salon trigger (786);
  reminder recovery / run finish, setup-health rerun, money-protection run and duplicate-review writes now name their
  tenant; the new centers' status writes run through state machines; settings saves (alert thresholds, refund policy)
  announce the change; two NOT VALID checks validated (787); unsubscribe link rate-limited. Guard false positives fixed
  (comments read as SQL, CTEs in other templates, aliases read as tables, 543 DO-loop columns, add-on reads read as 'add').
  Stale tests rewritten to current truth (refund keeps the sale approved, markSent retired, reopen status, fixtures).
- STILL FAILING in apps/api (known, not regenerated blindly): role-matrix snapshot (needs a reviewed regeneration),
  route-domains wire-type ratchet, IDOR route table (92 new routes need a fixture or exemption each), strict-bodies type
  proof (15 routes need a reviewed entry).
- D10 Suppliers — FIXED: receiving a purchase order claimed the line and created the stock in separate writes (a failure
  in between left the line "received" with no stock — proven by test); the whole receipt is one transaction. Create PO and
  Receive run once per Idempotency-Key (the POS sends one per action), so a double tap no longer makes two drafts or
  receives twice.
- D6 Membership (more) — FIXED: enrollment wrote the membership, its first credits, activity and audit separately — a
  failure after the insert left an ACTIVE membership with no credits (proven by test); now one transaction. Enroll runs
  once per Idempotency-Key (the POS sends one), so a double tap no longer creates a second membership.
  NOT built: first-period charge at enrollment (the guide: "record initial billing only when the provider confirms" — needs
  a card-on-file / checkout step that does not exist for memberships yet).
- D11 Stock Alerts, D16 End-of-Day Cash, D19 Tips — re-checked against their guides: built in the Oct builds (sidebar and
  page agree; ticket-level tip totals without double counting allocations; cash hand-offs with period / search). No new bug found.
- Nov 4 early — more fixed: D4 plain service edit can no longer change price/duration without the pricing editor; D3 change
  history location-scoped; D2 export = the filtered list; D6 enrollment atomic + idempotent, unused credits expire at renewal
  unless rollover; D10 PO receipt atomic, create/receive idempotent. API gates: role matrix reviewed + regenerated (flag:
  technicians can start the duplicate / intelligence / recommendation scans), 15 strict routes reviewed (no bug), IDOR table
  complete, every route has a domain, Global Rewards salon routes plan-gated. ONE API gate still red: the api-contracts
  wire-type ratchet — 774 routes from the recent builds have no shared wire type (a large typing job; not grandfathered).
- D6 Membership — BUILT (Nov 4): first payment. A plan with a price and no trial now starts PENDING (no benefits, no credits,
  no billing date) and is activated only by a confirmed first payment = one period + the enrollment fee: the customer's saved
  card through the salon's gateway (customer-initiated; a decline keeps it pending and is recorded; each attempt has its own
  processor key), or a PAID invoice of the customer that covers the amount (never used twice — row lock + check). Payment row,
  pending → active, first period, first credits, activity and audit commit in one transaction; idempotent. POS: the enroll
  dialog continues into "First payment" (or "Collect later"); Member Details offers it for a pending member. Card-on-file
  needs MEMBERSHIP_AUTOBILL_ENABLED + the salon's gateway — without it the button says billing is not set up.
- D15 Cash Drawer — BUILT (Nov 4, f1458f9): one drawer per register. Payments record the register that took them
  (migration 788 payments.register_id, filled from the ticket's checkout register). Each register's drawer counts only its
  own cash; "Cash with no register" holds payments with no register (older payments, a retired register). A location with
  no registers set up keeps one drawer as before. Reads and writes for another location's register are refused
  (REGISTER_NOT_IN_BRANCH). POS Cash Drawer has a register picker (EN/VI), shown only when registers exist. Payments taken
  before today have no register and land in "Cash with no register". End-of-Day Cash (technician cash) stays per location.
- Nov 4 (later) — BUILT / FIXED:
  - A6 AI Queue (8a5c84d): Check AI Queue System (13 parts, read-only, recorded — 789), assignment history (server search,
    filters, salon-day presets, numbered pages 10/20/50, URL filters), guest overlay in 7 tabs. A6 is now BUILT.
  - A7 AI Booking Assistant (8a5c84d): operations center over the existing booking records (counts, request activity with
    search / filters / pages, 8-tab overlay without codes, recovery cases with draft-only messages and audited Dismiss,
    Check AI Booking System — 790). A7 is now BUILT; "Request Manager Approval" and the alternative times on a recovery case
    followed in afb238a.
  - D6 Membership (1a6d564): the plan's rollover switch, "Rollover max (cycles)" and "Credit expiry (days)" are applied
    (they were saved and ignored); migration 193's fake $49 redemption is removed (791).
  - D2 Services (9a2d583): per-service taxable setting (792) — lines copy it when rung up; checkout, line refunds and the
    finance amount-due tax only the taxable part. A per-service RATE / exemption / tax category is still refused. Dashboard
    and Service Done "estimated tax" figures still use the whole subtotal (estimates). The older add-on route no longer deletes.
  - Live IDOR run (2a0e384): 11/11 on PostgreSQL after fixing 3 location leaks and 1 crash.
- STILL OPEN: the guides' smaller extras (each row above); the api-contracts wire-type ratchet (774 routes); POS suite —
  run in 12 slices: 13 tests in 8 files fail (Live Technician Schedule ×5, roster-1000 ×2, New Booking, Retention ×2,
  Service Done, Split Payments, layout grid), and slices 3 and 9 stall intermittently (the Booking language-switch test passed
  alone twice; the stall depends on timing).

## Nov 4 2026 (10:14 / 10:15) — 40 files received
- 33 are byte-identical copies of guides already in batches C and D (Loyalty Complete, Communications, Loyalty Tokens, Four Modules,
  Phone & Messaging, Customer Retention, Team Management, Five Unfinished Features, Technicians, Tech Appointments, Live Technician
  Schedule, Tech Queue, Commission Report, Team Performance, Services & Products, Service Categories, Service Pricing, Add-Ons,
  Membership, Discounts ×2, Products, Inventory, Suppliers, Stock Alerts ×2 (the two files are identical), Payments & Money,
  Transactions, Cash Drawer, End-of-Day Cash, Refunds & Voids, Split Payments, Tips). Their status is the batch C / D lines above.
- Batch E — 7 NEW guides (never audited against the code; their screens exist from the Oct 29 Payments & Money build):
  E1 Gift Cards · E2 Payment Terminals · E3 Settlements · E4 Deposit Reconciliation · E5 Invoices · E6 Expenses ·
  E7 Loyalty Rewards (full spec) — audited Nov 4; money / safety bugs fixed first (13093f9), E6 rebuilt (14ae52d).
  - E1 Gift Cards — DONE: refund / reload money safety (13093f9); adjust (audited ledger + reason), Pending / Frozen tabs, branch
    filter, received-card customer link, rate limit on every lookup, settings route moved off the duplicate path (dfcf807).
  - E2 Payment Terminals — DONE: one live terminal per register (13093f9); activity location-scoped, phone re-enable, null-branch
    terminals manageable (dfcf807); processor account + request key + verification at pairing, processor filter, Device history
    tab (799, 82b17b0). Kept by decision: Tap to Pay phone actions stay owner-only and salon-wide.
  - E3 Settlements — DONE: webhook refund outcomes, failed / returned batches out of KPIs (13093f9); "Not set up" instead of $0,
    stale-feed state, Investigate, cross-tab search counts (dfcf807, 57bd35b).
  - E4 Deposit Recon — DONE: missing payout stays Missing, audit history, salon-only assignee (13093f9, 794); server-computed
    match basis, grace days consistent, legacy sweep skips workspace-allocated settlements, picker reaches every year (57bd35b).
  - E5 Invoices — FIXED: legacy create refuses another salon's customer; reads join within the salon (trigger 793); Paid KPI
    respects search / amount; save note decided from the reloaded list (57bd35b). BUILT Nov 4: credit notes with refund of the
    overpaid part (797, 4d87545); customer filter + invoices on the customer profile (f09cfff); lines from services / retail
    products (c6fe4bd); email / text delivery through the salon's sender with honest Submitted / Delivered status (798, bc76dd3).
    Location scoping: Kevin's decision — salon-wide kept.
  - E6 Expenses — DONE: rebuilt to the guide (14ae52d); screenshots at 1920x1080 / 1536x864 / 1440x900 / 1366x768 in EN, VI
    and an empty salon all PASS (tooling/finance-one-screen/results/e6-expenses-guide); they exposed and fixed a POS expense
    filed salon-wide that vanished from the location's list, a doubled "+", a 41 px tab (f9d3f32).
  - E7 Loyalty — DONE: code stays on screen; Redemptions KPI counts used only, ledger Retry, ILIKE escaping (57bd35b); reward
    dates / stock / per-member limit / eligible tiers checked atomically at redemption, with a real-Postgres race test (795,
    dfd0c4e); Manage Tiers (own tiers, threshold, benefits, rename relabels members, held tier cannot retire), member tier change,
    member status filter + sort, reward change audit (796, c28218d).
- POS suite (Nov 4): every file passes run alone; the 3 files that hung (Serving, Queue, language switch — a stale window.event
  in jsdom) now finish. API gates: silent-catch, raw-sql, audit-writers, error-text, as-any green (f4ab1c1); api-contract still
  fails on the 774-route wire-type backlog.
- Nov 4 night — D9 recipe amounts with decimals (802, 458ff97); batch C audits + 16 bugs (4baf21a); C5 Cancel Campaign, branch
  sender (53c4637). Still open from batch C: C1 earning preview at checkout, per-salon low-balance levels, Super Admin suspend
  a rewards account, dual control on global rule publish (and the open question: custom-earning flag off vs active custom
  rates — Kevin to decide); C2/C4 Rebooking Conversion, inbox branch selector, booking linked back to the conversation,
  campaign filter / priority sort, message-text retention, live reminder / campaign events, SPF/DKIM/DMARC, notifications
  export; C3/C5 per-branch retention history, Add Note, template choice, First Visit Invitation. Book Appointment from
  Retention keeps the signed-in location (the booking screen books at the session location by design — not changed).
- Nov 5 early — batch C gaps BUILT: C5 Add Note (abd7aee); C1 Super Admin suspend / reactivate a rewards account from a fraud
  alert (9a88a0b), earning estimate at checkout (5b5ac4d), per-salon token warning levels (804, 3287297); C2 Customer
  Notifications export (a432edf), sender identity SPF / DKIM / DMARC from DNS (805, f851b0d), Rebooking Conversion from the
  win-back recipients (deb6e7e). KEVIN TO DECIDE: (1) C1 dual control on global rule publish / program update — the guide asks
  for a second Super Admin approval; with one Super Admin it would block every change, so it is NOT built until you say so;
  (2) custom-earning flag off vs salons already on a custom rate; (3) how long inbox message text is kept (C2 retention).
- Nov 5 — more built: C2 location filter on the inbox + activity tiles (cabb955), booking linked back to its conversation (806,
  b37e14b); C5 template choice in the win-back composer, placeholders refused (7bdb575); C3 Setup Health "customers can book"
  per location (699f89b); A2 background evaluator for AI Business alerts (be799be).

- Nov 5 — A2 date presets last 7 / last 30 / last month (4c01ed6); A7 the dialed number is kept and shown on calls (807,
  339a320); D9 bottle actions Expired / Missing / Found / Throw away (2b11499 — one transaction each, Missing and Found need
  stock-adjust, a thrown-away bottle cannot come back).
- Nov 5 (cont.) — D9 bottles that arrive damaged on a purchase order (808, 3e09fad); D9 change a draft purchase order — a pending
  approval is withdrawn by its requester and re-filed for the new total (5ec746b); D1 Team Performance helper contribution,
  service-completion date, export needs reports.export (6534233); Tips free-form adjustment route + POS "Add or remove tip"
  (db161c8). Still open in D9: variants, in-transit transfers, PO line discounts. D15 Cash Drawer rebuild extras (search,
  presets, pages, activity overlay, denominations, manager approval, version check) not built yet.
- Nov 5 (cont.) — D15 Cash Drawer gaps BUILT (809, cb65dc0): bill / coin breakdown on a count (must add up), version check (the
  expected cash the counter saw — a sale or refund since refuses the count), a difference over $20 waits for a manager's
  sign-off (once, with a note; a re-count clears it), drawer history (date range, register, status incl. "needs sign-off",
  search, server pages). Not built from the Cash Drawer guide: the activity overlay and moving the Money Protection banner.
