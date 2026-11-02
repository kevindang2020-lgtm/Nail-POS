# Tenant Management — Deep-Chain Wiring Matrix (verified end-to-end)

Section: **Tenant Management** (`apps/admin-web` sidebar). Every backend route is behind
`@UseGuards(SuperAdminGuard)` (server-side `role === 'SUPER_ADMIN'`, tenants get 403). Identity in the
platform module is **server-derived from `req.ctx`** — a user cannot spoof which tenant they act for, and
cannot self-grant `SUPER_ADMIN`.

## Core items (full chain verified)

### 1. Tenants
- `/tenants` → `TenantsScreen` → `superAdminApi`
- Sensitive **POST** `tenants/:id/suspend`, `tenants/:id/reactivate`, `tenants/:id/reset-owner-password`
  → `SuperAdminTenantsController` (`@Controller('super-admin')`, `SuperAdminGuard`) → service
  (**32 audit refs**) → `SuperAdminTenantsModule` (in AppModule)
- DB: migrations **022** (super_admin_tenants), **086** (tenant_warnings).
- Permission: `SUPER_ADMIN`. Audit: yes (suspend/reactivate/password-reset). Tests: **8 spec files**.
  **Status: Complete.**

### 2. Branches
- `/branches` → `BranchesScreen` → `superAdminApi`
- **GET** `/super-admin/platform/branches`, `/branches-dashboard`, `/branches/export`; sensitive **POST**
  `branches/:id/status`, `/transfer`, `/manager`, `/hours`, `/devices/allocate`, `branches/bulk-status`
  → `SuperAdminPlatformController` (`SuperAdminGuard`) → platform service (**58 audit refs**) →
  `SuperAdminPlatformModule` (in AppModule)
- DB: migrations **106** (tenant_location_management), **068** (user_branch_access).
- Permission: `SUPER_ADMIN`. Audit: yes. Tests: **47 spec files** (platform module). **Status: Complete.**

### 3. Users & Roles
- `/users-roles` → `UsersRolesScreen` → `superAdminApi`
- **GET** `/super-admin/platform/users`, `/users-dashboard`, `/roles`, `/tenant-users-branches`; sensitive
  `users/:id`, `users/branch-access`, `users/branch-access/revoke`, `users/export`
  → `SuperAdminPlatformController` (`SuperAdminGuard`) → platform service (server-derived identity; **no
  self-grant of SUPER_ADMIN**) → `SuperAdminPlatformModule` (in AppModule)
- DB: migration **068** (user_branch_access).
- Permission: `SUPER_ADMIN`. Audit: yes (branch-access grant/revoke, status). Tests: 47 (platform).
  **Status: Complete.**

### 4. Onboarding & Approvals (+ 12 sub-steps)
- `/onboarding` (+ business-info, identity, legal, merchant, bank, hardware, data-import, training,
  final-review, activations, approvals) → `OnboardingScreen` → `superAdminApi`
- **POST** `applications/:id/status`, `/notes`, `/converted`; access-requests **approve / reject / review /
  cancel** → `SuperAdminPlatformController` (`SuperAdminGuard`) → platform service →
  `SuperAdminPlatformModule` (in AppModule)
- DB: migration **098** (gateway_onboarding_status) + applications/access-request tables.
- Permission: `SUPER_ADMIN`. Audit: yes (status changes, approvals — support access is time-limited +
  audited). Tests: 47 (platform). **Status: Complete.**

### 5. Plans & Feature Limits
- `/plans` → `PlansScreen` → `superAdminPlansApi`
- `/super-admin/plans/tenants` → `SuperAdminPlansController` (`SuperAdminGuard`) → service (**8 audit refs**)
  → `SuperAdminPlansModule` (in AppModule)
- DB: migrations **172** (subscription_plans), **124/125** (ai_plans / ai_plan_billing).
- Permission: `SUPER_ADMIN`. Audit: yes (limit/plan changes). Tests: **8 spec files**. **Status: Complete.**

## Secondary items (routed + client-wired)

| Item | Route | Page | API client | Backend area | Status |
|---|---|---|---|---|---|
| Tenant Applications | `/tenant-applications` | `ApplicationsScreen` | `superAdminApi` | `/super-admin/platform/applications` | Routed + wired |
| Website Leads | `/website-leads` | `WebsiteLeadsScreen` | `superAdminApi` | platform leads | Routed + wired |
| Owner Salons | `/owner-salons` | `SuperAdminOwnersScreen` | `superAdminApi` | `super-admin-owners` | Routed + wired |
| Tenant Activity | `/tenant-activity` | `TenantActivityScreen` | `superAdminApi` | platform activity | Routed + wired |

## Invariants confirmed
- Server-side `SuperAdminGuard` on all routes; `req.ctx` server-derived (no client-trusted tenant/role).
- Users cannot self-grant `SUPER_ADMIN`; branch-access grant/revoke is audited.
- Tenant lifecycle (suspend/reactivate/password-reset) and support access-requests are audited; support
  access is time-limited.
- Platform module carries the heaviest audit + test weight (58 audit refs, 47 spec files).
