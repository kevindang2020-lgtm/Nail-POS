# Super Admin → Payment Gateways — Code Audit (do this before building)

Per the task's first rule ("check all my code first… do not duplicate"). The upload (`files__4_.zip`) is the **design**
(`payment-gateways-screen.html` + `.png`), not code. Below is what already exists in the repo and the keep/merge/fix/replace
call for each. **Headline: the security-critical backend and the secure Configure drawer already exist and are correct.**
This is a *frontend command-center build + backend aggregation*, NOT a from-scratch rebuild — and definitely not a new module.

## The most important finding
The spec's hardest, most dangerous-to-get-wrong requirements (§10/§11/§14) are **already implemented and correct**:
- Per-tenant gateway credentials are **encrypted at rest** and only a **masked** view is ever returned.
- The Configure form is **write-only** (credential inputs are never pre-filled and are cleared after save).
- **Tenant isolation** is enforced server-side via a shared `PaymentGatewayResolver` (frontend tenantId is never trusted).
- **POS checkout already reads its own tenant gateway** (`GET /pos/payment-gateway`, masked).
Re-implementing these from the spec would duplicate working code and risk a security regression. They are **KEEP**.

## Existing code inventory

| Path | What it does | Layer | Call | Dup? | Mock? | Connected? | Sec risk | Missing vs design |
|---|---|---|---|---|---|---|---|---|
| `apps/admin-web/src/screens/PaymentGatewaysScreen.tsx` | The Payment Gateways page (routed at `/payment-gateways`). 4 KPIs (Active/Needs Setup/Errors/Terminals), status tabs, one masked row per tenant, Configure → tenant drawer. | FE | **MERGE/FIX** | no | no | yes (`paymentGateways()`) | no | The whole command center: 8 KPIs, search+filters, rich table (Owner, City/State, Settlement, Monthly Volume, Last Sync, Actions), selected-gateway detail panel, analytics (status donut, top processors, recent events, recent activity), Export/Refresh. |
| `apps/admin-web/src/components/PaymentGatewayPanel.tsx` | **The secure Configure drawer.** Masked view; write-only Merchant ID / API username / API password / Webhook secret (cleared after save); processor/env/status; Base URL; Test connection; "secrets encrypted at rest, only masked returned." | FE | **KEEP (reuse as ConfigureGatewayDrawer)** | no | no | yes | no | Already satisfies §10/§11. Only needs to be openable from the new table/detail/Configure button (today it lives on the tenant screen). |
| `apps/admin-web/src/api/superAdminApi.ts` | `getGateway`/`setGateway`/`testGateway` (per-tenant secure config) + `paymentGateways()` (list). | FE | **MERGE** | no | no | yes | no | Add the new aggregation/analytics calls (`…/state`, status-breakdown, top-processors, recent-events, recent-activity) + Export. |
| `apps/api/src/super-admin-platform/super-admin-platform.controller.ts` → `GET /super-admin/platform/payment-gateways` | List endpoint. | BE | **MERGE/EXTEND** | no | no | yes | no | Thin row. Add KPIs + per-row Owner, City/State, Settlement Status, Monthly Volume; add analytics + a single `…/state`. Extend this controller — do **not** create a parallel `/super-admin/payment-gateways` module. |
| `super-admin-platform.repository.ts` → `paymentGateways()` | Joins `tenants` + `tenant_payment_config` + paired-terminal counts + last-payment; **masks MID** (`••••last4`), maps `gatewayStatus`, `boltConfigured`. | BE/DB | **KEEP/EXTEND** | no | no | yes | **no — masking verified correct** | Join `users` (owner), `branches` (city/state), `payment_settlements` (settlement status/failed), card volume (monthly), `payment_gateway_events` (activity). |
| `apps/api/src/super-admin-tenants/super-admin-tenants.controller.ts` → `GET/POST/PATCH /super-admin/tenants/:id/payment-gateway` + `/test-connection` | The secure per-tenant config CRUD + test. | BE | **KEEP** | no | no | yes | no (masked, encrypted) | This is the §12 config API. Reuse as-is. |
| `apps/api/src/payments/payment-gateway.resolver.ts` | Central resolver: tenant/branch isolation, encryption, masking, upsert, test. Used by Super Admin + POS. | BE | **KEEP** | no | no | yes | no | The §13/§14 core. Reuse. |
| `apps/api/src/checkout/pos-payment-gateway.controller.ts` → `GET /pos/payment-gateway` | Tenant POS reads its **own** masked gateway (§15 wiring). | BE | **KEEP** | no | no | yes | no | Already wired. POS checkout disables card + shows reason when unconfigured (verify message text). |
| `apps/api/src/customer-display/terminal-capture.service.ts` | Terminal capture (Fiserv) used by the kiosk path. | BE | **KEEP** | no | no | yes | no | Terminals already modeled (`pos_payment_terminals`). |

## Database — tables already exist (use them; do NOT add duplicates)
| Migration | Table(s) | Use |
|---|---|---|
| (config) | `tenant_payment_config` | The gateway per tenant (processor, merchant_id, environment, status, bolt_base_url). **Note:** real table is `tenant_payment_config`, the spec's name `tenant_payment_gateways` is a synonym — keep the existing one. |
| `036_tenant_payment_gateway_credentials.sql` | `tenant_payment_gateway_credentials` | Encrypted credential refs + `*_configured` flags. |
| `037_payment_gateway_events.sql` | `payment_gateway_events` (`event_type`) | Recent Events / Recent Activity feeds. |
| `038_payment_settlements_refunds.sql` | `payment_settlements` (`status`), `payment_refunds` | Settlement Status column + Failed Settlements KPI + settlement summary. |
| `039_payment_processor_types.sql` | `payment_processor_types` | Processor filter + Connected Processors KPI + Top Processors. |
| `017_checkout_payments.sql` | `payments` | Monthly Processed Volume (aggregate) + last sync. |
| `078_hardware_payment.sql` | `hardware_payment_invoices.card_volume_cents` | Monthly card volume → Hardware Payment Recovery (§16). |
| (pos) | `pos_payment_terminals` | Paired terminals + View Terminals. |
| (core) | `tenants`, `branches`, `users`, `audit_logs` | Owner, City/State, audit. |

**No new tables are needed** for the design. One possible gap: **chargebacks** have no dedicated table — the "Chargeback Alerts" KPI/feed is an **honest blocker** (will read 0 / "not tracked yet" until a `chargebacks` source exists or it's derived from gateway events). Documented, not faked.

## Gap = what actually needs building
1. **Backend (extend `super-admin-platform`)**: enrich the list row (Owner, City/State, Settlement Status, Monthly Volume, Last Sync); add `GET /super-admin/platform/payment-gateways/state` returning `{ kpis, gateways, pagination, analytics{statusBreakdown, topProcessors, recentEvents, recentActivity}, permissions }`; server-side search/filter/paginate; Export (CSV). All from existing tables. Chargebacks = honest 0/blocker.
2. **Frontend (rebuild `PaymentGatewaysScreen` to the design, same cream/gold tokens)**: 8 KPI cards (drill-down), search + 5 filters (URL-synced, debounced), the rich table with the design's columns + Actions menu, the selected-gateway detail panel, the four analytics modules, Export/Refresh/Configure. **Reuse `PaymentGatewayPanel` as the Configure drawer** (do not rebuild the credential form).
3. **Wiring already done (verify only)**: encryption, masking, tenant isolation, POS-uses-own-gateway, audit on config changes.

## Build order (subsequent steps)
1. Backend aggregation + analytics + `…/state` (+ harness tests for the pure shaping). 2. Frontend command center wired to `…/state`, reusing the secure drawer. 3. Tests (FE: load/filters/drawer-not-prefilled/masked-only; BE: shaping + masking + tenant-isolation). 4. The §24 reports (BUILD/WIRING/API/SECURITY/TEST/BLOCKERS).

## Honest blockers (so far)
- **Chargebacks**: no source table → KPI/feed shows 0 / "not tracked yet" (not fabricated).
- **Some design KPIs are seed numbers** (2,418 etc.): real values will reflect actual tenants (far smaller in the pilot) — the design figures are dev/seed only, as the task states.
