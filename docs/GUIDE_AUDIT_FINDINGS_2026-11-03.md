# Audit findings — Nov 3 2026 guide batches

Read-only audits of every uploaded guide against the code. Condensed to what must be built or fixed. Paths are repo-relative. "Gap" = the guide asks, the code lacks it. "Bug" = the code gives a wrong answer today.

## A1 AI Center
- Bug (fixed in this pass): old page counted stored `trialing` rows as Trial and Running after the trial ended; "AI usage" summed mixed units.

## A2 AI Business Alerts (newer guide)
- Bug: PATCH/DELETE `/pos/ai-business/alerts/:id` check tenant only (ai-business-alerts.kysely.repository.ts:51,56) — a branch manager can pause/delete another branch's rule.
- Bug: `evaluateNow` computes with `ctx.branchId`, stores `a.branch_id` (business-center.ts:302,312).
- Bug: `minSampleSize` 0 accepted (alerts.service.ts:33) → $0 average triggers "falls below".
- Bug: `ON DELETE CASCADE` erases evaluation history (781).
- Bug: Explain uses compare `month` vs `month` and today's data instead of the stored period.
- Bug: health-run reuse keyed by tenant+area, not branch.
- Gaps: severity/recipients/cooldown/quiet hours; rule versions; Draft/Archived; Edit/Duplicate/History; incident lifecycle (ack→investigating→resolved, mute/snooze); Unavailable/Failed/Paused outcomes; background evaluator; notifications + delivery attempts; tabs (Rules/Triggered/Evaluation History/Notifications/Reports); filters; anomaly detection on bookings/avg ticket/refunds/retention.

## A3 AI Branch Comparison (`/tenant/ai/business/branches`, POSAiBranchCompareScreen)
- Bug: completion 0 and avg ticket $0.00 when nothing to divide (should be N/A); avg ticket is gross÷tickets while Net/Rev per completed use net; inactive branches not filtered.
- Gaps: KPI strip + refresh; custom From/To; branch search/multi-select/paging (cap 20); drill-down overlay; Branch Data Health check; fair scorecard (per tech hour, per operating hour, retention); difference explanation; growth advisor; saved snapshots from this screen.

## A4 AI Business Assistant (`/tenant/ai/business`)
- Bug: "Why did revenue change" defaults comparePreset `month` (ai-business-revenue.service.ts:91) → this month vs this month; no previous-week/month preset (DatePreset reports.dto.ts:127).
- Bug: saved questions rerun with current tab's period (screen :84); "Summarize today" sends the selected tab preset (:71).
- Gaps: Yesterday/Last 7/Last 30/Last Month/Custom; header scope + availability + Check Business Data; snapshot KPIs before asking; multi-line composer + retry; conversation/report history with search; record search; export/copy/"run again with this period".

## A5 AI Scheduling Optimizer (built)
- Bugs: health reuse/lock per tenant not branch (scheduling-center.ts:272-273,352); `time_off_valid`/`shift_data` not branch-scoped; `current_date` DB tz; `no_side_effects` hard-coded PASS; calendar today UTC (SchedCenter.tsx:132,191).
- Gaps: Yesterday + Last 7 presets; qualification/queue consistency/timezone/realtime checks; technician full-day overlay; before/after preview.

## A6 AI Queue (`/tenant/ai/queue`)
- Bug: decisions `created_at <= 'YYYY-MM-DD'` drops the "to" day (ai-queue-assignment.kysely.repository.ts:105); no id tie-break; 5000-row silent cap.
- Bug: `parseRange` bare dates as UTC (ops.service.ts:42); tiles use different ranges.
- Bug: live queue capped at 100 (CustomerPanel:53, AlertsCard:60).
- Bug: `alerts/scan` writes under view permission (ops.controller.ts:71).
- Bug: failed analytics show 0; failed roster shows empty; "Decided today" omits keptUnassigned.
- Gaps: eligible technicians + approvals pending counters; dry-run when auto Off; kill switch while Off; health check + runs table; full overlay; ranked next-step list; unified search; presets + calendar; pages 10/20/50.

## A7 AI Booking Assistant (`/tenant/ai/booking`)
- Bug: POSBookingScreen.tsx:1495 asks the model for "best available slots" with no schedule data (invented availability, billable).
- Bug: usage hidden once cancelled (POSAiPackageScreen:91).
- Gap: whole operations center (summary, activity with search/filters/pages, activity detail, health) — no backend module.

## A8/A16 Reception Copilot (two guides, same screen)
- Bug: sidebar gates `/reception-copilot` by `ai_reception` (tenant-nav.tsx:220,228) while APIs need `ai_reception_copilot`.
- Bug: priority/overlay links `/tenant/queue`, `/tenant/booking`, `/tenant/ai/calls?call=`, `/tenant/customers/:id` fall to /overview; failed-text link passes notification id as `?timeline=` (center.ts:480); `?customerId=` ignored.
- Bug: "Prepare a reschedule" pre-fills only appointmentId → always blocked (center.ts:472,160).
- Bug: failed queue read → "waitlist is short" claim (reception-copilot-assist.service.ts:100-109).
- Bug: AI Phone panel ignores `available` (POSReceptionCopilotScreen.tsx:29,38); conflict-check network error shows validation text (:180,470); Explain a Service found:false in all-branches.
- Bug: health reuse any branch (center.ts:370); Twilio sender nulls first vs last (:421 vs :204); time windows wrap midnight (:351,:453); calendar today UTC (receptionCopilotCenter.tsx:19).
- Bug: literal `…` in catalog.en.ts (42 occurrences) — "Ask the copilot…".
- Gaps: responsible role/likely cause; priority filters/sorts; services + SMS scopes; Yesterday preset; URL filters; name pickers instead of typed IDs; tabbed workspace (guide B); SMS state list.

## A9 AI Receptionist Settings (`/tenant/ai/receptionist/settings`)
- Bug: `get()` swallows read errors → defaults; `update()` builds on it → save overwrites stored settings with defaults (ai-settings.service.ts:70,77-79).
- Bug: decimals rounded instead of refused; consent text cut at 500 while schema allows 2000.
- Bug: no runtime reads `ai_receptionist_settings` — "Saved" implies effect.
- Bug: branch session ignores tenant-wide row; audit logs keys only; raw `e.message` shown.
- Gaps: config health check; settings history/compare/restore; smart config assistant; effective-config read; sync states; concurrency/idempotency; versioned consent script; unsaved-changes guard.

## A10 AI Calls / A15 AI Receptionist (built)
- Bugs: AI-activity search tenant-only (rc.ts:424-428); overlay appointments not branch/call-scoped (:451); control history tenant-wide (:647); `checks()` calls `control()` outside try (:209) and AI Calls `.catch(() => [])` hides it (health can show READY); `zone()` falls back to New York silently (:96); test-call proof accepts any real call; gates not re-checked in the write transaction; voiceMinutes 0 not "—"; pending-code count error→0; health rate-limit/lastHealth tenant-wide; page reset on mount (POSAICallsScreen.tsx:78); verified bookings counted by requested_at vs call start.
- Gaps: missed/in_progress statuses; branch/agent/service/technician/duration filters; phone search beyond follow-ups; URL filters; caller/dialed number columns; SID/agent/appointment search; more date bases; Answered metric, abandon alert; call_links.

## A11 AI Calendar (built)
- Bugs: health check one transaction without savepoints (ai-calendar-center.ts:312) — first failure makes every later check UNKNOWN; reuse per tenant; failed-call count error→0 and not branch-scoped (:351); metrics hard-coded READY (:364); `clock()` New York fallback (:102); overlay tabs error→[] (:278-284).
- Gaps: deep-link appointmentId/technicianId into Booking; Open Slots use saved hours; "hidden by current filters" message.

## A12 Business Setup (built)
- Bugs: FAQ replay key per salon not per FAQ (center.ts:379); qualification join ignores branch (:140,:480); `online_booking_enabled=false` counted AI-bookable (:178, owner decision).
- Gaps: date presets; FAQ overlay Approval/AI Preview/Usage tabs + diff; author/branch filters in UI; service/technician filters; FAQ tags; more history bases; holidays/closures; recorded health runs.

## A13 AI Follow-Ups (built)
- Bugs: health cache tenant-only (:504); escalation alerts once per task+rule forever (:354,:615); version check skipped when undefined (:267); attempts on resolved tasks (:374); escalation alert uses caller branch (:349).
- Gaps: branch filter; missed-call + Reception Copilot sources; edit due date/description; recommended assignee; hold expiry; notify assigned staff; health history.

## A14 AI Front Desk (built)
- Bugs: Open Booking/Open AI Calls dead links (tsx:195); handoffs24h counts attempts+failures (:654); bookings succeeded counts cancels/reschedules/holds (:656); `route()` single latest call salon-wide → one branch shows "Degraded" (:102-104); directory/summary ignore branch (:121-182); `shared` check reads other tenants' rows (:215); today UTC (tsx:29).
- Gaps: assigned number/creator search; call search by customer/phone/appointment; call detail overlay; avg duration; verified AI bookings; connected vs attempted transfers.

## A17 Reviews & Reputation
- Bugs: `detail()` sends "null" branch (:259); users join without tenant (:249).
- Gaps: branch filter; KPIs ignore technician/source/rating filters; assign workflow; communication history; first/last name search; recorded checks.

## A18 Referral Program
- Bugs: archived customers can refer/be referred (status selected, unused :161,:170); REWARD_PENDING_APPROVAL in two tabs; users join without tenant (:608).
- Gaps: branch/eligibility/creator/reviewer filters; more fraud signals; communication tab; recorded checks.

## A19 Retention / Win-Back
- Gaps: email search; first/last/accent search; search scopes; service category/technician/spend-band filters; "New" = exactly one visit; Add to eligible audience.

## A20 Birthday Campaigns
- Bugs: history not branch-scoped (:308-315); summary KPIs ignore branch and range (:131-142); association window on `updated_at` (:141); Feb 29 ordering (:199).
- Gaps: more date bases; history scope + dialog search/range/page size; activity/tier/source filters; offer status column; birthday timeline.

## B1–B4 Segments, Coupons, Deals, Promotions
- Bugs: segments email search unescaped `%`/`_` (segments.repository.ts:103); discard/link audit outside transaction (controller:99-113); dollar parsing float (POSSegmentsScreen.tsx:48, POSCouponsScreen.tsx:252); coupon assistant draft not atomic (coupon-center.ts:198,202); assistant stats include removed tickets (:135,:164,:166); ticket-number lookup not branch-scoped (:65); deal approvals preview active-deal count 0 (deals-center.ts:84,125); tech_policy health ignores 4 limits; promotion trends include removed lines (promotions-center.ts:117).
- Gaps: health runs tables; coupon branch filter + Open Ticket + export + created/finalized basis + customer in checker + configurable expiring window; deals branch filter + Open Ticket + approvals search/date; promotions export + View Receipt.

## B9–B12, B16 Notifications, Phone Numbers, Booking Verification, Messaging Setup, Email
- Bug: `'\D'` in `sql` templates becomes `D` — phone-center.ts:238-240,417; inbox.repository.ts:103,104,267,324,460,493,522; message-templates.ts:609.
- Bug: retry fixed-since check only for SMS auth/config (customer-notifications.ts:345); resend-of-resend unlimited (:337); providerAcceptedAt = created_at.
- Bug: email Delivery Rate denominator excludes bounced/failed (email-center.ts:93,103); canResend true for hard bounces (:229); auth_failed both branches 'down' (:149); masked users can search unmasked addresses (:167).
- Bug: verification latest reason vs error count disagree (:198-200); canResend ignores phone match (:329); no last-page clamp.
- Gaps: more date bases/filters; branch control on screens; failure-group Open filters category; AI Receptionist in timeline; exports; alerts for idle tenants; Rejected/Conflict phone states; live Twilio credential check; messaging history search; scheduled email health check; sender identity SPF/DKIM/DMARC.

## B13–B15 EOD Follow-Ups, Follow-Up Queue, Appointment Reminders
- Bug P0: reminders only for `status='booked'`; Confirm and customer reschedule set `confirmed` → no reminder (reminders.kysely.repository.ts:68,121,148,178,202; reminder-core.ts:36; reminder-center.ts:122).
- Bug: reminder totals 0 past last page (count over() :187,:222).
- Bug: EOD tech message edit bypasses allowTechEditMessage=Off (service.ts:200; eod-center.ts:145).
- Bug: missed 8 PM run never caught up (service.ts:127).
- Bug: "Rebooked" counts cancelled/no-show (eod-center.ts:210-211,344; followup-queue.ts:111,154,165,277,298,325); associated revenue counts another task's source ticket (:278-280).
- Gaps: opt-out/invalid contact checks; cooldown across communications; rebooking basis; type/channel/source filters; presets; URL state; "Opted Out" category assigned; profile follow-up history; CSV export; branch/channel filters; sent/skipped ordering; reminder reschedule/cancel event trail; customer history date range; Twilio branch override.

## B17/B18 Loyalty Tokens / Rules (flags off)
- Bug: purchase REVERSED/CHARGED_BACK after FUNDS_VERIFIED never debits wallet; books check accepts it (repo:451; books-check.ts:65).
- Bug: refunds pass total refunded (tip/tax/gift card) as refundedEligibleCents (consumer.ts:54; rewards-earn.ts:145).
- Bug: refund before earn → earn on full amount (rewards-earn.ts:50-55).
- Bug: suspended/locked wallet reported as insufficient tokens (repo:367; rewards-earn.ts:90-96).
- Bug: liability journal tenantId T on earn vs null on redeem.
- Gaps: point expiry; daily/per-customer caps, categories, delayed availability; POS customer-rewards and payables regions; search/date/export; tenant health check; earning history server paging.

## D9–D12 Inventory, Suppliers, Stock Alerts
- Bug: recipe quantity floored to whole bottles ≥1 (inventory.service.ts:1318) and consumption empties whole bottles (:1346-1357); usage history counts emptied bottle as 1.00.
- Bug: Service Done deduction can repeat (check before lock, no unique key :1374); manual consume has no idempotency.
- Bug: expired bottles count as stock (inventory-core.ts:26-39) and are consumed first.
- Bug: product status/reorderAlert ignore branch thresholds (:557,:782).
- Bug: addStock/receivePO/createTransfer/reconcileCount/transition not atomic; reconcileCount uses current stock not count snapshot.
- Bug: Add Stock accepts purchaseOrderId without PO update or tenant check.
- Bug: approveReport `catch {}` (:838); audit() swallows insert errors inside transactions (:135-147).
- Bug: three low-stock definitions disagree (overview-board.service.ts:217).
- Bug: receiving ignores units_per_purchase_unit; createPurchaseOrder vendor not tenant-checked, not atomic; reorder ignores open POs and counts drafts.
- Bug: mixed units summed in All Technicians "Used" (stock-alerts.repository.ts:291); thresholds count containers.
- Gaps: variants; unit conversion; dispose/waste/expire; in-transit transfers; recipe versions; helper attribution; usage filters; alert history by ack/resolve date; Reopened; PO edit, line discounts, Submitted, accepted/damaged qty, idempotent receive, supplier documents.

## D1 Team Performance
- Bugs: tier filter uses raw average, rows show rounded (team-performance-screen.repository.ts:67,83-84 vs 97); per-technician reviews/services not branch-scoped (:45-48,58-59); overall includes archived technicians; customer search without customers.view (:86-89).
- Gaps: helper contribution; completion date; export role.

## D2–D8 Catalog, Membership, Discounts, Products
- Bug: service tax `setTax` not persisted.
- Bug: catalog `paid()` tenant-only (catalog-screens.repository.ts:90) → branch users see all branches' sales; Active Products counts supplies.
- Bug: category review/history not branch-scoped (:359,:267); no duplicate-name guard; description not accepted.
- Bug: ticket-number search treated as phone when ≥4 digits (:316).
- Bug: Edit Service dialog price path skips reason + conflict check (catalogShared.tsx:147).
- Bug: add-on usage `'\u0000'` placeholder → 500 (:499); usage matched by name across branches (:486); legacy `/pos/service-add-ons` sees first 20 services, copies category rows, rewrites without history.
- Bug (membership): no credits on renewal; no first-period charge; dollar-credit redeem always fails; creditBalance held math lets redemptions exceed grants; redeem/reserve race; month-end drift (setUTCMonth); dunning always attempt 1 and period anchored to retry date; card charged before duplicate check → hourly re-charge loop risk; one failure stops sweep; member numbers collide; demo data migration 193.
- Bug (discounts): redemptions filtered by deal branch not redemption branch (discounts-screen.ts:216); KPI uses counter vs ledger; export ignores filters.
- Gaps: branch override model; AI pricing review decisions; bundle sales; category conflict/reorder history/booking impact; pricing revert + future booking preview; add-on conflict/reason, add-on recipes; discount filters.

## D13–D19 Payments & Money, Transactions, Cash Drawer, End-of-Day Cash, Refunds & Voids, Split Payments, Tips
- Bug P0: Checkout writes `tickets.subtotal_cents` already net of discount (checkout.kysely.repository.ts:1494; checkout.service.ts:171,286-288) but money-overview (:71,:163) and tips (:66) subtract `discount_cents` again → Revenue, Average Ticket, trend, all-time revenue, tip rate too low. Pgtest fixtures seed pre-discount subtotal.
- Bug P0: `tickets.total_cents` written only at payment; `locked_total_cents` = remaining due at card attempt (checkout.service.ts:885-886). Readers compute `locked_total ?? total+tip − Σpaid` → Outstanding (money-overview :94), transactions detail balance (:236), split total/due/status (split-payments :66) wrong (partly paid shows 0 / completed).
- Bug P0: payment webhook stores dollar strings as cents for refund/settlement/chargeback (payment-webhook.service.ts:316,325-327,359); `amountFromDollars` (:36) used only at :383.
- Bug P0: refund webhook marks whole original tender `refunded` even for partial (:80,:302-303) → sale disappears from Collections/Transactions while refund still counted; extra refund row when refundId differs from stored retref.
- Bug P1: cash drawer `.catch(() => undefined)` → $0 and reconcile persists false discrepancy + alert (cash-drawer.repository.ts:46,51,63,68,106); cash filtered by branch not register (:43-49); reconciled variance recomputed live (:71); open overwrites float without lock (:89); movement allowed after close (:148); reconcile returns status even when guard skipped (:128); no idempotency on open/reconcile/movement; screen todayIso UTC (POSCashDrawerScreen.tsx:11); movements error → empty; Number() parsing.
- Bug P1: skip-line tickets never write subtotal → $0 revenue but counted in paidTickets.
- Bug P1: split payments count pending/reserved refunds as refunded (:86).
- Bug P1: EOD cash `.catch(() => [])` → expected $0 written into count (tech-cash-handoff.repository.ts:56-63,101-107); not branch-scoped; expected not reduced by refunds/voids; equal count auto-reconciles.
- Bug P2: finance-scope uses first branch's time zone (finance-scope.ts:60); refund type per row; void lateral first row; processors filter not branch-scoped; tips gift card counted as card; Issue Refund gated on wrong permission (POSPaymentsOverviewScreen.tsx:48).
- Gaps: Cash Drawer rebuild (search, presets/calendar, pages, activity table + overlay, denominations, manager approval, version check; Money Protection banner to bottom); tips free-form adjustments route.
