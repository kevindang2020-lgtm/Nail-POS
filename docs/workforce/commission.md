# Commission, tips & earnings as the Technician Profile sees them (mandate §28–§34, §122–§127)

The ONE engine is `modules/workforce/src/compensation` + `payroll` (owned by the payroll / Fair Turn wave; see
[docs/payroll/architecture.md](../payroll/architecture.md)). The Technician Profile does not compute pay — it reads what the
engine stored and gates who may read it.

**Rule precedence (§28, `compensation-policy.ts` LEVELS):** 1 Ticket override (approved) → 2 Technician + Service → 3 Technician +
Category → 4 Technician default → 5 Branch + Service → 6 Branch default → 7 Salon default; ties → latest effectiveStart, then
highest version. With no authored rule: the service's own rate → `tenants.default_commission_percent` (never a literal 40/60).

**Basis (§29, `commission-basis.ts`):** commissionable base = line total − line discount, 0 for a removed line; before tax,
before tip. Retail product commission is a separate rule type (§31). **Snapshot (§30):** every paid line stamps
`ticket_compensation_snapshots` (original/eligible revenue, rate, type, technician share, salon share, `policy_id` = the rule used,
provenance label) — historical payroll is never recomputed from today's settings (§149). **Refund (§125):** reversal lines with
idempotency (588); after a period lock, an adjustment in the next open period (589/612).

**Tips (§32–§33):** separate ledger, single-technician or allocated across helpers (587 line allocations), manual allocation with
`tips.adjust`; history per ticket on POS Team → Tips and the tech app Tips.

**Who sees what (§26, §72, §122):** the technician sees ONLY her own earnings (`/tech/earnings/canonical`, periods today / week / pay
period / month / custom). Managers/owners read a technician's rate, history and payroll summary only with `technicians.view_pay`
(front desk never); rate changes need `pos.technicians.commission.edit` + the commission admin code. The POS Technician Profile page
hides the Commission · Tips · Earnings section and the today-revenue/tips cards without `view_pay`.
