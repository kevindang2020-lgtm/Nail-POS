# Clover — two very different things

Mandate §16–§20, §50, §52, §191-D.

| What | How AIPowerSalon reaches it | File |
|---|---|---|
| **Clover Compact / Flex / Mini as a PAYMENT DEVICE** (the normal salon setup) | Fiserv **CardPointe Integrated Terminal (Bolt)** — the device is registered to the merchant's CardPointe MID, the API talks to Bolt by the device's **HSN** | `modules/payments/src/payments/cardpointe-bolt.client.ts`, `apps/api/src/customer-display/terminal-capture.service.ts`, `apps/api/src/payments/terminal-probe.module.ts` |
| **Clover as an e-commerce PROCESSOR** (a salon whose merchant account is a Clover account) | Clover Ecommerce API (`/v1/charges`, `/v1/refunds`), Bearer private token | `modules/payments/src/payments/clover.client.ts` (`CloverPaymentAdapter`) |

There is **no Clover Remote Pay / Clover Connector SDK** in the code (none is needed on Bolt; the architecture test refuses
one outside an adapter). The Clover Compact is a semi-integrated card reader: AIPowerSalon owns the customer, visit,
services, products, discounts, loyalty, membership, gift card, tax, tip rules, totals, receipt, commission and inventory;
the device only takes the card (§16).

## Pairing and routing (§17–§18)

* A terminal is paired in POS **Devices → Pair Terminal** with a 6-digit code, a label, the **HSN** (the device serial
  Fiserv registered) and the **register** (`pos_stations`) it serves. One register → one Clover is the default; a
  register with no terminal and a branch with exactly one paired terminal uses that one.
* The terminal charges through: its own `merchant_account_id` → the branch's merchant account → the tenant default
  (`resolveTerminalConfig`). A branch whose merchant is paused cannot charge on its Clover; it does not silently use
  the tenant default's MID.
* Registry fields (638): provider (`cardpointe_bolt`), terminal type (`clover_compact` / `clover_flex` / `clover_mini` /
  `other`), serial number, connection type (`cloud` for Bolt), disabled_at/by/reason, last seen / last ping / last transaction.

## Shared terminal reservation (§19–§20)

`payment_terminal_leases` (485): `acquire(tenant, terminal, holder)` is one atomic `INSERT … ON CONFLICT … WHERE expired`
— a second POS, display or phone targeting the same Clover gets **TERMINAL_BUSY** (409) until the first releases (or the
lease expires after a crash). Race tests: `terminal-lease.postgres-race.vitest.spec.ts`, `terminal-capture.postgres-race.vitest.spec.ts`.
The normalized status shows **PROCESSING** while a charge holds the lease.

## Transaction flow on the device (§21, §26–§27)

```
display session → amount + tip computed server-side → checkout lock on the ticket (one payment at a time)
→ resolveTerminalConfig → lease the terminal → Bolt connect(hsn) → authCard(hsn, amount, orderId = ticketId)
→ approved: payments row approved + ticket paid + events (one transaction); declined: nothing recorded as paid
→ thrown / timeout: payments row stays `processing` (PAYMENT_STATUS_UNKNOWN) — the POS shows
  "Payment status is being verified. Do not run the card again yet." and the display "Verifying Payment…"
→ release the lease; stamp last_seen_at / last_transaction_at
```

Status recovery: **Verify with processor** on the POS and the payment-attempt sweep ask `inquireByOrderId(ticketId)`
on the REST gateway (Bolt charges land on the same MID); the answer — not a guess — closes or releases the attempt.

## Status model (§12, §50)

`terminalOperationalStatus()` (packages/api-contracts/src/payment-terminals.ts):
`DISABLED` → `OFFLINE` (unpaired, or last ping failed) → `PROCESSING` / `BUSY` (live lease) → `ONLINE` (answered ≤ 15 min)
→ `DEGRADED` (answered, but longer ago) → `UNKNOWN` (never answered). The POS, the devices overview and Super Admin show
this and its sentence; raw Bolt words stay in the server log.

## Test connection (§166)

POS **Devices → Payment Terminals → Test connection** → `GET /pos/settings/payments-checkout/terminals/:id/test` →
`TerminalProbePort` (apps/api, @Global) → `resolveTerminalConfig` → Bolt `connect` + `ping(hsn)`. No charge, no display
message; the outcome is recorded on the registry row (`last_ping_*`, `last_seen_at` on success) and audited. Without a
probe (unit harness) the answer is the honest "readiness not probed", never "responding".

## Clover Ecommerce adapter notes

`voidTransaction` maps to a FULL refund (the Ecommerce API has no separate void for a captured charge) — documented in
the adapter; amounts are integer cents; the private token is the sealed `api_password_enc`. Live verification needs a
Clover account (BLOCKED_EXTERNAL); request shaping is unit-tested (`clover.client.vitest.spec.ts`).
