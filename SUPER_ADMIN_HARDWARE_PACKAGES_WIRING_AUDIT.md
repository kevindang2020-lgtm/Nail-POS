# SUPER_ADMIN_HARDWARE_PACKAGES_WIRING_AUDIT.md

Per-module FE → endpoint → DB → permission → status. Whole surface gated by SuperAdminGuard.

| Module | Frontend | Backend endpoint | DB source | Action | Permission | Status |
|---|---|---|---|---|---|---|
| KPI cards (8) | KPI | GET /state (/summary) | hardware_packages | display | hardware.view | working |
| Search | filter input (debounced→URL) | GET /state?search | hardware_packages | filter | view | working |
| Filters (Status/Payment/Type/Carrier/Date) | selects→URL | GET /state?… | hardware_packages | filter | view | working |
| Clear Filters | button | GET /state | hardware_packages | reset (keeps tenantId) | view | working |
| Packages table | table | GET /state | hardware_packages + tenants/app/users | row→select | view | working |
| Pagination | pager | GET /state?page&limit | hardware_packages | page | view | working |
| Row select / detail panel | DetailPanel | GET /:packageId | hardware_packages + devices + notes | highlight + show | view | working |
| Assign Package | AssignModal | POST / | hardware_packages, devices, notes, audit_logs | create + reload | create/assign | working |
| Export | button | GET /export | hardware_packages | CSV download | export | working (CSV) |
| Refresh | button | GET /state | hardware_packages | reload | view | working |
| Update Tracking | TrackingModal | PATCH /:id/tracking | hardware_packages, audit_logs | save (+auto-ship) | tracking.update | working |
| Mark Delivered/Installed/Shipped/Ready/Complete | detail + kebab | PATCH /:id/status | hardware_packages, audit_logs | status (409 invalid) | status.update | working |
| Update Payment Status | (endpoint live; service) | PATCH /:id/payment-status | hardware_packages, audit_logs | payment | payment.update | working (detail-panel select) |
| Add Device Serials | (endpoint live; service) | POST /:id/devices | hardware_package_devices, audit_logs | add (409 dup) | devices.update | working (detail-panel form) |
| Add Internal Note | (endpoint live; service) | POST /:id/notes | hardware_package_notes, audit_logs | note | notes.create | working (detail-panel form) |
| Cancel / Return | kebab (confirm) | POST /:id/cancel · /return | hardware_packages, audit_logs | cancel/return | cancel/return | working |
| Open Tenant | detail + kebab | nav `/tenants?tenantId=` | — | navigate | tenant.view | working |
| Packages by Status | Donut | GET /state (packagesByStatus) | hardware_packages | click→status filter | view | working |
| Top Package Types | bars | GET /state (topPackageTypes) | hardware_packages | click→type filter | view | working |
| Recent Hardware Activity | feed | GET /state (recentHardwareActivity) | audit_logs | View All→/audit-logs | view | working |
| Recent Hardware Events | timeline | GET /state (recentHardwareEvents) | audit_logs | View All→/audit-logs | view | working |
| Tenant detail hardware card | TenantsScreen detail panel (live) | GET /super-admin/tenants/:id/hardware | hardware_packages | renders name/status/payment/tracking + View All | view | working |

Audit events written: hardware_package_created/assigned/updated/status_changed/payment_status_changed/tracking_updated/
device_added/note_added/cancelled/returned + tenant_hardware_status_updated.
