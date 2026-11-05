# Super Admin Overview — Wiring Audit

Every module is wired to a real backend source via `GET /super-admin/overview/state` (SUPER_ADMIN-guarded). Nothing is
visual-only except where a source table does not exist yet — those are listed as **blocked** and surfaced in the UI's
"Documented data blockers" panel.

| Module | FE component | Backend | DB source | Click action | Permission | Status |
|---|---|---|---|---|---|---|
| 7 KPI cards | `KpiCard` | `/overview/state` | tenants, branches, tenant_applications, tenant_payment_config, tenant_daily_sales_summary, super_admin_support_sessions, payment_gateway_events | drill to module route | overview.view | working |
| Monthly Sales Volume | `LineChart` | `/overview/state` + `/overview/monthly-sales-volume?range=` | tenant_daily_sales_summary | Day/Week/Month/Year switch | overview.view | working |
| Tenants by Status | `Donut` | `/overview/state` | tenants.status | slice → `/tenants?status=` | overview.view | working |
| Recent Alerts | alert rows | `/overview/state` | derived: applications, payment config, hardware, gateway errors, support | row → target route; View All → `/audit-logs` | overview.view | working |
| Hardware Banner | `hwbanner` | `/overview/state` | hardware_packages, hardware_payment_invoices | iMac/Clover/Display → `/hardware-packages?type=` | hardware.assign | working |
| Top Performing Tenants | top rows | `/overview/state` | tenant_daily_sales_summary + tenants + branches | row → tenant; View Full Report → `/platform-reports` | reports.view | working |
| Recent Tenant Applications | `dtable` | `/overview/state` | tenant_applications | row → `/tenant-applications?focus=`; View All → `/tenant-applications` | overview.view | working |
| Hardware Packages | `Donut` | `/overview/state` | hardware_packages.status | slice → `/hardware-packages?status=` | overview.view | working |
| 6 Platform KPIs | `KpiCard` | `/overview/state` | users, branches, technicians, customers, appointments | drill to module route | overview.view | working (AI Interactions **blocked**) |
| Quick Actions | `qbtn` | `/overview/state` (permissions) | n/a | open route/modal; disabled+reason if no permission | per-action perms | working |
| Recent Activity | activity rows | `/overview/state` | audit_logs | — | overview.view | working |

**Blocked (documented, not faked):**
- `AI Interactions` — no `ai_usage_events` table; renders 0 with a "No usage source yet" note.
- `Open Support Tickets` — no support-ticket system; mapped to active `super_admin_support_sessions`.
- KPI trends (except Monthly Card Volume) — no historical snapshot table, so the arrow shows `—` rather than a fake delta. Card-volume trend is real (prior calendar month).
