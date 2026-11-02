# Salon Location API Map

## Tenant (TenantAuthGuard + RolePermissionGuard, tenant-scoped server-side)
- `GET  /tenant/locations` — list + summary KPIs · `locations.view`
- `POST /tenant/locations` — create (duplicate detection) · `locations.create`
- `POST /tenant/locations/geocode` — address search (server key) · `locations.update`
- `GET  /tenant/locations/:id` · `locations.view`
- `PATCH /tenant/locations/:id` — update fields · `locations.update`
- `POST /tenant/locations/:id/apply-address` — apply a geocoded hit · `locations.map.update`
- `PATCH /tenant/locations/:id/map-pin` — move pin (reverse-geocode + history) · `locations.map.update`
- `POST /tenant/locations/:id/confirm-pin` — confirm (accuracy=exact) · `locations.map.update`
- `POST /tenant/locations/:id/publish` — publish (readiness gate) · `locations.publish`
- `POST /tenant/locations/:id/unpublish` · `locations.unpublish`
- `GET  /tenant/locations/:id/public-preview` — customer-safe projection · `locations.view`

## Super Admin (SuperAdminGuard)
- `GET  /super-admin/tenant-locations?search=&status=`
- `GET  /super-admin/tenant-locations/summary`
- `GET  /super-admin/tenant-locations/:id` (+ map history)
- `POST /super-admin/tenant-locations/:id/verify|reject|suspend`
- `PATCH /super-admin/tenant-locations/:id/map-pin`

## Customer (public, rate-limited 30/min/IP) — EXISTING, reused
- `GET /customer/salons/nearby?lat=&lng=&radiusMiles=&city=&state=&zip=&searchText=`
- `GET /customer/salons/:salonId`
- `GET /customer/salons/:salonId/services`

Public responses never include manager contact, internal notes, gateway/subscription, or private data.
