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
- Nov 5 (late) — D9 shipped (in-transit) transfers: Ship option, receive all or part at the destination (the rest recorded
  missing there), cancel with a reason at the source; on hand nowhere while in transit (810, bcaf9f0). D4 Service Pricing:
  upcoming-booking impact preview in Edit Pricing (booked quotes are never repriced) and Revert as a new revision (ebc5b90).
  Still open in D4: scheduled (future-effective) prices — not built; the editor stays immediate-only and says so.
  D9 "PO line discounts" dropped from the open list: the Inventory guide does not ask for them.
- Nov 5 (night) — D4 scheduled (future-effective) prices with a one-minute job and apply-on-read (811, 92c76be); D15 history
  day overlay + Money Protection moved to the bottom (2598530); TM-01 archived staff in customer-linked search, opt-in (016444e);
  C2 inbox source-campaign filter, 14-day attribution window (52035a0). D9 "variants": already modelled — each colour / finish is
  its own product row (product line, colour name / number, finish) with SKU / barcode uniqueness; nothing to build.
- Nov 5 (early) — C2 live delivery updates: new realtime event message_delivery_updated refreshes communications /
  notifications / campaigns / reminders / retention on a signed delivery report (f7221ba); C3/C5 per-location retention history,
  last-visit location per snapshot row, older days say "not recorded", confined roles stay in their location (812, ab9c60e);
  C5 First Visit Invitation audience for never-visited customers, consent checked, win-back wording refused (813, ca75e5b).
  Batch C open list is now empty except Kevin's 3 decisions.

## Batch F — Nov 5 2026 uploads (40 documents) added to the list

34 of the 40 are byte-identical copies of guides already in Batches C / D / E (checked by MD5): Team Performance,
Services & Products, Service Categories, Service Pricing, Add-Ons, Membership, Discounts, Products, Inventory, Suppliers,
Stock Alerts, Stock Alerts Technician Usage, Payments & Money, Transactions, Cash Drawer, End of Day Cash, Refunds & Voids,
Split Payments, Tips, Gift Cards, Payment Terminals, Settlements, Deposit Reconciliation, Invoices, Expenses, Loyalty Rewards
(several uploaded twice). Their status is the one recorded above for D1–D20 / E1–E7; they are NOT re-counted.

New documents, each a queue row:

| Row | Document | Status at Nov 5 |
|---|---|---|
| F1 | Customer Directory — Master Redesign, Functional Repair & Developer Handoff (90 sections) | IN PROGRESS — see the F1 section below |
| F2 | Customer Retention — Claude Full Build Spec (Oct 29) | BUILT — audited Nov 5: this is the Oct 29 mandate `retention.repository.ts` was built from; the Oct 30 Complete Build Guide (C5) extended it. See the F2 section below |
| F3 | Membership Overview — Claude Build Spec (Oct 29) | BUILT — audited Nov 5: the "Membership Overview mandate" the screen and `memberships.kysely.repository.ts` cite (9 references); see the F3 section below |
| F4 | Full System Test (23 pages, 20 parts) | a whole-platform test run, not a feature; needs the full regression + the 27-inch pilot |
| F5 | Full Platform Architecture & Code Audit — Completion Mandate | Nov 5: 219 DONE / 40 PARTIAL / 3 BLOCKED of 262 (§68 re-verified DONE; §192 egress gate built — still PARTIAL for CSP unsafe-inline) |
| F6 | Full System Run, Audit, Repair & Wiring — Completion Mandate | SKIPPED by Kevin's decision Oct 27; re-uploaded — re-opened |
| F7 | Receipt, Expense, OCR & Accounting — Master Completion Mandate | Nov 5: 195 DONE / 15 PARTIAL / 1 NOT DONE / 1 BLOCKED of 212 (§87, §94, §102 built; §98 PDF summary waits on Kevin vs the no-print rule) |
| F8 | Weekly Technician Paycheck, Cash Payout & Owner Approval — Master Mandate | Oct 27 matrix: 160 DONE / 1 PARTIAL (17.5 pay-stub PDF) of 161 |

Order: F1 → F2 → F3 → the F7 PARTIAL rows → F5 product gaps → F8 17.5 → F4 / F6 as one full run at the end.

### F1 Customer Directory — progress (Nov 5 2026)

Built and tested (commits 4819af4, 1426448, a4c84ad, 0c053d2, a9c8860):

- §8 / §40-42: the top AI banner is gone; the AI Customer Profile Assistant is a compact card in the last row beside Recent Activity.
- §17-18: the inline duplicate comparison is replaced by a compact alert (open groups from `/pos/duplicate-review/summary`) that opens a safe queue overlay → the Duplicate Review centre's compare overlay. Nothing merges from the list.
- §11-12 / §15: one server definition per number. Tab counts are `segmentCounts` (same filter code as the list, other filters applied). The At Risk tab now filters — it listed everyone before. New / Returning This Month use the salon's calendar month; they showed today's counters before. Definitions: `docs/customer-directory-metrics.md`.
- §14: phone search matches any format of the number (accent-insensitive names and IME-safe debounce were already in place).
- §28: page size 10 / 25 / 50 and "Showing X–Y of Z" (server-side pagination was already in place).
- §30: the row Message action opens or starts the customer's conversation. It used to open a blank send page.
- §37: Retention Trend from the nightly retention snapshots (6 months; gaps shown as "—"; location rule as on the Retention screen). It was placeholder text before.
- §29: Archived is a lifecycle status: out of All Customers, the tabs and the KPIs; listed under the Archived status.
- §39: Recent Customer Activity is a whole-salon server feed (latest visits, profiles added, bookings made, loyalty adjustments; no notes or amounts).
- §32: every rail / lower-card link goes somewhere real — Tags and Sources View All open a full list that filters the directory; Demographics / CLV / RFM → Customers report; Retention Trend → Customer Retention; Recent Activity → Appointment History (Tags View All reopened this same page before; Recent Activity went to Overview).
- §11 / §36: customer spend (and so CLV and Avg. Spend) is net of completed refunds.
- §55: export omits spend without financial access; CSV formula guard covers tab / CR.
- §61 / §62 (partial): scale run at 1,000 / 10,000 customers — the browser gets one page (26 KB); server time 1.29 s → 0.36 s at 10k.
- §38: RFM uses Monetary (top-20 % spenders) and gives never-visited customers their own segment; names translated in VI.
- §31 / §64: the profile drawer is an overlay (list, filters, page and scroll stay); focus returns to the opener on close.
- §60: archive / restore commit customer.updated (changedFields [status], ids only) with the row — other screens refresh at once (they waited for the 45 s poll).
- §53: Add Customer is idempotent (one key per submission; a retry replays, never a second profile).
- Platform gates: three red common-suite gates from Nov 4–5 units (migration 802 review, pricing-impact tenant predicate, new whole-row reads) fixed — apps/api src/common 1,519 tests pass.
- §16: an analytics read that fails marks that card "unavailable" (with retry on the next refresh) and the list keeps working. It was built from the visible page before.

Remaining F1 work:

- §39: check-ins and profile edits as their own feed events — PARTIAL (visits, new profiles, bookings and loyalty adjustments are in).
- §58 / §62: the server still reads every customer in scope and filters in memory (linear; ~3–4 s projected at 100k on PGlite) — move search / filters / counts / paging into SQL.
- §45-80: the sidebar module audit (Profiles, Appointment History, Loyalty, Gift Cards, Notes, Saved Cards, Retention, NailShowcase, Add / Edit / Archive, Export, realtime, scale, touch, EN/VI) and the test sections §68-80.
- §81-89: before / after screenshots, code map and handoff package. Screenshots are BLOCKED here (no browser on the 27-inch target).

### F2 Customer Retention Full Build Spec (Oct 29) — audit (Nov 5 2026)

The spec is the "Customer Retention mandate (Oct 29 2026)" named in `modules/customers/src/retention/retention.repository.ts`.
Its sections are implemented and covered by `src/retention/*.spec.ts` (52 tests pass):

- §05 definitions: Never Visited is its own segment, never At Risk.
- §06 KPIs reconcile with the segments; Lapsed Value is net of refunds.
- §07 segments: 60+ / 90+ / 180+, Never Visited, Recently Returned, Contactable, plus search and filters.
- §08 longest absence first, ties broken on customer id, numbered pages clamp.
- §09 select page / select all matching (server-side).
- §10 preview with exclusions and segment count.
- §11 one job per recipient, idempotent confirm, send-time recheck, "unknown" never re-sent, quiet hours, Cancel.
- §12 per-salon Twilio, consent, STOP.
- §13 campaign history (this salon only).
- §17 another salon is never listed.

One difference, decided by the newer guide: §08 asks for the At Risk list to default to oldest visit first. The Oct 30 Complete Build Guide (C5, built later) made Smart Priority the At Risk default. "Oldest visit" stays one tap away in the sort menu, and the list states its sort. Kept as C5 has it.

Not verifiable here:

- §16 / §20 the 100 %-zoom fit on the 27-inch ASUS — no browser at that size in this environment.
- A live Twilio send — no credentials, and test traffic only, by the spec.

### F3 Membership Overview Build Spec (Oct 29) — audit (Nov 5 2026)

The spec is the "Membership Overview mandate" that `POSMembershipsScreen.tsx` and `modules/memberships` were rebuilt from.
The later "full-screen rebuild, member search, calendar filters, pagination" pass is on top of it. Built:

- §06 five KPIs:
  - Total and Active (snapshot) and Expiring Soon (7-day window, cancel-at-period-end included).
  - Revenue = succeeded payments settled this month. Refunded / voided payments are excluded, with the delta vs last month.
  - Canceled This Month.
  - Each card opens its list.
- §07–09 Membership Plans / Active Members / Activity panels: internal scroll, Manage, View All.
- §10 analytics:
  - Status: one population, every lifecycle status, mutually exclusive.
  - Plan Distribution: current memberships, explicit denominator.
  - Top Services: this month's redemptions.
  - Revenue trend.
- §11 all ten Quick Actions open real flows (create plan, enroll, reminder, discounts, report, three exports, performance, settings).
- §12 dialogs.
- §13 rules: lifecycle vs payment status, expiry vs next billing.
- §14 tenant scope.
- modules/memberships: 175 tests pass. POS screen tests pass.

Not verifiable here:

- The 100 %-zoom fit on the 27-inch ASUS (§03): the screen now scrolls vertically by the later rebuild's choice, never sideways.
- A live card renewal (no processor credentials).

## Batch G — 15 guides uploaded Nov 5 2026 10:08 ("build exactly on it")

Duplicates by content (byte-identical to an earlier upload): AI Usage Limits = `c44ee836`, Customer Timeline = `037d88cc`,
Review & Reputation Settings = `4a3fee5e`, Weekly Paycheck = `3f78a066`. The six master mandates (Weekly Paycheck, Security
Deep Scan, Secure Tap to Pay, Remaining Production, 200 Technician, Platform Announcement) have status matrices in
`docs/mandates/status/` from Oct 24–27; they are re-checked here, not rebuilt.

| # | Guide | Status (Nov 5) |
|---|---|---|
| G1 | Customer Profile & Global Loyalty Protection (owner-approved bonus points) | BUILT — see the G1 section below |
| G2 | Refer a Friend / Referral Rewards build | BUILT (two-sided salon vouchers + hard budget) — see the G2 section below |
| G3 | Technician Profile & Team Management (repeating days off, Skills Catalog) | BUILT (P1 branch names, P2 weekly days off, P3 Skills Catalog) — see the G3 section below |
| G4 | Split Tips — individual technician tipping at checkout | BUILT behind a default-off flag — see `docs/tips/TIP_INDIVIDUAL_TECHNICIAN.md` (PRODUCTION: blocked on Fiserv device checks) |
| G5 | AI Usage Limits (duplicate of an earlier upload) | re-check |
| G6 | Customer Timeline (duplicate of an earlier upload) | re-check — `docs/customers/CUSTOMER_TIMELINE.md` exists |
| G7 | Global Advertising + Tenant Control (master switch, platform ads, 50/50, ACK fleet status) | BUILT — see `docs/advertising/GLOBAL_ADVERTISING.md` |
| G8 | Review & Reputation Settings (duplicate of an earlier upload) | re-check — `docs/ai/REVIEW_REPUTATION_SETTINGS.md` exists |
| G9 | Enterprise Backup & Disaster Recovery | BUILT (catalog, Backup Center, plan/approve/job, compare-only restore) — destructive apply GATED, hosting items BLOCKED_EXTERNAL; see `docs/backup/BACKUP_AND_DR.md` |
| G10 | Weekly Technician Paycheck (= F8) | 160 DONE / 1 PARTIAL (pay-stub PDF — waits on Kevin vs the no-print rule) |
| G11 | Full Security Deep Scan | matrix `SECURITY_DEEP_SCAN_STATUS.md` — re-check |
| G12 | Secure Tap to Pay / Device Authentication | matrix `SECURE_TAP_STATUS.md` — re-check (Apple TTP is BLOCKED_EXTERNAL) |
| G13 | Remaining Production Work / Payment Recovery | matrix `REMAINING_PRODUCTION_STATUS.md` — re-check |
| G14 | 200 Technician Large Salon | matrix `200_TECHNICIAN_STATUS.md` — re-check |
| G15 | Super Admin POS Top-Bar Announcement | matrix `PLATFORM_ANNOUNCEMENT_STATUS.md` — re-check |

### G1 Customer Profile & Global Loyalty Protection — built (Nov 5 2026)

- **§01 / §06 No manual point reduction:** every salon edit path refuses with `LOYALTY_DIRECT_EDIT_REFUSED`.
  - Paths covered: `PATCH /pos/customers/:id/loyalty` (points can no longer change; a tier-only change still saves), `POST /pos/customers/:id/loyalty-adjust`, and `POST /pos/loyalty/adjust`.
  - Each route stays in place, so an old POS build gets this answer instead of a 404.
  - Redemption is unchanged.
- **§03 / §08 Request Bonus Points** (`components/LoyaltyBonusRequest.tsx`) replaces three things:
  - the drawer's "New balance" form;
  - the Customer Profile screen's "use negative to deduct" modal;
  - the Loyalty screen's add / deduct dialog.
- **How the request form works:**
  - Current points are read-only; only a positive whole number (1–5,000) can be entered.
  - The reason is a preset or "Other".
  - Before sending, the form shows the server's preview: balance after approval, plus the token cost and a wallet shortfall warning.
  - Sending creates a pending request only. One request per customer can wait at a time.
  - The form also shows the customer's request history with statuses.
  - A failed history load is shown as an error, never as "none".
- **§04 Owner approval** runs on the salon's one approvals engine as a new kind, `loyalty_bonus`:
  - Approver key: `loyalty.bonus.approve`, held by the OWNER only.
  - The person who asked can never approve it, and the owner cannot switch that rule off.
  - Requests expire after 7 days.
  - The approval is persistent in the Owner App → Approvals, with live updates.
  - The Owner App shows current points → after, the token cost against the wallet, and an explanation when funding fails.
  - An owner alert is the supplemental nudge, with no customer name or reason in it.
- **§05 Funded credit** (`modules/loyalty/src/global-rewards/rewards-bonus.ts`): the executor runs once and recomputes everything at approval.
  - Customer in the global network: the salon's token wallet is debited by the central program's cost (10 points = 1.00 token) and the customer's global points are credited. A balanced `bonus_award` journal entry is written in the same transaction. A replay moves nothing.
  - Customer not in the network: one entry is added to the salon's own points ledger, with no tokens.
  - Not enough tokens: nothing moves, the request ends as not completed with `LOYALTY_BONUS_NEEDS_FUNDING`, and the POS and Owner App say "buy tokens, then ask again".
- **§11 Check Customer & Loyalty System:** `GET /pos/loyalty/bonus-requests/health`, read-only.
  - Each approved bonus is posted exactly once.
  - Nothing is credited without an executed owner approval.
  - No manual reduction since Nov 5.
  - Failed approvals are listed.
  - Requests past their deadline are listed.
- **Migration 814:** two CHECK lists widened (the approval kind and the journal entry type), plus an index.
- **Tests:**
  - `loyalty-bonus.pgtest` — 10 tests: global and salon paths, replay, funding shortfall, cross-salon, refusals, health check.
  - `LoyaltyBonusRequest.test` — 4 tests.
  - `OwnerApprovalRequestsCard.test` — the bonus case.
  - Rewritten to the new rule: `loyalty-program.pgtest` (staff adjust refused; seeding uses what an approval writes) and `customers-core.spec`.
- **Not built (PARTIAL):**
  - §09 month-view From / To calendars on the bonus history (the history is newest-first with a status filter on the API).
  - §08 extras:
    - sticky drawer header;
    - optimistic concurrency on Notes;
    - separately permissioned safety warnings;
    - Visits "empty vs disconnected".
  - A push notification beyond the owner alert.
  - Owner re-authentication for high-value awards.

### G2 Refer a Friend / Referral Rewards — built (Nov 5 2026)

The existing Referral Program (A18, migration 751) is extended, not duplicated. A new reward type, **Salon vouchers (both
sides)**, sits beside loyalty points and the (blocked) cash payout.

- **Policy (R014, R020):** Owner sets the new-customer voucher and the referrer voucher separately ($1–$500 each), the voucher
  minimum spend, how long vouchers last (7–365 days), a **required** campaign budget, an optional monthly cap, an optional
  per-referrer limit and a warning percentage. A voucher policy without a budget (or one smaller than a single referral) is
  refused, never defaulted.
- **One discount authority (R026, R038–R041):** a voucher is a customer-bound, single-use wallet coupon on the deals engine
  (`modules/deals/src/salon-promotions/referral-vouchers.ts`, global token `REFERRAL_VOUCHERS`, so customers does not import
  deals). Checkout finds it in the customer's wallet like any coupon. Never cash, a gift card, global points or tokens. The code
  is shown once and stored only as a hash + hint.
- **Activation (R021, R035, R037):** recording a referral locks the policy row, checks the budget, the monthly cap and the
  per-referrer limit, then reserves BOTH amounts. The friend's voucher opens at once (held if a person must review risk
  signals first; it opens when the review is cleared). The referrer's voucher stays PENDING. No budget → `REFERRAL_BUDGET_EXHAUSTED`
  and nothing is saved; no issuer on the server → `REFERRAL_VOUCHERS_UNAVAILABLE` (503), nothing saved.
- **Qualification:** the friend's first completed, PAID visit (the existing rule) creates the reward and opens the referrer's
  voucher in the same transaction, once (approval still applies when the salon requires it). No loyalty ledger entry.
- **Closing:** a rejected referral voids the unused friend voucher and releases the pending referrer one; a refund below the
  rule releases the pending referrer voucher; a reversed reward voids the referrer's unused voucher (a used one stands and is
  shown as the shortfall). Used / expired vouchers reconcile from the deals ledger (REDEEMED / EXPIRED).
- **Budget display:** summary + health show committed / remaining / redeemed and the warning; health also checks that every
  open voucher has its wallet coupon. The referral detail lists both vouchers with state and hint.
- **Customer App (R030–R033):** `GET /customer/referral` returns the salon's LIVE offer (null when off, not vouchers, or out of
  budget). The Home banner was hard-coded "You both get $10" — now: "You both get $X" only when both amounts are equal, "Give
  your friend $X, earn $Y" otherwise, and no money claim at all without a funded offer. The share text follows the same rule.
- **Migration 815:** settings columns, CHECKs widened (`salon_voucher`), new table `referral_vouchers`
  (UNIQUE tenant + referral + role; B-12 tenant trigger on referral_id), machine `REFERRAL_VOUCHER`.
- **Tests:** `referral-vouchers.pgtest` (11, apps/api), `customer-extras` (offer / share text), `HomeReferralLine.test` (3);
  existing referral pgtests (23) unchanged and green; common suite green.
- **Not built (PARTIAL):** a customer-facing voucher list in the Customer App wallet screen (the coupon is in the wallet the
  checkout reads; the app's Offers screen is unchanged), SMS delivery of the friend's code (the POS shows it once; sending
  waits on the messaging consent rules), and a Super Admin cross-salon budget report.

### G3 Technician Profile & Team Management — built (Nov 5 2026)

Audit first (P0): the profile page (`POSTechnicianProfileScreen`, route `/technicians/:technicianId`) and the Employee
quick-view drawer both exist and are kept. Existing pieces reused, not duplicated: the weekly template
(`technician_schedules`), one-date overrides (`technician_shift_overrides`, 719, Edit Shift for Selected Date), approved time
off, the ONE eligibility table `technician_services`, and the technician Skill Requests flow (053/475/583). What was missing:
repeating weekly days off with effective dates, and a reusable Skills Catalog.

- **P1 Branch names:** the profile's Primary Branch card and Branches section showed raw branch ids. The detail now returns
  `branchName` / `branchNames` (this salon's branches only); the id stays in the hover title only.
- **P2 Weekly days off (§7):** new table `technician_weekly_off_rules` (weekdays, effective from / to, version, history in the
  append-only `technician_weekly_off_events`).
  - Schedule › Days Off: Set Day Off / Working Pattern → Repeat every week (weekday chips, one or several), Starts on, Ends on or
    "until changed", reason. Review Conflicts shows Before / After and every confirmed booking on the new off days; Save is
    disabled until the preview ran, and a booking must be acknowledged (409 `SCHEDULE_CONFLICT` otherwise). Bookings are never
    cancelled, moved or reassigned. Remove Recurrence from a date. A month calendar shows each date's source; History.
  - One day / a few dates go through the existing Edit Shift for Selected Date (link) — a one-date working override wins for
    that date only.
  - Versioned: a new pattern ends the current rule the day before it starts; past dates keep their rule. Optimistic version
    (`VERSION_CONFLICT`). Audit row + outbox event (`technician_schedule_updated` to the branch and the technician's room).
  - **One precedence for every reader** (`modules/booking/src/booking/weekly-off.ts`): date override > weekly day-off rule >
    weekly template > store hours. Wired into Booking's schedule reader (`techSchedules` — staff booking, Customer App, AI
    receptionist and availability read through it), the Live Technician Schedule board, the Team lookup / preferred-staff
    check, the date-shift editor baseline and the Live Schedule KPIs. Branch-local calendar weekday, not a UTC repeat.
- **P3 Skills Catalog (§8):** tables `tenant_skills` (name unique per salon, category, description, required certification;
  archived, never deleted), `tenant_skill_services` (links to EXISTING services — no price or duration), and
  `technician_skill_assignments` (approved by, proficiency, effective / expiry, revoked with a reason).
  - Manage Skills Catalog dialog: search (name, category or linked service), Active / Archived / All, numbered pages newest
    first, create / edit / archive / restore. `pos.technicians.skills.edit` to change; viewers read only.
  - Profile › Skills & Services › Assign Skills: several at once; each grants its linked active services in
    `technician_services` (`granted_via 'skill:<id>'`) — an existing grant is never duplicated or overwritten. A manager cannot
    approve skills for themself (`SKILL_SELF_APPROVAL`); technicians keep using Skill Requests.
  - Remove: shows the services it takes away and the future bookings that use them (kept for review, acknowledged), removes
    only what that skill granted and no other live skill also links; a manager's direct grant stays. History kept.
  - Status shown from the record: Approved / Pending (future start) / Expired / Inactive (archived skill) / Removed.
- **Migration 816**, state machines `TECHNICIAN_WEEKLY_OFF_RULE`, `TENANT_SKILL`, `TECHNICIAN_SKILL_ASSIGNMENT`; B-12 tenant
  triggers; 9 new error codes (EN/VI); POS namespace `teamprofilex` (`tpx.*`).
- **Tests:** `weekly-off-skills.pgtest` (11 — the §16 scenarios: Mon + Tue weekly, one-time Friday, working override, conflict,
  next-month change, Remove Recurrence, cross-salon, Gel Extensions created once, assign, remove with a future booking,
  archive), `TechnicianDaysOffSkills.test` (3). Existing team-screens (112), live schedule (6) and profile tests green; common
  suite green.
- **Not built (PARTIAL):**
  - §13 one-click Technician System Health Checker (the Team Data Accuracy Alerts and per-module health checks exist; no
    single technician-wide report yet).
  - §12 directory search by skill / certification and the month-grid From / To picker on every profile list.
  - Bulk apply of a days-off pattern / skills to several technicians (§10 Manager Bulk Assignment).
  - Tech Queue's own walk-in eligibility reads the workforce state (clock / queue), not the schedule; a technician on a weekly
    day off who is not clocked in is already not offered, but the queue does not name the rule as the reason.
  - Pre-existing, not from this change: `customer-booking-reschedule.vitest.spec` "a time that already passed" fails at this
    hour of the day on the base commit too.

### G4 Split Tips — built behind a default-off flag (Nov 5 2026)

Full write-up, audit table and the 36-scenario status matrix: `docs/tips/TIP_INDIVIDUAL_TECHNICIAN.md`. Summary: the
customer display shows one card per technician who performed a service; each technician's tip is chosen separately
(No Tip / $ presets / % of that technician's own services / Custom), reviewed and confirmed before payment; the server
re-validates, versions and writes the customer-directed split into the one tip store (`ticket_tip_allocations`, migration
817 `checkout_tip_selections` + append-only events), locks it at Pay, unlocks on a decline, marks it stale when the
performers change, and supersedes it when the front desk changes the total. One combined card amount is unchanged.
Tests: `technician-tips.vitest` (12), `technician-tips.pgtest` (9), `TechnicianTips.test` (4); checkout (1,021),
customer-display (205) and common (1,522) suites green. Not done: the front desk Pay path does not yet require the
customer's confirmation; POS live per-technician view; Fiserv device / UAT checks (BLOCKED_EXTERNAL).

### G7 Global Advertising + Tenant Control — built (Nov 5 2026)

Write-up, audit table and evidence: `docs/advertising/GLOBAL_ADVERTISING.md`. One Super Admin switch (starts ON = today's
behaviour): OFF plays AI PowerSalon's campaigns on every idle display, ON each salon's own — never mixed; enforced on every
playlist request and every salon advertising write (saved salon ads kept, pause / archive allowed). Platform campaigns reuse
the salon engine (validation, lifecycle, image pipeline, playlist builder). Displays acknowledge the applied policy in their
heartbeat; the fleet status counts only those acknowledgments. Idle layout exactly 50 / 50. Migration 818. Tests:
`platform-advertising.pgtest` (6), `heartbeat-ad-policy` (2); display-ads (98), common (1,522), customer-display (205) green.

### G9 Enterprise Backup & Disaster Recovery — built, with an honest gate (Nov 5 2026)

Report (§50 A–K) and the executed-evidence matrix (Appendix B): `docs/backup/BACKUP_AND_DR.md`. Extends what existed
(`DISASTER_RECOVERY.md`, backup_reports heartbeat, restore-verify, drills, POST_RESTORE_HOLD) rather than replacing it.
Migration 819: recovery catalog (manifest sha256, key references, schema version, retention class, immutable-copy status,
verification status), append-only verifications, checksummed restore plans with one-active-per-tenant fencing, append-only
plan events, cross-tenant trigger. Manifests with credentials / embedded passwords / no key reference / no checksum are
refused (recorded FAILED). A point is "recoverable" only after a real restore test posts VERIFIED. Midnight America/New_York
checkpoint (DST-safe) + P2 alert when missed. Super Admin (English) Backup & Disaster Recovery: Overview, Restore Center
(search salon → scope → verified point → dry run listing payments / payouts / gift-card / loyalty / sends after the time,
unresolved card attempts BLOCK), second-person step-up approval bound to the plan checksum (30 min, finance acknowledgement
when money moved), durable idempotent job. Compare-only restores run against an isolated staged clone and complete with
per-table evidence; whole-salon / one-branch stop at BLOCKED `DESTRUCTIVE_APPLY_NOT_AVAILABLE` until pilots A/B/G.
Tests: backup-center-core (16), backup-center.pgtest (16, two PGlite databases), BackupCenterScreen (3); common 1,524 green.
Remaining: provider job wiring + first VERIFIED point (Kevin, HOSTING), off-site immutable bucket, PITR decision, independent
recovery identity (BLOCKED_EXTERNAL); destructive apply + pre-restore safety point + rollback (P1 engineering); 100k-customer
timing (P2). Pre-existing, not G9: `check-error-codes` flags BRANCH_NOT_AUTHORIZED in communications.controller.ts (fails on the base commit too).

