# Runbook — PAYMENT_STATUS_UNKNOWN (a charge whose outcome did not come back)

**What it is**: the processor call threw or timed out AFTER the claim row was written. The `payments` row stays
`processing`; the POS says *"Payment status is being verified. Do not run the card again yet."*; the customer display
says *"Verifying Payment… Please wait."* Nothing is retried, nothing is voided, nothing is marked failed (§26).

**Resolution paths (all read the processor's own answer — never a guess)**
1. **Cashier**: POS → the ticket → **Verify with processor** (`verifyCardPayment` → `inquireByOrderId(ticketId)`):
   * processor shows an approval → the attempt is completed as paid (`how: 'verified'`), events emitted, receipt offered;
   * processor shows a decline / nothing → the claim is released; the cashier may take the card again;
   * processor unreachable / recording failed → still unknown; try again in a moment.
2. **Automatic**: the payment-attempt sweep (every tick, `runAsSingleOwner`, stranded after 15 min) runs the same code
   under the ticket's lock. "Charged at the processor but nothing recorded here" → `needs_review` + owner and Super
   Admin alert (no auto-void) — the salon decides (record it as paid through Verify, or refund at the processor).
3. **Support**: Super Admin → tenant → Payment Gateways → recent events / alerts; the processor portal (by order id =
   ticket id) is the evidence of record.

**Do not**: run the card again (double charge); void from the processor portal before checking whether AIPowerSalon
already recorded the sale; edit the payment row by hand (adjustments are their own records — §39).

**After a DB restore (§182)**: a charge made after the restore point may exist only at the processor — run the sweep and
reconciliation, do not replay checkout commands.
