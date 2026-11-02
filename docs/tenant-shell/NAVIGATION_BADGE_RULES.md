# Navigation Badge Rules

Endpoint: `GET /tenant/navigation/badges` — `TenantNavigationService.badges(ctx)`.
Every count is tenant + branch scoped, derived from canonical tables, fail-soft to 0 (a missing table never breaks the sidebar). No hardcoded demo numbers.

| Key | Definition | Source |
|---|---|---|
| `checkIn` | Queue items waiting or called | `pos_queue_items` |
| `customerQueue` | Queue items waiting | `pos_queue_items` |
| `techQueue` | Tech tickets not completed/cancelled/removed | `pos_tech_queue_tickets` |
| `serviceDone` | Service lines sent to Service Done | `ticket_service_lines` |
| `checkout` | Unpaid, non-cancelled tickets | `tickets` |
| `inventoryAlerts` | Products at/below reorder level (location) | `inventory_location_stock` ⋈ `inventory_products` |
| `techReportsPending` | Technician inventory reports `status='pending'` | `inventory_technician_reports` |
| `notifications` | `inventoryAlerts` + `techReportsPending` (tenant-safe operational signals) | derived |
| `messages` | Unread staff messages — **0** until staff Communications inbox exists (not fabricated) | pending |
| `reviews`, `payrollPending`, `billingAlerts`, `aiUsageAlerts`, `supportTickets` | 0 until their canonical sources exist | pending |

Security: `notifications` deliberately does NOT read the super-admin `alerts` table (platform-side) — tenant staff must not see platform internals (spec §20/§22).
