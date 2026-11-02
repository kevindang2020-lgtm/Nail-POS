# Payment Security — Report

- **Backend-authoritative money.** Totals are recomputed server-side from `ticket_service_lines` + ticket
  discount/tax/tip on every read and at confirmation time. The frontend total is never trusted; the cash-confirmation
  amount is the recomputed balance (verified: charged $51.50 regardless of any client value).
- **Integer cents** end-to-end; no floats.
- **Tenant isolation** enforced on every query by `tenant_id` derived from the authenticated session (never from the
  client). Cross-tenant customer/technician access is rejected (403/404). See TENANT_ISOLATION_TEST_REPORT.md.
- **Assignment checks** — a technician can only confirm cash on a ticket assigned to them unless they hold
  `pos.checkout.take_payment` (manager override).
- **Idempotent terminal state** — a paid ticket cannot be re-confirmed; `payments` keeps its idempotency-key dedupe.
- **Gateway secrets** stay server-side. The cash path touches no card data. The **card/wallet charge** uses the per-tenant
  processor (`processorFromEnv()` → CardPointe) with **tokenization** (hosted-fields token, wallet token, or a saved
  method) — **no PAN/CVV is ever sent to or stored by us**. Apple/Google Pay only when the gateway supports them; the
  sandbox is clearly labeled (`PAYMENTS_SANDBOX`) and **never fakes an approval** when no processor is configured. The
  charge is **idempotency-keyed** so a retried confirm cannot double-charge; declines are recorded and leave the ticket open.
- **Audit** — every cash confirmation and cash-issue writes an `owner_audit_log` row (verified); cash issues also raise an
  `owner_alerts` row for the front desk.
