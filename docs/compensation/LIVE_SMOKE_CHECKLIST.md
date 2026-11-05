> Moved here from apps/api/src/compensation/ (Constitution 13 Phase 12). The compensation code itself now lives in modules/workforce/src/compensation/; paths below are as they were when this was written.

# Compensation — Live Postgres Smoke Checklist (run in your repo)

The pure engine/policy/supply/guarantee/tips/snapshot logic is verified by tsc + DB-free + mocked tests. The DB-touching
pieces below are verified ONLY by tsc + mocked ports in the sandbox and REQUIRE a live Postgres 16 run before you rely on
them. The checkout hook is best-effort and non-throwing, so a failure here degrades to "no snapshot", never a broken payment.

## 1. Apply the new migration
    npm run db:up && npm run db:setup        # applies 157_ticket_compensation_snapshots (plus 153–156 from the tech merge)
Confirm: `\d ticket_compensation_snapshots` shows the table + the UNIQUE (tenant_id, ticket_id, service_line_id, technician_id).

## 2. Snapshot writes on a real checkout
- Ring up a ticket with ≥1 service line that has a technician + commission snapshot, take any payment (cash/card/gift/split).
- Expect one row per (service line, technician) in `ticket_compensation_snapshots`, and per-tech rows in
  `ticket_tip_allocations` when a tip was left.
- Verify reconciliation in SQL: Σ tech_service_earnings_cents + Σ salon_service_share_cents == Σ commissionable_cents
  for the ticket; Σ tip rows == ticket tip.

## 3. Idempotency / immutability
- Re-run (or retry) the same paid ticket → NO duplicate snapshot rows (ON CONFLICT DO NOTHING).
- Confirm a later rule change does not alter existing snapshot rows (they are write-once).

## 4. Safety property under failure
- Temporarily point the snapshot table at a bad name (or revoke insert) → payments still succeed and flip to 'paid';
  only the snapshot is skipped (check logs). Restore.

## 5. Known limitation to validate against your data
- Ticket tip is currently attributed to the CARD rail (the ticket stores a single tip_cents). If you need true card/cash
  split, wire a per-payment-method tip source into `loadTicketMeta`; the engine + snapshot already support it.

## 6. Migration 158 (payroll breakdown columns)
    npm run db:up && npm run db:setup        # adds retail_commission_cents, card_tip_cents, cash_tip_cents, guarantee_topup_cents to payroll_lines
Confirm existing payroll_lines still read (columns default to 0) and a derived line's payable == service + retail + topup + tips + adjustments.

## 7. Migration 159 (adjustment ledger)
    npm run db:up && npm run db:setup        # creates compensation_adjustments
Smoke: refund a paid ticket → negative entries appear (snapshot rows UNCHANGED); chargeback → status 'pending_review';
refund after a paid payroll period → targets_future_period=true + status 'pending'; a $250+ manual adjustment without an
approver is rejected.

## 8. Migration 160 (guarantee policies) + payroll auto-build
    npm run db:up && npm run db:setup        # creates technician_guarantee_policies
Smoke: insert a tech-specific + a tenant-default guarantee policy → the tech-specific wins for that tech; auto-build a
period → each line's payable == snapshot earnings + guarantee top-up + net approved adjustments, and reconciles.

## 9. Payroll build-from-sales endpoint (end to end)
After 157–160 are live and a few tickets are paid:
    POST /payroll/periods            # create a draft period spanning those sales
    POST /payroll/periods/:id/build-from-sales
Verify: one line per technician with sales; each line's commission_cents == the snapshot's tech service earnings (NOT
gross×value); guarantee_topup_cents and the card/cash tip + retail breakdown columns populated; period totals roll up;
re-running is idempotent (onConflict update); the endpoint refuses once the period is finalized/paid.
