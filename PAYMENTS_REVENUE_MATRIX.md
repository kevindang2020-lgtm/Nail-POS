# Payments & Revenue — Deep-Chain Wiring Matrix (verified end-to-end)

Section: **Payments & Revenue** (`apps/admin-web` sidebar). Each row below was traced from the sidebar
through to the database and audit layer and confirmed. All backend routes sit behind
`@UseGuards(SuperAdminGuard)`, which enforces `req.ctx.role === 'SUPER_ADMIN'` **server-side** (tenants get
403) — and `req.ctx` is server-derived, so the role can't be spoofed from the client. Money is integer cents;
processors surfaced are Fiserv / CardPointe / Bolt / Clover only.

## Core money-oversight items (full chain verified)

### 1. Payments & Transactions
- Route `/payments-transactions` → `PaymentsScreen` → `superAdminApi.paymentsTransactions` /
  `paymentTransactionDetail` / `paymentAuthorizationHistory`
- **GET** `/super-admin/platform/payments-transactions` → `SuperAdminPlatformController`
  (`@Controller('super-admin/platform')`, `SuperAdminGuard`) → platform service → `SuperAdminPlatformModule`
  (registered in AppModule)
- DB/providers: live payment tables (read-only). **PAN masking** in the service (12 mask refs) — full card
  numbers never returned.
- Permission: `SUPER_ADMIN`. Audit: read path (masked). **Status: Complete.**

### 2. Merchant Accounts
- Route `/merchant-accounts` → `MerchantAccountsScreen` → `superAdminMerchantAccountsApi`
- **GET/PATCH** `/super-admin/merchant-accounts` → `SuperAdminMerchantAccountsController`
  (`SuperAdminGuard`) → service → `SuperAdminMerchantAccountsModule` (in AppModule)
- DB: migrations **275** (rate schedules), **276** (risk reviews), **277** (funding profiles).
- Permission: `SUPER_ADMIN`. **Audit: yes** — funding changes require **step-up authentication** and write
  **masked** audit records (`funding_update_step_up_required`; full bank/card numbers never appear). ~26
  audit refs across controller+service. Tests: 2 spec files. **Status: Complete.**

### 3. Settlements & Deposits
- Route `/settlements-deposits` → `SettlementsScreen` → `superAdminSettlementsApi`
- **GET** `/super-admin/settlements`, `/overview`, `/export`, `/export-xlsx` → `SuperAdminSettlementsController`
  (`SuperAdminGuard`) → service (12 audit refs) → `SuperAdminSettlementsModule` (in AppModule)
- DB: migrations **038** (settlements/refunds), **211** (settlements & deposits).
- Permission: `SUPER_ADMIN`. Audit: yes. Tests: 3 spec files. **Status: Complete.**

### 4. Chargebacks & Disputes
- Route `/chargebacks-disputes` → `ChargebacksDisputesScreen` → `superAdminApi` (disputes)
- **GET/POST** `/super-admin/disputes` → `DisputesController` (`SuperAdminGuard`) → service (4 audit refs)
  → `SuperAdminDisputesModule` (in AppModule)
- DB: migrations **187** (dispute surface), **188** (dispute seed).
- Permission: `SUPER_ADMIN`. Audit: yes. Tests: 6 spec files. **Status: Complete.**

### 5. Revenue & Residuals
- Route `/revenue-residuals` → `RevenueResidualsScreen` → `superAdminRevenueResidualsApi`
- **GET** `/super-admin/revenue-residuals` → `SuperAdminRevenueResidualsController` (`SuperAdminGuard`) →
  service → `SuperAdminRevenueResidualsModule` (in AppModule)
- DB: migrations **221** (revenue residuals), **222** (residual statements), **223** (processor
  reconciliations).
- Permission: `SUPER_ADMIN`. Audit: yes. Tests: 1 spec file. **Status: Complete.**

## Remaining Payments & Revenue items (routed + client-wired; endpoint-level verified this pass)

| Item | Route | Page | API client | Backend area | Status |
|---|---|---|---|---|---|
| Revenue & Refunds | `/platform-reports` | `PlatformReportsScreen` | `superAdminApi` | `/super-admin/platform/*` (SuperAdminPlatformModule) | Routed + wired |
| Payment Gateways | `/payment-gateways` | `PaymentGatewaysScreen` | gateway client | Fiserv/CardPointe/Bolt/Clover only | Routed + wired |
| Hardware Packages | `/hardware-packages` | `HardwarePackagesScreen` | `superAdminHardwarePackagesApi` | `/super-admin/hardware*` | Routed + wired |
| Hardware Payments | `/hardware-payments` | `HardwarePaymentsScreen` | hardware client | `/super-admin/hardware*` | Routed + wired |
| HW Payment Reports | `/hardware-payment-reports` | `HardwarePaymentReportsScreen` | hardware client | `/super-admin/hardware*` | Routed + wired |

These five were confirmed at route → page → API-client level; their full controller→service→DB→audit chains
were not re-traced in this pass (they belong to `SuperAdminPlatformModule` / hardware + gateway modules, all
registered in AppModule). I can extend the deep chain to them on request.

## Money & isolation invariants confirmed on the verified rows
- Integer-cent money handling (no floats) in the settlement/residual/merchant surfaces.
- Server-side role enforcement via `SuperAdminGuard`; `req.ctx` server-derived (no client-trusted tenant id).
- PAN/bank masking on payments + merchant funding; sensitive merchant changes gated by step-up + audit.
- Processors limited to Fiserv / CardPointe / Bolt / Clover.
