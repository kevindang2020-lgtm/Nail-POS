# API_MAP (backend)

_Measured this pass._

- **834 HTTP routes** across **90 controllers** in **70 Nest modules** (`apps/api/src`).
- Major module groups: auth/identity/MFA · tenants/branches · checkout (POS payments) · payments (Fiserv CardPointe/Bolt + Clover clients, webhooks) · booking · check-in · tech-queue · customer-queue · serving · service-done · customers · team · services · pricing/tax · wallet (gift-card/loyalty ledger) · hardware-payment · owner (multi-salon) · super-admin-* (overview, health, billing, applications, website-leads, hardware-packages, usage-limits, audit) · ai (gateway, packages, overage, subscription billing, cost tracking) · realtime (SSE) · customer-display.
- Request flow: `TenantContextMiddleware` → permission guard → controller → service (business logic) → Kysely repository (`scoped()` RLS). Business rules live in services, not controllers/frontends.
- Reference: root `OVERVIEW_API_MAP.md`, `SUPER_ADMIN_*_API_REPORT.md`, `PAYMENT_GATEWAY_WIRING_AUDIT.md`, `FRONTEND_BACKEND_CONNECTION_MAP.md`.
