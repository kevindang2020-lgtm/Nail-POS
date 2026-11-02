# Skip-the-Line Checkout — Build Report

**Goal (met for the cash path):** on busy days customers skip the front-desk line — they pay from the app or hand cash
to their technician, who confirms it in the Tech App and the ticket closes automatically in the POS. Every payment,
including cash, is recorded.

## What was built (this increment) — backend, merged not duplicated
- **Migration `080_skip_line_checkout.sql`** — `payment_intents`, `cash_payment_confirmations`, `skip_line_checkout_settings`
  (per-tenant). Reuses existing `tickets` / `ticket_service_lines` / `payments` / `receipts` / loyalty tables. No
  `invoices` table exists — the bill is derived from the ticket; `invoice_id` stores the ticket id for traceability.
- **`apps/api/src/skip-line-checkout/`** module (registered in `app.module.ts`):
  - `skip-line-checkout.repository.ts` — tenant-scoped Kysely. Derives the **bill** server-side
    (`subtotal = Σ ticket_service_lines.line_total_cents`; `total = subtotal − discount + tax + tip`), resolves
    customer/technician from the same links the rest of the app uses (`customers.user_id`, `technicians.user_id`),
    persists intents + cash confirmations + settings, and **records the cash payment into the shared `payments` table +
    closes the ticket** (`status='paid', paid_at=now()`) in one transaction — the same terminal state POS checkout uses.
  - `skip-line-checkout.service.ts` — orchestration, auth scoping, realtime. Cash-to-tech, tech confirm/report,
    POS send/cancel app payment, settings. Backend-authoritative money; tenant/branch always from the session/ticket.
  - controllers: `customer-skip-line` (`/customer`), `tech-cash-confirmation` (`/tech`), `pos-skip-line` (`/pos`),
    `skip-line-settings` (`/pos/settings` + `/super-admin`, super-admin guarded).
- **Endpoints live:** `GET /customer/me/active-bill`, `POST /customer/payments/:id/pay-cash-to-tech`,
  `GET /customer/payments/:id/status`; `GET /tech/me/cash-pending`, `GET /tech/tickets/:id/cash-payment`,
  `POST /tech/tickets/:id/confirm-cash-received`, `POST /tech/tickets/:id/report-cash-not-paid`;
  `GET /pos/checkout/skip-line/state`, `GET /pos/tickets/:id/payment-status`,
  `POST /pos/tickets/:id/{send-app-payment,cancel-app-payment,move-to-front-desk-checkout}`;
  `GET/PATCH /pos/settings/skip-line-checkout`, `GET/PATCH /super-admin/tenants/:tenantId/skip-line-checkout`.
- **Realtime** events emitted on the shared SSE bus (`cash_to_technician_selected`, `cash_pending_tech_confirmation`,
  `cash_confirmed_by_tech`, `ticket_paid`, `ticket_closed`, `cash_issue_needs_front_desk`, `skip_line_payment_prompt_sent`,
  `customer_bill_opened`). **Audit** → `owner_audit_log` (entity_type `skip_line_checkout`); **alerts** → `owner_alerts`
  (category `skip_line_checkout`).

## Verified live (Postgres, real guards) — see BUILD_AND_TEST_REPORT / TENANT_ISOLATION_TEST_REPORT
Customer bill computed server-side ($40 + $3.50 tax + $8 tip = $51.50); cash-to-tech → pending confirmation → tech
confirm → ticket closes + `payments` row ($51.50 cash) + intent `cash_confirmed_by_tech` + audit row; report-not-paid →
ticket stays open + front-desk alert; tenant isolation + ticket-ownership + already-paid all enforced.

## Frontend — customer-web (added this increment)
`apps/customer-web` now has the customer pay flow: `api/skipLineApi.ts` + `screens/PayScreen.tsx` (route `/pay`) —
Review Bill → Choose Method → Card → Processing → Success, with **Pay Cash to Technician** (live-polls until the tech
confirms) and Apple/Google Pay. A Home banner (`screens/PayBanner.tsx`) surfaces a waiting bill. All money shown is the
server total; the screen sends a tokenized payment, never a PAN (CardSecure hosted-field tokenization is the marked
production hook). 4 new screen tests; full customer-web suite **89/89**.

## Frontend — tech-web (added this increment)
`apps/tech-web` now has the cash-confirmation surface: `techApi.cashPending/confirmCashReceived/reportCashNotPaid` +
`screens/CashPendingScreen.tsx` (pushed nav route `cashPending`) — each pending cash payment shows the customer, ticket,
services, and amount, with **Confirm Cash Received** (closes the ticket) and **Customer Did Not Pay** (optional reason →
front desk). A dashboard banner (`components/CashPendingBanner.tsx`) surfaces waiting cash and live-refreshes over the SSE
stream. 4 new screen tests; full tech-web suite **29/29**.

## Frontend — pos-web (added this increment)
`apps/pos-web` now surfaces Skip-the-Line at the front desk: `api/posSkipLineApi.ts` + `components/SkipLineDrawer.tsx`
(opened from a toolbar button on the **Checkout** screen — a fixed slide-over that leaves the Mac-fit grid untouched)
polls `/pos/checkout/skip-line/state` and lists each in-flight app/cash payment with a status chip and **Resend /
Cancel / Front desk** actions; auto-refreshes every 5s. The **Service-Done** screen gains a **Send to App** action per
ready ticket. 4 new drawer tests; full pos-web suite **58/58**.

## Website section (added this increment)
`marketing/skip-the-line-section.html` — a self-contained, **scoped** (`.stl`) drop-in section matching the AIPowerSalon
marketing aesthetic (cream/gold; Playfair Display + Hanken Grotesque). Carries the spec §3/§20 copy verbatim — eyebrow
"New · Skip-the-Line Checkout", headline "No checkout line. No waiting.", the body paragraph, five feature cards, and the
closing CTA — with a signature **pay-from-the-chair** phone mockup (bill + Pay / Pay-cash-to-tech + a "Cash confirmed by
your technician" badge). Responsive to mobile, keyboard-focus visible, reduced-motion respected; rendered and
screenshot-verified at 1280px and 390px. Paste the `<section class="stl">` + its `<style>` into the site.

## Loyalty-on-payment (final increment)
Paying a ticket through either Skip-the-Line completion path awards loyalty automatically.
- **Rule:** 1 point per dollar paid — `floor(amountCents / 100)`.
- **Store:** `customer_loyalty_profiles.points_balance` += pts and `total_earned_points` += pts (the same row the customer
  app reads and redemptions decrement); a profile is created if one doesn't exist and a branch is in context.
- **Where:** `confirmCashReceived` and `confirmAppPayment` success paths, via a single private `awardLoyalty()` helper.
- **Safety:** best-effort (wrapped so it can never fail a payment) and idempotent by construction — a paid ticket can't be
  re-confirmed, so points are awarded exactly once per payment.
- **Surfacing:** emits `loyalty_points_added` (tenant + customer), writes a `skip_line_loyalty_awarded` audit row, and
  returns `loyaltyAwarded` in the API response so the app can show "You earned N points."
- **Live-verified vs Postgres:** cash confirm on $51.50 → +51; card confirm on $30 → +30; balance and total_earned_points
  updated; audit rows present; re-confirm returns 404 with the balance unchanged (no double-award).

## Build status
API builds clean. Full backend suite **442/442** (this feature is additive — no regressions).

## Card / Apple Pay / Google Pay (added this increment)
`POST /customer/payments/:invoiceId/start` + `/confirm` charge via the per-tenant processor (`processorFromEnv()` →
CardPointe when configured, shared `SandboxPaymentProcessor` when `PAYMENTS_SANDBOX=1`, else honest "not configured").
Tokenized cards / wallet tokens / saved methods only — never a raw PAN. Approval records the payment (+ processor
reference) and closes the ticket in one idempotent transaction; declines leave the ticket open. Verified live (27/27).

## Deferred (next increments) — see REMAINING_BLOCKERS.md
The three **frontends** (customer-web pay screens, tech-web cash-confirm, pos-web skip-line statuses); the **website**
feature section; the **loyalty-on-payment** hook; `GET /customer/me/invoices/:id` + receipt GET endpoints for the app.
