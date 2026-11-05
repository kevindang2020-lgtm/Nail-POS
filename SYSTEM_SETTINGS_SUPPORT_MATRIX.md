# System Settings & Support — Deep-Chain Wiring Matrix (verified end-to-end)

Sections: **System Settings** + **Support**. All routes behind `@UseGuards(SuperAdminGuard)`. Every module
below is registered in AppModule (`SuperAdminSettingsModule`, `SuperAdminBillingModule`,
`SuperAdminIntegrationsModule`, `SuperAdminDeviceManagementModule`, `SecurityModule`,
`AuditLogsOverviewModule`, `SuperAdminSupportModule`, `HealthModule`/`SystemHealthModule`,
`MaintenanceModule`, `LegalDocumentsModule`).

## 1. General Settings
- `/settings` → `GeneralSettingsScreen` → `superAdminApi`
- `/super-admin/settings/general` (+ `/maintenance`, `/legal-documents`) → `SuperAdminSettingsController` /
  `MaintenanceController` / `LegalDocumentsController` (`SuperAdminGuard`); sensitive **POST** `reset`,
  maintenance `disable` → services (settings 4 + maintenance 6 + legal 4 audit refs).
- Permission `SUPER_ADMIN`. Tests: 2+2+2. **Status: Complete.**

## 2. Billing & Subscriptions  (what tenants pay AIPowerSalon — kept separate from salon payments)
- `/subscriptions` → `BillingScreen` → `superAdminBillingApi`
- `/super-admin/billing/*` → `SuperAdminBillingController` (`SuperAdminGuard`) → service →
  `SuperAdminBillingModule` (in AppModule)
- DB: migrations **172/176/180** (plans/versions/changes), **195/196/197** (billing subscriptions, payment
  attempts, lifecycle). Money in integer cents.
- Permission `SUPER_ADMIN`. Tests: **8 spec files**. **Status: Complete.**

## 3. Integrations  (credentials)
- `/integrations` → `IntegrationsScreen` → `superAdminIntegrationsApi`
- Sensitive **POST** `connections/:id/credentials`, `connections/:id/credentials/rotate`,
  `connections/:id/lifecycle-disable` → `SuperAdminIntegrationsController` (`SuperAdminGuard`) → service
  (**10 audit refs**) → `SuperAdminIntegrationsModule` (in AppModule)
- Providers: Fiserv, Twilio, Retell AI, email/accounting/payroll — credentials stored + rotated server-side.
- Permission `SUPER_ADMIN`. Audit: yes (credential set/rotate/disable). Tests: **7 spec files**.
  **Status: Complete.**

## 4. Device Management  (FIXED this pass — was serving in-memory seed data)
- `/devices-management` → `DevicesScreen` → `superAdminApi.deviceMgmtOverview`
- `/super-admin/device-management` (`overview` / `devices` / `devices/:id`) → `DeviceManagementController`
  (`SuperAdminGuard`) → `DeviceManagementService` → `SuperAdminDeviceManagementModule` (in AppModule)
- **Gap found:** the module wired `InMemoryDeviceMgmtRepo`, which seeds fixture devices "so the page renders
  without a database" — i.e. the Super Admin device oversight showed **fabricated seed data**, violating the
  project's real-data / honest-verification rule, even though migration **246** (device_catalog,
  device_shipments, device_maintenance, device_security_alerts) and the real inventory sources
  (customer_display_devices, go_checkin_devices, pos_payment_terminals) already exist.
- **Fix applied:** added `KyselyDeviceMgmtRepo` (raw-`sql`, matching the merchant/settlements repo pattern)
  that reads the real inventory + migration-246 tables; the module now uses it in production and keeps
  `InMemoryDeviceMgmtRepo` only when no DB is configured (dev/tests). Unmodeled per-device attributes
  (serial/OS/app-version/security/update status) are returned **null** → render as "Unknown"/"—", never
  fabricated. Repo degrades to empty/zero on any DB error (never crashes the page).
- Permission `SUPER_ADMIN`. Tests: **13 unit** (10 existing + 3 degradation) **+ 4 integration** (real
  Postgres 16 — self-provisioning, skips without a DB so the normal suite is unaffected); API tsc 0.
  **Status: Fixed & integration-verified.** Confirmed live: all 3 inventory sources join correctly (incl. the
  TEXT-id payment terminal → UUID branch/tenant cast), revoked devices count as locked/revoked, tenant scope
  isolates, and unmodeled fields return null (never fabricated).

## 5. Security & Compliance
- `/security-compliance` → `SecurityScreen` → `superAdminApi`
- Multiple controllers under `SecurityModule` (`SuperAdminGuard`): `security/privileged-access` (**`:id/revoke`**),
  `security/incidents`, `security/ip-blocks`, `security/lockdowns`, `security` (**`@Patch session-policy`**),
  `security/retention-rules`, `security/sessions`.
- DB: migrations **264** (ip_block_rules), **265** (security_incidents), **266** (security_policies),
  **267** (emergency_lockdowns), **269** (data_retention_rules), **148** (support_sessions).
- Covers 2FA/session policy, session revocation, IP blocking, emergency lockdown, incidents, data retention.
- Permission `SUPER_ADMIN`. Tests: **16 spec files**. **Status: Complete.**

## 6. Audit Logs  (tamper-resistant)
- `/audit-logs` (+ `/browse`) → `AuditLogsOverviewScreen` / `AuditLogsScreen` → `superAdminApi`
- `/super-admin/audit-logs` (`SuperAdminGuard`, `AuditLogsOverviewModule`); sensitive **POST** `legal-holds`
  (+ `/:id/release`), **`tamper-controls`** (+ `/:key/verify`), `retention-policies`.
- DB: migrations **291** (audit_tamper_controls), **293** (audit_retention_policies), **288**
  (audit_legal_holds). Tamper verification + retention + legal hold on the audit trail itself.
- Permission `SUPER_ADMIN`. **Status: Complete.**

## 7. Support Center  (support-mode access — time-limited + audited)
- `/support-access` → `SupportAccessScreen`; Support tickets → `SupportCenterScreen` → `superAdminSupportApi`
- `/super-admin/support` (`SuperAdminGuard`, `SuperAdminSupportModule`): `overview`, `tickets`,
  `tickets/:id`, `tickets/:id/reply`, `tickets/:id/status`, `tickets/:id/internal-note`.
- **Support sessions** (`/super-admin/platform/support-sessions`) are **step-up confirmed, time-limited
  (`expires`), and audited** — controlled tenant support access per spec.
- DB: migration **148** (support_sessions). Permission `SUPER_ADMIN`. Tests: 2. **Status: Complete.**

## 8. System Status / System Health
- `/system-status` → `SystemStatusScreen`; `/system-health` → `SystemHealthScreen` → `superAdminApi`
- `/super-admin/platform` (status) + `/super-admin/system-health` (`SuperAdminGuard`,
  `HealthModule`/`SystemHealthModule`). Operational / degraded / outage / maintenance states.
- Permission `SUPER_ADMIN`. **Status: Complete.**

## Invariants confirmed
- Integration credentials set/rotated/disabled server-side, audited (never exposed to frontend).
- Security surface: session-policy, session revocation, IP blocking, emergency lockdown, retention — all
  server-guarded + migration-backed.
- The audit trail itself has tamper-controls (with verify), legal holds, and retention policies.
- Support access is time-limited, step-up-confirmed, and audited.
- Billing (tenant→AIPowerSalon subscriptions) is separate from salon customer payments and memberships.
