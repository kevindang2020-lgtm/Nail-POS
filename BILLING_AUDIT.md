# Billing (Salon-Billed Paths) — Security & Correctness Audit

Audit of the paths where the **salon (tenant) gets charged**, completing the money-path review. Two surfaces:
the Super-Admin billing dashboard, and the hardware-financing auto-charge (the one that actually moves money).

## Super-Admin billing dashboard — sound
`super-admin-billing` is a **read/roll-up** (MRR aggregation, subscription-status counts, plan distribution) plus a
subscription-status setter — it does **not** auto-charge cards, so there's no double-charge surface here.
- **Authorization:** the controller is `@UseGuards(SuperAdminGuard)` at the class level (covers the roll-up `GET` and the
  `PATCH :tenantId/subscription`), under the `super-admin/billing` prefix. The guard rejects anyone whose
  `req.ctx.role !== 'SUPER_ADMIN'` with a `ForbiddenException` — so a tenant owner cannot read all-tenant billing data or
  change subscriptions. ✅
- The roll-up intentionally spans all tenants (it's the platform operator's global view) — that's by design, gated by the guard.

## Hardware-financing auto-charge — **double-charge bug found & FIXED**
This path charges a salon's saved card for any monthly hardware-cost **shortfall**. Invoices are period-keyed
(`UNIQUE (hardware_payment_plan_id, billing_month)`), the charge is capped at the shortfall (`decideAutoCharge`), tokenized
only, and tenant-scoped — all good. But the run was **not idempotent**.

**Finding (critical):** `reconcile(tenant, plan, billingMonth, cardVolume)` re-created the month's invoice as
`status:'open', autoChargeAmountCents:0` (wiping a prior `'paid'`), and `decideAutoCharge` keys only off
shortfall/consent/method/plan-status — **not** whether the month was already charged. So re-running a month would charge
the card **again**. It's easily triggered: `reconcile` is exposed via the cron `run-monthly` **and** a super-admin
**"recalculate-month"** endpoint, so an admin recalculating an already-paid month (or a scheduler retry) **double-charges
the salon**. `chargeShortfallNow` had the same hole (charged on `shortfall>0` regardless of `paid`).

**Fix:** an idempotency guard — `reconcile` now returns the settled invoice unchanged when the month is already `'paid'`
(no re-charge, no re-ledger, no re-principal-reduction), and `chargeShortfallNow` refuses an already-paid invoice. Added a
re-run test: a second reconcile of the same month keeps the charge count at **one**, and a manual charge on a paid month
is rejected. hardware-payment tests 34/34; full API suite **447/447**.

## Noted, not changed (your call — flagged, not silently altered)
- **Retry of a *failed* (not paid) month** still re-posts reconciliation ledger entries and re-applies principal
  reduction. The catastrophic case (double-charging the card) is fixed; this residual affects **internal accounting**
  (loan balance / ledger), is correctable, and a correct fix needs per-month "already-applied" tracking — a more invasive
  change to critical billing code I didn't want to make unilaterally.
- **Concurrency:** the guard is select-then-act (not atomic). Two *simultaneous* reconciles of the same month are
  theoretically racy, but this is an admin/scheduler action (not customer-triggered), so it's near-impossible in practice;
  a per-(plan,month) advisory lock (like the wallet uses) would close it fully if you want belt-and-suspenders.

## Money-path review — complete
- Cash — void/correction gap fixed (`CASH_SECURITY_AUDIT.md`).
- Card + PCI — concurrent-idempotency id + recursive-scrub fixes (`PAYMENT_PATH_AUDIT.md`).
- Wallet — clean (`WALLET_LEDGER_AUDIT.md`).
- Billing — **double-charge bug fixed** (this doc). The salon-billed path no longer double-charges on a re-run.
