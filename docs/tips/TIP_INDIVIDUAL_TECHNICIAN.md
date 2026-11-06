# Individual Technician Tipping at Checkout — G4 (Split Tips guide, Nov 5 2026)

Consolidated equivalent of the guide's §15.1 handoff files (architecture, display UI, Fiserv integration, ledger,
cash/payroll, security, test results, external dependencies, readiness, next steps). Commit: see `git log` "G4 Split Tips".

## Audit (§01) — what existed and what was reused

| Piece | Where | Classification |
|---|---|---|
| One tip store per ticket, explicit split wins | `ticket_tip_allocations` (052); compensation `loadTicketMeta` → `directedTips` → engine `customer_directed` | KEEP — the customer's split is written here |
| Card / cash split of each technician's tip | compensation engine (proportional to the ticket's card:cash tip pool) | KEEP |
| 50/50 two-tech / proportional fallback | compensation.service tip method | KEEP — runs only when NO explicit rows exist |
| Manual re-split after payment (tip_correction ledger) | `compensation-tip-allocation.service.ts` | KEEP (post-payment corrections) |
| Customer display: one ticket tip (percent / custom / none) | `customer-display.service.ts` `applyTipToRow` | KEEP when the flag is off; per-technician path added |
| Payment UNKNOWN / verifying, unsettled-tender guard | checkout (`unsettled-tenders.ts`), display `payment_verifying` | KEEP — unchanged |
| Terminal capture (CardPointe Bolt) | `terminal-capture.service.ts` | KEEP — still ONE combined amount |

## What was built

- **Flag:** Settings → Payments & Checkout → "Customer tips each technician separately on the display" (`tips.perTechnicianTips`,
  default OFF — the guide's default-off rollout). Dollar presets `tips.tipPresetCents` (default $3 / $5 / $10) beside the
  salon's tip percents.
- **Recipients (§4.1):** the technicians who PERFORMED the ticket's service lines (`ticket_service_lines.technician_id`; a
  shared line by its recorded `ticket_service_line_allocations.share_bps`, never invented). Booked-only technicians and
  product lines get no card. One card per technician, services grouped.
- **Percent basis (§4.3):** each technician's own net service basis — line totals with the ticket discount spread by line
  size (exact cents). 20% of A=$40 and B=$60 is $8 + $12.
- **Customer display (§3):** one card per technician (photo, name, services, current tip); tapping opens that technician's
  menu only (No Tip, $ presets, %, Custom keypad); review shows each tip and the total; **Confirm & Continue** is enabled only
  when every technician has a choice (No Tip counts). English only. Ads never cover it (existing right-panel priority).
- **Server (§6.3, §7):** `POST …/tip` with `technicians[]`, `expectedVersion`, `confirm`. The server re-reads the performers,
  recomputes every tip, refuses a non-performer or another salon's technician, refuses a stale version, and in ONE
  transaction writes the versioned selection (`checkout_tip_selections`, migration 817), replaces the ticket's tip rows
  with the customer-directed split (`source 'customer_display'`), sets the ticket's total tip, and appends history
  (`checkout_tip_selection_events`, append-only). A single undirected tip is refused while the flag is on.
- **Lock before payment (§5.3):** Pay on the display requires a CONFIRMED, current selection and LOCKS it; edits are refused
  while locked. A declined / failed charge unlocks so the customer can change the tips and retry.
- **Stale performers (§4.1, #12):** a changed performer or price changes the recipients key → the selection shows as stale
  and Pay is refused until the customer chooses again.
- **Front desk changes the total (§4.4):** `checkout.setTip` supersedes a customer split whose total no longer matches —
  rows removed, history kept — never a silent re-split of the customer's choice.
- **One combined charge (§6.1):** unchanged — the ticket total (with the summed tip) is the one amount the Fiserv adapter
  charges. No per-technician transactions.

## Test evidence (§13) — executed in this environment (PGlite / jsdom; no provider)

| ID | Scenario | Status | Evidence |
|---|---|---|---|
| 01, 08 | one performer / several lines → one card | PASS | `technician-tips.vitest` |
| 02 | A=$5, B=$10 kept unequal | PASS | vitest + `technician-tips.pgtest` (allocation rows) |
| 03, 04 | explicit $0 / no tip | PASS | vitest + pgtest (`ben:0:customer_display`) |
| 05 | draft edit $5 → $8 | PASS | pgtest |
| 06 | 20% per performer $8 + $12 | PASS | vitest + pgtest (ticket tip_type percent 20, $20) |
| 07 | custom $7.25 exact | PASS | vitest |
| 09 | three performers | PASS | vitest |
| 10 | booked but did not work | PASS | vitest + pgtest (Cara absent) |
| 11 | shared service by recorded shares | PASS | vitest |
| 12 | performer changed → stale, Pay refused | PASS | pgtest |
| 13 | one combined amount, not per tech | PASS (code path) | the display charges the ticket total; no per-tech charge path exists |
| 14 | no duplicate terminal tip prompt | BLOCKED_EXTERNAL | needs the Clover / Bolt device tip-prompt configuration verified with Fiserv |
| 15 | declined → retry, tips editable | PASS | pgtest |
| 16 | UNKNOWN → verify, no second tender | NOT_TESTED here (existing verifying flow unchanged) |
| 17, 33 | duplicate webhook / worker restart → one posting | NOT_TESTED here (existing compensation snapshot idempotency unchanged) |
| 18 | concurrent screens → version conflict | PASS | pgtest |
| 19–23 | cash tip / split tender / partial refund / locked payroll / payout mix | NOT_TESTED here — existing engine paths, unchanged |
| 24 | cross-tenant / non-performer refused | PASS | vitest + pgtest |
| 25 | session takeover | PASS (existing) | display token per session; the version check rejects a stale screen |
| 26, 27 | 3-second clear, ads paused | PASS (existing tests) | customer-display suite (205 tests) |
| 28 | language boundary | PASS | display strings English only; POS setting EN/VI |
| 29, 31 | sandbox vs real UAT; branch merchant routing | BLOCKED_EXTERNAL | no provider in this environment |
| 30 | physical touch / 27-inch | NOT_TESTED (jsdom only) |
| 34 | no fabricated customer confirmation | PASS | display Pay requires confirm; **Nov 5:** every NEW front-desk tender (cash / card / gift card / split / rewards — never Verify) runs `assertCustomerTipsConfirmed`: a DRAFT → `TECH_TIPS_NOT_CONFIRMED`; performers changed → `TECH_TIPS_STALE`; the cashier may confirm ON THE CUSTOMER'S BEHALF with a reason (`staffTipConfirmation`) → CONFIRMED with source `staff` on the selection and its rows, history `STAFF_CONFIRMED_ON_BEHALF` naming the cashier (migration 820). `technician-tips.pgtest` +4, `checkout-cash-tender` +1, `POSCheckoutScreen.tips-on-behalf.test` 2/2 (EN + VI panel) |
| 35 | gift card / loyalty funding tips | NOT_TESTED — unchanged tender rules |
| 36 | discount → basis | PASS | vitest |

## Decisions

- CODE READY FOR DEVELOPER HANDOFF: **yes, behind the default-off flag**.
- PRODUCTION READY: **no** — 14 / 29 / 31 are BLOCKED_EXTERNAL (Fiserv device tip prompt, UAT, merchant routing on real
  devices); 16 / 17 / 19–23 / 30 / 35 need an end-to-end run with a pilot salon.

## Next steps (P1)

1. ~~Front desk Pay with an unconfirmed DRAFT~~ — built Nov 5 (row 34). Found on the way: the POS checkout API's own error
   class dropped the server's code, so `e.code` branches on that screen (incl. the CHECKOUT_ALREADY_IN_PROGRESS refresh)
   never fired — fixed (`ApiError.code`).
2. POS checkout screen: show the per-technician tips live (the display already emits `customerDisplayTipSelected`).
3. Verify the Clover terminal's own tip prompt is OFF for display-tipped checkouts (BLOCKED_EXTERNAL).
