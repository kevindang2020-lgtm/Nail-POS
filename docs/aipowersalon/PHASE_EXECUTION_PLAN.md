# PHASE EXECUTION PLAN — AI PowerSalon (Phase 0)

Adopts the master prompt's phased model, mapped to this codebase's canonical targets (pos-web = tenant, admin-web = super admin). Each phase ends with a test gate; no phase proceeds until its gate passes and you approve. "Verified" always means commands actually run and inspected.

- **Phase 0 — Discovery/audit/baseline (THIS DELIVERABLE).** Audit done; baseline green (api 690, 1,277 total); 7 docs produced; canonical apps/shells chosen; duplication + new-table risks registered. Gate: ✅ duplicate/tenant/security risks identified before any UI change.
- **Phase 1 — Shared design system + the two shells.** Extract canonical tokens (cream/gold tenant, bright-white SA) + shared components (AppShell, TenantSidebar from `tenant-nav.tsx`, SuperAdminSidebar reshaped to S01 IA, TopHeader, BranchSelector, GlobalSearch, KpiCard, MetricStrip, ChartCard, DataTable, FilterBar, StatusBadge, HealthGauge, Drawer, Modal, EmptyState, LoadingSkeleton, ErrorState, PermissionGate). Reconcile pos-web/owner-web overlap. Gate: visual parity at 1440×900 / 1920×1080 (tenant) and iPad portrait/landscape (SA), no horizontal overflow, keyboard nav, builds pass.
- **Phase 2 — Auth/tenant/RBAC/audit foundation.** Confirm + tighten existing guards; stand up unified audit_events; SA separation. Gate: cross-tenant + unauthorized-route + audit negative tests pass.
- **Phase 3 — Tenant operational core (T01,T03–T09).** Mostly KEEP+align existing verified screens to the pictures + finish T01 dashboard composition. Gate: full appointment→check-in→queue→serving→done→checkout E2E + realtime + concurrency pass; no mock data.
- **Phase 4 — Tenant CRM/team/catalog/analytics (T02,T10,T11,T12).** EXPAND/MERGE. Gate: import/dedupe, role/skill/commission, inventory/branch-sync, tenant-scoped analytics tests.
- **Phase 5 — Tenant payments completion (T09 pay, T13).** EXPAND money surface. Gate: success/failure/retry/refund/void/dispute/reconciliation + webhook idempotency; no sensitive card data; totals reconcile.
- **Phase 6 — Tenant comms/growth/AI/reports (T14,T15,T16,T17).** New campaigns/promotions/comms + tenant AI Center; align reports. Gate: consent/opt-out, template/delivery, attribution, AI-action safety, report reconciliation/export.
- **Phase 7 — Tenant management/devices/account/help (T18,T19,T20,T21).** Gate: device/integration failure, account/security, support-ticket, tenant permissions.
- **Phase 8 — SA overview/ops foundation (S01–S05).** Reshape SA shell; split Overview/Dashboard; Branches; Users&Roles. Gate: platform aggregation, branch drill-down, role tests, iPad visual.
- **Phase 9 — SA operational modules (S06–S08 + pictureless Customers/Staff/Booking&Check-in/Queue).** Gate: cross-tenant read controls, support-action audit, catalog/stock/calendar/queue reconciliation, responsive tables.
- **Phase 10 — SA money/growth/loyalty/comms (S09–S12 + Loyalty).** Gate: financial aggregation/reconciliation, attribution, consent, tenant credential isolation.
- **Phase 11 — SA AI/automation (S13–S16).** Gate: deterministic metrics, model/forecast traceability, automation idempotency, retry/DLQ, approval/safety.
- **Phase 12 — SA settings/governance (S17–S23).** Gate: subscription/dunning/usage, secrets/webhook, device remote-action, security/compliance, audit integrity/retention, help/ticket/onboarding.
- **Phase 13 — Cross-module reconciliation & resilience.** Event replay, duplicate webhook/job, partial failure, reconnect/offline, financial/inventory/loyalty/commission reconciliation. Gate: no unreconciled critical paths.
- **Phase 14 — Performance/a11y/security hardening.** Gate: perf budgets, no critical security findings, WCAG interaction checks.
- **Phase 15 — UAT/migration/deploy/docs.** Gate: signed UAT, backup/rollback verified, smoke-test plan approved.

## Immediate next (Phase 1) on your approval
1. Tokens module shared by pos-web + admin-web (no per-page styling).
2. Canonical `TenantSidebar` from the existing `tenant-nav.tsx` (already the T01 IA) + `POSLayout` → AppShell.
3. Canonical `SuperAdminSidebar`: reshape `AdminLayout` NAV to the exact S01 order (Overview/Dashboard/Analytics → OPERATION / BUSINESS / AI & AUTOMATION / SYSTEM SETTINGS), keeping existing extra modules under the right group, every item routed (no dead links).
4. Shared KpiCard/DataTable/ChartCard/FilterBar/Drawer/StatusBadge/EmptyState/Loading/Error + PermissionGate.
5. Reconcile owner-web overlap to call the same services.
Gate: visual parity + responsive + builds + existing 1,277 tests still green + new shell tests.
