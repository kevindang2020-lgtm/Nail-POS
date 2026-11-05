# Clover Compact — production onboarding procedure (§128)

> **Fiserv master build — Nov 4 2026 correction (read first).**
> * This page is the **production** procedure. It is **not** permission to run a real card on the current **UAT** MID
>   (177000000238). In UAT use only Fiserv-approved **test cards** and the Jotform scenarios (CP $1,000.12 approve,
>   $1,100.25 decline, surcharge $9.00, tip-adjust $125.56 + $10, void, refund). The "$1.00 real card" step below applies
>   only to a salon's first **production pilot** after Fiserv's written certification and that salon's boarding.
> * The Fiserv test device is a **Clover Compact** (not a Flex). Use the HSN that Bolt `listTerminals` returns, not the
>   printed serial; the CardPointe portal "Equipment: 0" is a question for Ryan, not proof of failure.
> * Code now: `connect` never forces (no session stealing), `authCard` sends Fiserv's implied-decimal amount ("100" =
>   $1.00) to `/api/v3/authCard` (v4 opt-in), and "Paid" requires the approved amount + retref to reconcile.
> * A terminal must be assigned to its branch (Devices). Terminals with no branch are no longer used for any branch.
> * Production stays OFF until: `payment_platform_validations` has an `approved` production row with Fiserv's reference,
>   `platform_settings.payments.production_enabled = true`, the merchant row is `onboarding_status = approved` with
>   `credentials_verified_at` and `production_enabled_at`, and the deployment sets `PAYMENTS_LIVE_MODE=1`.


The exact operational procedure for putting a Clover Compact (or Flex / Mini) into a salon on AIPowerSalon. No tribal
knowledge: every step names the screen or command. Prerequisite reading: [clover.md](clover.md), [fiserv.md](fiserv.md).

## 0. Who does what

| Step | Who | Where |
|---|---|---|
| Merchant boarding + device order | Fiserv / CardPointe ISV team with Kevin | Fiserv (external) |
| Gateway credentials, Bolt key | AIPowerSalon Super Admin (step-up) | admin-web → Payment Gateways → Configure Gateway |
| Branch merchant (multi-location) | Super Admin | same drawer → **Branch merchant accounts** |
| Device pairing, register, test | Salon owner / manager (`settings.edit`) | pos-web → Devices → Pair Terminal / Payment Terminals |

## 1. Merchant activation (BLOCKED_EXTERNAL — Fiserv)

1. Fiserv boards the salon's **production MID** and issues the CardPointe Gateway site + API username / password, and the
   **Bolt (Integrated Terminal) Authorization key** for that MID.
2. Super Admin → Payment Gateways → the tenant → **Configure Gateway**: processor `fiserv`, environment **production**,
   Base URL (`https://fts.cardconnect.com/cardconnect/rest`), Merchant ID, API username/password (write-only, sealed with
   the PAYMENT key), Terminal API base (`https://bolt.cardpointe.com/api`) + Terminal Authorization key. Status `pending`.
3. **Verify credentials** (which fields are missing) → **Test connection** (`inquireMerchant`, no charge) → when it answers
   `merchantEnabled`, set status **active** (step-up; audited `payment_gateway_*`).
4. Multi-location salon whose branch settles to its own MID: **Branch merchant accounts → Add for location…** with that
   branch's MID / credentials / Bolt key; Test; set **active**. Branches without a row use the salon default.

## 2. Device activation (BLOCKED_EXTERNAL — Fiserv + the physical device)

1. Fiserv registers the Clover to the MID (order id) and gives the device's **HSN** (hardware serial number).
2. Power the Clover, connect it to the salon Wi-Fi/Ethernet, let it finish the CardPointe terminal setup until it shows
   the idle screen. Bolt `connect` fails with *"No request queue registered for hsn"* until the device is online.

## 3. Branch assignment + POS pairing

1. pos-web, signed in at the branch the Clover lives in → **Devices → Pair Terminal**: 6-digit code (any — it becomes the
   terminal id), label ("Front Desk Clover"), **HSN**, and the **register** (from the location's `pos_stations`) it serves.
2. **Devices → Payment Terminals**: set the type (`Clover Compact`), optionally the serial; the register can be changed later.
   Preferred setup is one Clover per register (POS-01 → CLOVER-01). A shared Clover is allowed: the server lease makes the
   second register wait with TERMINAL_BUSY.

## 4. Connection validation

**Devices → Payment Terminals → Test connection** — a Bolt `connect` + `ping` for the HSN through the branch's merchant
(no charge). Expected: status becomes **Online**, `last_seen_at` set, audit `pos_settings_terminal_tested`. If it answers
"did not answer": device off / offline / not registered to this MID / wrong HSN / wrong Bolt key — see
`docs/runbooks/clover-terminal-offline.md`.

## 5. Test transaction

1. Open a $1.00 test ticket at that register, send it to the customer display (or take it at the register) and tap a
   real card on the Clover. Expect **approved**, ticket paid, receipt offered.
2. **Refund** the $1.00 from the ticket (Checkout → ticket → Refund; original tender). Expect `payment_refunds` row +
   processor refund id.
3. Optional **void** test: a second $1.00 sale, then Void before the batch closes.
4. Disconnect test (§144): unplug the Clover mid-tap → the POS shows "Payment status is being verified"; press **Verify
   with processor** → the attempt resolves from the gateway's answer (no second charge).

## 6. Production verification checklist (§188)

- [ ] Merchant configured (production environment, status active, Test connection OK, `last_validated_at` set)
- [ ] Branch mapping verified (branch merchant rows for every branch with its own MID; others inherit)
- [ ] Terminal registered (HSN) and paired to its register; type set
- [ ] Test connection → Online
- [ ] Sandbox tests complete (`npm run uat:cardpointe` passed on UAT before production credentials were entered)
- [ ] Production credentials active (sealed; never in env)
- [ ] Webhook configured: Super Admin → Rotate webhook secret → paste into the CardPointe webhook configuration for the MID;
      endpoint `https://<api>/api/v1/webhooks/payments/fiserv`
- [ ] Webhook verified: Super Admin → Webhook events shows `✓ verified` for a delivery
- [ ] Idempotency tested (double-tap Pay → one charge; `checkout-card-idempotency`, race tests)
- [ ] Refund tested, void tested, unknown-state recovery tested (steps 5.2–5.4)
- [ ] Settlement sync tested: the next day's `settlement.*` webhook shows in Super Admin → View settlements

Keep this page with the salon's go-live record; the audit log holds who did each step.
