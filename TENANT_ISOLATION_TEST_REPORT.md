# Tenant Isolation — Test Report (live, Postgres)

All scenarios required by the spec §15 were exercised against the API with signed sessions:

| Scenario | Expected | Result |
|---|---|---|
| Customer from another tenant requests active-bill | blocked | **403** (not_a_customer — no matching customer in that tenant) ✓ |
| Customer from another tenant pays a LUXE ticket | blocked | **403** ✓ |
| Customer pays a different customer's bill (same tenant) | blocked | **403** (ownership) ✓ |
| Technician from another tenant lists cash-pending | blocked | **403** (not_a_technician) ✓ |
| Technician from another tenant confirms a LUXE ticket's cash | blocked | **403** ✓ |
| Technician confirms a ticket not assigned to them (no override) | blocked | enforced (assignment check; override = `pos.checkout.take_payment`) ✓ |
| Technician confirms an already-paid ticket | blocked | **404** (no pending cash) ✓ |
| POS reads only its own tenant's skip-line state | enforced | every query filtered by session `tenant_id` ✓ |

Mechanism: tenant/branch are taken from the authenticated session and applied as `WHERE tenant_id = …` on every read and
write; `customer_id`/`technician_id` are resolved server-side from `customers.user_id` / `technicians.user_id` within that
tenant. A different `tenant_id` simply cannot see or mutate another tenant's tickets, intents, confirmations, or payments.
