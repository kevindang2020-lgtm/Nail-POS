# Payment Gateways — Wiring Audit (every link, honest status)

| Link | Wired? | How |
|---|---|---|
| Frontend → Backend | ✅ | Screen calls `superAdminApi.paymentGatewaysState()` / `paymentGatewaysExport()` → `GET /super-admin/platform/payment-gateways/state` and `/export`. Configure uses `getGateway`/`setGateway`/`testGateway`. |
| Backend → Database | ✅ | `paymentGatewaysState()` repo JOINs `tenants`, `tenant_payment_config`, `users`, `branches`, `payment_settlements`, `pos_payment_terminals`, `payments`, `payment_gateway_events`. |
| Super Admin guard | ✅ | All routes under `@UseGuards(SuperAdminGuard)`. Tenant users cannot reach them. |
| Tenant payment settings | ✅ | The Configure drawer reads/writes the same per-tenant `tenant_payment_config` via `PaymentGatewayResolver` (masked; encrypted). |
| Tenant POS checkout | ✅ (pre-existing) | `GET /pos/payment-gateway` returns the authenticated tenant's own masked gateway; checkout disables card pay + shows a reason when unconfigured. Not re-implemented here. |
| Customer app / display / skip-line checkout | ✅ (pre-existing) | All resolve the tenant/branch gateway through the same `PaymentGatewayResolver` from the ticket/invoice context — never a frontend-supplied tenantId. |
| Hardware payment recovery | ✅ (data path) | Monthly card volume (`payment_settlements.gross_cents` / `hardware_payment_invoices.card_volume_cents`) feeds the Monthly Processed Volume KPI and Top Processors; the hardware-payment module already consumes card volume for revenue split/shortfall. |
| Reports | ✅ | KPI drill-downs + Actions deep-link to `/platform-reports` and `/subscriptions`. |
| Audit logs | ✅ (pre-existing) | Gateway config changes via `setGateway` are audited by the per-tenant controller; the row Action menu links to `/audit-logs?tenantId=`. |
| System health | ✅ | Gateway-issue counts surface in the platform reports/overview that the System Health + Tenants screens already read; the "Gateway Issues" KPI mirrors `gatewayStatus = error`. |
| Chargebacks | ✅ | `chargebacks` table (migration 096) + idempotent webhook ingestion (tenant-resolved, signature-verified, same path as refunds/settlements). KPI counts open/unresolved per tenant; degrades to "not tracked yet" only if unmigrated. |
| Dedicated pause/resume/disable endpoints | ✅ | `POST /super-admin/tenants/:id/payment-gateway/{pause,resume,disable}` — audited, guarded transitions over the resolver status update; pause→`paused` (On Hold), disable→`disabled`, resume→`active`. |
