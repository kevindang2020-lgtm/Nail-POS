# Tenant Dashboard — API Map
- `GET /pos/dashboard/state` · `pos.dashboard.view` — rich aggregate consumed by the screen.
- Slice endpoints (same permission): `/kpis /operations /appointments /queue /serving /checkout
  /revenue-trend /top-services /top-technicians /payment-mix /customers /insights /alerts`.
- Inventory Alerts module reuses `GET /tenant/inventory/alerts` · `inventory.view`.
- AI Insights are gated client-side by active AI package (access.aiPackages) and server-side by the AI module.
All endpoints derive tenant+branch from the session (never the client) and forbid CUSTOMER/SUPER_ADMIN roles.
