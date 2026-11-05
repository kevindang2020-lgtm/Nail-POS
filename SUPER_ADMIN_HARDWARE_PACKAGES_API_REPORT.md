# SUPER_ADMIN_HARDWARE_PACKAGES_API_REPORT.md

All routes under `@Controller('super-admin/hardware-packages')` + `@UseGuards(SuperAdminGuard)` (super-admin only).
Errors: not_found → 404, conflict → **409**, bad_request/validation → 400.

| Method | Path | Purpose |
|---|---|---|
| GET | `/state` | One-shot: summary(8 KPIs+trends), filters, packages(filtered/sorted/paginated, deviceCount), pagination, packagesByStatus, topPackageTypes, recentHardwareActivity, recentHardwareEvents, selectedPackage detail, permissions, reference lists |
| GET | `/summary` · `/status-breakdown` · `/package-types` | Summary + status + type breakdowns |
| GET | `/activity/recent` · `/events` | Recent hardware activity / events (from audit_logs) |
| GET | `/tenants?search=` | Tenant picker for Assign modal |
| GET | `/export?…filters` | CSV of filtered packages (text/csv attachment) |
| GET | `/` | Filtered + sorted + paginated list |
| POST | `/` | Create / assign package (tenant required) + devices + note + audit |
| GET | `/:packageId` | Detail: package + devices + notes + normalizedStatus |
| PATCH | `/:packageId` | Edit package fields |
| PATCH | `/:packageId/status` | Update status (state-machine validated; `force` to override; 409 on invalid) |
| PATCH | `/:packageId/payment-status` | Update payment status (validated) |
| PATCH | `/:packageId/tracking` | Update carrier/tracking/dates; auto-advance to shipped |
| POST | `/:packageId/devices` | Add device serials (409 on duplicate) |
| POST | `/:packageId/notes` | Add internal note |
| POST | `/:packageId/cancel` | Cancel package |
| POST | `/:packageId/return` | Return package (only from shipped/delivered/installed/complete) |
| GET | `/super-admin/tenants/:tenantId/hardware` | Tenant detail hardware card (latest package + detail) |

Query params on list/state/export: search, status, paymentStatus, packageType, carrier, dateFrom, dateTo, tenantId,
sortBy, sortDirection, page, limit. Route ordering: literal sub-routes precede `:packageId`. The basic
`/super-admin/platform/hardware` endpoints remain for back-compat over the same table.
