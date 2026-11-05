# API & EVENT MAP — AI PowerSalon (Phase 0)

## Shared backend services (reuse; UI must call these, not embed business rules)
Existing equivalents present in `apps/api/src` (73 services across 68 modules): TenantContext (middleware + `scoped()`), auth/RBAC guards, Availability/Appointment (booking), CheckIn, Queue, TechQueue, Serving (TicketService), Checkout, Payment + PaymentRefund + Settlement + gateway (Fiserv CardPointe/Bolt + Clover), Customer, Technician, ServiceCatalog, Inventory, Wallet/Loyalty/GiftCard, Reports/Owner, AI + AI-billing, follow-up engine, cash drawer, support-access, hardware billing, customer-display, go-check-in.

To ADD (thin services over new tables, same conventions): Campaign, Promotion/Offer, Communication (threads/messages), Reminder (generalize follow-ups), Automation, Integration/Webhook-registry, Commission/Payroll, Supplier/PurchaseOrder, unified Audit, unified Device fleet, platform Analytics aggregator (SA cross-tenant, separate routes + audit).

## Realtime / events (reuse existing transport)
- Transport: SSE controllers (`customer-realtime`, `tech-realtime`) + `push`/`realtime` namespaces; ~330 emit points already exist (check-in, queue, booking, serving, settings buses per prior work).
- Channels to standardize: `tenant:{tenantId}`, `tenant:{tenantId}:branch:{branchId}`, `super-admin:platform`.
- Events already emitted around appointment/queue/ticket/payment lifecycle. ADD missing names from the master spec (campaign.redeemed, message.sent/failed, reminder.sent, automation.executed/failed, device.offline/recovered, integration.failed, subscription.*, security.alert_created, audit.event_created). Consumers must stay idempotent (retries must not double-charge/point/message/commission/inventory).
- Do NOT add a second WebSocket/SSE transport; extend the existing one. Provide reconnect/backoff/missed-event recovery + polling fallback for critical screens.

## Conventions
- Tenant clients never pass arbitrary `tenantId`; tenant derived from session; branch membership validated; `scoped()` applied on every CRUD path.
- Super Admin cross-tenant access uses `/super-admin/*` + `super-admin.guard` + explicit audit + support-access controls. Tenant users may never reach SA endpoints.
- Webhooks: signature-verified + idempotent + deduped (PaymentGatewayEvents pattern is the reference).
